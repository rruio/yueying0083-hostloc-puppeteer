#!/usr/bin/env node

/**
 * IP API测试脚本
 * 专门测试多API备选机制和故障转移功能
 */

const { SocksProxyAgent } = require('socks-proxy-agent');
const https = require('https');
const http = require('http');

class IpApiTester {
  constructor(useProxy = false) {
    // 代理配置（可选）
    this.useProxy = useProxy;
    this.socks5Host = '127.0.0.1';
    this.socks5Port = '1080';

    // IP检测API配置数组
    this.ipApis = [
      {
        name: 'ip-api.com',
        hostname: 'ip-api.com',
        port: 80,
        path: '/json/',
        method: 'GET',
        responseType: 'json',
        ipField: 'query',
        timeout: 10000
      },
      {
        name: 'icanhazip.com',
        hostname: 'icanhazip.com',
        port: 80,
        path: '/',
        method: 'GET',
        responseType: 'text',
        timeout: 10000
      },
      {
        name: 'ipify.org',
        hostname: 'api.ipify.org',
        port: 80,
        path: '/',
        method: 'GET',
        responseType: 'text',
        timeout: 10000
      }
    ];
  }

  log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
  }

  /**
   * 测试单个API
   */
  async testSingleApi(api) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: api.hostname,
        port: api.port,
        path: api.path,
        method: api.method,
        timeout: api.timeout,
        headers: {
          'User-Agent': 'WireProxy-HealthCheck/1.0'
        }
      };

      // 只有在使用代理模式时才配置代理
      if (this.useProxy) {
        options.agent = new SocksProxyAgent(`socks5://${this.socks5Host}:${this.socks5Port}`);
      }

      const req = (api.port === 443 ? https : http).request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            let ip;

            if (api.responseType === 'json') {
              const jsonData = JSON.parse(data);
              ip = jsonData[api.ipField] || jsonData.origin;
            } else if (api.responseType === 'text') {
              ip = data.trim();
            }

            // 验证IP地址格式
            const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
            if (!ipRegex.test(ip)) {
              reject(new Error(`无效的IP地址格式: ${ip}`));
              return;
            }

            resolve(ip);
          } catch (error) {
            reject(new Error(`解析API响应失败: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`API请求失败: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('API请求超时'));
      });

      req.end();
    });
  }

  /**
   * 测试多API备选机制
   */
  async testMultiApiFallback() {
    this.log(`开始测试多API备选机制，共有 ${this.ipApis.length} 个API`);

    for (let i = 0; i < this.ipApis.length; i++) {
      const api = this.ipApis[i];
      const attemptStartTime = Date.now();

      try {
        this.log(`尝试API ${i + 1}/${this.ipApis.length}: ${api.name}`);

        const ip = await this.testSingleApi(api);
        const attemptDuration = Date.now() - attemptStartTime;

        if (!ip || ip === '127.0.0.1' || ip === 'localhost') {
          this.log(`API ${api.name} 返回无效IP地址: ${ip}，尝试下一个API`);
          continue;
        }

        this.log(`API ${api.name} 成功获取IP: ${ip} (耗时: ${attemptDuration}ms)`);
        return { success: true, ip, api: api.name, duration: attemptDuration };

      } catch (error) {
        const attemptDuration = Date.now() - attemptStartTime;
        this.log(`API ${api.name} 失败 (耗时: ${attemptDuration}ms): ${error.message}`);

        // 如果是最后一个API，返回失败结果
        if (i === this.ipApis.length - 1) {
          return { success: false, error: error.message };
        }

        // 继续尝试下一个API
        continue;
      }
    }
  }

  /**
   * 测试所有API
   */
  async testAllApis() {
    this.log('开始测试所有IP API...');

    const results = [];

    for (const api of this.ipApis) {
      const startTime = Date.now();

      try {
        const ip = await this.testSingleApi(api);
        const duration = Date.now() - startTime;
        results.push({
          api: api.name,
          success: true,
          ip,
          duration,
          error: null
        });
        this.log(`✓ ${api.name}: ${ip} (${duration}ms)`);
      } catch (error) {
        const duration = Date.now() - startTime;
        results.push({
          api: api.name,
          success: false,
          ip: null,
          duration,
          error: error.message
        });
        this.log(`✗ ${api.name}: ${error.message} (${duration}ms)`);
      }

      // API之间稍作延迟，避免请求过于频繁
      await this.sleep(1000);
    }

    return results;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 运行完整测试
   */
  async runTests() {
    console.log('='.repeat(60));
    console.log('IP API 多备选机制测试');
    console.log('='.repeat(60));

    try {
      // 测试1: 单独测试每个API
      console.log('\n📋 测试1: 单独测试每个API');
      console.log('-'.repeat(40));
      const individualResults = await this.testAllApis();

      // 测试2: 多API备选机制
      console.log('\n🔄 测试2: 多API备选机制（故障转移）');
      console.log('-'.repeat(40));
      const fallbackResult = await this.testMultiApiFallback();

      // 测试结果汇总
      console.log('\n📊 测试结果汇总');
      console.log('='.repeat(40));

      const successfulApis = individualResults.filter(r => r.success);
      const failedApis = individualResults.filter(r => !r.success);

      console.log(`总API数量: ${this.ipApis.length}`);
      console.log(`成功API数量: ${successfulApis.length}`);
      console.log(`失败API数量: ${failedApis.length}`);

      if (successfulApis.length > 0) {
        console.log('\n✅ 成功的API:');
        successfulApis.forEach(result => {
          console.log(`  - ${result.api}: ${result.ip} (${result.duration}ms)`);
        });
      }

      if (failedApis.length > 0) {
        console.log('\n❌ 失败的API:');
        failedApis.forEach(result => {
          console.log(`  - ${result.api}: ${result.error} (${result.duration}ms)`);
        });
      }

      console.log('\n🎯 多API备选机制结果:');
      if (fallbackResult.success) {
        console.log(`✅ 成功获取IP: ${fallbackResult.ip}`);
        console.log(`📍 使用API: ${fallbackResult.api}`);
        console.log(`⏱️  总耗时: ${fallbackResult.duration}ms`);
      } else {
        console.log(`❌ 所有API都失败: ${fallbackResult.error}`);
      }

      console.log('\n' + '='.repeat(60));
      console.log('测试完成!');
      console.log('='.repeat(60));

    } catch (error) {
      console.error('测试过程中发生错误:', error.message);
      console.error('错误详情:', error);
    }
  }
}

// 运行测试
if (require.main === module) {
  const useProxy = process.argv.includes('--proxy');
  const tester = new IpApiTester(useProxy);

  console.log(`测试模式: ${useProxy ? '使用代理' : '直接连接'}`);
  if (useProxy) {
    console.log(`代理地址: socks5://${tester.socks5Host}:${tester.socks5Port}`);
  }
  console.log('');

  tester.runTests().catch(console.error);
}

module.exports = IpApiTester;