const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const TelegramBot = require('node-telegram-bot-api');
const { format } = require('date-fns');

puppeteer.use(StealthPlugin());

// 加载环境变量（GitHub Actions 会自动注入 secrets）
const isLocal = process.env.NODE_ENV === 'test';
if (isLocal) {
  require('dotenv').config();
}

// 初始化 Telegram 机器人
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
let bot;

if (telegramToken && chatId) {
  bot = new TelegramBot(telegramToken, { polling: false });
} else {
  console.warn('Telegram 环境变量未设置，推送功能已禁用');
}

// 增强的日志函数（带 Telegram 推送）
async function log(message, sendTelegram = false) {
  const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);

  // 推送到 Telegram（仅在需要时推送）
  if (sendTelegram && bot) {
    try {
      await bot.sendMessage(chatId, logMessage);
    } catch (error) {
      console.error('Telegram 推送失败:', error.message);
    }
  }
}

(async () => {
  try {
    const username = process.env.HOSTLOC_USERNAME;
    const password = process.env.HOSTLOC_PASSWORD;
    
    if (!username || !password) {
      throw new Error('请设置 HOSTLOC_USERNAME 和 HOSTLOC_PASSWORD 环境变量');
    }

    // 启动前通知
    await log('🚀 开始执行 hostloc 自动任务', true);

    // 启动浏览器（适配 GitHub Actions）
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, // GitHub Actions 需要
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote'
      ],
      ...(isLocal ? { slowMo: 50 } : {}),
    });
    
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000); // 设置超时时间 60 秒

    // 访问 hostloc
    await log('🌐 访问 hostloc 论坛...');
    await page.goto('https://hostloc.com/forum-45-1.html', { waitUntil: 'networkidle2' });

    // 登录过程
    await log('🔑 输入用户名和密码...');
    await page.type('#ls_username', username);
    await page.type('#ls_password', password);
    
    await log('📤 提交登录表单...');
    await page.click('button[type="submit"]');
    await page.waitForNavigation();

    // 验证登录
    const loggedIn = await page.evaluate(() => 
      !!document.querySelector('a[href^="space-uid-"][title="访问我的空间"]')
    );
    
    if (!loggedIn) {
      throw new Error('❌ 登录失败，未找到用户空间链接');
    }
    await log('✅ 登录成功!', true);

    // 访问用户空间
    await log('🔄 开始随机访问 20 个用户空间...', true);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < 20; i++) {
      const randomUid = Math.floor(Math.random() * 31210);
      const userUrl = `https://www.hostloc.com/space-uid-${randomUid}.html`;
      
      try {
        await log(`👤 访问用户空间 #${i+1}: UID-${randomUid}`);
        await page.goto(userUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        successCount++;
      } catch (error) {
        await log(`⚠️ 访问失败: ${error.message}`);
        failCount++;
      }
      
      // 随机延迟（10-15秒）
      const delay = Math.floor(Math.random() * 5000) + 10000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // 任务完成报告
    const report = `
✅ 任务完成！
=========================
成功访问: ${successCount} 次
失败访问: ${failCount} 次
=========================
`;
    
    await log(report, true);
    await browser.close();

  } catch (error) {
    const errorMessage = `❌ 发生严重错误: ${error.message}`;
    console.error(error);
    
    // 确保错误信息被推送到 Telegram
    if (bot) {
      try {
        await bot.sendMessage(chatId, errorMessage);
      } catch (telegramError) {
        console.error('Telegram 推送错误失败:', telegramError.message);
      }
    }
    
    process.exit(1);
  }
})();
