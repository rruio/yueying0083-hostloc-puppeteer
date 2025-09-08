const { format } = require('date-fns');

/**
 * 超时和重试管理器
 * 提供统一的超时管理、智能重试策略、循环控制、动态超时调整、错误分类和监控日志功能
 */
class TimeoutManager {
  constructor(options = {}) {
    this.defaultTimeout = options.defaultTimeout || 60000; // 默认60秒
    this.navigationTimeout = options.navigationTimeout || 60000;
    this.elementTimeout = options.elementTimeout || 30000;
    this.networkTimeout = options.networkTimeout || 30000;
    this.adaptiveEnabled = options.adaptiveEnabled !== false;
    this.maxRetries = options.maxRetries || 3;
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.maxBackoffTime = options.maxBackoffTime || 30000;
    this.jitterEnabled = options.jitterEnabled !== false;
  }

  /**
   * 设置页面超时配置
   */
  configurePage(page) {
    page.setDefaultTimeout(this.defaultTimeout);
    page.setDefaultNavigationTimeout(this.navigationTimeout);
  }

  /**
   * 获取操作超时时间
   */
  getTimeout(operationType) {
    const timeouts = {
      navigation: this.navigationTimeout,
      element: this.elementTimeout,
      network: this.networkTimeout,
      default: this.defaultTimeout
    };
    return timeouts[operationType] || this.defaultTimeout;
  }

  /**
   * 计算退避延迟时间
   */
  calculateBackoffDelay(attempt, baseDelay = 1000) {
    const delay = Math.min(baseDelay * Math.pow(this.backoffMultiplier, attempt), this.maxBackoffTime);

    if (this.jitterEnabled) {
      // 添加随机抖动，避免惊群效应
      const jitter = Math.random() * 0.1 * delay;
      return delay + jitter;
    }

    return delay;
  }
}

/**
 * 智能重试管理器
 * 基于错误类型和上下文实现智能重试策略
 */
class RetryManager {
  constructor(timeoutManager, monitorLogger) {
    this.timeoutManager = timeoutManager;
    this.monitorLogger = monitorLogger;
    this.errorClassifier = new ErrorClassifier();
  }

  /**
   * 执行带重试的操作
   */
  async executeWithRetry(operation, options = {}) {
    const {
      maxRetries = this.timeoutManager.maxRetries,
      operationType = 'default',
      accountId = null,
      context = {}
    } = options;

    let lastError;
    const startTime = Date.now();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        this.monitorLogger.logRetryAttempt(operationType, attempt, maxRetries, accountId);

        const result = await operation();

        if (attempt > 0) {
          this.monitorLogger.logRetrySuccess(operationType, attempt, Date.now() - startTime, accountId);
        }

        return result;
      } catch (error) {
        lastError = error;
        const errorType = this.errorClassifier.classifyError(error);

        this.monitorLogger.logRetryFailure(operationType, attempt, errorType, error.message, accountId);

        // 检查是否应该重试
        if (attempt === maxRetries || !this.shouldRetry(errorType, context)) {
          this.monitorLogger.logRetryExhausted(operationType, attempt, Date.now() - startTime, accountId);
          throw error;
        }

        // 计算退避延迟
        const delay = this.timeoutManager.calculateBackoffDelay(attempt);
        this.monitorLogger.logRetryDelay(operationType, delay, accountId);

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * 判断是否应该重试
   */
  shouldRetry(errorType, context = {}) {
    const retryableErrors = [
      'timeout',
      'navigation_timeout',
      'network_error',
      'connection_refused',
      'temporary_failure'
    ];

    // 检查错误类型是否可重试
    if (!retryableErrors.includes(errorType)) {
      return false;
    }

    // 检查上下文特定的重试条件
    if (context.maxNavigationRetries !== undefined && errorType === 'navigation_timeout') {
      return context.navigationRetryCount < context.maxNavigationRetries;
    }

    return true;
  }

  /**
   * 休眠函数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 循环操作控制器
 * 管理循环操作的执行、暂停、恢复和终止
 */
class LoopController {
  constructor(options = {}) {
    this.isRunning = false;
    this.isPaused = false;
    this.currentIteration = 0;
    this.maxIterations = options.maxIterations || Infinity;
    this.delayBetweenIterations = options.delayBetweenIterations || 1000;
    this.timeoutPerIteration = options.timeoutPerIteration || 30000;
    this.onIterationComplete = options.onIterationComplete || null;
    this.onLoopComplete = options.onLoopComplete || null;
    this.onError = options.onError || null;
    this.abortController = new AbortController();
  }

  /**
   * 执行循环操作
   */
  async execute(operation, options = {}) {
    const { accountId = null } = options;

    this.isRunning = true;
    this.isPaused = false;
    this.currentIteration = 0;

    try {
      while (this.isRunning && this.currentIteration < this.maxIterations) {
        if (this.isPaused) {
          await this.waitForResume();
        }

        if (!this.isRunning) break;

        this.currentIteration++;

        try {
          // 创建带超时的操作
          const timeoutPromise = new Promise((_, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`Iteration ${this.currentIteration} timeout after ${this.timeoutPerIteration}ms`));
            }, this.timeoutPerIteration);

            this.abortController.signal.addEventListener('abort', () => {
              clearTimeout(timeout);
              reject(new Error('Operation aborted'));
            });
          });

          const operationPromise = operation(this.currentIteration, accountId);
          await Promise.race([operationPromise, timeoutPromise]);

          if (this.onIterationComplete) {
            await this.onIterationComplete(this.currentIteration, accountId);
          }

        } catch (error) {
          if (this.onError) {
            const shouldContinue = await this.onError(error, this.currentIteration, accountId);
            if (!shouldContinue) {
              break;
            }
          } else {
            throw error;
          }
        }

        // 迭代间延迟
        if (this.delayBetweenIterations > 0 && this.currentIteration < this.maxIterations) {
          await this.sleep(this.delayBetweenIterations);
        }
      }

