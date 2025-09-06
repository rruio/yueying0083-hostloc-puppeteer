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

function log(message, accountId = null) {
  const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
  const prefix = accountId ? `[账号${accountId}]` : '';
  console.log(`[${timestamp}]${prefix} ${message}`);
}

// 单个账号签到函数
async function signInForAccount(account, accountId) {
  let browser;
  try {
    log('开始执行签到任务', accountId);

    // 本地测试时显示浏览器
    const isLocal = process.env.NODE_ENV === 'test';

    log('启动浏览器...', accountId);
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

    // 访问hostloc并登录
    log('访问hostloc论坛...', accountId);
    await page.goto('https://hostloc.com/forum-45-1.html');

    log('输入用户名和密码...', accountId);
    await page.type('#ls_username', account.username);
    await page.type('#ls_password', account.password);
    log('提交登录表单...', accountId);
    await page.click('button[type="submit"]');

    // 等待登录完成并验证
    await page.waitForNavigation();

    // 检查用户空间链接是否存在以确认登录成功
    log('等待登录成功...', accountId);
    const loggedIn = await page.evaluate(() => {
      return !!document.querySelector(
        `a[href^="space-uid-"][title="访问我的空间"]`
      );
    });

    if (!loggedIn) {
      throw new Error('登录失败，未找到用户空间链接');
    }

    log('登录成功', accountId);

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

    // 提取用户信息
    log('提取用户信息...', accountId);
    try {
      await page.goto('https://hostloc.com/home.php?mod=spacecp&ac=usergroup');
      await page.waitForSelector('#ct > div.mn > div > div.tdats > table.tdat.tfx > tbody:nth-child(1) > tr:nth-child(1) > th > h4');

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

      log(`当前用户组: ${userInfo.currentGroup}`, accountId);
      log(`当前积分: ${userInfo.currentPoints}`, accountId);
      log(`晋级用户组: ${userInfo.nextGroup}`, accountId);
      log(`升级所需积分: ${userInfo.upgradePoints}`, accountId);
    } catch (error) {
      log(`提取用户信息失败: ${error.message}`, accountId);
    }

    await browser.close();
    log('任务完成', accountId);
    return true;
  } catch (error) {
    log(`执行出错: ${error.message}`, accountId);
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

    if (accounts.length === 0) {
      throw new Error('请设置HOSTLOC_ACCOUNTS环境变量（JSON格式）或HOSTLOC_USERNAME/HOSTLOC_PASSWORD环境变量');
    }

    log(`运行模式: ${isLocal ? '本地测试' : '生产环境'}`);
    log(`共配置${accounts.length}个账号`);

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

      log(`随机抽取账号${accountId}，将在${Math.floor(delay / 60000)}分钟后开始执行`);

      await new Promise(resolve => setTimeout(resolve, delay));

      const success = await signInForAccount(accounts[accountIndex], accountId);
      results.push({ accountId, success });

      log(`账号${accountId}执行完成`);
    }

    // 账号池为空，显示完成信息
    log('今日所有账号已执行完成');

    // 统计结果
    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

    log(`所有账号执行完成。成功: ${successCount}, 失败: ${failCount}`);

  } catch (error) {
    console.error('执行出错:', error);
    process.exit(1);
  }
})();
