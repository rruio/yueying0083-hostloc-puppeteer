const puppeteer = require('puppeteer');
const dotenv = require('dotenv');

// 加载环境变量
dotenv.config();

(async () => {
  try {
    const username = process.env.HOSTLOC_USERNAME;
    const password = process.env.HOSTLOC_PASSWORD;
    
    if (!username || !password) {
      throw new Error('请在.env文件中设置HOSTLOC_USERNAME和HOSTLOC_PASSWORD');
    }
    
    console.log('启动浏览器...');
    const browser = await puppeteer.launch({
      headless: false, // 设置为false可以看到浏览器操作
      slowMo: 100,    // 减慢操作速度便于观察
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    
    console.log('访问hostloc登录页面...');
    await page.goto('https://www.hostloc.com/member.php?mod=logging&action=login');
    
    console.log('输入用户名和密码...');
    await page.type('#ls_username', username);
    await page.type('#ls_password', password);
    await page.click('button[type="submit"]');
    
    console.log('等待登录完成...');
    await page.waitForNavigation();
    
    // 检查登录是否成功
    const loggedIn = await page.evaluate(() => {
      return !!document.querySelector('a[href^="space-uid-"][title="访问我的空间"]');
    });
    
    if (!loggedIn) {
      throw new Error('登录失败，未找到用户空间链接');
    }
    
    console.log('登录成功');
    
    // 随机访问10个用户空间(31180-31210范围内)
    for (let i = 0; i < 10; i++) {
      const randomUid = Math.floor(Math.random() * (31210 - 31180 + 1)) + 31180;
      console.log(`访问用户空间: ${randomUid}`);
      await page.goto(`https://www.hostloc.com/space-uid-${randomUid}.html`);
      await page.waitForTimeout(2000); // 等待2秒
    }
    
    console.log('测试完成');
    await browser.close();
  } catch (error) {
    console.error('测试失败:', error);
    process.exit(1);
  }
})();