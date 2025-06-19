const puppeteer = require('puppeteer');

(async () => {
  try {
    // 从环境变量获取登录凭证
    const username = process.env.HOSTLOC_USERNAME;
    const password = process.env.HOSTLOC_PASSWORD;
    
    if (!username || !password) {
      throw new Error('请设置HOSTLOC_USERNAME和HOSTLOC_PASSWORD环境变量');
    }

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    // 访问hostloc并登录
    await page.goto('https://www.hostloc.com/');
    await page.type('#ls_username', username);
    await page.type('#ls_password', password);
    await page.click('button[type="submit"]');
    
    // 等待登录完成并验证
    await page.waitForNavigation();
    
    // 检查用户空间链接是否存在以确认登录成功
    const loggedIn = await page.evaluate((username) => {
      return !!document.querySelector(`a[href^="space-uid-"][title="访问我的空间"]`);
    }, username);
    
    if (!loggedIn) {
      throw new Error('登录失败，未找到用户空间链接');
    }
    
    console.log('登录成功');
    
    // 随机访问10个用户空间(31180-31210范围内)
    for (let i = 0; i < 10; i++) {
      const randomUid = Math.floor(Math.random() * (31210 - 31180 + 1)) + 31180;
      await page.goto(`https://www.hostloc.com/space-uid-${randomUid}.html`);
      await page.waitForTimeout(2000); // 等待2秒
    }
    
    await browser.close();
    console.log('任务完成');
  } catch (error) {
    console.error('执行出错:', error);
    process.exit(1);
  }
})();