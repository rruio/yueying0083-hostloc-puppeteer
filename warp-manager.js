const { exec, spawn } = require('child_process');
const https = require('https');
const http = require('http');
const { format } = require('date-fns');

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
        // 优雅终止
        await this.execPromise(`kill ${pids.join(' ')}`);
        // 等待5秒，如果还没终止则强制终止
        await this.sleep(5000);
        await this.execPromise(`kill -9 ${pids.join(' ')} || true`);
        this.log('wireproxy进程已终止', accountId);
      } else {
        this.log('未发现运行中的wireproxy进程', accountId);
      }
    } catch (error) {
      this.log(`终止wireproxy进程时出错: ${error.message}`, accountId);
      // 不抛出错误，继续执行
    }
  }

  /**
   * 启动WireProxy
   */
  async startWireproxy(accountId = null) {
    return new Promise((resolve, reject) => {
      this.log(`启动WireProxy: ${this.wireproxyBinary} -c ${this.wireproxyConfigPath}`, accountId);

      const wireproxyProcess = spawn(this.wireproxyBinary, ['-c', this.wireproxyConfigPath], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // 设置子进程独立运行
      wireproxyProcess.unref();

      // 监听输出
      let startupTimeout = setTimeout(() => {
        reject(new Error('WireProxy启动超时'));
      }, 30000); // 30秒超时

      wireproxyProcess.stdout.on('data', (data) => {
        const output = data.toString();
        this.log(`WireProxy输出: ${output.trim()}`, accountId);

        // 检查是否成功启动
        if (output.includes('SOCKS5') || output.includes('listening') || output.includes('ready')) {
          clearTimeout(startupTimeout);
          resolve();
        }
      });

      wireproxyProcess.stderr.on('data', (data) => {
        const error = data.toString();
        this.log(`WireProxy错误: ${error.trim()}`, accountId);
      });

      wireproxyProcess.on('error', (error) => {
        clearTimeout(startupTimeout);
        reject(error);
      });

      wireproxyProcess.on('close', (code) => {
        clearTimeout(startupTimeout);
        if (code !== 0) {
          reject(new Error(`WireProxy进程异常退出，退出码: ${code}`));
        }
      });

      // 如果没有检测到启动信息，3秒后也认为启动成功
      setTimeout(() => {
        clearTimeout(startupTimeout);
        resolve();
      }, 3000);
    });
  }

  /**
   * 等待Warp服务就绪
   */
  async waitForWarpReady(accountId = null, maxRetries = 10) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const ip = await this.getCurrentWarpIp(accountId);
        if (ip) {
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
   * 通过httpbin.org/ip获取当前IP地址
   */
  async getCurrentWarpIp(accountId = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'httpbin.org',
        port: 443,
        path: '/ip',
        method: 'GET',
        timeout: 10000,
        // 配置SOCKS5代理
        agent: new (require('socks-proxy-agent').SocksProxyAgent)(`socks5://${this.socks5Host}:${this.socks5Port}`)
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            const ip = jsonData.origin;
            resolve(ip);
          } catch (error) {
            reject(new Error(`解析IP响应失败: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`获取IP失败: ${error.message}`));
      });

      req.on('timeout', () => {
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
   * 执行IP轮换（主要入口函数）
   */
  async rotateIp(accountId = null) {
    if (!this.isEnabled()) {
      this.log('IP轮换功能未启用', accountId);
      return null;
    }

    try {
      this.log('开始执行IP轮换...', accountId);

      // 获取轮换前的IP
      const oldIp = await this.getCurrentWarpIp(accountId);
      this.log(`轮换前IP: ${oldIp}`, accountId);

      // 重启服务
      await this.restartWarpService(accountId);

      // 获取轮换后的IP
      const newIp = await this.getCurrentWarpIp(accountId);
      this.log(`轮换后IP: ${newIp}`, accountId);

      if (oldIp !== newIp) {
        this.log(`IP轮换成功: ${oldIp} -> ${newIp}`, accountId);
      } else {
        this.log(`IP轮换完成，但IP未改变: ${newIp}`, accountId);
      }

      return {
        oldIp,
        newIp,
        changed: oldIp !== newIp
      };
    } catch (error) {
      this.log(`IP轮换失败: ${error.message}`, accountId);
      throw error;
    }
  }
}

// 导出单例实例
module.exports = new WarpManager();