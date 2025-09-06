const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { format } = require('date-fns');
const schedule = require('node-schedule');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { Server } = require('socket.io');

// Add stealth plugin
puppeteer.use(StealthPlugin());

// 加载环境变量
require('dotenv').config();
const isLocal = process.env.NODE_ENV === 'test';

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 在生产环境中设置 trust proxy
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Session配置
app.use(session({
  secret: process.env.SESSION_SECRET || 'default-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // 在生产环境中设置为true（需要HTTPS）
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24小时
  }
}));

// 日志函数
function log(message, accountId = null) {
  const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
  const accountPrefix = accountId ? `[账号${accountId}] ` : '';
  const logMessage = `[${timestamp}] ${accountPrefix}${message}`;
  console.log(logMessage);
  if (global.io) {
    global.io.emit('log', logMessage);
  }
}

// 账号管理函数
function loadAccounts() {
  const accountsEnv = process.env.HOSTLOC_ACCOUNTS;
  accounts = [];

  if (accountsEnv) {
    try {
      accounts = JSON.parse(accountsEnv);
      log(`从环境变量加载了${accounts.length}个账号配置`);
    } catch (error) {
      log(`解析HOSTLOC_ACCOUNTS环境变量失败: ${error.message}`);
    }
  }

  // 如果没有配置多个账号，尝试使用单个账号配置（向后兼容）
  if (accounts.length === 0) {
    const username = process.env.HOSTLOC_USERNAME;
    const password = process.env.HOSTLOC_PASSWORD;

    if (username && password) {
      accounts.push({ username, password });
      log('使用单个账号配置（向后兼容）');
    }
  }

  return accounts;
}

function isAccountAvailableToday(accountId) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const lastRun = accountLastRun[accountId];
  return lastRun !== today;
}

function getRandomAvailableAccount() {
  // 重新加载账号配置（以防环境变量有更新）
  loadAccounts();

  if (accounts.length === 0) {
    throw new Error('未配置任何账号');
  }

  // 过滤出今天还没执行过的账号
  const availableAccounts = accounts
    .map((account, index) => ({ ...account, id: index + 1 }))
    .filter(account => isAccountAvailableToday(account.id));

  if (availableAccounts.length === 0) {
    throw new Error('今天所有账号都已执行过任务');
  }

  // 随机选择一个可用账号
  const randomIndex = Math.floor(Math.random() * availableAccounts.length);
  return availableAccounts[randomIndex];
}

function updateAccountLastRun(accountId) {
  const today = format(new Date(), 'yyyy-MM-dd');
  accountLastRun[accountId] = today;
  log(`更新账号${accountId}最后执行日期为: ${today}`, accountId);
}

// 全局状态
let isRunning = false;
let lastRunTime = null;
let currentStatus = 'idle';

// 账号相关状态
let accounts = [];
let accountLastRun = {}; // 记录每个账号的最后执行日期，格式: {accountId: 'YYYY-MM-DD'}

// 定时任务配置
let scheduleConfig = {
  enabled: true,
  time: '0 8 * * *', // 默认每天早上8点
  nextRun: null
};
let scheduledJob = null;

