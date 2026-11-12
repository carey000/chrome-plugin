// 新标签页 · 页面历史管理（只读浏览记录，点击新开标签）
// 依赖 common.js；由 newtab.js 在切到「页面历史」视图时调用 render()

;(function (NT) {
  'use strict'

  const MAX = 200
  const VISITABLE = /^https?:\/\//i

  function searchHistory() {
    return new Promise((resolve, reject) => {
      // 未声明 history 权限时 chrome.history 整体是 undefined，不能直接取 .search
      if (!chrome.history || !chrome.history.search) {
        return reject(new Error('缺少 history 权限'))
      }
      chrome.history.search({ text: '', maxResults: MAX, startTime: 0 }, (items) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
        resolve(items || [])
      })
    })
  }

  function formatVisit(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    const clock = NT.pad2(d.getHours()) + ':' + NT.pad2(d.getMinutes())
    return d.toDateString() === new Date().toDateString() ? '今天 ' + clock : NT.formatTime(ts)
  }

  function makeItem(item) {
    const row = NT.el('button', 'history-item')
    row.type = 'button'
    row.title = item.title || item.url
    row.appendChild(NT.favicon('', 'history-favicon'))

    const meta = NT.el('div', 'history-meta')
    meta.appendChild(NT.el('div', 'history-title', item.title || item.url || '未命名页面'))
    meta.appendChild(NT.el('div', 'history-host', NT.badge(item.title, item.url).host))
    row.appendChild(meta)

    row.appendChild(NT.el('span', 'history-time', formatVisit(item.lastVisitTime)))
    row.addEventListener('click', () => NT.openInNewTab(item.url))
    return row
  }

  function render() {
    const box = document.getElementById('historyList')
    const summary = document.getElementById('historySummary')
    box.textContent = ''
    summary.textContent = '读取中…'

    return searchHistory()
      .then((items) => {
        const list = items.filter((item) => VISITABLE.test(item.url || ''))
        box.textContent = ''
        summary.textContent = list.length + ' 条记录'
        if (!list.length) {
          box.appendChild(NT.el('div', 'history-empty', '暂无浏览记录'))
          return
        }
        list.forEach((item) => box.appendChild(makeItem(item)))
        console.log('[newtab][history] 渲染历史:', list.length, '条')
      })
      .catch((error) => {
        box.textContent = ''
        summary.textContent = '读取失败'
        box.appendChild(
          NT.el(
            'div',
            'history-empty',
            '无法读取浏览记录：' + error.message + '。请在 chrome://extensions 重新加载扩展并确认已授予 history 权限。'
          )
        )
        console.error('[newtab][history] 读取失败:', error.message)
      })
  }

  function init() {
    document.getElementById('historyRefreshBtn').addEventListener('click', render)
  }

  NT.history = { init, render }
})(window.NT)
