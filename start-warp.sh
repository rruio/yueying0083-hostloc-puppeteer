#!/bin/bash

# WARP WireProxy 启动脚本
# 用于启动WireProxy并设置环境变量供Puppeteer使用

set -e

echo "启动WARP WireProxy..."

# 检查wireproxy是否已安装
if ! command -v wireproxy &> /dev/null; then
    echo "WireProxy未安装，尝试安装..."
    go install github.com/pufferffish/wireproxy/cmd/wireproxy@latest
fi

# 检查配置文件是否存在
if [ ! -f "wireproxy.conf" ]; then
    echo "错误: wireproxy.conf配置文件不存在"
    exit 1
fi

# 启动WireProxy
echo "启动WireProxy..."
wireproxy -c wireproxy.conf &

# 等待WireProxy启动
sleep 3

# 设置环境变量
export WARP_ENABLED=true
export WARP_SOCKS5_HOST=127.0.0.1
export WARP_SOCKS5_PORT=1080

echo "WARP WireProxy已启动"
echo "SOCKS5代理地址: socks5://127.0.0.1:1080"
echo "环境变量已设置:"
echo "  WARP_ENABLED=$WARP_ENABLED"
echo "  WARP_SOCKS5_HOST=$WARP_SOCKS5_HOST"
echo "  WARP_SOCKS5_PORT=$WARP_SOCKS5_PORT"

# 保持脚本运行
wait