// 提取Puppeteer任务逻辑为函数
async function runPuppeteerTask() {
  let selectedAccount = null;
  let accountId = null;

  try {
    isRunning = true;
    currentStatus = 'running';

    // 随机选择可用账号
    selectedAccount = getRandomAvailableAccount();
    accountId = selectedAccount.id;
    const { username, password } = selectedAccount;

    log('开始执行Puppeteer任务...', accountId);
    log(`随机选择账号: ${username}`, accountId);
    log(`运行模式: ${isLocal ? '本地测试' : '生产环境'}`, accountId);

    log('启动浏览器...', accountId);

    // 检查WARP代理配置
    const warpEnabled = process.env.WARP_ENABLED === 'true';
    const warpSocks5Host = process.env.WARP_SOCKS5_HOST;
    const warpSocks5Port = process.env.WARP_SOCKS5_PORT;

    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ];

    // 如果启用WARP代理，添加代理参数
    if (warpEnabled && warpSocks5Host && warpSocks5Port) {
      launchArgs.push(`--proxy-server=socks5://${warpSocks5Host}:${warpSocks5Port}`);
      log(`启用WARP代理: socks5://${warpSocks5Host}:${warpSocks5Port}`, accountId);
    } else if (warpEnabled) {
      log('警告: WARP_ENABLED为true，但未设置WARP_SOCKS5_HOST或WARP_SOCKS5_PORT', accountId);
    }

    const browser = await puppeteer.launch({
      headless: true,
      args: launchArgs,
      ...(isLocal ? { slowMo: 50 } : {}),
    });
    const page = await browser.newPage();

    // 访问hostloc并登录
    log('访问hostloc论坛...', accountId);
    await page.goto('https://hostloc.com/forum-45-1.html');

    log('输入用户名和密码...', accountId);
    await page.type('#ls_username', username);
    await page.type('#ls_password', password);
    log('提交登录表单...', accountId);
    await page.click('button[type="submit"]');

    // 等待登录完成并验证
    await page.waitForNavigation();

    // 检查用户空间链接是否存在以确认登录成功
    log('等待登录成功...', accountId);
    const loggedIn = await page.evaluate((username) => {
      return !!document.querySelector(
        `a[href^="space-uid-"][title="访问我的空间"]`
      );
    }, username);

    if (!loggedIn) {
      throw new Error('登录失败，未找到用户空间链接');
    }

    log('登录成功!', accountId);
    await page.evaluate(() => console.log('登录成功'));

    log('开始随机访问20个用户空间...', accountId);
    for (let i = 0; i < 20; i++) {
      const randomUid = Math.floor(Math.random() * 31210);
      log(`访问用户空间: https://www.hostloc.com/space-uid-${randomUid}.html`, accountId);
      try {
        await page.goto(`https://www.hostloc.com/space-uid-${randomUid}.html`);
      } catch (error) {
        log(`访问用户空间失败: ${error.message}`, accountId);
      }
      await new Promise((resolve) => setTimeout(resolve, 10 * 1000));
    }

    await browser.close();
    lastRunTime = new Date();
    currentStatus = 'completed';

    // 更新账号最后执行记录
    updateAccountLastRun(accountId);

    log('任务完成', accountId);
  } catch (error) {
    currentStatus = 'error';
    log(`任务执行出错: ${error.message}`, accountId);
    throw error;
  } finally {
    isRunning = false;
  }
}

// 定时任务管理函数
function scheduleTask() {
 if (scheduledJob) {
   scheduledJob.cancel();
   scheduledJob = null;
 }

 if (scheduleConfig.enabled) {
   scheduledJob = schedule.scheduleJob(scheduleConfig.time, async () => {
     if (isRunning) {
       log('定时任务跳过：任务正在运行中');
       return;
     }
     log('定时任务执行中...');
     try {
       await runPuppeteerTask();
     } catch (error) {
       log(`定时任务执行失败: ${error.message}`);
     }
   });
   scheduleConfig.nextRun = scheduledJob.nextInvocation().toDate();
   log(`定时任务已设置，下次执行时间: ${format(scheduleConfig.nextRun, 'yyyy-MM-dd HH:mm:ss')}`);
 } else {
   scheduleConfig.nextRun = null;
   log('定时任务已禁用');
 }
}

function updateScheduleConfig(newConfig) {
 scheduleConfig = { ...scheduleConfig, ...newConfig };
 scheduleTask();
}

// requireAuth 中间件
function requireAuth(req, res, next) {
  if (!req.session.authenticated) {
    return res.status(401).json({ success: false, message: '未授权访问' });
  }
  next();
}

// 路由

