# WARP IP轮换功能使用指南

## 概述

本项目已实现WARP IP轮换功能，可以在每次账号执行签到任务前自动重启WireProxy服务以获得新的出口IP地址，有效避免IP被封禁的问题。

## 功能特性

- ✅ 自动IP轮换：每次账号执行前自动重启WireProxy获得新IP
- ✅ 可选择性启用：通过环境变量控制是否启用IP轮换
- ✅ 错误处理完善：IP轮换失败不影响签到流程正常执行
- ✅ 详细日志：提供清晰的IP轮换过程日志
- ✅ 兼容性保证：不破坏现有功能，完全向后兼容

## 环境变量配置

### 必需环境变量

```bash
# 启用IP轮换功能
WARP_IP_ROTATION=true

# WARP WireProxy配置
WARP_SOCKS5_HOST=127.0.0.1
WARP_SOCKS5_PORT=1080

# WireProxy二进制文件路径
WIREPROXY_BINARY=/go/bin/wireproxy

# WireProxy配置文件路径
WIREPROXY_CONFIG_PATH=./wireproxy.conf

# WARP私钥（必需，用于WireGuard连接）
WARP_PRIVATE_KEY=你的WARP私钥
```

### 可选环境变量

```bash
# WireProxy配置文件路径（默认为./wireproxy.conf）
WIREPROXY_CONFIG_PATH=./wireproxy.conf
```

## 使用方法

### 1. 启用IP轮换

在你的环境变量中设置：
```bash
export WARP_IP_ROTATION=true
```

### 2. 配置WireProxy

确保WireProxy已正确安装和配置：

```bash
# 安装WireProxy（如果尚未安装）
go install github.com/pufferffish/wireproxy/cmd/wireproxy@latest

# 或者使用start-warp.sh脚本
./start-warp.sh
```

### 3. 运行程序

```bash
# 运行简单版本
node index.js

# 运行Web界面版本
node server.js
```

## 工作原理

1. **启动阶段**：程序启动时检查`WARP_IP_ROTATION`环境变量
2. **账号执行前**：每个账号执行签到前，系统会：
   - 获取当前出口IP
   - 终止现有的WireProxy进程
   - 重启WireProxy服务
   - 等待服务就绪
   - 获取新的出口IP
   - 记录IP变化日志
3. **签到执行**：使用新的IP执行签到任务
4. **错误处理**：如果IP轮换失败，程序会记录错误但继续执行签到

## 日志示例

启用IP轮换后，你会在日志中看到类似信息：

```
[2025-01-08 07:08:35] [账号1] [WARP] 开始IP轮换...
[2025-01-08 07:08:35] [账号1] [WARP] 发现 1 个wireproxy进程，正在终止...
[2025-01-08 07:08:35] [账号1] [WARP] wireproxy进程已终止
[2025-01-08 07:08:35] [账号1] [WARP] 启动WireProxy: /go/bin/wireproxy -c ./wireproxy.conf
[2025-01-08 07:08:35] [账号1] [WARP] WireProxy服务重启完成
[2025-01-08 07:08:35] [账号1] [WARP] IP轮换完成: 1.2.3.4 -> 5.6.7.8
[2025-01-08 07:08:35] [账号1] 开始执行签到任务
```

## 故障排除

### 常见问题

1. **WireProxy启动失败**
   - 检查`WARP_PRIVATE_KEY`环境变量是否正确设置
   - 确认WireProxy二进制文件路径正确
   - 检查wireproxy.conf配置文件是否存在

2. **IP轮换失败但签到正常**
   - 这是正常现象，IP轮换失败不会影响签到流程
   - 检查WireProxy进程是否被正确终止和重启

3. **获取IP失败**
   - 检查网络连接
   - 确认WireProxy服务正在运行
   - 检查SOCKS5代理配置是否正确

### 调试模式

启用详细日志：
```bash
export NODE_ENV=development
export WARP_IP_ROTATION=true
```

## 文件结构

```
├── warp-manager.js          # IP轮换管理模块
├── index.js                 # 简单版本主程序（已集成IP轮换）
├── server.js                # Web界面版本主程序（已集成IP轮换）
├── wireproxy.conf           # WireProxy配置文件
├── start-warp.sh           # WireProxy启动脚本
├── test-warp-manager.js    # 测试脚本
└── .env.test               # 测试环境变量
```

## 技术实现

- **模块化设计**：`warp-manager.js`独立管理IP轮换逻辑
- **异步处理**：使用async/await处理所有异步操作
- **错误恢复**：IP轮换失败不影响主业务流程
- **进程管理**：正确终止和重启WireProxy进程
- **网络验证**：通过httpbin.org验证IP变化

## 兼容性

- ✅ 完全向后兼容，不破坏现有功能
- ✅ 支持所有现有环境变量配置
- ✅ 可选择性启用，不影响未配置IP轮换的用户
- ✅ 错误处理完善，保证系统稳定性

## 性能影响

- IP轮换过程大约需要5-10秒
- 对签到成功率无负面影响
- 仅在启用IP轮换时产生额外开销

## 安全注意事项

- 不要在代码中硬编码WARP私钥
- 使用环境变量管理敏感配置
- 定期轮换WARP私钥以增强安全性