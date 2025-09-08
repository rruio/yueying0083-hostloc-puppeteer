const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Add stealth plugin
puppeteer.use(StealthPlugin());
const { format } = require('date-fns');

// 加载环境变量
const isLocal = process.env.NODE_ENV === 'test';
if (isLocal) {
  require('dotenv').config();
}

const warpManager = require('./warp-manager');
const {
  timeoutManager,
  retryManager,
  LoopController,
  adaptiveTimeout,
  monitorLogger
} = require('./timeout-manager');

function log(message, accountId = null) {
  const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
  const prefix = accountId ? `[账号${accountId}]` : '';
  console.log(`[${timestamp}]${prefix} ${message}`);
}

// 使用新的智能重试管理器
async function retryWithSmartRetry(operation, options = {}) {
  const { maxRetries = 3, operationType = 'default', accountId = null } = options;

  return await retryManager.executeWithRetry(operation, {
    maxRetries,
    operationType,
    accountId,
    context: options.context || {}
  });
}
// 单个账号签到函数
async function signInForAccount(account, accountId) {
  let browser;
  const startTime = Date.now();

  try {
    monitorLogger.log('开始执行签到任务', 'info', accountId);

    // 执行IP轮换（如果启用）
    if (warpManager.isEnabled()) {
      try {
        monitorLogger.log('开始IP轮换...', 'info', accountId);
        const rotationResult = await retryWithSmartRetry(
          () => warpManager.rotateIp(accountId),
          { operationType: 'ip_rotation', accountId }
        );
        if (rotationResult) {
          monitorLogger.log(`IP轮换完成: ${rotationResult.oldIp} -> ${rotationResult.newIp}`, 'info', accountId);
        }
      } catch (error) {
        monitorLogger.log(`IP轮换失败，但继续执行签到: ${error.message}`, 'warn', accountId);
        // IP轮换失败不影响签到流程，继续执行
      }
    }

    // 本地测试时显示浏览器
    const isLocal = process.env.NODE_ENV === 'test';

    monitorLogger.log('启动浏览器...', 'info', accountId);
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
      ...(isLocal ? { slowMo: 50 } : {}),
    });
    const page = await browser.newPage();

    // 配置页面超时设置
    timeoutManager.configurePage(page);

    // 访问hostloc并登录
    monitorLogger.log('访问hostloc论坛...', 'info', accountId);
    await retryWithSmartRetry(async () => {
      const startTime = Date.now();
      const result = await page.goto('https://hostloc.com/forum-45-1.html', {
        waitUntil: 'domcontentloaded',
        timeout: timeoutManager.getTimeout('navigation')
      });
      adaptiveTimeout.recordPerformance('navigation', Date.now() - startTime, true, accountId);
      return result;
    }, { operationType: 'navigation', accountId });

    monitorLogger.log('输入用户名和密码...', 'info', accountId);
    await page.type('#ls_username', account.username);
    await page.type('#ls_password', account.password);
    monitorLogger.log('提交登录表单...', 'info', accountId);

    // 提交表单并等待导航完成，使用智能重试逻辑
    await retryWithSmartRetry(async () => {
      const startTime = Date.now();
      await page.click('button[type="submit"]');
      const result = await page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: timeoutManager.getTimeout('navigation')
      });
      adaptiveTimeout.recordPerformance('form_submission', Date.now() - startTime, true, accountId);
      return result;
    }, { operationType: 'form_submission', accountId });

    // 检查用户空间链接是否存在以确认登录成功
    monitorLogger.log('等待登录成功...', 'info', accountId);
    const loggedIn = await retryWithSmartRetry(async () => {
      const startTime = Date.now();
      const result = await page.evaluate(() => {
        return !!document.querySelector(
          `a[href^="space-uid-"][title="访问我的空间"]`
        );
      });
      adaptiveTimeout.recordPerformance('login_check', Date.now() - startTime, result, accountId);
      return result;
    }, { operationType: 'login_check', accountId });

    if (!loggedIn) {
      throw new Error('登录失败，未找到用户空间链接');
    }

    monitorLogger.log('登录成功', 'info', accountId);

    monitorLogger.log('开始随机访问20个用户空间...', 'info', accountId);

    // 创建循环控制器
    const loopController = new LoopController({
      maxIterations: 20,
      delayBetweenIterations: 10000, // 10秒
      timeoutPerIteration: timeoutManager.getTimeout('navigation'),
      onIterationComplete: async (iteration, accountId) => {
        monitorLogger.log(`用户空间访问循环完成第 ${iteration} 次`, 'info', accountId);
      },
      onLoopComplete: async (totalIterations, accountId) => {
        monitorLogger.log(`用户空间访问循环完成，共执行 ${totalIterations} 次`, 'info', accountId);
      },
      onError: async (error, iteration, accountId) => {
        monitorLogger.log(`用户空间访问循环第 ${iteration} 次出错: ${error.message}`, 'warn', accountId);
        // 继续执行下一轮
        return true;
      }
    });

    // 执行循环操作
    await loopController.execute(async (iteration, accountId) => {
      const randomUid = Math.floor(Math.random() * 31210);
      const url = `https://www.hostloc.com/space-uid-${randomUid}.html`;
      monitorLogger.log(`访问用户空间: ${url}`, 'info', accountId);

      return await retryWithSmartRetry(async () => {
        const startTime = Date.now();
        const result = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: timeoutManager.getTimeout('navigation')
        });
        adaptiveTimeout.recordPerformance('space_visit', Date.now() - startTime, true, accountId);
        return result;
      }, { operationType: 'space_visit', accountId });
    }, { accountId });

    // 提取用户信息
    monitorLogger.log('提取用户信息...', 'info', accountId);
    try {
      await retryWithSmartRetry(async () => {
        const startTime = Date.now();
        const result = await page.goto('https://hostloc.com/home.php?mod=spacecp&ac=usergroup', {
          waitUntil: 'domcontentloaded',
          timeout: timeoutManager.getTimeout('navigation')
        });
        adaptiveTimeout.recordPerformance('userinfo_navigation', Date.now() - startTime, true, accountId);
        return result;
      }, { operationType: 'userinfo_navigation', accountId });

      await retryWithSmartRetry(async () => {
        const startTime = Date.now();
        const result = await page.waitForSelector('#ct > div.mn > div > div.tdats > table.tdat.tfx > tbody:nth-child(1) > tr:nth-child(1) > th > h4', {
          timeout: timeoutManager.getTimeout('element')
        });
        adaptiveTimeout.recordPerformance('userinfo_wait', Date.now() - startTime, true, accountId);
        return result;
      }, { operationType: 'userinfo_wait', accountId });

      const userInfo = await page.evaluate(() => {
        const currentGroupElement = document.querySelector('#ct > div.mn > div > div.tdats > table.tdat.tfx > tbody:nth-child(1) > tr:nth-child(1) > th > h4');
        const currentGroup = currentGroupElement ? currentGroupElement.textContent.trim() : 'N/A';

        const currentPointsElement = document.querySelector('#ct > div.mn > div > div.tdats > table.tdat.tfx > tbody:nth-child(1) > tr:nth-child(2) > th > span');
        const currentPointsText = currentPointsElement ? currentPointsElement.textContent.trim() : 'N/A';
        const currentPoints = currentPointsText.match(/积分: (\d+)/) ? parseInt(currentPointsText.match(/积分: (\d+)/)[1]) : 'N/A';

        const nextGroupElement = document.querySelector('#c2#tba li');
        const nextGroupText = nextGroupElement ? nextGroupElement.textContent.trim() : 'N/A';
        const nextGroup = nextGroupText.match(/晋级用户组 - (.+)/) ? nextGroupText.match(/晋级用户组 - (.+)/)[1] : 'N/A';

        const upgradePointsElement = document.querySelector('#ct > div.mn > div > div.tdats > div > table > tbody:nth-child(1) > tr:nth-child(1) > th > span');
        const upgradePointsText = upgradePointsElement ? upgradePointsElement.textContent.trim() : 'N/A';
        const upgradePoints = upgradePointsText.match(/您升级到此用户组还需积分 (\d+)/) ? parseInt(upgradePointsText.match(/您升级到此用户组还需积分 (\d+)/)[1]) : 'N/A';

        return { currentGroup, currentPoints, nextGroup, upgradePoints };
      });

      monitorLogger.log(`当前用户组: ${userInfo.currentGroup}`, 'info', accountId);
      monitorLogger.log(`当前积分: ${userInfo.currentPoints}`, 'info', accountId);
      monitorLogger.log(`晋级用户组: ${userInfo.nextGroup}`, 'info', accountId);
      monitorLogger.log(`升级所需积分: ${userInfo.upgradePoints}`, 'info', accountId);
    } catch (error) {
      monitorLogger.log(`提取用户信息失败: ${error.message}`, 'error', accountId);
      adaptiveTimeout.recordPerformance('userinfo_extraction', Date.now() - startTime, false, accountId);
    }

    await browser.close();
    const totalDuration = Date.now() - startTime;
    monitorLogger.log(`任务完成，总耗时: ${totalDuration}ms`, 'info', accountId);
    adaptiveTimeout.recordPerformance('sign_in_task', totalDuration, true, accountId);
    return true;
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    monitorLogger.log(`执行出错: ${error.message}`, 'error', accountId);
    adaptiveTimeout.recordPerformance('sign_in_task', totalDuration, false, accountId);
    if (browser) {
      await browser.close();
    }
    return false;
  }
}

