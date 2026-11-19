// 网址导航 · 分类增删/拖拽排序 + 站点编辑/拖拽(含跨分类移动) + 卡片/列表视图
// 依赖：favicon.js / common.js / sites-data.js；不依赖 newtab.js，自初始化。
// 数据：sites-data.js 是只读种子；用户改动存 chrome.storage.local 的 `nt_sites_state`，
//       不动其它 key，刷新后保留。

;(function (NT) {
  'use strict'

  var DATA = NT.sitesData || { categories: [], sites: [] }
  var VIEW_KEY = 'nt_sites_view_mode'
  var STORAGE_KEY = 'nt_sites_state'
  var viewMode = 'grid'
  var active = null
  var state = null          // { categories: [], sites: [] }
  var editingId = null      // 当前编辑的站点 id
  var dragCtx = null        // { type: 'cat'|'site', cat?, id? }
  var catModalFromEdit = false // 添加分类弹窗的打开来源：true=编辑弹窗内, false=分类栏

  // hover 提示：抓取到的网页 title / description 缓存（独立于站点数据，不碰 nt_sites_state）
  var META_KEY = 'nt_sites_meta'
  var META_TTL = 7 * 24 * 3600 * 1000 // 缓存 7 天，过期重抓
  var metaCache = {}                  // url -> { title, desc, ts, fail? }
  var metaPending = {}                // url -> true，去重并发请求
  var activeTipSite = null            // 当前 hover 的站点
  var lastMouse = { x: 0, y: 0 }

  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(VIEW_KEY) === 'list') {
      viewMode = 'list'
    }
  } catch (error) {
    viewMode = 'grid'
  }

  function hasStorage() {
    return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local &&
      typeof NT.storageGet === 'function' && typeof NT.storageSet === 'function'
  }

  function defaults() {
    return {
      categories: (DATA.categories || []).slice(),
      sites: normalize((DATA.sites || []).map(function (site) {
        return Object.assign({}, site, {
          cat: Array.isArray(site.cat) ? site.cat.slice() : (site.cat ? [site.cat] : [])
        })
      }))
    }
  }

  function normalize(sites) {
    sites.forEach(function (site, i) {
      if (!site.id) site.id = 'site-' + i
      if (!Array.isArray(site.cat)) site.cat = site.cat ? [site.cat] : []
    })
    return sites
  }

  function loadState() {
    if (!hasStorage()) {
      state = defaults()
      normalize(state.sites)
      active = state.categories[0]
      return Promise.resolve()
    }
    return NT.storageGet(STORAGE_KEY).then(function (data) {
      var saved = data && data[STORAGE_KEY]
      state = saved && Array.isArray(saved.categories) && Array.isArray(saved.sites)
        ? { categories: saved.categories.slice(), sites: normalize(saved.sites) }
        : defaults()
      active = state.categories.indexOf(active) !== -1 ? active : state.categories[0]
      console.log('[newtab][sites] 状态已加载:', state.categories.length, '个分类 /', state.sites.length, '个站点')
    }).catch(function (error) {
      state = defaults()
      normalize(state.sites)
      active = state.categories[0]
      console.warn('[newtab][sites] 读取状态失败，回退默认数据:', error.message)
    })
  }

  function save(label) {
    if (!hasStorage()) return Promise.resolve()
    return NT.storageSet({ [STORAGE_KEY]: state }).then(function () {
      console.log('[newtab][sites] 已保存:', label)
    }).catch(function (error) {
      console.warn('[newtab][sites] 保存失败:', label, error.message)
    })
  }

  // cat 允许字符串（单分类）或数组（多分类）
  function hasCat(site, name) {
    return Array.isArray(site.cat) ? site.cat.indexOf(name) !== -1 : site.cat === name
  }

  function categoryNames() {
    return state ? state.categories.slice() : []
  }

  function findSite(id) {
    for (var i = 0; i < state.sites.length; i++) {
      if (state.sites[i].id === id) return state.sites[i]
    }
    return null
  }

  // 图标优先级：用户自定义 icon > 由域名推导的 favicon > 8 色字母块
  // favicon 走 DuckDuckGo 免费服务；加载失败时回退字母块（不依赖 favicon.js 的灰占位）
  function makeIcon(site) {
    var src = site.icon || siteFavicon(site.url)
    if (src) {
      var wrap = NT.favicon(src, 'site-icon')
      var img = wrap.querySelector('img')
      if (img) img.addEventListener('error', function () {
        // favicon.js 默认移除 img 留灰块，这里改成回退字母块
        var badge = NT.badge(site.name, site.url)
        wrap.className = 'site-icon tone-' + badge.tone
        wrap.textContent = badge.letter
      })
      return wrap
    }
    var badge = NT.badge(site.name, site.url)
    return NT.el('span', 'site-icon tone-' + badge.tone, badge.letter)
  }

  function siteFavicon(url) {
    if (!url) return ''
    try {
      var parsed = new URL(url)
      if (!/^https?:$/.test(parsed.protocol)) return ''
      return 'https://icons.duckduckgo.com/ip3/' + parsed.hostname + '.ico'
    } catch (error) {
      return ''
    }
  }

  // ---------- hover 提示：抓取网页 title / description ----------
  function parseMetaHtml(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html')
    var title = doc.title ? String(doc.title).trim() : ''
    var desc = ''
    var metaNodes = doc.querySelectorAll('meta[name="description"], meta[property="og:description"]')
    for (var i = 0; i < metaNodes.length; i++) {
      var content = metaNodes[i].getAttribute('content')
      if (content && content.trim()) { desc = content.trim(); break }
    }
    if (!title && !desc) return null
    return { title: title.slice(0, 120), desc: desc.slice(0, 200) }
  }

  function fetchSiteMeta(url) {
    if (metaPending[url]) return
    metaPending[url] = true
    // 扩展页有 host_permissions，可跨域 fetch；抓不到就标记失败，不再反复请求
    fetch(url, { credentials: 'omit', redirect: 'follow' })
      .then(function (res) {
        if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status))
        return res.text()
      })
      .then(function (html) {
        var parsed = parseMetaHtml(html)
        metaCache[url] = parsed
          ? { title: parsed.title, desc: parsed.desc, ts: Date.now() }
          : { fail: true, ts: Date.now() }
        console.log('[newtab][sites] 抓取站点元信息:', url, parsed ? parsed.title : '(无内容)')
      })
      .catch(function (error) {
        metaCache[url] = { fail: true, ts: Date.now() }
        console.warn('[newtab][sites] 站点元信息抓取失败:', url, error.message)
      })
      .then(function () {
        delete metaPending[url]
        saveMeta()
        if (activeTipSite && activeTipSite.url === url) showTooltip(activeTipSite)
      })
  }

  function loadMeta() {
    if (!hasStorage()) return Promise.resolve()
    return NT.storageGet(META_KEY).then(function (data) {
      metaCache = (data && data[META_KEY]) || {}
    }).catch(function () { metaCache = {} })
  }

  function saveMeta() {
    if (!hasStorage()) return
    var obj = {}
    obj[META_KEY] = metaCache
    NT.storageSet(obj)
  }

  function getMeta(url) {
    var m = metaCache[url]
    if (!m) return null
    // 失败或过期：返回 null（失败不重试，过期可重抓）
    if (m.fail) return null
    if (Date.now() - m.ts > META_TTL) return null
    return m
  }

  function showTooltip(site) {
    var tip = document.getElementById('siteTooltip')
    if (!tip || !site.url) return
    var meta = getMeta(site.url)
    if (meta) {
      var titleNode = document.getElementById('siteTooltipTitle')
      var descNode = document.getElementById('siteTooltipDesc')
      if (titleNode) { titleNode.textContent = meta.title; titleNode.hidden = !meta.title }
      if (descNode) { descNode.textContent = meta.desc; descNode.hidden = !meta.desc }
      tip.hidden = false
      positionTooltip()
    } else {
      tip.hidden = true
      // 失败标记不再重试；未抓过或已过期的则发起抓取，回调里会再次 showTooltip
      var cached = metaCache[site.url]
      if ((!cached || !cached.fail) && !metaPending[site.url]) fetchSiteMeta(site.url)
    }
  }

  function hideTooltip() {
    activeTipSite = null
    var tip = document.getElementById('siteTooltip')
    if (tip) tip.hidden = true
  }

  function positionTooltip() {
    var tip = document.getElementById('siteTooltip')
    if (!tip || tip.hidden) return
    var pad = 14
    var w = tip.offsetWidth
    var h = tip.offsetHeight
    var left = lastMouse.x + pad
    var top = lastMouse.y + pad
    if (left + w > window.innerWidth - 8) left = lastMouse.x - w - pad
    if (top + h > window.innerHeight - 8) top = lastMouse.y - h - pad
    tip.style.left = Math.max(8, left) + 'px'
    tip.style.top = Math.max(8, top) + 'px'
  }

  var PENCIL = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
    '<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
    '<path d="m14.5 6.5 3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>'

  function clearDrag() {
    dragCtx = null
    var nodes = document.querySelectorAll('.is-dragging, .is-drop-target')
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.remove('is-dragging')
      nodes[i].classList.remove('is-drop-target')
    }
  }

  function makeTile(site) {
    var pending = !site.url
    var tile = NT.el('div', pending ? 'site-tile site-tile--pending' : 'site-tile')
    tile.setAttribute('role', 'button')
    tile.tabIndex = 0
    tile.dataset.id = site.id
    tile.draggable = true
    // title 交给自定义 tooltip（网页 title/description），不再用原生 title 显示站点名
    tile.appendChild(makeIcon(site))
    tile.appendChild(NT.el('span', 'site-name', site.name))

    var edit = NT.el('button', 'site-edit')
    edit.type = 'button'
    edit.title = '编辑 ' + site.name
    edit.setAttribute('aria-label', '编辑 ' + site.name)
    edit.innerHTML = PENCIL
    edit.addEventListener('click', function (event) {
      event.stopPropagation()
      openEditModal(site.id)
    })
    tile.appendChild(edit)

    tile.addEventListener('click', function () {
      if (pending) {
        console.log('[newtab][sites] 网址待补，未跳转:', site.name)
        return
      }
      NT.openInNewTab(site.url)
      console.log('[newtab][sites] 打开站点:', site.name, site.url)
    })
    tile.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        tile.click()
      }
    })

    // hover 提示：只在有 url 的站点上显示网页 title/description
    tile.addEventListener('mouseenter', function () {
      if (pending) return
      activeTipSite = site
      showTooltip(site)
    })
    tile.addEventListener('mousemove', function (event) {
      lastMouse.x = event.clientX
      lastMouse.y = event.clientY
      if (activeTipSite === site) positionTooltip()
    })
    tile.addEventListener('mouseleave', hideTooltip)

    // 跨分类移动保留原生拖拽（分类标签是 drop 目标）；同分类排序交给 Sortable，避免两套 drop 互相拦截
    tile.addEventListener('dragstart', function (event) {
      hideTooltip()
      dragCtx = { type: 'site', id: site.id }
      try { event.dataTransfer.setData('text/plain', 'site:' + site.id) } catch (error) { /* 忽略 */ }
      console.log('[newtab][sites] 开始拖动站点:', site.name)
    })
    tile.addEventListener('dragend', clearDrag)
    return tile
  }

  // 跨分类移动：从原分类移除，只留在目标分类
  function moveSiteToCategory(id, catName) {
    var site = findSite(id)
    if (!site || site.cat.length === 1 && site.cat[0] === catName) return
    var from = site.cat.slice()
    site.cat = [catName]
    save('移动站点 ' + site.name + ': ' + from.join('/') + ' → ' + catName)
    render()
  }

  // Sortable 拖完后 DOM 已到位，直接从 DOM 顺序回写数据（不再 render，以免打断动画）
  function syncCategoryOrder(bar) {
    var names = []
    Array.prototype.forEach.call(bar.querySelectorAll('.site-cat:not(.site-cat--add)'), function (el) {
      if (el.dataset.cat) names.push(el.dataset.cat)
    })
    if (!names.length || names.join('|') === state.categories.join('|')) return
    state.categories = names
    save('分类排序: ' + names.join(' / '))
  }

  function syncSiteOrder(grid) {
    if (!active) return
    var ids = []
    Array.prototype.forEach.call(grid.querySelectorAll('.site-tile'), function (el) {
      if (el.dataset.id) ids.push(el.dataset.id)
    })
    if (!ids.length) return
    // 只重排当前分类站点在全局数组中的位置，其它分类的站点保持原位
    var slots = []
    state.sites.forEach(function (site, i) { if (hasCat(site, active)) slots.push(i) })
    if (slots.length !== ids.length) return
    var moving = ids.map(function (id) { return findSite(id) })
    if (moving.some(function (s) { return !s })) return
    slots.forEach(function (idx, k) { state.sites[idx] = moving[k] })
    save('站点排序: ' + active + ' (' + ids.length + ' 个)')
  }

  var sortablesReady = false
  function initSortables() {
    if (sortablesReady) return
    if (typeof window.Sortable === 'undefined') {
      console.warn('[newtab][sites] Sortable 未加载，拖拽不可用')
      return
    }
    sortablesReady = true
    var bar = document.getElementById('sitesCategoryBar')
    var grid = document.getElementById('sitesGrid')
    var base = {
      animation: 180,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag'
    }
    if (bar) {
      window.Sortable.create(bar, Object.assign({}, base, {
        draggable: '.site-cat:not(.site-cat--add)',
        handle: '.site-cat-label',
        filter: '.site-cat-del',
        onEnd: function (event) {
          if (event.from !== event.to) return
          syncCategoryOrder(bar)
          dragCtx = null
          console.log('[newtab][sites] 分类排序完成')
        }
      }))
    }
    if (grid) {
      window.Sortable.create(grid, Object.assign({}, base, {
        draggable: '.site-tile',
        filter: '.site-edit',
        onEnd: function (event) {
          if (event.from !== event.to) return
          syncSiteOrder(grid)
          dragCtx = null
          console.log('[newtab][sites] 站点排序完成:', active)
        }
      }))
    }
    console.log('[newtab][sites] Sortable 拖拽已初始化')
  }

  function renderBar() {
    var bar = document.getElementById('sitesCategoryBar')
    if (!bar) return
    bar.textContent = ''
    categoryNames().forEach(function (name) {
      var btn = NT.el('button', 'site-cat' + (name === active ? ' is-active' : ''), '')
      btn.type = 'button'
      btn.dataset.cat = name
      btn.draggable = true
      btn.appendChild(NT.el('span', 'site-cat-label', name))
      var del = NT.el('span', 'site-cat-del', '×')
      del.title = '删除分类「' + name + '」'
      del.setAttribute('role', 'button')
      del.setAttribute('aria-label', '删除分类 ' + name)
      del.addEventListener('click', function (event) {
        event.stopPropagation()
        deleteCategory(name)
      })
      btn.appendChild(del)
      btn.addEventListener('click', function () {
        if (active === name) return
        active = name
        render()
      })
      btn.addEventListener('dragstart', function (event) {
        dragCtx = { type: 'cat', cat: name }
        try { event.dataTransfer.setData('text/plain', 'cat:' + name) } catch (error) { /* 忽略 */ }
        console.log('[newtab][sites] 开始拖动分类:', name)
      })
      btn.addEventListener('dragend', clearDrag)
      // 分类排序由 Sortable 接管，这里只处理「站点拖到分类」的跨类移动
      btn.addEventListener('dragover', function (event) {
        if (!dragCtx || dragCtx.type !== 'site') return
        event.preventDefault()
        btn.classList.add('is-drop-target')
      })
      btn.addEventListener('dragleave', function () { btn.classList.remove('is-drop-target') })
      btn.addEventListener('drop', function (event) {
        if (!dragCtx || dragCtx.type !== 'site') return
        event.preventDefault()
        event.stopPropagation()
        btn.classList.remove('is-drop-target')
        moveSiteToCategory(dragCtx.id, name)
        clearDrag()
      })
      bar.appendChild(btn)
    })
    var add = NT.el('button', 'site-cat site-cat--add', '+')
    add.type = 'button'
    add.title = '添加分类'
    add.setAttribute('aria-label', '添加分类')
    add.addEventListener('click', function () { openAddCatModal(false) })
    bar.appendChild(add)
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

  function openAddCatModal(fromEdit) {
    catModalFromEdit = !!fromEdit
    var modal = document.getElementById('siteCatModal')
    if (modal) modal.hidden = false
    var input = document.getElementById('siteCatName')
    if (input) input.value = ''
    var error = document.getElementById('siteCatError')
    if (error) error.hidden = true
    if (input) input.focus()
    console.log('[newtab][sites] 打开添加分类弹窗, 来源:', fromEdit ? '编辑弹窗' : '分类栏')
  }

  function renderEditCats(selected) {
    var wrap = document.getElementById('siteEditCats')
    if (!wrap) return
    wrap.textContent = ''
    state.categories.forEach(function (name) {
      var label = NT.el('label', 'site-edit-cat')
      var checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.value = name
      checkbox.checked = selected.indexOf(name) !== -1
      label.appendChild(checkbox)
      label.appendChild(NT.el('span', '', name))
      wrap.appendChild(label)
    })
    var add = NT.el('button', 'site-edit-cat site-edit-cat--add', '+')
    add.type = 'button'
    add.title = '新建分类'
    add.setAttribute('aria-label', '新建分类')
    add.addEventListener('click', function () { openAddCatModal(true) })
    wrap.appendChild(add)
  }

  function val(id) {
    var node = document.getElementById(id)
    return node ? String(node.value || '').trim() : ''
  }

  function openEditModal(id) {
    var site = findSite(id)
    if (!site) return
    editingId = id
    var name = document.getElementById('siteEditName')
    var url = document.getElementById('siteEditUrl')
    var icon = document.getElementById('siteEditIcon')
    var error = document.getElementById('siteEditError')
    if (name) name.value = site.name
    if (url) url.value = site.url || ''
    if (icon) icon.value = site.icon || ''
    if (error) error.hidden = true
    resetDeleteBtn()
    renderEditCats(site.cat)
    document.getElementById('siteEditModal').hidden = false
    console.log('[newtab][sites] 打开编辑弹窗:', site.name, site.cat.join('/'))
  }

  function closeModal(id) {
    var modal = document.getElementById(id)
    if (modal) modal.hidden = true
    if (id === 'siteEditModal') {
      resetDeleteBtn()
      hideTooltip()
    }
  }

  function saveSiteEdit() {
    var site = findSite(editingId)
    if (!site) return
    var name = val('siteEditName')
    var url = val('siteEditUrl')
    var icon = val('siteEditIcon')
    var wrap = document.getElementById('siteEditCats')
    var checked = wrap ? wrap.querySelectorAll('input:checked') : []
    var cats = []
    for (var i = 0; i < checked.length; i++) cats.push(checked[i].value)
    var error = document.getElementById('siteEditError')
    function fail(msg) {
      if (error) { error.textContent = msg; error.hidden = false }
      console.warn('[newtab][sites] 编辑校验失败:', msg)
    }
    if (!name) return fail('名称不能为空')
    if (!cats.length) return fail('至少勾选一个分类')
    site.name = name
    site.url = url
    if (icon) site.icon = icon
    else delete site.icon
    site.cat = cats
    if (cats.indexOf(active) === -1) active = cats[0]
    closeModal('siteEditModal')
    save('编辑站点: ' + name)
    render()
  }

  var deleteArmed = false   // 删除二次确认状态
  var deleteTimer = null

  function resetDeleteBtn() {
    deleteArmed = false
    if (deleteTimer) { clearTimeout(deleteTimer); deleteTimer = null }
    var btn = document.getElementById('siteEditDelete')
    if (btn) btn.textContent = '删除'
  }

  function deleteSite() {
    var site = findSite(editingId)
    if (!site) return
    var btn = document.getElementById('siteEditDelete')
    if (!deleteArmed) {
      deleteArmed = true
      if (btn) btn.textContent = '确认删除？'
      console.log('[newtab][sites] 删除二次确认:', site.name)
      deleteTimer = setTimeout(resetDeleteBtn, 3000)
      return
    }
    // 第二次点击：真正删除
    state.sites = state.sites.filter(function (s) { return s.id !== editingId })
    closeModal('siteEditModal')
    resetDeleteBtn()
    save('删除站点: ' + site.name)
    render()
    console.log('[newtab][sites] 已删除站点:', site.name)
  }

  function addCategory() {
    var name = val('siteCatName')
    var error = document.getElementById('siteCatError')
    function fail(msg) {
      if (error) { error.textContent = msg; error.hidden = false }
      console.warn('[newtab][sites] 新增分类校验失败:', msg)
    }
    if (!name) return fail('分类名不能为空')
    if (state.categories.indexOf(name) !== -1) return fail('分类已存在')
    state.categories.push(name)
    closeModal('siteCatModal')
    if (catModalFromEdit && editingId) {
      // 从编辑弹窗新建：保留用户已填内容，仅刷新分类列表并勾选新分类
      var checked = document.querySelectorAll('#siteEditCats input:checked')
      var cats = []
      for (var i = 0; i < checked.length; i++) cats.push(checked[i].value)
      if (cats.indexOf(name) === -1) cats.push(name)
      renderEditCats(cats)
      console.log('[newtab][sites] 编辑弹窗内新建分类并勾选:', name)
    } else {
      active = name
    }
    catModalFromEdit = false
    save('新增分类: ' + name)
    render()
  }

  function deleteCategory(name) {
    if (!state) return
    var index = state.categories.indexOf(name)
    if (index === -1) return
    if (state.categories.length <= 1) {
      console.warn('[newtab][sites] 至少保留一个分类，无法删除:', name)
      return
    }
    var fallback = state.categories.filter(function (c) { return c !== name })[0]
    var affected = state.sites.filter(function (s) { return s.cat.indexOf(name) !== -1 }).length
    if (!window.confirm('删除分类「' + name + '」？\n该分类下的 ' + affected + ' 个站点会移到「' + fallback + '」。')) return
    state.categories.splice(index, 1)
    state.sites.forEach(function (s) {
      var at = s.cat.indexOf(name)
      if (at === -1) return
      s.cat.splice(at, 1)
      if (s.cat.length === 0) s.cat.push(fallback)
    })
    if (active === name) active = fallback
    catModalFromEdit = false
    save('删除分类: ' + name)
    render()
    console.log('[newtab][sites] 已删除分类:', name, '| 受影响站点:', affected, '| 移至:', fallback)
  }

  function bindModals() {
    var map = [
      ['siteEditClose', function () { closeModal('siteEditModal') }],
      ['siteEditCancel', function () { closeModal('siteEditModal') }],
      ['siteEditSave', saveSiteEdit],
      ['siteEditDelete', deleteSite],
      ['siteCatSave', addCategory]
    ]
    map.forEach(function (pair) {
      var btn = document.getElementById(pair[0])
      if (btn) btn.addEventListener('click', pair[1])
    })
    ;['siteCatClose', 'siteCatCancel'].forEach(function (id) {
      var btn = document.getElementById(id)
      if (btn) btn.addEventListener('click', function () { closeModal('siteCatModal') })
    })
    var catName = document.getElementById('siteCatName')
    if (catName) catName.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') addCategory()
    })
    // ESC 统一作为取消操作：弹窗叠加时先关最上层（新建分类 → 编辑站点）
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return
      var catModal = document.getElementById('siteCatModal')
      var editModal = document.getElementById('siteEditModal')
      if (catModal && !catModal.hidden) {
        closeModal('siteCatModal')
        catModalFromEdit = false
        console.log('[newtab][sites] ESC 关闭新建分类弹窗')
        return
      }
      if (editModal && !editModal.hidden) {
        closeModal('siteEditModal')
        editingId = null
        console.log('[newtab][sites] ESC 退出编辑')
      }
    })
  }

  function render() {
    if (!state) return
    renderBar()
    var grid = document.getElementById('sitesGrid')
    if (!grid) return
    grid.textContent = ''
    var list = state.sites.filter(function (site) { return hasCat(site, active) })
    list.forEach(function (site) { grid.appendChild(makeTile(site)) })
    if (!list.length) {
      grid.appendChild(NT.el('div', 'sites-empty', '这个分类下还没有站点，把其它站点拖到这里，或点右上角 + 添加分类'))
    }
    if (grid.classList) grid.classList.toggle('sites-grid--list', viewMode === 'list')
    var summary = document.getElementById('sitesSummary')
    if (summary) {
      summary.textContent = state.sites.length + ' 个站点 · ' + state.categories.length + ' 个分类'
    }
    console.log('[newtab][sites] 渲染分类:', active, list.length, '个站点 /', viewMode, '视图')
  }

  NT.sites = {
    init: render,
    render: render,
    setCategory: function (name) {
      if (state && state.categories.indexOf(name) !== -1) { active = name; render() }
    },
    setViewMode: setViewMode,
    hasCat: hasCat,
    get active() { return active },
    get viewMode() { return viewMode },
    get categories() { return categoryNames() }
  }

  function boot() {
    bindViewSwitch()
    bindModals()
    setViewMode(viewMode)
    loadMeta()
    loadState().then(function () {
      render()
      initSortables()
      console.log('[newtab][sites] 初始化完成')
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})(window.NT)
