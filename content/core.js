/*
 * 基础设施层（core）
 * 职责：命名空间、开关状态、工具函数、基类、调度中心、消息监听。
 * 依赖：src/config.js 先注入，提供 window.FEATURE_CONFIG。
 * 顺序约束：必须在所有 sites/*.js 与 boot.js 之前注入（子类要继承 SiteHandler）。
 *
 * MV3 说明：content_scripts 的 js 数组按序注入同一个 isolated world，
 * 各文件共享 window，没有模块作用域，因此统一挂到 window.AutoBoat 下。
 */
;(function () {
  const AB = (window.AutoBoat = window.AutoBoat || {})
  AB.sites = AB.sites || {}

  const FEATURE_CONFIG = (typeof window !== 'undefined' && window.FEATURE_CONFIG) || []

  // 运行时开关状态：未设置的默认开启
  const flags = {}
  function isEnabled(id) {
    return flags[id] !== false
  }

  function loadFlags() {
    return new Promise((resolve) => {
      const keys = FEATURE_CONFIG.map((f) => f.storageKey)
      if (!keys.length) return resolve()
      try {
        chrome.storage.local.get(keys, (stored) => {
          FEATURE_CONFIG.forEach((f) => {
            flags[f.id] = stored[f.storageKey] !== false
          })
          resolve()
        })
      } catch (e) {
        FEATURE_CONFIG.forEach((f) => {
          flags[f.id] = true
        })
        resolve()
      }
    })
  }

  // ---------- 工具 ----------
  function throttle(func, delay) {
    let lastCall = 0
    return function (...args) {
      const now = Date.now()
      if (now - lastCall >= delay) {
        func.apply(this, args)
        lastCall = now
      }
    }
  }

  function parseTime(seconds) {
    if (isNaN(seconds)) return `${seconds} 不是一个时间戳`
    const M = Math.floor(seconds / 60)
    const S = Math.floor(seconds % 60)
    return `${M}:${S}`
  }

  // ---------- 站点处理器基类 ----------
  class SiteHandler {
    constructor(id, matchFn) {
      this.id = id
      this.matchFn = matchFn
    }

    /** 仅当域名命中且开关开启时，才由 FeatureManager 调用 */
    matches(hostname) {
      return this.matchFn ? !!this.matchFn(hostname) : false
    }

    /** 进入页面 / 标签页激活 / 可见性恢复时调用 */
    init() {}

    /** 启动工作（默认等同 init） */
    activate() {
      this.init()
    }

    /** 关闭功能：断开监听、清理 DOM */
    disable() {}
  }

  // ---------- 调度中心 ----------
  class FeatureManager {
    constructor(handlers) {
      this.handlers = handlers
    }

    _matchingEnabled() {
      return this.handlers.filter((h) => h.matches(location.hostname) && isEnabled(h.id))
    }

    bindLifecycle() {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this._matchingEnabled().forEach((h) => h.activate())
      })
      window.addEventListener('pageshow', (e) => {
        if (e.persisted) this._matchingEnabled().forEach((h) => h.activate())
      })
    }

    start() {
      this.bindLifecycle()
      this._matchingEnabled().forEach((h) => h.activate())
    }

    onActivated() {
      this._matchingEnabled().forEach((h) => h.activate())
      return { ok: true, host: location.hostname }
    }

    onUpdated() {
      const ksb = this.handlers.find((h) => h.id === 'kaoshibao')
      if (
        ksb &&
        ksb.matches(location.hostname) &&
        isEnabled('kaoshibao') &&
        typeof ksb.restartTweaks === 'function'
      ) {
        ksb.restartTweaks()
      }
    }

    /** popup 开关热切换 */
    onFlagChanged(id, value) {
      flags[id] = value
      const h = this.handlers.find((x) => x.id === id)
      if (!h) return
      if (value) {
        if (h.matches(location.hostname)) h.activate()
      } else {
        h.disable()
      }
    }
  }

  // 暴露给同 isolated world 内的其他文件
  Object.assign(AB, {
    FEATURE_CONFIG,
    flags,
    isEnabled,
    loadFlags,
    throttle,
    parseTime,
    SiteHandler,
    FeatureManager,
    setFlag(id, value) {
      flags[id] = value
    },
  })

  // AB.manager 由 boot.js（最后注入）同步创建；此处延迟引用，避免顺序依赖
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const manager = AB.manager
    switch (message.action) {
      case 'activated':
        sendResponse(manager ? manager.onActivated() : { ok: false, reason: 'not_ready' })
        break
      case 'updated':
        if (manager) manager.onUpdated()
        break
      case 'feature-flag-changed':
        if (manager) manager.onFlagChanged(message.id, message.value)
        sendResponse({ ok: true })
        break
      case 'log':
        console.log('%c>> $', 'color:yellow', message, sender)
        break
      default:
        break
    }
  })
})()
