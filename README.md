# Hostloc Puppeteer Automation

使用Puppeteer自动登录hostloc.com并随机浏览页面的自动化脚本。

## 配置

1. 在GitHub仓库的Settings > Secrets中设置以下环境变量：
   - `HOSTLOC_USERNAME`: 您的hostloc用户名
   - `HOSTLOC_PASSWORD`: 您的hostloc密码

2. 默认工作流每6小时运行一次，可在`.github/workflows/main.yml`中修改cron表达式。

## 本地运行

1. 安装依赖：
```bash
npm install puppeteer
```

2. 设置环境变量后运行：
```bash
HOSTLOC_USERNAME=your_username HOSTLOC_PASSWORD=your_password node index.js
```

## 注意事项

- 请勿设置过高的访问频率，以免被hostloc封禁。
- 密码等敏感信息请始终通过环境变量传递，不要硬编码在脚本中。