      if (this.onLoopComplete) {
        await this.onLoopComplete(this.currentIteration, accountId);
      }

    } finally {
      this.isRunning = false;
      this.isPaused = false;
    }
  }

  /**
   * 暂停循环
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * 恢复循环
   */
  resume() {
    this.isPaused = false;
  }

  /**
   * 停止循环
   */
  stop() {
    this.isRunning = false;
    this.abortController.abort();
  }

  /**
   * 等待恢复
   */
  async waitForResume() {
    while (this.isPaused && this.isRunning) {
      await this.sleep(100);
    }
  }

  /**
   * 休眠函数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取循环状态
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      currentIteration: this.currentIteration,
      maxIterations: this.maxIterations,
      progress: this.maxIterations === Infinity ? 0 : (this.currentIteration / this.maxIterations) * 100
    };
  }
}

/**
 * 动态超时调整器
 * 根据网络条件、系统负载和历史性能动态调整超时时间
 */
class AdaptiveTimeout {
  constructor(timeoutManager, monitorLogger) {
    this.timeoutManager = timeoutManager;
    this.monitorLogger = monitorLogger;
    this.performanceHistory = [];
    this.maxHistorySize = 100;
    this.adjustmentFactor = 0.1; // 调整因子
    this.minTimeout = 5000; // 最小超时5秒
    this.maxTimeout = 300000; // 最大超时5分钟
  }

  /**
   * 记录操作性能
   */
  recordPerformance(operationType, duration, success, accountId = null) {
    const record = {
      operationType,
      duration,
      success,
      timestamp: Date.now(),
      accountId
    };

    this.performanceHistory.push(record);

    // 保持历史记录大小
    if (this.performanceHistory.length > this.maxHistorySize) {
      this.performanceHistory.shift();
    }

    // 动态调整超时
    this.adjustTimeout(operationType, accountId);
  }

