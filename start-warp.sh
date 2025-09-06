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

# 检查WARP_PRIVATE_KEY环境变量
if [ -z "$WARP_PRIVATE_KEY" ]; then
    echo "错误: WARP_PRIVATE_KEY环境变量未设置"
    exit 1
fi

# 设置WARP_PRIVATE_KEY环境变量（如果未设置，使用默认值）
export WARP_PRIVATE_KEY=${WARP_PRIVATE_KEY}

# 使用envsubst替换配置文件中的环境变量
envsubst < wireproxy.conf > wireproxy.conf.tmp

# 启动WireProxy
echo "启动WireProxy..."
wireproxy -c wireproxy.conf.tmp &

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