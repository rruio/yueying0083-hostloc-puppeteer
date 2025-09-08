const { exec, spawn } = require('child_process');
const https = require('https');
const http = require('http');
const net = require('net');
const { format } = require('date-fns');
const { SocksProxyAgent } = require('socks-proxy-agent');

/**
 * WARP IP轮换管理器
 * 负责重启WireProxy服务以获得新的出口IP
 */
class WarpManager {
  constructor() {
    this.isRotationEnabled = process.env.WARP_IP_ROTATION === 'true';
    this.socks5Host = process.env.WARP_SOCKS5_HOST || '127.0.0.1';
    this.socks5Port = process.env.WARP_SOCKS5_PORT || '1080';
    this.wireproxyConfigPath = process.env.WIREPROXY_CONFIG_PATH || './wireproxy.conf';
    this.wireproxyBinary = process.env.WIREPROXY_BINARY || 'wireproxy';
    this.wireproxyProcess = null;
    this.startupTimeout = null;
    this.healthCheckInterval = null;
    this.lastHealthCheck = null;
    this.healthCheckFailures = 0;
    this.maxHealthCheckFailures = 3;
    this.tempConfigPath = null; // 临时配置文件路径
    this.ipCache = null; // IP缓存
    this.ipCacheExpiry = null; // IP缓存过期时间
    this.ipCacheDuration = 5 * 60 * 1000; // IP缓存5分钟
  }

  /**
   * 日志函数
   */
  log(message, accountId = null) {
    const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
    const prefix = accountId ? `[账号${accountId}]` : '';
    console.log(`[${timestamp}]${prefix} [WARP] ${message}`);
  }

  /**
   * 执行系统命令的Promise包装
   */
  execPromise(command, options = {}) {
    return new Promise((resolve, reject) => {
      exec(command, options, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  }

  /**
   * 重启WireProxy服务
   * 通过kill进程并重新启动来获得新的IP
   */
  async restartWarpService(accountId = null) {
    if (!this.isRotationEnabled) {
      this.log('IP轮换功能已禁用，跳过重启', accountId);
      return true;
    }

    try {
      this.log('开始重启WireProxy服务...', accountId);

      // 查找并终止现有的wireproxy进程
      await this.killExistingWireproxyProcesses(accountId);

      // 等待进程完全终止
      await this.sleep(2000);

      // 重新启动WireProxy
      await this.startWireproxy(accountId);

      // 等待服务启动
      await this.waitForWarpReady(accountId);

      this.log('WireProxy服务重启完成', accountId);
      return true;
    } catch (error) {
      this.log(`重启WireProxy服务失败: ${error.message}`, accountId);
      throw error;
    }
  }

  /**
   * 终止现有的wireproxy进程
   */
  async killExistingWireproxyProcesses(accountId = null) {
    try {
      // 使用pgrep查找wireproxy进程
      const { stdout } = await this.execPromise('pgrep -f wireproxy || true');
      const pids = stdout.trim().split('\n').filter(pid => pid);

      if (pids.length > 0) {
        this.log(`发现 ${pids.length} 个wireproxy进程，正在终止...`, accountId);
        try {
          // 优雅终止
          await this.execPromise(`kill ${pids.join(' ')}`);
          // 等待5秒，如果还没终止则强制终止
          await this.sleep(5000);
          await this.execPromise(`kill -9 ${pids.join(' ')} || true`);
          this.log('wireproxy进程已终止', accountId);
        } catch (killError) {
          this.log(`终止wireproxy进程失败: ${killError.message}`, accountId);
          // 继续执行，不抛出错误
        }
      } else {
        this.log('未发现运行中的wireproxy进程', accountId);
      }
    } catch (error) {
      this.log(`查找wireproxy进程时出错: ${error.message}`, accountId);
      // 不抛出错误，继续执行，但记录更详细的错误信息
    }
  }

  /**
   * 检查端口是否正在监听
   */
  async checkPortListening(host, port, timeout = 5000) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, timeout);

      socket.connect(port, host, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      });

      socket.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }

