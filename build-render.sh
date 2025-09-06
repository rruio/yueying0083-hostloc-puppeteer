#!/bin/bash

# Render平台构建脚本
# 安装必要的依赖：Go和WireProxy

set -e

echo "开始Render构建过程..."

# 安装系统依赖
echo "安装系统依赖..."
apt-get update && apt-get install -y wget

# 安装Go
echo "安装Go..."
wget -q https://go.dev/dl/go1.21.5.linux-amd64.tar.gz
tar -C /usr/local -xzf go1.21.5.linux-amd64.tar.gz
export PATH=$PATH:/usr/local/go/bin
echo "export PATH=$PATH:/usr/local/go/bin" >> ~/.bashrc

# 验证Go安装
go version

# 安装WireProxy
echo "安装WireProxy..."
go install github.com/pufferffish/wireproxy/cmd/wireproxy@latest

# 验证WireProxy安装
wireproxy --version

echo "WireProxy安装完成"

# 清理安装文件
rm go1.21.5.linux-amd64.tar.gz

echo "构建过程完成"