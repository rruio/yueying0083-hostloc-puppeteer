const puppeteer = require('puppeteer');
const { format } = require('date-fns');

// 加载环境变量
const isLocal = process.env.NODE_ENV === 'test';
if (isLocal) {
  require('dotenv').config();
}

function log(message) {
  const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
  console.log(`[${timestamp}] ${message}`);
}

(async () => {
  try {
    // 从环境变量获取登录凭证try {
    // 获取环境变量
    const username = process.env.HOSTLOC_USERNAME;
    const password = process.env.HOSTLOC_PASSWORD;

    if (!username || !password) {
      throw new Error('请设置HOSTLOC_USERNAME和HOSTLOC_PASSWORD环境变量');
    }

    // 本地测试时显示浏览器
    const isLocal = process.env.NODE_ENV !== 'production';
    log(`运行模式: ${isLocal ? '本地测试' : '生产环境'}`);

    if (!username || !password) {
      throw new Error('请设置HOSTLOC_USERNAME和HOSTLOC_PASSWORD环境变量');
    }

    log('启动浏览器...');
    const browser = await puppeteer.launch({
      headless: !isLocal,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
      ...(isLocal ? { slowMo: 50 } : {}),
    });
    const page = await browser.newPage();

    // 访问hostloc并登录
    log('访问hostloc论坛...');
    await page.goto('https://hostloc.com/forum-45-1.html');

    log('输入用户名和密码...');
    await page.type('#ls_username', username);
    await page.type('#ls_password', password);
    log('提交登录表单...');
    await page.click('button[type="submit"]');

    // 等待登录完成并验证
    await page.waitForNavigation();

    // 检查用户空间链接是否存在以确认登录成功
    log('等待登录成功...');
    const loggedIn = await page.evaluate((username) => {
      return !!document.querySelector(
        `a[href^="space-uid-"][title="访问我的空间"]`
      );
    }, username);
    log('登录成功!');

    if (!loggedIn) {
      throw new Error('登录失败，未找到用户空间链接');
    }

    console.log('登录成功');

    // 随机访问10个用户空间(31180-31210范围内)
    log('开始随机访问10个用户空间...');
    for (let i = 0; i < 10; i++) {
      const randomUid = Math.floor(Math.random() * (31210 - 31180 + 1)) + 31180;
      log(`访问用户空间: https://www.hostloc.com/space-uid-${randomUid}.html`);
      await page.goto(`https://www.hostloc.com/space-uid-${randomUid}.html`);
      await page.waitForTimeout(2000); // 等待2秒
    }

    await browser.close();
    log('任务完成');
  } catch (error) {
    console.error('执行出错:', error);
    process.exit(1);
  }
})();
