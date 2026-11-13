// 网址导航 · 顶部横向分类切换 + 图标网格（最后一个加载，自初始化）
// 依赖：favicon.js / common.js / sites-data.js；不依赖 newtab.js，因此可追加在脚本末尾。

;(function (NT) {
  'use strict'

  var DATA = NT.sitesData || { categories: [], sites: [] }
  var ALL = '全部'
  var active = ALL

  function categoryNames() {
    var used = {}
    DATA.sites.forEach(function (site) {
      if (site.cat) used[site.cat] = true
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
    var host = hostOf(site.url)
    var tile = NT.el('button', 'site-tile')
    tile.type = 'button'
    tile.title = site.name + ' · ' + host + (site.tentative ? '（名称待核）' : '')
    tile.dataset.url = site.url
    tile.appendChild(makeIcon(site))
    tile.appendChild(NT.el('span', 'site-name', site.name))
    tile.appendChild(NT.el('span', 'site-host', host))
    tile.addEventListener('click', function () {
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

  function render() {
    renderBar()
    var grid = document.getElementById('sitesGrid')
    if (!grid) return
    grid.textContent = ''
    var list = active === ALL
      ? DATA.sites
      : DATA.sites.filter(function (site) { return site.cat === active })
    list.forEach(function (site) { grid.appendChild(makeTile(site)) })
    if (!list.length) {
      grid.appendChild(NT.el('div', 'sites-empty', '这个分类下还没有站点，编辑 sites-data.js 添加'))
    }
    var summary = document.getElementById('sitesSummary')
    if (summary) {
      summary.textContent = DATA.sites.length + ' 个站点 · ' + (categoryNames().length - 1) + ' 个分类'
    }
    console.log('[newtab][sites] 渲染分类:', active, list.length, '个站点')
  }

  NT.sites = {
    init: render,
    render: render,
    setCategory: function (name) { active = name; render() },
    get active() { return active },
    get categories() { return categoryNames() }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render)
  } else {
    render()
  }
})(window.NT)
