// 网址导航 · 顶部分类切换 + 卡片/列表视图 + 图标网格（最后一个加载，自初始化）
// 依赖：favicon.js / common.js / sites-data.js；不依赖 newtab.js，因此可追加在脚本末尾。

;(function (NT) {
  'use strict'

  var DATA = NT.sitesData || { categories: [], sites: [] }
  var ALL = '全部'
  var VIEW_KEY = 'nt_sites_view_mode'
  var active = ALL
  var viewMode = 'grid'

  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(VIEW_KEY) === 'list') {
      viewMode = 'list'
    }
  } catch (error) {
    viewMode = 'grid'
  }

  // cat 允许字符串（单分类）或数组（同一站点出现在多张分类截图里）
  function hasCat(site, name) {
    return Array.isArray(site.cat) ? site.cat.indexOf(name) !== -1 : site.cat === name
  }

  function categoryNames() {
    var used = {}
    DATA.sites.forEach(function (site) {
      var cats = Array.isArray(site.cat) ? site.cat : [site.cat]
      cats.forEach(function (name) { if (name) used[name] = true })
    })
    return [ALL].concat(
      (DATA.categories || []).filter(function (name) { return used[name] })
    )
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch (error) {
      return String(url || '')
    }
  }

  // 有 icon 用真实图（失败回退灰占位），没有则用 8 色字母块，全程零网络、零权限
  function makeIcon(site) {
    if (site.icon) return NT.favicon(site.icon, 'site-icon')
    var badge = NT.badge(site.name, site.url)
    return NT.el('span', 'site-icon tone-' + badge.tone, badge.letter)
  }

  function makeTile(site) {
    var pending = !site.url
    var host = pending ? '' : hostOf(site.url)
    var tile = NT.el('button', pending ? 'site-tile site-tile--pending' : 'site-tile')
    tile.type = 'button'
    tile.title = pending
      ? site.name + ' · 网址待补（在 sites-data.js 补 url）'
      : site.name + ' · ' + host + (site.tentative ? '（名称/域名待核）' : '')
    tile.dataset.url = site.url || ''
    tile.appendChild(makeIcon(site))
    tile.appendChild(NT.el('span', 'site-name', site.name))
    tile.appendChild(NT.el('span', 'site-host', pending ? '网址待补' : host))
    tile.addEventListener('click', function () {
      if (pending) {
        console.log('[newtab][sites] 网址待补，未跳转:', site.name)
        return
      }
      NT.openInNewTab(site.url)
      console.log('[newtab][sites] 打开站点:', site.name, site.url)
    })
    return tile
  }

  function renderBar() {
    var bar = document.getElementById('sitesCategoryBar')
    if (!bar) return
    bar.textContent = ''
    categoryNames().forEach(function (name) {
      var btn = NT.el('button', 'site-cat' + (name === active ? ' is-active' : ''), name)
      btn.type = 'button'
      btn.dataset.cat = name
      btn.addEventListener('click', function () {
        active = name
        render()
      })
      bar.appendChild(btn)
    })
  }

  function setViewMode(mode) {
    viewMode = mode === 'list' ? 'list' : 'grid'
    var grid = document.getElementById('sitesGrid')
    if (grid && grid.classList) grid.classList.toggle('sites-grid--list', viewMode === 'list')
    ;[['sitesViewList', true], ['sitesViewGrid', false]].forEach(function (pair) {
      var btn = document.getElementById(pair[0])
      if (!btn) return
      var on = (viewMode === 'list') === pair[1]
      if (btn.classList) btn.classList.toggle('is-active', on)
      btn.setAttribute('aria-pressed', String(on))
    })
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(VIEW_KEY, viewMode)
    } catch (error) {
      console.warn('[newtab][sites] 视图偏好无法保存:', error.message)
    }
    console.log('[newtab][sites] 切换视图:', viewMode)
  }

  function bindViewSwitch() {
    var list = document.getElementById('sitesViewList')
    var grid = document.getElementById('sitesViewGrid')
    if (list && list.addEventListener) list.addEventListener('click', function () { setViewMode('list') })
    if (grid && grid.addEventListener) grid.addEventListener('click', function () { setViewMode('grid') })
  }

  function render() {
    renderBar()
    var grid = document.getElementById('sitesGrid')
    if (!grid) return
    grid.textContent = ''
    var list = active === ALL
      ? DATA.sites
      : DATA.sites.filter(function (site) { return hasCat(site, active) })
    list.forEach(function (site) { grid.appendChild(makeTile(site)) })
    if (!list.length) {
      grid.appendChild(NT.el('div', 'sites-empty', '这个分类下还没有站点，编辑 sites-data.js 添加'))
    }
    if (grid.classList) grid.classList.toggle('sites-grid--list', viewMode === 'list')
    var summary = document.getElementById('sitesSummary')
    if (summary) {
      summary.textContent = DATA.sites.length + ' 个站点 · ' + (categoryNames().length - 1) + ' 个分类'
    }
    console.log('[newtab][sites] 渲染分类:', active, list.length, '个站点 /', viewMode, '视图')
  }

  NT.sites = {
    init: render,
    render: render,
    setCategory: function (name) { active = name; render() },
    setViewMode: setViewMode,
    hasCat: hasCat,
    get active() { return active },
    get viewMode() { return viewMode },
    get categories() { return categoryNames() }
  }

  function boot() {
    bindViewSwitch()
    setViewMode(viewMode)
    render()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})(window.NT)
