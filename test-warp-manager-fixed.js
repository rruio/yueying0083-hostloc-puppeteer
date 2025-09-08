const warpManager = require('./warp-manager');

// 测试基本功能
async function testWarpManager() {
  try {
    console.log('开始测试WireProxy管理器修复版本...');

    // 测试状态获取
    console.log('1. 测试状态获取:');
    const status = warpManager.getStatus();
    console.log(JSON.stringify(status, null, 2));

    // 测试是否启用
    console.log('2. 测试IP轮换功能是否启用:', warpManager.isEnabled());

    // 测试端口检查功能
    console.log('3. 测试端口监听检查:');
    const portListening = await warpManager.checkPortListening('127.0.0.1', 1080);
    console.log(`端口 127.0.0.1:1080 监听状态: ${portListening}`);

    // 测试健康检查（如果启用）
    if (warpManager.isEnabled()) {
      console.log('4. 测试健康检查:');
      const healthCheck = await warpManager.performHealthCheck();
      console.log(`健康检查结果: ${healthCheck}`);
    }

    // 测试性能统计
    console.log('5. 测试性能统计:');
    const stats = warpManager.getPerformanceStats();
    console.log(JSON.stringify(stats, null, 2));

    console.log('WireProxy管理器测试完成');

  } catch (error) {
    console.error('测试过程中发生错误:', error);
  } finally {
    // 清理资源
    warpManager.cleanup();
  }
}

// 运行测试
testWarpManager().then(() => {
  console.log('测试脚本执行完毕');
  process.exit(0);
}).catch((error) => {
  console.error('测试脚本执行失败:', error);
  process.exit(1);
});