  /**
   * 启动WireProxy
   */
  async startWireproxy(accountId = null) {
    return new Promise(async (resolve, reject) => {
      let portCheckInterval = null;
      let startupTimeout = null;

      try {
        this.log(`启动WireProxy: ${this.wireproxyBinary} -c ${this.wireproxyConfigPath}`, accountId);

        // 检查配置文件是否存在
        const fs = require('fs').promises;
        const fsSync = require('fs');
        const path = require('path');

        if (!fsSync.existsSync(this.wireproxyConfigPath)) {
          throw new Error(`WireProxy配置文件不存在: ${this.wireproxyConfigPath}`);
        }

        // 检查WireProxy二进制文件是否存在，并防止命令注入
        const binaryPath = this.wireproxyBinary;
        if (!binaryPath || typeof binaryPath !== 'string' || binaryPath.trim() === '') {
          throw new Error('WireProxy二进制文件路径无效');
        }

        // 验证路径不包含危险字符
        if (/[;&|`$()<>]/.test(binaryPath)) {
          throw new Error('WireProxy二进制文件路径包含危险字符');
        }

        try {
          await this.execPromise(`which "${binaryPath}"`);
        } catch (error) {
          throw new Error(`WireProxy二进制文件未找到: ${binaryPath}`);
        }

        // 异步读取并处理配置文件，进行环境变量替换
        let configContent = await fs.readFile(this.wireproxyConfigPath, 'utf8');

        // 检查并替换环境变量
        const warpPrivateKey = process.env.WARP_PRIVATE_KEY;
        if (!warpPrivateKey) {
          throw new Error('环境变量 WARP_PRIVATE_KEY 未设置');
        }

        // 安全地替换环境变量，支持特殊字符转义
        configContent = configContent.replace(/\$\{WARP_PRIVATE_KEY\}/g, warpPrivateKey.replace(/[\\$]/g, '\\$&'));

        // 创建临时配置文件，设置安全权限
        const tempDir = require('os').tmpdir();
        this.tempConfigPath = path.join(tempDir, `wireproxy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.conf`);
        await fs.writeFile(this.tempConfigPath, configContent, { mode: 0o600, encoding: 'utf8' });

        this.log(`已创建临时配置文件: ${this.tempConfigPath}`, accountId);

        // 启动WireProxy进程，使用临时配置文件
        this.wireproxyProcess = spawn(this.wireproxyBinary, ['-c', this.tempConfigPath], {
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        // 设置子进程独立运行
        this.wireproxyProcess.unref();

        this.log(`WireProxy进程已启动，PID: ${this.wireproxyProcess.pid}`, accountId);

        // 设置启动超时
        startupTimeout = setTimeout(() => {
          this.log('WireProxy启动超时，正在终止进程...', accountId);
          if (this.wireproxyProcess && !this.wireproxyProcess.killed) {
            this.wireproxyProcess.kill('SIGTERM');
            setTimeout(() => {
              if (this.wireproxyProcess && !this.wireproxyProcess.killed) {
                this.wireproxyProcess.kill('SIGKILL');
              }
            }, 5000);
          }
          reject(new Error('WireProxy启动超时'));
        }, 30000);

        let startupDetected = false;

        // 监听stdout
        this.wireproxyProcess.stdout.on('data', (data) => {
          const output = data.toString();
          // 避免记录可能包含敏感信息的完整输出，只记录状态信息
          if (output.includes('SOCKS5') || output.includes('listening') || output.includes('ready')) {
            this.log('WireProxy启动状态信息已接收', accountId);
          }

          // 检查启动成功标志
          if (!startupDetected && (output.includes('SOCKS5') || output.includes('listening') || output.includes('ready'))) {
            startupDetected = true;
            this.log('检测到WireProxy启动成功信号', accountId);
          }
        });

        // 监听stderr
        this.wireproxyProcess.stderr.on('data', (data) => {
          const error = data.toString();
          // 避免记录可能包含敏感信息的错误详情，只记录错误类型
          if (error.includes('error') || error.includes('Error') || error.includes('failed')) {
            this.log('WireProxy进程报告错误', accountId);
          }
        });

        // 监听进程错误
        this.wireproxyProcess.on('error', (error) => {
          this.clearStartupTimeout();
          this.log(`WireProxy进程启动失败: ${error.message}`, accountId);
          reject(new Error(`WireProxy进程启动失败: ${error.message}`));
        });

        // 监听进程退出
        this.wireproxyProcess.on('close', (code) => {
          this.clearStartupTimeout();
          if (code !== 0 && code !== null) {
            this.log(`WireProxy进程异常退出，退出码: ${code}`, accountId);
            reject(new Error(`WireProxy进程异常退出，退出码: ${code}`));
          }
        });

        // 定期检查端口是否监听
        portCheckInterval = setInterval(async () => {
          if (await this.checkPortListening(this.socks5Host, parseInt(this.socks5Port))) {
            clearInterval(portCheckInterval);
            portCheckInterval = null;
            this.clearStartupTimeout();
            this.log(`WireProxy端口 ${this.socks5Host}:${this.socks5Port} 已开始监听`, accountId);

            // 启动健康检查
            this.startHealthCheck(accountId);

            // 注意：成功启动后不清理临时文件，因为WireProxy进程仍在使用它
            // 临时文件将在进程退出时或cleanup()方法中清理

            resolve();
          }
        }, 1000);

        // 如果10秒后仍未检测到端口监听，则认为启动失败
        setTimeout(() => {
          if (!this.wireproxyProcess.killed) {
            if (portCheckInterval) {
              clearInterval(portCheckInterval);
              portCheckInterval = null;
            }
            this.clearStartupTimeout();
            this.log('WireProxy端口监听检测超时', accountId);
            reject(new Error('WireProxy端口监听检测超时'));
          }
        }, 10000);

      } catch (error) {
        this.clearStartupTimeout();
        this.log(`启动WireProxy失败: ${error.message}`, accountId);
        reject(error);
      } finally {
        // 确保资源清理
        if (portCheckInterval) {
          clearInterval(portCheckInterval);
        }
        if (startupTimeout) {
          clearTimeout(startupTimeout);
        }
        // 清理临时文件（如果启动失败）
        if (this.tempConfigPath && !this.wireproxyProcess) {
          this.cleanupTempConfig(accountId);
        }
      }
    });
  }

  /**
   * 清除启动超时
   */
  clearStartupTimeout() {
    if (this.startupTimeout) {
      clearTimeout(this.startupTimeout);
      this.startupTimeout = null;
    }
  }

  /**
   * 启动健康检查
   */
  startHealthCheck(accountId = null) {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        const isHealthy = await this.performHealthCheck(accountId);
        if (isHealthy) {
          this.lastHealthCheck = new Date();
          this.healthCheckFailures = 0;
        } else {
          this.healthCheckFailures++;
          this.log(`健康检查失败 ${this.healthCheckFailures}/${this.maxHealthCheckFailures}`, accountId);

          if (this.healthCheckFailures >= this.maxHealthCheckFailures) {
            this.log('健康检查失败次数过多，准备重启WireProxy', accountId);
            this.restartWireproxyOnFailure(accountId);
          }
        }
      } catch (error) {
        this.healthCheckFailures++;
        this.log(`健康检查异常: ${error.message}`, accountId);

        if (this.healthCheckFailures >= this.maxHealthCheckFailures) {
          this.log('健康检查异常次数过多，准备重启WireProxy', accountId);
          this.restartWireproxyOnFailure(accountId);
        }
      }
    }, 30000); // 每30秒检查一次

    this.log('WireProxy健康检查已启动', accountId);
  }

  /**
   * 执行健康检查
   */
  async performHealthCheck(accountId = null) {
    try {
      // 1. 检查端口是否监听
      const portListening = await this.checkPortListening(this.socks5Host, parseInt(this.socks5Port), 2000);
      if (!portListening) {
        this.log('健康检查失败: SOCKS5端口未监听', accountId);
        return false;
      }

      // 2. 测试SOCKS5代理连接
      const proxyWorking = await this.testSocks5Proxy(accountId);
      if (!proxyWorking) {
        this.log('健康检查失败: SOCKS5代理测试失败', accountId);
        return false;
      }

      // 3. 测试网络连通性
      const networkWorking = await this.testNetworkConnectivity(accountId);
      if (!networkWorking) {
        this.log('健康检查失败: 网络连通性测试失败', accountId);
        return false;
      }

      return true;
    } catch (error) {
      this.log(`健康检查过程中发生错误: ${error.message}`, accountId);
      return false;
    }
  }

  /**
   * 测试SOCKS5代理
   */
  async testSocks5Proxy(accountId = null) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 5000);

      socket.connect(parseInt(this.socks5Port), this.socks5Host, () => {
        // 发送SOCKS5握手
        const handshake = Buffer.from([0x05, 0x01, 0x00]); // SOCKS5, 1 method, no auth
        socket.write(handshake);
      });

      socket.on('data', (data) => {
        clearTimeout(timeout);
        // 检查SOCKS5响应
        if (data.length >= 2 && data[0] === 0x05 && data[1] === 0x00) {
          socket.destroy();
          resolve(true);
        } else {
          socket.destroy();
          resolve(false);
        }
      });

      socket.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }

  /**
   * 测试网络连通性
   */
  async testNetworkConnectivity(accountId = null) {
    try {
      const ip = await this.getCurrentWarpIp(accountId);
      return ip && ip !== '127.0.0.1' && ip !== 'localhost';
    } catch (error) {
      return false;
    }
  }

  /**
   * 故障时重启WireProxy
   */
  async restartWireproxyOnFailure(accountId = null) {
    try {
      this.log('开始故障恢复: 重启WireProxy', accountId);
      await this.restartWarpService(accountId);
      this.healthCheckFailures = 0;
      this.log('WireProxy故障恢复完成', accountId);
    } catch (error) {
      this.log(`WireProxy故障恢复失败: ${error.message}`, accountId);
      // 如果恢复失败，增加重试间隔
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = setInterval(async () => {
          await this.restartWireproxyOnFailure(accountId);
        }, 60000); // 1分钟后重试
      }
    }
  }

  /**
   * 停止健康检查
   */
  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * 等待Warp服务就绪
   */
  async waitForWarpReady(accountId = null, maxRetries = 10) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const isHealthy = await this.performHealthCheck(accountId);
        if (isHealthy) {
          const ip = await this.getCurrentWarpIp(accountId);
          this.log(`Warp服务就绪，当前IP: ${ip}`, accountId);
          return true;
        }
      } catch (error) {
        this.log(`等待Warp服务就绪，重试 ${i + 1}/${maxRetries}: ${error.message}`, accountId);
      }
      await this.sleep(2000);
    }
    throw new Error('Warp服务启动超时');
  }

  /**
   * 获取当前出口IP
   * 通过httpbin.org/ip获取当前IP地址，支持缓存机制
   */
  async getCurrentWarpIp(accountId = null) {
    const now = Date.now();

    // 检查缓存是否有效
    if (this.ipCache && this.ipCacheExpiry && now < this.ipCacheExpiry) {
      this.log(`使用缓存的IP地址: ${this.ipCache}`, accountId);
      return this.ipCache;
    }

    const startTime = now;

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'httpbin.org',
        port: 443,
        path: '/ip',
        method: 'GET',
        timeout: 15000, // 增加超时时间
        headers: {
          'User-Agent': 'WireProxy-HealthCheck/1.0'
        },
        // 配置SOCKS5代理
        agent: new SocksProxyAgent(`socks5://${this.socks5Host}:${this.socks5Port}`)
      };

      this.log(`开始获取出口IP，通过代理 ${this.socks5Host}:${this.socks5Port}`, accountId);

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          const duration = Date.now() - startTime;
          this.log(`IP请求完成，耗时: ${duration}ms`, accountId);

          try {
            const jsonData = JSON.parse(data);
            const ip = jsonData.origin;

            if (!ip || ip === '127.0.0.1' || ip === 'localhost') {
              reject(new Error(`获取到无效IP地址: ${ip}`));
              return;
            }

            // 更新缓存
            this.ipCache = ip;
            this.ipCacheExpiry = Date.now() + this.ipCacheDuration;

            this.log(`成功获取出口IP: ${ip}`, accountId);
            resolve(ip);
          } catch (error) {
            this.log(`解析IP响应失败: ${error.message}`, accountId);
            reject(new Error(`解析IP响应失败: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        const duration = Date.now() - startTime;
        this.log(`获取IP请求失败，耗时: ${duration}ms, 错误: ${error.message}`, accountId);
        reject(new Error(`获取IP失败: ${error.message}`));
      });

      req.on('timeout', () => {
        const duration = Date.now() - startTime;
        this.log(`获取IP请求超时，耗时: ${duration}ms`, accountId);
        req.destroy();
        reject(new Error('获取IP请求超时'));
      });

      req.end();
    });
  }

  /**
   * 检查IP轮换功能是否启用
   */
  isEnabled() {
    return this.isRotationEnabled;
  }

  /**
   * 休眠函数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 清理临时配置文件
   */
  cleanupTempConfig(accountId = null) {
    if (this.tempConfigPath) {
      const fs = require('fs');
      if (fs.existsSync(this.tempConfigPath)) {
        try {
          fs.unlinkSync(this.tempConfigPath);
          this.log(`已清理临时配置文件: ${this.tempConfigPath}`, accountId);
        } catch (error) {
          this.log(`清理临时文件失败: ${error.message}`, accountId);
        }
      }
      this.tempConfigPath = null;
    }
  }

  /**
   * 清理IP缓存
   */
  clearIpCache() {
    this.ipCache = null;
    this.ipCacheExpiry = null;
    this.log('IP缓存已清理');
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.stopHealthCheck();
    this.clearStartupTimeout();

    // 清理临时配置文件
    this.cleanupTempConfig();

    // 清理IP缓存
    this.clearIpCache();

    if (this.wireproxyProcess && !this.wireproxyProcess.killed) {
      try {
        this.wireproxyProcess.kill('SIGTERM');
        // 等待进程优雅退出
        setTimeout(() => {
          if (!this.wireproxyProcess.killed) {
            this.wireproxyProcess.kill('SIGKILL');
          }
        }, 5000);
      } catch (error) {
        // 忽略清理过程中的错误
      }
    }

    this.wireproxyProcess = null;
    this.log('WireProxy管理器资源已清理');
  }

  /**
   * 获取性能统计信息
   */
  getPerformanceStats(accountId = null) {
    const stats = {
      uptime: this.wireproxyProcess ? Date.now() - this.wireproxyProcess.spawnTime : 0,
      lastHealthCheck: this.lastHealthCheck,
      healthCheckFailures: this.healthCheckFailures,
      processPid: this.wireproxyProcess ? this.wireproxyProcess.pid : null,
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };

    this.log(`性能统计: ${JSON.stringify(stats, null, 2)}`, accountId);
    return stats;
  }

  /**
   * 获取WireProxy状态信息
   */
  getStatus(accountId = null) {
    const status = {
      enabled: this.isEnabled(),
      processRunning: this.wireproxyProcess && !this.wireproxyProcess.killed,
      processPid: this.wireproxyProcess ? this.wireproxyProcess.pid : null,
      lastHealthCheck: this.lastHealthCheck,
      healthCheckFailures: this.healthCheckFailures,
      socks5Host: this.socks5Host,
      socks5Port: this.socks5Port,
      configPath: this.wireproxyConfigPath,
      binaryPath: this.wireproxyBinary
    };

    this.log(`WireProxy状态: ${JSON.stringify(status, null, 2)}`, accountId);
    return status;
  }

  /**
   * 强制终止WireProxy进程
   */
  async forceKillWireproxy(accountId = null) {
    try {
      this.stopHealthCheck();

      if (this.wireproxyProcess && !this.wireproxyProcess.killed) {
        this.log(`强制终止WireProxy进程 (PID: ${this.wireproxyProcess.pid})`, accountId);
        this.wireproxyProcess.kill('SIGKILL');
        await this.sleep(1000);
      }

      // 清理可能残留的进程
      await this.killExistingWireproxyProcesses(accountId);
      this.wireproxyProcess = null;

      this.log('WireProxy进程已完全终止', accountId);
    } catch (error) {
      this.log(`强制终止WireProxy进程失败: ${error.message}`, accountId);
      throw error;
    }
  }

  /**
   * 执行IP轮换（主要入口函数）
   */
  async rotateIp(accountId = null) {
    if (!this.isEnabled()) {
      this.log('IP轮换功能未启用', accountId);
      return null;
    }

    const startTime = Date.now();
    let oldIp = null;
    let newIp = null;

    try {
      this.log('开始执行IP轮换...', accountId);

      // 清理IP缓存，确保获取最新的IP
      this.clearIpCache();

      // 获取轮换前的IP
      oldIp = await this.getCurrentWarpIp(accountId);
      this.log(`轮换前IP: ${oldIp}`, accountId);

      // 停止健康检查，避免干扰重启过程
      this.stopHealthCheck();

      // 重启服务
      await this.restartWarpService(accountId);

      // 等待服务稳定
      await this.sleep(3000);

      // 获取轮换后的IP
      newIp = await this.getCurrentWarpIp(accountId);
      this.log(`轮换后IP: ${newIp}`, accountId);

      const duration = Date.now() - startTime;
      const success = oldIp !== newIp;

      if (success) {
        this.log(`IP轮换成功: ${oldIp} -> ${newIp} (耗时: ${duration}ms)`, accountId);
      } else {
        this.log(`IP轮换完成，但IP未改变: ${newIp} (耗时: ${duration}ms)`, accountId);
      }

      // 重新启动健康检查
      if (this.wireproxyProcess && !this.wireproxyProcess.killed) {
        this.startHealthCheck(accountId);
      }

      return {
        oldIp,
        newIp,
        changed: success,
        duration,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.log(`IP轮换失败 (耗时: ${duration}ms): ${error.message}`, accountId);

      // 即使失败也要尝试重新启动健康检查
      try {
        if (this.wireproxyProcess && !this.wireproxyProcess.killed) {
          this.startHealthCheck(accountId);
        }
      } catch (healthCheckError) {
        this.log(`重启健康检查失败: ${healthCheckError.message}`, accountId);
      }

      throw error;
    }
  }
}

// 创建单例实例
const warpManagerInstance = new WarpManager();

// 添加进程退出时的清理逻辑
process.on('SIGINT', () => {
  console.log('接收到SIGINT信号，正在清理WireProxy资源...');
  warpManagerInstance.cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('接收到SIGTERM信号，正在清理WireProxy资源...');
  warpManagerInstance.cleanup();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
  warpManagerInstance.cleanup();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
  warpManagerInstance.cleanup();
  process.exit(1);
});

// 导出单例实例
module.exports = warpManagerInstance;