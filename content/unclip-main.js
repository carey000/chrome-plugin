/*
 * 「解除复制限制」· MAIN world 注入层（manifest 中单独一条 document_start 条目）
 *
 * 为什么必须在 MAIN world：页面脚本对 copy / contextmenu / keydown 的劫持监听器
 * 注册在页面自己的 world；官方文档未说明 isolated world 的 stopImmediatePropagation
 * 能否跨 world 生效，因此这里与页面同 world 注册 capture 监听，行为可预期。
 *
 * 本文件不调用任何 chrome.* API（MAIN world 的 API 可用性官方未确认），
 * 开关状态由 content/unclip-bridge.js 通过 window.postMessage 下发。
 */
;(function () {
  'use strict'

  var CHANNEL = '__autoboat_unclip__'
  // 需要恢复默认行为的事件。mousedown / dragstart 不全局拦截，避免破坏页面自身交互
  var EVENTS = ['copy', 'cut', 'contextmenu', 'selectstart', 'keydown', 'keyup']
  var SHORTCUTS = { c: 1, x: 1, v: 1, a: 1, f: 1 }
  var CSS_RULE =
    '*, *::before, *::after { -webkit-user-select: text !important; user-select: text !important; }'

  var enabled = true // 与 popup 默认开启一致；页面装配后会被真实状态覆盖
  var sheet = null
  var styleNode = null

  function blocker(event) {
    if (!enabled) return
    if (event.type === 'keydown' || event.type === 'keyup') {
      if (!(event.ctrlKey || event.metaKey)) return
      var key = String(event.key || '').toLowerCase()
      if (!SHORTCUTS[key]) return // 其它快捷键放行，不破坏页面功能
    }
    // capture 阶段掐断后续监听器：页面无法 preventDefault，浏览器默认行为照常执行
    event.stopImmediatePropagation()
  }

  EVENTS.forEach(function (type) {
    document.addEventListener(type, blocker, true)
  })

  // 用 constructable stylesheet 绕开页面 style-src CSP；不支持时降级到 <style>
  function applyStyle(on) {
    if (typeof CSSStyleSheet !== 'undefined' && CSSStyleSheet.prototype.replaceSync) {
      try {
        if (!sheet) {
          sheet = new CSSStyleSheet()
          sheet.replaceSync(CSS_RULE)
        }
        var list = Array.prototype.slice.call(document.adoptedStyleSheets || [])
        var index = list.indexOf(sheet)
        if (on && index === -1) document.adoptedStyleSheets = list.concat([sheet])
        if (!on && index !== -1) document.adoptedStyleSheets = list.filter(function (s) { return s !== sheet })
        return
      } catch (error) {
        console.warn('[unclip][main] adoptedStyleSheets 不可用，降级到 style 标签:', error.message)
      }
    }
    if (!on) {
      if (styleNode && styleNode.parentNode) styleNode.parentNode.removeChild(styleNode)
      styleNode = null
      return
    }
    if (styleNode) return
    styleNode = document.createElement('style')
    styleNode.textContent = CSS_RULE
    var parent = document.head || document.documentElement
    if (parent) parent.appendChild(styleNode)
    else document.addEventListener('DOMContentLoaded', function () {
      if (styleNode && !styleNode.parentNode && document.head) document.head.appendChild(styleNode)
    })
  }

  function setEnabled(value) {
    enabled = !!value
    applyStyle(enabled)
    console.log('[unclip][main] 状态:', enabled ? '已启用' : '已停用')
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return
    var data = event.data
    if (!data || data.channel !== CHANNEL) return
    setEnabled(data.enabled)
  })

  applyStyle(enabled)
  console.log('[unclip][main] 已装载，等待开关状态')
})()
