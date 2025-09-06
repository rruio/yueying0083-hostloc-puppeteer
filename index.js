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

function log(message) {
  const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
  console.log(`[${timestamp}] ${message}`);
}

(async () => {
  try {
    // 从环境变量获取登录凭证
    // 获取环境变量
    const username = process.env.HOSTLOC_USERNAME;
    const password = process.env.HOSTLOC_PASSWORD;

    if (!username || !password) {
      throw new Error('请设置HOSTLOC_USERNAME和HOSTLOC_PASSWORD环境变量');
    }

    // 本地测试时显示浏览器
    const isLocal = process.env.NODE_ENV === 'test';
    log(`运行模式: ${isLocal ? '本地测试' : '生产环境'}`);

    log('启动浏览器...');
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--proxy-server=socks5://127.0.0.1:9091',
      ],
      ...(isLocal ? { slowMo: 50 } : {}),
    });
    const page = await browser.newPage();

    // 访问hostloc并登录
    log('测试Hostloc访问...');
    await page.goto('https://hostloc.com/forum-45-1.html');

    // 检查页面标题验证访问成功
    const title = await page.title();
    log('Hostloc访问成功');
    log(`页面标题: ${title}`);

    // 检查是否有论坛内容
    const hasContent = await page.evaluate(() => {
      return document.querySelector('.forumdisplay') !== null;
    });
    log(`论坛内容检测: ${hasContent ? '成功' : '失败'}`);

    await browser.close();
    log('任务完成');
  } catch (error) {
    console.error('执行出错:', error);
    process.exit(1);
  }
})();
