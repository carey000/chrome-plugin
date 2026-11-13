/*
 * 「解除复制限制」· ISOLATED world 桥接层（document_start 独立条目）
 * 职责：读开关 → 用 window.postMessage 下发给 MAIN world 的 unclip-main.js。
 * 不依赖 core.js / boot.js（它们在 document_end 才注入），因此能更早同步状态。
 */
;(function () {
  'use strict'

  var CHANNEL = '__autoboat_unclip__'
  var KEY = 'feat_unclip'

  function sync(enabled) {
    window.postMessage({ channel: CHANNEL, enabled: enabled !== false }, '*')
    console.log('[unclip][bridge] 下发开关状态:', enabled !== false)
  }

  try {
    chrome.storage.local.get([KEY], function (data) {
      sync(data && data[KEY] !== false)
    })
  } catch (error) {
    console.warn('[unclip][bridge] 读取开关失败，按默认开启处理:', error.message)
    sync(true)
  }

  // popup 切换开关时，storage 变化让所有已打开的标签页同步生效（无需刷新）
  if (chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local' || !changes[KEY]) return
      sync(changes[KEY].newValue !== false)
    })
  }

  // popup 的 sendMessage 热切换也接住，双通道避免任一路径失效
  chrome.runtime.onMessage.addListener(function (message) {
    if (message && message.action === 'feature-flag-changed' && message.id === 'unclip') {
      sync(message.value)
    }
  })
})()