// GET /login - 提供登录页面
app.get('/login', (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>登录 - Hostloc Puppeteer</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
            .container { max-width: 400px; margin: 100px auto; padding: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { text-align: center; color: #333; margin-bottom: 30px; }
            .form-group { margin-bottom: 20px; }
            label { display: block; margin-bottom: 5px; color: #555; }
            input[type="text"], input[type="password"] { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
            button { width: 100%; padding: 12px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
            button:hover { background-color: #0056b3; }
            .error { color: #dc3545; text-align: center; margin-top: 10px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>管理员登录</h1>
            <form id="loginForm">
                <div class="form-group">
                    <label for="username">用户名:</label>
                    <input type="text" id="username" name="username" required>
                </div>
                <div class="form-group">
                    <label for="password">密码:</label>
                    <input type="password" id="password" name="password" required>
                </div>
                <button type="submit">登录</button>
            </form>
            <div id="error" class="error" style="display: none;"></div>
        </div>

        <script>
            document.getElementById('loginForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const username = document.getElementById('username').value;
                const password = document.getElementById('password').value;
                const errorDiv = document.getElementById('error');

                try {
                    const response = await fetch('/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username, password })
                    });
                    const result = await response.json();

                    if (result.success) {
                        window.location.href = '/';
                    } else {
                        errorDiv.textContent = result.message;
                        errorDiv.style.display = 'block';
                    }
                } catch (error) {
                    errorDiv.textContent = '登录请求失败';
                    errorDiv.style.display = 'block';
                }
            });
        </script>
    </body>
    </html>
  `;
  res.send(html);
});

// GET / - 提供控制界面HTML
app.get('/', (req, res) => {
  // 检查用户是否已登录
  if (!req.session.authenticated) {
    return res.redirect('/login');
  }
  const html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Hostloc Puppeteer 控制面板</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .container { max-width: 800px; margin: 0 auto; }
            .status { padding: 10px; margin: 10px 0; border-radius: 5px; }
            .status.idle { background-color: #e7f3ff; color: #0066cc; }
            .status.running { background-color: #fff3cd; color: #856404; }
            .status.completed { background-color: #d4edda; color: #155724; }
            .status.error { background-color: #f8d7da; color: #721c24; }
            button { padding: 10px 20px; margin: 5px; cursor: pointer; }
            .run-btn { background-color: #28a745; color: white; border: none; }
            .run-btn:disabled { background-color: #6c757d; cursor: not-allowed; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Hostloc Puppeteer 控制面板</h1>
            <div style="text-align: right; margin-bottom: 20px;">
                <button onclick="logout()" style="background-color: #dc3545; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">登出</button>
            </div>

            <h2 style="margin-top: 30px;">账号信息</h2>
            <div style="margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px;">
                <div style="margin-bottom: 15px;">
                    <strong id="accountCount">当前配置账号数量：加载中...</strong>
                    <button onclick="loadAccountInfo()" style="margin-left: 15px; padding: 5px 10px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">刷新账号信息</button>
                </div>
                <div id="accountList" style="margin-top: 10px;">
                    <div style="color: #666;">正在加载账号信息...</div>
                </div>
            </div>

            <div id="status" class="status idle">状态: 空闲</div>
            <button id="runBtn" class="run-btn" onclick="runTask()">运行任务</button>
            <button onclick="checkStatus()">刷新状态</button>
            <button onclick="testWarpIp()" style="background-color: #17a2b8; color: white; border: none; padding: 10px 20px; margin: 5px; cursor: pointer;">测试WARP出口IP</button>
            <div id="lastRun">最后运行时间: 从未运行</div>
            <div id="warpTestResult" style="margin: 10px 0; padding: 10px; background-color: #f8f9fa; border-radius: 5px; display: none;"></div>

            <h2 style="margin-top: 30px;">定时设置</h2>
            <div style="margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px;">
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: bold;">定时状态:</label>
                    <input type="checkbox" id="scheduleEnabled" onchange="toggleSchedule()">
                    <span id="scheduleStatus">已禁用</span>
                </div>
                <div style="margin-bottom: 15px;">
                    <label for="scheduleTime" style="display: block; margin-bottom: 5px; font-weight: bold;">执行时间 (cron表达式):</label>
                    <input type="text" id="scheduleTime" placeholder="0 8 * * *" style="width: 200px; padding: 5px;">
                    <button onclick="updateScheduleTime()" style="margin-left: 10px; padding: 5px 10px;">更新时间</button>
                </div>
                <div>
                    <strong>下次执行时间:</strong> <span id="nextRun">未设置</span>
                </div>
            </div>

            <div id="logs" style="margin-top: 20px; padding: 10px; background-color: #f8f9fa; border: 1px solid #dee2e6; height: 300px; overflow-y: auto;"></div>
        </div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
            function updateStatus(data) {
                const statusEl = document.getElementById('status');
                statusEl.className = 'status ' + data.status;
                statusEl.textContent = '状态: ' + getStatusText(data.status);

                document.getElementById('runBtn').disabled = data.isRunning;
                document.getElementById('lastRun').textContent = '最后运行时间: ' + (data.lastRunTime || '从未运行');
            }

            function getStatusText(status) {
                const statusMap = {
                    'idle': '空闲',
                    'running': '运行中',
                    'completed': '已完成',
                    'error': '错误'
                };
                return statusMap[status] || status;
            }

            async function runTask() {
                try {
                    const response = await fetch('/run', { method: 'POST' });
                    const result = await response.json();
                    if (result.success) {
                        alert('任务已启动');
                        checkStatus();
                    } else {
                        alert('启动失败: ' + result.message);
                    }
                } catch (error) {
                    alert('请求失败: ' + error.message);
                }
            }

            async function checkStatus() {
                try {
                    const response = await fetch('/status');
                    const data = await response.json();
                    updateStatus(data);
                } catch (error) {
                    console.error('获取状态失败:', error);
                }
            }

            async function testWarpIp() {
                const resultDiv = document.getElementById('warpTestResult');
                resultDiv.style.display = 'block';
                resultDiv.textContent = '正在测试WARP出口IP...';
                resultDiv.style.backgroundColor = '#fff3cd';
                resultDiv.style.color = '#856404';

                try {
                    const response = await fetch('/test-warp-ip');
                    const result = await response.json();

                    if (result.success) {
                        resultDiv.textContent = '[成功] WARP出口IP测试成功!\\n出口IP: ' + result.ip + '\\n代理: ' + result.proxy;
                        resultDiv.style.backgroundColor = '#d4edda';
                        resultDiv.style.color = '#155724';
                    } else {
                        resultDiv.textContent = '[失败] 测试失败: ' + result.message;
                        resultDiv.style.backgroundColor = '#f8d7da';
                        resultDiv.style.color = '#721c24';
                    }
                } catch (error) {
                    resultDiv.textContent = '[错误] 请求失败: ' + error.message;
                    resultDiv.style.backgroundColor = '#f8d7da';
                    resultDiv.style.color = '#721c24';
                }
            }

            async function logout() {
                try {
                    const response = await fetch('/logout', { method: 'POST' });
                    const result = await response.json();
                    if (result.success) {
                        window.location.href = '/login';
                    } else {
                        alert('登出失败: ' + result.message);
                    }
                } catch (error) {
                    alert('登出请求失败: ' + error.message);
                }
            }

            // 定时设置相关函数
            async function loadScheduleConfig() {
                try {
                    const response = await fetch('/schedule');
                    const config = await response.json();
                    document.getElementById('scheduleEnabled').checked = config.enabled;
                    document.getElementById('scheduleTime').value = config.time;
                    document.getElementById('scheduleStatus').textContent = config.enabled ? '已启用' : '已禁用';
                    document.getElementById('nextRun').textContent = config.nextRun || '未设置';
                } catch (error) {
                    console.error('加载定时配置失败:', error);
                }
            }

            async function toggleSchedule() {
                const enabled = document.getElementById('scheduleEnabled').checked;
                try {
                    const response = await fetch('/schedule', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ enabled })
                    });
                    const result = await response.json();
                    if (result.success) {
                        document.getElementById('scheduleStatus').textContent = enabled ? '已启用' : '已禁用';
                        document.getElementById('nextRun').textContent = result.config.nextRun || '未设置';
                        alert('定时设置已更新');
                    } else {
                        alert('更新失败: ' + result.message);
                        document.getElementById('scheduleEnabled').checked = !enabled; // 恢复状态
                    }
                } catch (error) {
                    alert('请求失败: ' + error.message);
                    document.getElementById('scheduleEnabled').checked = !enabled; // 恢复状态
                }
            }

            async function updateScheduleTime() {
                const time = document.getElementById('scheduleTime').value.trim();
                if (!time) {
                    alert('请输入cron表达式');
                    return;
                }
                try {
                    const response = await fetch('/schedule', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ time })
                    });
                    const result = await response.json();
                    if (result.success) {
                        document.getElementById('nextRun').textContent = result.config.nextRun || '未设置';
                        alert('定时时间已更新');
                    } else {
                        alert('更新失败: ' + result.message);
                    }
                } catch (error) {
                    alert('请求失败: ' + error.message);
                }
            }

            // Socket.io 客户端
            const socket = io();
            socket.on('log', (msg) => {
              const logsDiv = document.getElementById('logs');
              const line = document.createElement('div');
              line.textContent = msg;
              logsDiv.appendChild(line);
              logsDiv.scrollTop = logsDiv.scrollHeight; // 自动滚动到底部
            });

            // 账号信息相关函数
            async function loadAccountInfo() {
                try {
                    const response = await fetch('/accounts');
                    const data = await response.json();

                    if (data.success) {
                        document.getElementById('accountCount').textContent = '当前配置账号数量：' + data.count + '个';

                        const accountListDiv = document.getElementById('accountList');
                        if (data.accounts.length > 0) {
                            let html = '<ul style="margin: 0; padding-left: 20px;">';
                            data.accounts.forEach(account => {
                                html += '<li>账号 ' + account.id + ': ' + account.username + '</li>';
                            });
                            html += '</ul>';
                            accountListDiv.innerHTML = html;
                        } else {
                            accountListDiv.innerHTML = '<div style="color: #dc3545;">未配置任何账号</div>';
                        }
                    } else {
                        document.getElementById('accountCount').textContent = '获取账号信息失败';
                        document.getElementById('accountList').innerHTML = '<div style="color: #dc3545;">无法加载账号信息</div>';
                    }
                } catch (error) {
                    console.error('加载账号信息失败:', error);
                    document.getElementById('accountCount').textContent = '获取账号信息失败';
                    document.getElementById('accountList').innerHTML = '<div style="color: #dc3545;">网络错误，无法加载账号信息</div>';
                }
            }

            // 定期检查状态
            setInterval(checkStatus, 5000);
            checkStatus(); // 初始检查
            loadScheduleConfig(); // 加载定时配置
            loadAccountInfo(); // 加载账号信息
        </script>
    </body>
    </html>
  `;
  res.send(html);
});

// POST /login - 处理登录
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  log(`登录请求: 用户名=${username}`);

  // 获取管理员凭证
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminUsername || !adminPassword) {
    log('错误: 未设置ADMIN_USERNAME或ADMIN_PASSWORD环境变量');
    return res.status(500).json({ success: false, message: '服务器配置错误' });
  }

  // 验证凭证
  if (username === adminUsername && password === adminPassword) {
    req.session.authenticated = true;
    req.session.username = username;
    log(`登录成功: ${username}`);
    res.json({ success: true, message: '登录成功' });
  } else {
    log(`登录失败: ${username}`);
    res.status(401).json({ success: false, message: '用户名或密码错误' });
  }
});

// POST /logout - 处理登出
app.post('/logout', requireAuth, (req, res) => {
  const username = req.session.username || 'unknown';
  log(`登出请求: ${username}`);

  req.session.destroy((err) => {
    if (err) {
      log(`登出失败: ${err.message}`);
      return res.status(500).json({ success: false, message: '登出失败' });
    }
    res.json({ success: true, message: '登出成功' });
  });
});

// POST /run - 手动触发Puppeteer任务
app.post('/run', requireAuth, async (req, res) => {
  if (isRunning) {
    return res.status(409).json({ success: false, message: '任务正在运行中' });
  }

  try {
    // 异步执行任务，不阻塞响应
    runPuppeteerTask();
    res.json({ success: true, message: '任务已启动' });
  } catch (error) {
    log(`启动任务失败: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /status - 获取当前状态
app.get('/status', requireAuth, (req, res) => {
  res.json({
    status: currentStatus,
    isRunning,
    lastRunTime: lastRunTime ? format(lastRunTime, 'yyyy-MM-dd HH:mm:ss') : null
  });
});

// GET /test-warp-ip - 测试WARP出口IP
app.get('/test-warp-ip', requireAuth, async (req, res) => {
  try {
    log('开始测试WARP出口IP...');

    // 检查WARP代理配置
    const warpEnabled = process.env.WARP_ENABLED === 'true';
    const warpSocks5Host = process.env.WARP_SOCKS5_HOST;
    const warpSocks5Port = process.env.WARP_SOCKS5_PORT;

    if (!warpEnabled || !warpSocks5Host || !warpSocks5Port) {
      return res.status(400).json({
        success: false,
        message: 'WARP代理未启用或配置不完整'
      });
    }

    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      `--proxy-server=socks5://${warpSocks5Host}:${warpSocks5Port}`
    ];

    const browser = await puppeteer.launch({
      headless: true,
      args: launchArgs,
      ...(isLocal ? { slowMo: 50 } : {}),
    });

    const page = await browser.newPage();

    // 访问IP查询服务
    log('访问IP查询服务...');
    await page.goto('https://httpbin.org/ip', { waitUntil: 'networkidle2' });

    // 获取出口IP
    const ipInfo = await page.evaluate(() => {
      try {
        const bodyText = document.body.innerText;
        const ipMatch = bodyText.match(/"origin":\s*"([^"]+)"/);
        return ipMatch ? ipMatch[1] : null;
      } catch (error) {
        return null;
      }
    });

    await browser.close();

    if (ipInfo) {
      log(`WARP出口IP测试成功: ${ipInfo}`);
      res.json({
        success: true,
        message: 'WARP出口IP测试成功',
        ip: ipInfo,
        proxy: `socks5://${warpSocks5Host}:${warpSocks5Port}`
      });
    } else {
      log('WARP出口IP测试失败：无法获取IP信息');
      res.status(500).json({
        success: false,
        message: '无法获取IP信息'
      });
    }
  } catch (error) {
    log(`WARP出口IP测试出错: ${error.message}`);
    res.status(500).json({
      success: false,
      message: `测试失败: ${error.message}`
    });
  }
});

// GET /schedule - 获取定时配置
app.get('/schedule', requireAuth, (req, res) => {
  res.json({
    enabled: scheduleConfig.enabled,
    time: scheduleConfig.time,
    nextRun: scheduleConfig.nextRun ? format(scheduleConfig.nextRun, 'yyyy-MM-dd HH:mm:ss') : null
  });
});

// POST /schedule - 更新定时配置
app.post('/schedule', requireAuth, (req, res) => {
  const { enabled, time } = req.body;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, message: 'enabled必须是布尔值' });
  }

  if (time && typeof time !== 'string') {
    return res.status(400).json({ success: false, message: 'time必须是字符串' });
  }

  try {
    updateScheduleConfig({ enabled, time: time || scheduleConfig.time });
    log(`定时配置已更新: enabled=${enabled}, time=${time || scheduleConfig.time}`);
    res.json({
      success: true,
      message: '定时配置已更新',
      config: {
        enabled: scheduleConfig.enabled,
        time: scheduleConfig.time,
        nextRun: scheduleConfig.nextRun ? format(scheduleConfig.nextRun, 'yyyy-MM-dd HH:mm:ss') : null
      }
    });
  } catch (error) {
    log(`更新定时配置失败: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /accounts - 获取账号信息
app.get('/accounts', requireAuth, (req, res) => {
  try {
    // 从环境变量获取多个账号配置
    const accountsEnv = process.env.HOSTLOC_ACCOUNTS;
    let accounts = [];

    if (accountsEnv) {
      try {
        accounts = JSON.parse(accountsEnv);
        log(`从环境变量加载了${accounts.length}个账号配置`);
      } catch (error) {
        log(`解析HOSTLOC_ACCOUNTS环境变量失败: ${error.message}`);
      }
    }

    // 如果没有配置多个账号，尝试使用单个账号配置（向后兼容）
    if (accounts.length === 0) {
      const username = process.env.HOSTLOC_USERNAME;
      const password = process.env.HOSTLOC_PASSWORD;

      if (username && password) {
        accounts.push({ username, password });
        log('使用单个账号配置（向后兼容）');
      }
    }

    // 只返回用户名，不包含密码
    const accountInfo = accounts.map((account, index) => ({
      id: index + 1,
      username: account.username
    }));

    res.json({
      success: true,
      count: accounts.length,
      accounts: accountInfo
    });
  } catch (error) {
    log(`获取账号信息失败: ${error.message}`);
    res.status(500).json({ success: false, message: '获取账号信息失败' });
  }
});

// 启动服务器
const server = app.listen(PORT, () => {
  log(`服务器运行在端口 ${PORT}`);
});

const io = new Server(server);
global.io = io;

module.exports = app;