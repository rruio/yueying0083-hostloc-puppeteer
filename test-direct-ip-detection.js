const https = require('https');
const http = require('http');

// 直接测试IP检测API（不使用代理）
async function testDirectIpApis() {
  console.log('🧪 开始测试IP检测API（直接连接，无代理）...\n');

  // IP检测API配置
  const ipApis = [
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

  // 测试每个API
  for (let i = 0; i < ipApis.length; i++) {
    const api = ipApis[i];
    const startTime = Date.now();

    try {
      console.log(`📡 测试API ${i + 1}/${ipApis.length}: ${api.name}`);

      const ip = await testApiDirect(api);
      const duration = Date.now() - startTime;

      console.log(`✅ ${api.name}: ${ip} (${duration}ms)\n`);

    } catch (error) {
      const duration = Date.now() - startTime;
      console.log(`❌ ${api.name}: 失败 (${duration}ms) - ${error.message}\n`);
    }
  }

  console.log('🎉 直接连接测试完成！');
}

// 直接测试单个API
function testApiDirect(api) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: api.hostname,
      port: api.port,
      path: api.path,
      method: api.method,
      timeout: api.timeout,
      headers: {
        'User-Agent': 'Test-Script/1.0'
      }
    };

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
          reject(new Error(`解析响应失败: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`请求失败: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    req.end();
  });
}

// 运行测试
testDirectIpApis();