(async () => {
  try {
    // 从环境变量获取多个账号配置
    const accountsEnv = process.env.HOSTLOC_ACCOUNTS;
    let accounts = [];

    if (accountsEnv) {
      try {
        accounts = JSON.parse(accountsEnv);
        monitorLogger.log(`从环境变量加载了${accounts.length}个账号配置`, 'info');
      } catch (error) {
        monitorLogger.log(`解析HOSTLOC_ACCOUNTS环境变量失败: ${error.message}`, 'error');
      }
    }

    // 如果没有配置多个账号，尝试使用单个账号配置（向后兼容）
    if (accounts.length === 0) {
      const username = process.env.HOSTLOC_USERNAME;
      const password = process.env.HOSTLOC_PASSWORD;

      if (username && password) {
        accounts.push({ username, password });
        monitorLogger.log('使用单个账号配置（向后兼容）', 'info');
      }
    }

    if (accounts.length === 0) {
      throw new Error('请设置HOSTLOC_ACCOUNTS环境变量（JSON格式）或HOSTLOC_USERNAME/HOSTLOC_PASSWORD环境变量');
    }

    monitorLogger.log(`运行模式: ${isLocal ? '本地测试' : '生产环境'}`, 'info');
    monitorLogger.log(`共配置${accounts.length}个账号`, 'info');

    // 生成每个账号的随机延迟
    const delays = accounts.map(() => Math.floor(Math.random() * 3600000)); // 0-1小时随机延迟
    const results = [];

    // 创建账号池，包含所有账号的索引
    let accountPool = Array.from({length: accounts.length}, (_, i) => i);

    // 随机抽取账号执行，直到账号池为空
    while (accountPool.length > 0) {
      // 随机选择一个账号索引
      const randomIndex = Math.floor(Math.random() * accountPool.length);
      const accountIndex = accountPool[randomIndex];

      // 从账号池中移除该账号（抽签不返回）
      accountPool.splice(randomIndex, 1);

      const accountId = accountIndex + 1;
      const delay = delays[accountIndex];

      monitorLogger.log(`随机抽取账号${accountId}，将在${Math.floor(delay / 60000)}分钟后开始执行`, 'info');

      await new Promise(resolve => setTimeout(resolve, delay));

      const success = await signInForAccount(accounts[accountIndex], accountId);
      results.push({ accountId, success });

      monitorLogger.log(`账号${accountId}执行完成`, success ? 'info' : 'warn');
    }

    // 账号池为空，显示完成信息
    monitorLogger.log('今日所有账号已执行完成', 'info');

    // 统计结果
    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

    monitorLogger.log(`所有账号执行完成。成功: ${successCount}, 失败: ${failCount}`, 'info');

    // 输出性能统计
    monitorLogger.log('=== 性能统计报告 ===', 'info');
    const metrics = monitorLogger.getMetrics();
    monitorLogger.log(`重试统计: ${JSON.stringify(metrics.retries, null, 2)}`, 'info');
    monitorLogger.log(`错误统计: ${JSON.stringify(metrics.errors, null, 2)}`, 'info');
    monitorLogger.log(`操作统计: ${JSON.stringify(metrics.operations, null, 2)}`, 'info');

    // 输出自适应超时统计
    const navigationStats = adaptiveTimeout.getPerformanceStats('navigation');
    if (navigationStats) {
      monitorLogger.log(`导航操作统计: ${JSON.stringify(navigationStats, null, 2)}`, 'info');
    }

  } catch (error) {
    monitorLogger.log(`执行出错: ${error.message}`, 'error');
    process.exit(1);
  }
})();