  /**
   * 动态调整超时时间
   */
  adjustTimeout(operationType, accountId = null) {
    const recentRecords = this.getRecentRecords(operationType, 10); // 最近10次记录

    if (recentRecords.length < 5) return; // 需要足够的数据

    const avgDuration = recentRecords.reduce((sum, r) => sum + r.duration, 0) / recentRecords.length;
    const successRate = recentRecords.filter(r => r.success).length / recentRecords.length;

    let currentTimeout = this.timeoutManager.getTimeout(operationType);
    let newTimeout = currentTimeout;

    // 基于成功率调整
    if (successRate < 0.7) {
      // 成功率低，增加超时时间
      newTimeout = Math.min(currentTimeout * (1 + this.adjustmentFactor), this.maxTimeout);
    } else if (successRate > 0.9 && avgDuration < currentTimeout * 0.5) {
      // 成功率高且平均耗时短，减少超时时间
      newTimeout = Math.max(currentTimeout * (1 - this.adjustmentFactor), this.minTimeout);
    }

    if (newTimeout !== currentTimeout) {
      this.timeoutManager[`${operationType}Timeout`] = newTimeout;
      this.monitorLogger.logTimeoutAdjustment(operationType, currentTimeout, newTimeout, accountId);
    }
  }

  /**
   * 获取最近的性能记录
   */
  getRecentRecords(operationType, count) {
    return this.performanceHistory
      .filter(r => r.operationType === operationType)
      .slice(-count);
  }

  /**
   * 获取性能统计
   */
  getPerformanceStats(operationType) {
    const records = this.performanceHistory.filter(r => r.operationType === operationType);

    if (records.length === 0) return null;

    const totalDuration = records.reduce((sum, r) => sum + r.duration, 0);
    const successCount = records.filter(r => r.success).length;

    return {
      operationType,
      totalOperations: records.length,
      successRate: successCount / records.length,
      avgDuration: totalDuration / records.length,
      minDuration: Math.min(...records.map(r => r.duration)),
      maxDuration: Math.max(...records.map(r => r.duration)),
      currentTimeout: this.timeoutManager.getTimeout(operationType)
    };
  }
}

/**
 * 错误分类器
 * 根据错误特征智能分类错误类型
 */
class ErrorClassifier {
  constructor() {
    this.errorPatterns = {
      timeout: [
        /timeout/i,
        /timed out/i,
        /Navigation timeout/i,
        /TimeoutError/i
      ],
      navigation_timeout: [
        /Navigation timeout/i,
        /page\.goto.*timeout/i,
        /waitForNavigation.*timeout/i
      ],
      network_error: [
        /net::ERR/i,
        /ECONNREFUSED/i,
        /ENOTFOUND/i,
        /ECONNRESET/i,
        /network.*error/i
      ],
      connection_refused: [
        /ECONNREFUSED/i,
        /connection refused/i
      ],
      element_not_found: [
        /No element found/i,
        /waitForSelector.*timeout/i,
        /element.*not.*found/i
      ],
      javascript_error: [
        /Evaluation failed/i,
        /javascript.*error/i,
        /ReferenceError/i,
        /TypeError/i
      ],
      authentication_error: [
        /authentication.*failed/i,
        /login.*failed/i,
        /401/i,
        /403/i
      ],
      rate_limit: [
        /rate limit/i,
        /too many requests/i,
        /429/i
      ],
      temporary_failure: [
        /temporary.*failure/i,
        /service.*unavailable/i,
        /502/i,
        /503/i,
        /504/i
      ]
    };
  }

  /**
   * 分类错误
   */
  classifyError(error) {
    if (!error || !error.message) {
      return 'unknown';
    }

    const message = error.message.toLowerCase();

    for (const [errorType, patterns] of Object.entries(this.errorPatterns)) {
      if (patterns.some(pattern => pattern.test(message))) {
        return errorType;
      }
    }

    // 检查错误名称
    if (error.name) {
      const name = error.name.toLowerCase();
      if (name.includes('timeout')) return 'timeout';
      if (name.includes('navigation')) return 'navigation_timeout';
      if (name.includes('network')) return 'network_error';
    }

    return 'unknown';
  }

  /**
   * 获取错误分类统计
   */
  getErrorStats(errors) {
    const stats = {};

    errors.forEach(error => {
      const type = this.classifyError(error);
      stats[type] = (stats[type] || 0) + 1;
    });

    return stats;
  }
}

/**
 * 监控和日志器
 * 提供统一的监控和日志功能
 */
class MonitorLogger {
  constructor(options = {}) {
    this.logLevel = options.logLevel || 'info';
    this.enableMetrics = options.enableMetrics !== false;
    this.metrics = {
      operations: {},
      errors: {},
      timeouts: {},
      retries: {}
    };
  }

