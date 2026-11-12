// 新标签页 · 共享工具层（必须最先加载）
// MV3 扩展页的多个 <script> 共享同一个全局作用域，统一挂到 window.NT，避免同名符号覆盖。

window.NT = window.NT || {}

;(function (NT) {
  'use strict'

  // 所有跳转一律新开标签，保留当前 new tab 页面
  NT.openInNewTab = function (url) {
    if (!url) return
    chrome.tabs.create({ url })
    console.log('[newtab] 新开标签:', url)
  }

  NT.el = function (tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  // favicon 统一走共享组件（src/favicon.js，需在本文件之前加载）
  NT.favicon = function (url, extraClass) {
    if (typeof window.FAVICON === 'function') return window.FAVICON(url, extraClass)
    return NT.el('span', 'favicon favicon--empty' + (extraClass ? ' ' + extraClass : ''))
  }

  // 用域名 hash 生成 8 色字母块，不请求任何远程 favicon
  NT.badge = function (name, url) {
    let host = ''
    try {
      host = new URL(url).hostname
    } catch (error) {
      host = String(url || '')
    }
    host = host.replace(/^www\./, '')
    let hash = 0
    for (let i = 0; i < host.length; i++) hash = (hash * 31 + host.charCodeAt(i)) | 0
    const label = (name || host || '#').trim()
    return { host: host || '未知来源', letter: (label[0] || '#').toUpperCase(), tone: Math.abs(hash) % 8 }
  }

  NT.storageGet = function (keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (data) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
        resolve(data || {})
      })
    })
  }

  NT.storageSet = function (obj) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(obj, () => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
        resolve()
      })
    })
  }

  NT.tabsQuery = function (queryInfo) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query(queryInfo, (tabs) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
        resolve(tabs || [])
      })
    })
  }

  NT.pad2 = function (n) {
    return String(n).padStart(2, '0')
  }

  NT.formatTime = function (ts) {
    const d = new Date(ts)
    return d.getMonth() + 1 + '月' + d.getDate() + '日 ' + NT.pad2(d.getHours()) + ':' + NT.pad2(d.getMinutes())
  }

  // 集合命名用：2026年11月11日 17:53（带年份，跨年后不会重名）
  NT.formatStamp = function (ts) {
    const d = new Date(ts)
    return (
      d.getFullYear() +
      '年' +
      (d.getMonth() + 1) +
      '月' +
      d.getDate() +
      '日 ' +
      NT.pad2(d.getHours()) +
      ':' +
      NT.pad2(d.getMinutes())
    )
  }
})(window.NT)
