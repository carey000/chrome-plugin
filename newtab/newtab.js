// 新标签页 · 装配入口
// 脚本顺序：favicon.js -> common.js -> engines.js -> search.js -> sessions.js -> history.js -> newtab.js -> sites-data.js -> sites.js
// sites-data.js / sites.js 自初始化，不依赖本文件，所以可安全追加在末尾。

;(function (NT) {
  'use strict'

  // 大号时间 + 月日 / 星期 / 农历：全部本地计算，零网络请求、无农历数据表
  // 农历月与日序号由 Intl 的 u-ca-chinese（浏览器 ICU 中国日历）给出，
  // 再映射成「初一 / 初四 / 廿一」这类中文日名；Intl 不支持时只显示公历。
  const LUNAR_DAY_NAMES = [
    '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
  ]

  function renderDate() {
    const clock = document.getElementById('headerClock')
    const dateNode = document.getElementById('headerDate')
    if (!dateNode) return
    const now = new Date()
    if (clock) clock.textContent = NT.pad2(now.getHours()) + ':' + NT.pad2(now.getMinutes())
    const monthDay = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(now)
    const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now)
    let lunar = ''
    try {
      const parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
        month: 'long', day: 'numeric'
      }).formatToParts(now)
      const month = (parts.find((p) => p.type === 'month') || {}).value || ''
      const day = Number((parts.find((p) => p.type === 'day') || {}).value)
      if (month && day >= 1 && day <= 30) lunar = month + LUNAR_DAY_NAMES[day - 1]
    } catch (error) {
      console.warn('[newtab] 当前环境不支持中国农历日历，仅显示公历')
    }
    dateNode.textContent = monthDay + ' ' + weekday + (lunar ? ' ' + lunar : '')
    console.log('[newtab] 时间:', clock && clock.textContent, '| 日期:', dateNode.textContent)
  }

  function focusSearch() {
    const input = document.getElementById('searchInput')
    if (!input) return
    input.focus()
    console.log('[newtab] 尝试聚焦搜索框，当前焦点:', document.activeElement && document.activeElement.id)
  }

  // header 的链接一律新开标签，避免把 new tab 页面本身导航走
  function bindHeaderLinks() {
    ;['gmailEntry', 'itabEntry', 'bookmarksEntry'].forEach((id) => {
      const link = document.getElementById(id)
      if (!link) return
      link.addEventListener('click', (event) => {
        event.preventDefault()
        NT.openInNewTab(link.href)
        console.log('[newtab] 新开页面:', id)
      })
    })
  }

  // 视图注册表：以后新增功能只需在这里加一行，并在 HTML 里加 nav-item + view
  // side 表示该视图是否显示右侧 240px 功能区；header 搜索框常驻，不随视图变化
  const DEFAULT_VIEW = 'sites'
  const VIEW_MAP = {
    sites: { view: 'viewSites', side: false },
    tabs: { view: 'viewTabs', side: true },
    history: { view: 'viewHistory', side: false },
  }

  function switchView(view) {
    const target = VIEW_MAP[view] ? view : DEFAULT_VIEW
    const cfg = VIEW_MAP[target]
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.view === target)
    })
    Object.keys(VIEW_MAP).forEach((key) => {
      const node = document.getElementById(VIEW_MAP[key].view)
      if (node) node.hidden = key !== target
    })
    document.getElementById('sidePanel').hidden = !cfg.side
    if (target === 'history') NT.history.render()
    console.log('[newtab] 切换视图:', target, '右侧功能区:', cfg.side ? '显示' : '隐藏')
  }

  function bindNav() {
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view))
    })
  }

  // 只收窄 nav 并隐藏文字，不隐藏 nav 本身（否则折叠按钮无法再次展开）
  function bindNavToggle() {
    const btn = document.getElementById('navToggle')
    const nav = document.getElementById('navPanel')
    if (!btn || !nav || !nav.classList) return
    btn.addEventListener('click', () => {
      const collapsed = !nav.classList.contains('is-collapsed')
      nav.classList.toggle('is-collapsed', collapsed)
      const label = collapsed ? '展开侧边栏' : '折叠侧边栏'
      btn.setAttribute('aria-expanded', String(!collapsed))
      btn.setAttribute('aria-label', label)
      btn.title = label
      console.log('[newtab] 侧边栏:', collapsed ? '已折叠' : '已展开')
    })
  }

  function init() {
    bindHeaderLinks()
    bindNav()
    bindNavToggle()
    renderDate()
    // 大号时钟常驻页面，定时刷新；切回页面时由 focus 事件立即重算
    if (typeof window.setInterval === 'function') window.setInterval(renderDate, 30 * 1000)
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
    // 回到页面时顺带刷新时间，跨天 / 跨分钟不会显示旧值
    window.addEventListener('focus', () => { focusSearch(); renderDate() })
  }

  NT.views = { switchView }

  document.addEventListener('DOMContentLoaded', init)
})(window.NT)