  /**
   * 记录消息
   */
  log(message, level = 'info', accountId = null) {
    if (!this.shouldLog(level)) return;

    const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
    const prefix = accountId ? `[账号${accountId}]` : '';
    const logMessage = `[${timestamp}]${prefix} [TIMEOUT_MANAGER] ${message}`;

    switch (level) {
      case 'error':
        console.error(logMessage);
        break;
      case 'warn':
        console.warn(logMessage);
        break;
      case 'info':
      default:
        console.log(logMessage);
        break;
    }
  }

  /**
   * 记录重试尝试
   */
  logRetryAttempt(operationType, attempt, maxRetries, accountId = null) {
    if (attempt > 0) {
      this.log(`重试 ${operationType} 操作 (${attempt}/${maxRetries})`, 'info', accountId);
    }
    this.recordMetric('retries', `${operationType}_attempts`, 1);
  }

  /**
   * 记录重试成功
   */
  logRetrySuccess(operationType, attempts, totalDuration, accountId = null) {
    this.log(`${operationType} 操作在 ${attempts} 次重试后成功，总耗时: ${totalDuration}ms`, 'info', accountId);
    this.recordMetric('retries', `${operationType}_success`, 1);
  }

  /**
   * 记录重试失败
   */
  logRetryFailure(operationType, attempt, errorType, errorMessage, accountId = null) {
    this.log(`${operationType} 操作第 ${attempt} 次重试失败 [${errorType}]: ${errorMessage}`, 'warn', accountId);
    this.recordMetric('retries', `${operationType}_failures`, 1);
    this.recordMetric('errors', errorType, 1);
  }

  /**
   * 记录重试耗尽
   */
  logRetryExhausted(operationType, attempts, totalDuration, accountId = null) {
    this.log(`${operationType} 操作在 ${attempts} 次重试后仍然失败，总耗时: ${totalDuration}ms`, 'error', accountId);
    this.recordMetric('retries', `${operationType}_exhausted`, 1);
  }

  /**
   * 记录重试延迟
   */
  logRetryDelay(operationType, delay, accountId = null) {
    this.log(`${operationType} 操作等待 ${delay}ms 后重试`, 'info', accountId);
  }

  /**
   * 记录超时调整
   */
  logTimeoutAdjustment(operationType, oldTimeout, newTimeout, accountId = null) {
    this.log(`${operationType} 超时从 ${oldTimeout}ms 调整为 ${newTimeout}ms`, 'info', accountId);
    this.recordMetric('timeouts', `${operationType}_adjustments`, 1);
  }

  /**
   * 记录操作性能
   */
  logOperationPerformance(operationType, duration, success, accountId = null) {
    const status = success ? '成功' : '失败';
    this.log(`${operationType} 操作${status}，耗时: ${duration}ms`, success ? 'info' : 'warn', accountId);
    this.recordMetric('operations', `${operationType}_${success ? 'success' : 'failure'}`, 1);
  }

  /**
   * 记录指标
   */
  recordMetric(category, key, value) {
    if (!this.enableMetrics) return;

    if (!this.metrics[category]) {
      this.metrics[category] = {};
    }

    this.metrics[category][key] = (this.metrics[category][key] || 0) + value;
  }

  /**
   * 获取指标统计
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * 重置指标
   */
  resetMetrics() {
    this.metrics = {
      operations: {},
      errors: {},
      timeouts: {},
      retries: {}
    };
  }

  /**
   * 判断是否应该记录日志
   */
  shouldLog(level) {
    const levels = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }
}

// 创建单例实例
const monitorLogger = new MonitorLogger();
const timeoutManager = new TimeoutManager();
const retryManager = new RetryManager(timeoutManager, monitorLogger);
const adaptiveTimeout = new AdaptiveTimeout(timeoutManager, monitorLogger);

module.exports = {
  TimeoutManager,
  RetryManager,
  LoopController,
  AdaptiveTimeout,
  ErrorClassifier,
  MonitorLogger,
  // 单例实例
  timeoutManager,
  retryManager,
  adaptiveTimeout,
  monitorLogger
};