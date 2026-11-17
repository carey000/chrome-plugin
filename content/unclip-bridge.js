/*
 * 「解除复制限制」· ISOLATED world 桥接层（document_start 独立条目）
 * 职责：读开关 + 白名单 → 用 window.postMessage 下发给 MAIN world 的 unclip-main.js。
 * 不依赖 core.js / boot.js（它们在 document_end 才注入），因此能更早同步状态。
 * 白名单存于 storage.local 的 unclip_hosts，由 popup 配置；此处只负责转发。
 */
;(function () {
  'use strict'

  var CHANNEL = '__autoboat_unclip__'
  var KEY = 'feat_unclip'
  var HOSTS_KEY = 'unclip_hosts'
  var enabled = true
  var hosts = null // null = 未配置，MAIN world 用内置默认；[] = 显式清空

  function sync() {
    window.postMessage({ channel: CHANNEL, enabled: enabled, hosts: hosts }, '*')
    console.log('[unclip][bridge] 下发: 开关', enabled ? '开' : '关', '白名单', hosts)
  }

  try {
    chrome.storage.local.get([KEY, HOSTS_KEY], function (data) {
      enabled = !data || data[KEY] !== false
      hosts = data && Array.isArray(data[HOSTS_KEY]) ? data[HOSTS_KEY] : null
      sync()
    })
  } catch (error) {
    console.warn('[unclip][bridge] 读取失败，按默认开启处理:', error.message)
    sync()
  }

  // popup 切换开关 / 增删站点时，storage 变化让所有已打开的标签页同步生效（无需刷新）
  if (chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return
      var hit = false
      if (changes[KEY]) {
        enabled = changes[KEY].newValue !== false
        hit = true
      }
      if (changes[HOSTS_KEY]) {
        hosts = changes[HOSTS_KEY].newValue
        hit = true
      }
      if (hit) sync()
    })
  }

  // popup 的 sendMessage 热切换也接住，双通道避免任一路径失效
  chrome.runtime.onMessage.addListener(function (message) {
    if (message && message.action === 'feature-flag-changed' && message.id === 'unclip') {
      enabled = message.value !== false
      sync()
    }
  })
})()
