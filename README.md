# Hostloc Puppeteer 自动化脚本

这是一个基于Puppeteer的Hostloc论坛自动化工具，支持用户空间访问和定时任务执行。项目已优化为在Render.com等云平台上稳定运行。
Hostloc的签到就是要访问20个用户的空间，这个运行逻辑不能删改
## 最新更新
- 使用更稳定的元素选择器 `input[name="username"]` 和 `input[name="password"]`
- 集成测试和生产环境到单个文件 `index.js`
- 添加详细的日志记录功能
- 支持环境变量配置（本地开发使用 `.env`，CI使用secrets）
- 强制无头模式在CI环境中运行
- 修复了各种兼容性问题

## 使用说明

### 本地开发
1. 安装依赖：`npm install`
2. 配置环境变量：复制`.env`文件并填写实际值
3. 本地运行：`npm start`
4. 访问 `http://localhost:3000` 进行管理

### 测试运行
`npm test` - 在测试模式下运行（慢速模式）

### 生产部署
- **Render Start Command**: `npx puppeteer browsers install chrome && npm start`
- 确保所有环境变量已正确设置
## 环境变量
- `HOSTLOC_USERNAME`: Hostloc论坛用户名
- `HOSTLOC_PASSWORD`: Hostloc论坛密码
- `ADMIN_USERNAME`: 管理员登录用户名（可选，默认为admin）
- `ADMIN_PASSWORD`: 管理员登录密码（可选，默认为admin123）
- `SESSION_SECRET`: Session密钥（生产环境请修改）
- `PORT`: 服务器端口（可选，默认为3000）

## Render部署
本项目已配置为在Render.com云平台上运行。

### 部署步骤
1. 将代码推送到GitHub仓库
2. 在Render.com中创建新Web Service
3. 连接GitHub仓库
4. 配置环境变量（见上文）
5. 设置Start Command为：`npx puppeteer browsers install chrome && npm start`
6. 部署完成

### Render环境变量配置
在Render的Environment设置中添加以下变量：
- `HOSTLOC_USERNAME`: 您的Hostloc用户名
- `HOSTLOC_PASSWORD`: 您的Hostloc密码
- `ADMIN_USERNAME`: 管理员用户名
- `ADMIN_PASSWORD`: 管理员密码
- `SESSION_SECRET`: 随机生成的密钥
- `NODE_ENV`: production

### 注意事项
- Render会自动安装Chrome浏览器，无需额外配置
- 应用已在无头模式下运行，适合云环境
- 建议定期监控应用状态和日志

## GitHub Actions
工作流文件已配置为自动执行脚本