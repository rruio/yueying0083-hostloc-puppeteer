#!/bin/bash

# Render平台构建脚本
# 安装必要的依赖：WireProxy预编译二进制文件

set -e

echo "开始Render构建过程..."

# 下载预编译的WireProxy二进制文件
echo "下载WireProxy预编译二进制文件..."
wget -q https://github.com/whyvl/wireproxy/releases/download/v1.0.9/wireproxy_linux_amd64.tar.gz

# 解压WireProxy
echo "解压WireProxy..."
tar -xzf wireproxy_linux_amd64.tar.gz
chmod +x wireproxy

# 设置PATH包含当前目录
export PATH="$PWD:$PATH"

# 验证WireProxy安装
wireproxy --version

echo "WireProxy安装完成"

# 安装Chrome浏览器
echo "安装Chrome浏览器..."
npx puppeteer browsers install chrome

echo "Chrome浏览器安装完成"

# 清理安装文件
rm wireproxy_linux_amd64.tar.gz

echo "构建过程完成"