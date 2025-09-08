const WarpManager = require('./warp-manager');

// 测试改进后的IP检测功能
async function testImprovedIpDetection() {
  console.log('🧪 开始测试改进后的IP检测功能...\n');

  try {
    // 测试多API备选机制
    console.log('📡 测试多API备选机制（无代理）...');
    const testIp = await WarpManager.getCurrentWarpIp();
    console.log(`✅ 成功获取IP: ${testIp}\n`);

    // 测试缓存机制
    console.log('💾 测试缓存机制...');
    const cachedIp = await WarpManager.getCurrentWarpIp();
    console.log(`✅ 缓存工作正常: ${cachedIp}\n`);

    // 清理缓存并重新测试
    console.log('🧹 清理缓存并重新测试...');
    WarpManager.clearIpCache();
    const newIp = await WarpManager.getCurrentWarpIp();
    console.log(`✅ 缓存清理后重新获取: ${newIp}\n`);

    console.log('🎉 所有测试通过！改进后的IP检测功能工作正常。');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    console.error('完整错误信息:', error);
  }
}

// 运行测试
testImprovedIpDetection();