// 新标签页 · 装配入口（必须最后加载）
// 依赖顺序：common.js -> engines.js -> search.js -> sessions.js -> history.js -> newtab.js

;(function (NT) {
  'use strict'

  function focusSearch() {
    const input = document.getElementById('searchInput')
    if (!input) return
    input.focus()
    console.log('[newtab] 尝试聚焦搜索框，当前焦点:', document.activeElement && document.activeElement.id)
  }

  // header 的链接一律新开标签，避免把 new tab 页面本身导航走
  function bindHeaderLinks() {
    ;['gmailEntry', 'bookmarksEntry'].forEach((id) => {
      const link = document.getElementById(id)
      if (!link) return
      link.addEventListener('click', (event) => {
        event.preventDefault()
        NT.openInNewTab(link.href)
        console.log('[newtab] 新开页面:', id)
      })
    })
  }

  // 切换左侧 nav：标签管理显示右栏，页面历史隐藏右栏；header 搜索框始终保留
  function switchView(view) {
    const isTabs = view !== 'history'
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.view === view)
    })
    document.getElementById('viewTabs').hidden = !isTabs
    document.getElementById('viewHistory').hidden = isTabs
    document.getElementById('sidePanel').hidden = !isTabs
    if (!isTabs) NT.history.render()
    console.log('[newtab] 切换视图:', view, '右侧功能区:', isTabs ? '显示' : '隐藏')
  }

  function bindNav() {
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view))
    })
  }

  function init() {
    bindHeaderLinks()
    bindNav()
    NT.history.init()

    // 标签会话不依赖引擎配置，独立初始化，避免一边失败拖垮另一边
    NT.sessions.init()

    NT.engines
      .load()
      .then(() => {
        NT.search.init()
        console.log('[newtab] 页面已初始化')
      })
      .catch((error) => console.error('[newtab] 引擎配置加载失败:', error.message))

    focusSearch()
    // Ctrl+T 之后焦点可能仍在地址栏，下一帧再补一次
    requestAnimationFrame(focusSearch)
    window.addEventListener('focus', focusSearch)
  }

  NT.views = { switchView }

  document.addEventListener('DOMContentLoaded', init)
})(window.NT)
