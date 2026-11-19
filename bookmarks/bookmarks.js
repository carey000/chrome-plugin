// 书签管理页：按 Chrome 原始文件夹层级展示，支持打开与编辑标题 / 网址。
// MV3 扩展页 CSP 禁止内联脚本、eval、new Function，所有逻辑都在这个外部文件里。
// 数据只来自 chrome.bookmarks，不做任何远程请求，也不缓存 node.id 作为跨设备标识。

const ROOT_ID = '0'
const META_KEY = 'bm_meta' // { [url]: { tags: string[], starred: boolean } }

let index = new Map()
let currentId = ROOT_ID
let editingId = null
let editingMode = 'edit' // edit | create-bookmark | create-folder
let editingOldUrl = ''
let meta = {} // 标签 / 星标，按 url 存在 chrome.storage.local，不写进 Chrome 书签树
let searchQuery = ''
let sortMode = 'default'
let activeTag = ''
const collapsedFolders = new Set()
const selectedIds = new Set()

// ---------- 链接可访问性检测 ----------
// 只检测视口内卡片；异步、限量并发、带超时与缓存，不阻塞 render()。
// 只对明确的失效码（404 / 410 / 5xx）标记；网络/CORS 异常不误报（跨域失败原因不可判定）。
const LINK_HTTP = /^https?:\/\//i
const LINK_TIMEOUT = 6000
const LINK_CONCURRENCY = 3
const linkStatus = new Map() // url -> status（仅记录已判定的）
let linkObserver = null
let linkQueue = []
let linkRunning = 0

// 视图：grid（卡片，默认）/ list（列表）。偏好存 localStorage，扩展页内可用。
let viewMode = 'grid'
try {
  viewMode = localStorage.getItem('bm_view_mode') === 'list' ? 'list' : 'grid'
} catch (error) {
  viewMode = 'grid'
}

// Chrome API 包装成 Promise，方便 .then() 链式调用
function getTree() {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getTree((nodes) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
      resolve(nodes)
    })
  })
}

function updateNode(id, changes) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.update(id, changes, (node) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
      resolve(node)
    })
  })
}

function createNode(changes) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.create(changes, (node) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
      resolve(node)
    })
  })
}

function removeNode(id, isFolder) {
  return new Promise((resolve, reject) => {
    const call = isFolder ? chrome.bookmarks.removeTree : chrome.bookmarks.remove
    call(id, () => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
      resolve()
    })
  })
}

function moveNode(id, props) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.move(id, props, (node) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
      resolve(node)
    })
  })
}

function loadMeta() {
  return new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.local) return resolve({})
    chrome.storage.local.get(META_KEY, (data) => {
      const raw = data && data[META_KEY]
      meta = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
      console.log('[bookmarks] 已加载标签/星标元数据:', Object.keys(meta).length)
      resolve(meta)
    })
  })
}

function saveMeta() {
  if (!chrome.storage || !chrome.storage.local) return Promise.resolve()
  return new Promise((resolve) => {
    chrome.storage.local.set({ [META_KEY]: meta }, () => {
      if (chrome.runtime && chrome.runtime.lastError)
        console.warn('[bookmarks] 元数据保存失败:', chrome.runtime.lastError.message)
      resolve()
    })
  })
}

function metaFor(url) {
  if (!url) return { tags: [], starred: false }
  return meta[url] || { tags: [], starred: false }
}

// 一次遍历建索引：id -> { node, parentId }，同时保留 children 的原始顺序
function buildIndex(nodes, parentId = null, map = new Map()) {
  nodes.forEach((node) => {
    map.set(node.id, { node, parentId })
    if (node.children) buildIndex(node.children, node.id, map)
  })
  return map
}

function load() {
  return getTree()
    .then((nodes) => {
      index = buildIndex(nodes)
      if (!index.has(currentId)) currentId = ROOT_ID
      renderFolderTree()
      renderTagList()
      render()
      console.log('[bookmarks] 已加载节点:', index.size, '当前目录:', currentId)
    })
    .catch((error) => console.error('[bookmarks] 读取书签失败:', error))
}

function currentNode() {
  const hit = index.get(currentId)
  return hit ? hit.node : null
}

// 面包屑：沿 parentId 一路往上，根节点统一显示「全部书签」
function crumbsFor(id) {
  const chain = []
  let cursor = id
  while (cursor && index.has(cursor)) {
    const item = index.get(cursor)
    chain.unshift({
      id: item.node.id,
      title: item.node.id === ROOT_ID ? '全部书签' : item.node.title || '未命名文件夹',
    })
    cursor = item.parentId
  }
  if (!chain.length || chain[0].id !== ROOT_ID) chain.unshift({ id: ROOT_ID, title: '全部书签' })
  return chain
}

// 全局搜索结果里显示所在文件夹路径（不含「全部书签」根）
function pathFor(id) {
  const chain = []
  let hit = index.get(id)
  let cursor = hit ? hit.parentId : null
  while (cursor && index.has(cursor) && cursor !== ROOT_ID) {
    const item = index.get(cursor)
    chain.unshift(item.node.title || '未命名文件夹')
    cursor = item.parentId
  }
  return chain.join(' / ')
}

// 所有书签节点（排除文件夹与根节点），供全局搜索 / 标签筛选使用
function allBookmarks() {
  const list = []
  index.forEach(({ node, parentId }) => {
    if (node.url && parentId) list.push(node)
  })
  return list
}

// 纯 CSS 色块，不请求任何远程 favicon，避免把书签域名发给第三方
function siteInfo(url) {
  let host = ''
  try {
    host = new URL(url).hostname
  } catch (error) {
    host = String(url || '')
  }
  host = host.replace(/^www\./, '')
  let hash = 0
  for (let i = 0; i < host.length; i++) hash = (hash * 31 + host.charCodeAt(i)) | 0
  return { host: host || '未知来源', letter: (host[0] || '#').toUpperCase(), tone: Math.abs(hash) % 8 }
}

// 根节点下的特殊文件夹、企业策略下发的节点都不允许编辑
function canEdit(node) {
  if (node.unmodifiable || node.folderType) return false
  const hit = index.get(node.id)
  return !!hit && hit.parentId !== ROOT_ID
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const FOLDER_ICON =
  '<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">' +
  '<path d="M6 14a4 4 0 0 1 4-4h9l4 5h15a4 4 0 0 1 4 4v17a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V14Z" ' +
  'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg>'

const EDIT_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
  '<path d="M4 20h4l10-10-4-4L4 16v4Z" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linejoin="round"/></svg>'

function makeEditButton(node) {
  const btn = el('button', 'edit-btn')
  btn.type = 'button'
  btn.title = '编辑'
  btn.setAttribute('aria-label', '编辑 ' + (node.title || ''))
  btn.innerHTML = EDIT_ICON
  btn.addEventListener('click', (event) => {
    event.stopPropagation()
    openEditor(node)
  })
  return btn
}

let dragBookmarkId = null

function makeActionButton(className, title, glyph, handler) {
  const btn = el('button', className, glyph)
  btn.type = 'button'
  btn.title = title
  btn.setAttribute('aria-label', title)
  btn.addEventListener('click', (event) => {
    event.stopPropagation()
    handler()
  })
  return btn
}

function toggleStar(url) {
  const previous = meta[url] || { tags: [], starred: false }
  meta[url] = { tags: previous.tags || [], starred: !previous.starred }
  saveMeta().then(() => {
    console.log('[bookmarks] 星标切换:', url, meta[url].starred)
    render()
  })
}

let toastTimer = null
let pendingUndo = null

function showToast(text, undo) {
  const toast = document.getElementById('toast')
  document.getElementById('toastText').textContent = text
  pendingUndo = undo || null
  document.getElementById('toastUndo').hidden = !undo
  toast.hidden = false
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.hidden = true
    pendingUndo = null
  }, 8000)
}

let deleteResolve = null

function closeDeleteConfirm(result) {
  document.getElementById('deleteMask').hidden = true
  const done = deleteResolve
  deleteResolve = null
  if (done) done(result)
}

function confirmBatchDelete(nodes) {
  return new Promise((resolve) => {
    deleteResolve = resolve
    const list = document.getElementById('deleteList')
    const confirmBtn = document.getElementById('deleteConfirm')
    list.textContent = ''
    confirmBtn.textContent = '删除'
    confirmBtn.dataset.armed = ''
    const folders = nodes.filter((node) => !node.url)
    document.getElementById('deleteWarning').textContent = folders.length
      ? '其中包含 ' + folders.length + ' 个文件夹，将连带删除其中所有书签。批量删除不可撤销，请仔细核对下方清单。'
      : '批量删除不可撤销（单项删除的撤销提示条不适用于批量操作），请仔细核对下方清单。'
    nodes.slice(0, 50).forEach((node) => {
      list.appendChild(el('div', 'delete-item', (node.url ? '书签' : '文件夹') + ' · ' + (node.title || '未命名')))
    })
    if (nodes.length > 50) list.appendChild(el('div', 'delete-item', '…另有 ' + (nodes.length - 50) + ' 项'))
    document.getElementById('deleteMask').hidden = false
  })
}

function snapshotNode(node) {
  return {
    title: node.title || '',
    url: node.url || undefined,
    children: (node.children || []).map(snapshotNode),
  }
}

function restoreNode(snap, parentId, index) {
  const changes = { parentId, index, title: snap.title }
  if (snap.url) changes.url = snap.url
  return createNode(changes).then((created) => {
    if (!snap.children.length) return created
    return Promise.all(snap.children.map((child, i) => restoreNode(child, created.id, i))).then(
      () => created
    )
  })
}

function deleteNode(node) {
  const isFolder = !node.url
  const message = isFolder
    ? '删除文件夹「' + (node.title || '未命名') + '」及其中的 ' + (node.children || []).length + ' 项？可在提示条里撤销。'
    : '删除书签「' + (node.title || '未命名') + '」？可在提示条里撤销。'
  if (!window.confirm(message)) return
  const hit = index.get(node.id)
  const snap = snapshotNode(node)
  snap.parentId = hit ? hit.parentId : currentId
  snap.index = node.index
  const previousMeta = isFolder ? null : meta[node.url]
  removeNode(node.id, isFolder)
    .then(() => {
      if (!isFolder && meta[node.url]) {
        delete meta[node.url]
        saveMeta()
      }
      console.log('[bookmarks] 已删除:', node.id, node.title)
      showToast('已删除「' + (node.title || '未命名') + '」', () => {
        restoreNode(snap, snap.parentId, snap.index)
          .then(() => {
            if (!isFolder && previousMeta) {
              meta[node.url] = previousMeta
              saveMeta()
            }
            console.log('[bookmarks] 已撤销删除:', node.title)
            return load()
          })
          .catch((error) => window.alert('撤销失败：' + error.message))
      })
      return load()
    })
    .catch((error) => window.alert('删除失败：' + error.message))
}

function makeCard(node, isFolder) {
  const card = el('article', 'card')
  card._node = node
  card.tabIndex = 0
  const info = isFolder ? null : siteInfo(node.url)

  // 多选：复选框独立于卡片点击，不触发打开 / 进入文件夹
  // 标签组里的标签不是真实书签节点，不给勾选，避免批量删除走到 chrome.bookmarks API 报错
  if (index.has(node.id)) {
    const check = el('input', 'card-check')
    check.type = 'checkbox'
    check.checked = selectedIds.has(node.id)
    check.title = '选择此项'
    if (check.checked) card.classList.add('is-selected')
    check.addEventListener('click', (event) => event.stopPropagation())
    check.addEventListener('change', () => {
      if (check.checked) selectedIds.add(node.id)
      else selectedIds.delete(node.id)
      card.classList.toggle('is-selected', check.checked)
      updateBatchBar()
    })
    card.appendChild(check)
  }

  // 只对 http(s) 书签准备可访问性角标；文件夹、chrome://、file:// 一律不检测
  if (!isFolder && LINK_HTTP.test(node.url || '')) {
    card._linkUrl = node.url
    const badge = el('span', 'card-status')
    badge.hidden = true
    card.appendChild(badge)
    card._linkBadge = badge
  }

  const thumb = el('div', 'thumb')
  if (isFolder) {
    thumb.classList.add('thumb--folder')
    thumb.innerHTML = FOLDER_ICON
    thumb.appendChild(el('span', 'folder-badge', (node.children || []).length + ' 项'))
  } else {
    thumb.classList.add('tone-' + info.tone)
    thumb.appendChild(el('span', 'thumb-letter', info.letter))
  }
  card.appendChild(thumb)

  const body = el('div', 'card-body')
  const text = el('div', 'card-text')
  text.appendChild(el('div', 'card-title', node.title || (isFolder ? '未命名文件夹' : '未命名书签')))
  text.appendChild(el('div', 'card-sub', isFolder ? '文件夹' : info.host))
  // 搜索 / 标签筛选是跨文件夹的，补一行来源路径
  if (!isFolder && (searchQuery || activeTag)) text.appendChild(el('div', 'card-path', pathFor(node.id)))
  const tags = isFolder ? [] : metaFor(node.url).tags
  if (tags.length) {
    const tagRow = el('div', 'card-tag-row')
    tags.slice(0, 3).forEach((tag) => tagRow.appendChild(el('span', 'card-tag', tag)))
    text.appendChild(tagRow)
  }
  body.appendChild(text)

  const actions = el('div', 'card-actions')
  if (canEdit(node)) {
    actions.appendChild(makeEditButton(node))
    if (!isFolder) {
      const starred = !!metaFor(node.url).starred
      if (starred) card.classList.add('is-starred')
      actions.appendChild(
        makeActionButton('star-btn', starred ? '取消星标' : '加星标', starred ? '★' : '☆', () =>
          toggleStar(node.url)
        )
      )
    }
    actions.appendChild(
      makeActionButton('del-btn', isFolder ? '删除文件夹及其中所有书签' : '删除书签', '×', () =>
        deleteNode(node)
      )
    )
  }
  body.appendChild(actions)
  card.appendChild(body)

  function activate() {
    if (isFolder) {
      enterFolder(node.id)
      console.log('[bookmarks] 进入文件夹:', node.title, currentId)
    } else {
      chrome.tabs.create({ url: node.url })
      console.log('[bookmarks] 打开书签:', node.url)
    }
  }
  card.addEventListener('click', activate)
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
    }
  })

  // 拖拽：拖到侧栏文件夹 = 移动；拖到当前页某张卡片 = 排到它前面
  card.draggable = true
  card.addEventListener('dragstart', (event) => {
    dragBookmarkId = node.id
    card.classList.add('is-dragging')
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      try {
        event.dataTransfer.setData('text/plain', node.id)
      } catch (error) {
        /* 用模块内 dragBookmarkId 兜底 */
      }
    }
  })
  card.addEventListener('dragend', () => {
    dragBookmarkId = null
    card.classList.remove('is-dragging')
    document.querySelectorAll('.is-drop-target').forEach((node2) => node2.classList.remove('is-drop-target'))
  })
  card.addEventListener('dragover', (event) => {
    if (!dragBookmarkId || dragBookmarkId === node.id) return
    event.preventDefault()
    event.stopPropagation()
    card.classList.add('is-drop-target')
  })
  card.addEventListener('dragleave', () => card.classList.remove('is-drop-target'))
  card.addEventListener('drop', (event) => {
    if (!dragBookmarkId || dragBookmarkId === node.id) return
    event.preventDefault()
    event.stopPropagation()
    const targetIndex = index.get(node.id) ? node.index : undefined
    card.classList.remove('is-drop-target')
    moveNode(dragBookmarkId, { parentId: currentId, index: targetIndex })
      .then(() => {
        console.log('[bookmarks] 拖拽排序:', dragBookmarkId, '到', targetIndex)
        return load()
      })
      .catch((error) => console.error('[bookmarks] 拖拽排序失败:', error.message))
  })
  return card
}

// 只有这些状态码能明确说明「链接失效」；401/403/405/429 多为反爬、限流或不支持 HEAD，不算失效
function isDeadStatus(status) {
  return status === 404 || status === 410 || (status >= 500 && status <= 599)
}

// 只给明确失效的卡片打角标；网络/CORS/超时原因不可判定，不误报
function applyLinkStatus(card, status) {
  const badge = card._linkBadge
  if (!badge || !isDeadStatus(status)) return
  badge.textContent = status + (status >= 500 ? ' 服务异常' : ' 无法访问')
  badge.title = 'HTTP ' + status + '（检测时返回）· 点击仍会打开书签'
  badge.hidden = false
  if (card.classList && card.classList.add) card.classList.add('card--dead')
}

function requestStatus(url, method) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = setTimeout(() => {
    if (controller) controller.abort()
  }, LINK_TIMEOUT)
  const options = { method, redirect: 'follow', cache: 'no-store' }
  if (controller) options.signal = controller.signal
  return fetch(url, options).then(
    (response) => {
      clearTimeout(timer)
      // opaque 响应拿不到真实 status，返回 0 表示「无法判定」
      return response.type === 'opaque' ? 0 : response.status
    },
    () => {
      clearTimeout(timer)
      return 0
    }
  )
}

function probeLink(card) {
  const url = card._linkUrl
  if (linkStatus.has(url)) {
    applyLinkStatus(card, linkStatus.get(url))
    return Promise.resolve()
  }
  return requestStatus(url, 'HEAD')
    .then((status) => {
      // 站点不支持 HEAD / 拒绝探测时，用 GET 复核一次，避免把正常站点误标失效
      if (status === 405 || status === 501 || status === 403) return requestStatus(url, 'GET')
      return status
    })
    .then((status) => {
      linkStatus.set(url, status)
      applyLinkStatus(card, status)
      console.log('[bookmarks] 检测结果:', status || '无法判定', url)
    })
}

function pumpLinkQueue() {
  while (linkRunning < LINK_CONCURRENCY && linkQueue.length) {
    const card = linkQueue.shift()
    linkRunning += 1
    probeLink(card).then(() => {
      linkRunning -= 1
      pumpLinkQueue()
    })
  }
}

// IntersectionObserver 只把进入视口的卡片加入检测队列；render 结束后异步调度，不阻塞首屏
function scheduleLinkCheck() {
  if (linkObserver) linkObserver.disconnect()
  linkQueue = []
  const grid = document.getElementById('grid')
  const all = grid.querySelectorAll ? Array.prototype.slice.call(grid.querySelectorAll('.card')) : []
  const cards = all.filter((card) => card._linkUrl)
  cards.forEach((card) => {
    if (linkStatus.has(card._linkUrl)) applyLinkStatus(card, linkStatus.get(card._linkUrl))
  })
  if (typeof IntersectionObserver !== 'function') {
    console.log('[bookmarks] 当前环境无 IntersectionObserver，跳过可访问性检测')
    return
  }
  const pending = cards.filter((card) => !linkStatus.has(card._linkUrl))
  if (!pending.length) return
  linkObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      linkObserver.unobserve(entry.target)
      linkQueue.push(entry.target)
    })
    pumpLinkQueue()
  })
  pending.forEach((card) => linkObserver.observe(card))
}

function setViewMode(mode) {
  viewMode = mode === 'list' ? 'list' : 'grid'
  const grid = document.getElementById('grid')
  if (grid.classList && grid.classList.toggle) grid.classList.toggle('grid--list', viewMode === 'list')
  ;['viewList', 'viewGrid'].forEach((id) => {
    const btn = document.getElementById(id)
    if (!btn) return
    const active = (id === 'viewList') === (viewMode === 'list')
    if (btn.classList && btn.classList.toggle) btn.classList.toggle('is-active', active)
    btn.setAttribute('aria-pressed', String(active))
  })
  try {
    localStorage.setItem('bm_view_mode', viewMode)
  } catch (error) {
    console.warn('[bookmarks] 视图偏好无法保存:', error.message)
  }
  console.log('[bookmarks] 切换视图:', viewMode)
}

function clearFilters() {
  searchQuery = ''
  activeTag = ''
  if (activeGroupId) {
    activeGroupId = ''
    activeGroupName = ''
    renderGroups()
  }
  const input = document.getElementById('searchInput')
  if (input) input.value = ''
  renderTagList()
  render()
}

function render() {
  const grid = document.getElementById('grid')
  const crumbs = document.getElementById('crumbs')
  const empty = document.getElementById('empty')
  const filterBar = document.getElementById('filterBar')
  const node = currentNode()
  const globalMode = !!(searchQuery || activeTag || activeGroupId)

  grid.textContent = ''
  crumbs.textContent = ''
  filterBar.textContent = ''

  if (activeGroupId) {
    const rootCrumb = el('button', 'crumb', '全部书签')
    rootCrumb.type = 'button'
    rootCrumb.addEventListener('click', () => enterFolder(currentId))
    crumbs.appendChild(rootCrumb)
    crumbs.appendChild(el('span', 'crumb-sep', '/'))
    crumbs.appendChild(el('span', 'crumb crumb--current', '标签组 · ' + activeGroupName))
  } else if (globalMode) {
    crumbs.appendChild(
      el('span', 'crumb crumb--current', searchQuery ? '搜索：' + searchQuery : '标签：' + activeTag)
    )
  } else {
    const chain = crumbsFor(currentId)
    chain.forEach((item, i) => {
      if (i > 0) crumbs.appendChild(el('span', 'crumb-sep', '/'))
      const btn = el('button', 'crumb' + (i === chain.length - 1 ? ' crumb--current' : ''), item.title)
      btn.type = 'button'
      btn.addEventListener('click', () => enterFolder(item.id))
      crumbs.appendChild(btn)
    })
  }

  let children
  if (activeGroupId) {
    children = (groupTabMap.get(activeGroupId) || []).map((tab) => ({
      id: 'group-tab:' + tab.id,
      title: tab.title || tab.url || '未命名标签',
      url: tab.url || '',
    }))
  } else if (globalMode) {
    children = allBookmarks().filter((item) => {
      const itemMeta = metaFor(item.url)
      if (activeTag && (itemMeta.tags || []).indexOf(activeTag) === -1) return false
      if (!searchQuery) return true
      const hay = ((item.title || '') + ' ' + (item.url || '') + ' ' + (itemMeta.tags || []).join(' ')).toLowerCase()
      return hay.indexOf(searchQuery) !== -1
    })
  } else {
    children = (node && node.children) || []
  }

  if (sortMode === 'title') {
    children = children.slice().sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-CN'))
  } else if (sortMode === 'newest') {
    children = children.slice().sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0))
  } else if (sortMode === 'host') {
    children = children.slice().sort((a, b) =>
      siteInfo(a.url || '').host.localeCompare(siteInfo(b.url || '').host)
    )
  }

  const parts = []
  if (searchQuery) parts.push('搜索：' + searchQuery)
  if (activeTag) parts.push('标签：' + activeTag)
  filterBar.hidden = !parts.length
  parts.forEach((text) => filterBar.appendChild(el('span', 'filter-chip', text)))
  if (parts.length) {
    const clear = el('button', 'filter-clear', '清除筛选')
    clear.type = 'button'
    clear.addEventListener('click', clearFilters)
    filterBar.appendChild(clear)
  }

  children.forEach((child) => grid.appendChild(makeCard(child, !child.url)))
  if (grid.classList && grid.classList.toggle) grid.classList.toggle('grid--list', viewMode === 'list')

  empty.hidden = children.length > 0

  // 右侧导航（面包屑 / 卡片进入文件夹）与左侧树高亮保持一致
  syncFolderTreeActive()

  // 异步、不阻塞：render 已同步完成，检测排到下一个任务
  setTimeout(scheduleLinkCheck, 0)
}

// ---------- 文件夹侧栏 / 标签筛选 ----------
function loadCollapsedFolders() {
  try {
    const raw = JSON.parse(localStorage.getItem('bm_collapsed_folders') || '[]')
    if (Array.isArray(raw)) raw.forEach((id) => collapsedFolders.add(id))
  } catch (error) {
    console.warn('[bookmarks] 折叠状态读取失败:', error.message)
  }
}

function saveCollapsedFolders() {
  try {
    localStorage.setItem('bm_collapsed_folders', JSON.stringify(Array.from(collapsedFolders)))
  } catch (error) {
    console.warn('[bookmarks] 折叠状态保存失败:', error.message)
  }
}

// 当前文件夹的所有祖先都展开，保证侧栏能看到高亮项
function revealFolder(id) {
  let hit = index.get(id)
  let cursor = hit ? hit.parentId : null
  while (cursor && index.has(cursor) && cursor !== ROOT_ID) {
    collapsedFolders.delete(cursor)
    cursor = index.get(cursor).parentId
  }
  saveCollapsedFolders()
}

function syncFolderTreeActive() {
  document.querySelectorAll('#folderTree .folder-row').forEach((row) => {
    row.classList.toggle('is-active', !activeGroupId && row._folderId === currentId)
  })
}

// 统一的「进入文件夹」入口：清筛选、退出标签组视图、展开祖先、同步侧栏
function enterFolder(id) {
  currentId = id
  searchQuery = ''
  activeTag = ''
  if (activeGroupId) {
    activeGroupId = ''
    activeGroupName = ''
    renderGroups()
  }
  const input = document.getElementById('searchInput')
  if (input) input.value = ''
  revealFolder(id)
  renderFolderTree()
  renderTagList()
  render()
}

function makeFolderRow(node, depth) {
  const wrap = el('div')
  const row = el('button', 'folder-row' + (currentId === node.id ? ' is-active' : ''))
  row.type = 'button'
  row._folderId = node.id
  row.style.paddingLeft = 7 + depth * 14 + 'px'
  const children = (node.children || []).filter((child) => !child.url)
  const hasChildren = children.length > 0
  const collapsed = collapsedFolders.has(node.id)
  if (collapsed) row.classList.add('is-collapsed')
  const caret = el(
    'span',
    'folder-caret' + (hasChildren ? '' : ' folder-caret--empty'),
    '▾'
  )
  row.appendChild(caret)
  row.appendChild(el('span', 'folder-name', node.title || '未命名文件夹'))
  const direct = (node.children || []).filter((child) => child.url).length
  row.appendChild(el('span', 'folder-count', String(direct)))
  row.addEventListener('click', (event) => {
    if (event.target === caret && hasChildren) {
      if (collapsedFolders.has(node.id)) collapsedFolders.delete(node.id)
      else collapsedFolders.add(node.id)
      saveCollapsedFolders()
      renderFolderTree()
      return
    }
    enterFolder(node.id)
  })
  row.addEventListener('dragover', (event) => {
    if (!dragBookmarkId || dragBookmarkId === node.id) return
    event.preventDefault()
    row.classList.add('is-drop-target')
  })
  row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'))
  row.addEventListener('drop', (event) => {
    if (!dragBookmarkId) return
    event.preventDefault()
    event.stopPropagation()
    row.classList.remove('is-drop-target')
    moveNode(dragBookmarkId, { parentId: node.id, index: -1 })
      .then(() => {
        console.log('[bookmarks] 拖入文件夹:', dragBookmarkId, node.id)
        return load()
      })
      .catch((error) => console.error('[bookmarks] 拖入文件夹失败:', error.message))
  })
  wrap.appendChild(row)
  if (hasChildren && !collapsed) children.forEach((child) => wrap.appendChild(makeFolderRow(child, depth + 1)))
  return wrap
}

function renderFolderTree() {
  const box = document.getElementById('folderTree')
  if (!box) return
  box.textContent = ''
  const root = index.get(ROOT_ID)
  if (!root || !root.node.children) return
  root.node.children.forEach((node) => box.appendChild(makeFolderRow(node, 0)))
}

function renderTagList() {
  const box = document.getElementById('tagList')
  const head = document.getElementById('tagHead')
  if (!box || !head) return
  box.textContent = ''
  const counts = new Map()
  allBookmarks().forEach((item) => {
    ;(metaFor(item.url).tags || []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1))
  })
  head.hidden = counts.size === 0
  Array.from(counts.keys())
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .forEach((tag) => {
      const chip = el('button', 'tag-chip' + (activeTag === tag ? ' is-active' : ''), tag + ' ' + counts.get(tag))
      chip.type = 'button'
      chip.addEventListener('click', () => {
        activeTag = activeTag === tag ? '' : tag
        searchQuery = ''
        const input = document.getElementById('searchInput')
        if (input) input.value = ''
        renderTagList()
        render()
      })
      box.appendChild(chip)
    })
}

// ---------- 多选批量操作 ----------
function selectedNodes() {
  const list = []
  selectedIds.forEach((id) => {
    const hit = index.get(id)
    if (hit) list.push(hit.node)
  })
  return list
}

function updateBatchBar() {
  const bar = document.getElementById('batchBar')
  if (!bar) return
  bar.hidden = selectedIds.size === 0
  document.getElementById('batchCount').textContent = '已选 ' + selectedIds.size + ' 项'
  if (!selectedIds.size) return
  const select = document.getElementById('batchMove')
  const previous = select.value
  select.textContent = ''
  const placeholder = el('option', '', '移动到…')
  placeholder.value = ''
  select.appendChild(placeholder)
  index.forEach(({ node }) => {
    if (node.url || selectedIds.has(node.id)) return
    const option = el('option', '', node.title || '未命名文件夹')
    option.value = node.id
    select.appendChild(option)
  })
  select.value = previous
}

function clearSelection() {
  selectedIds.clear()
  document.querySelectorAll('.card.is-selected').forEach((card) => card.classList.remove('is-selected'))
  updateBatchBar()
}

function bindBatchActions() {
  document.getElementById('batchSelectAll').addEventListener('click', () => {
    document.querySelectorAll('#grid .card').forEach((card) => {
      if (!card._node || !index.has(card._node.id)) return
      selectedIds.add(card._node.id)
      card.classList.add('is-selected')
      const check = card.querySelector('.card-check')
      if (check) check.checked = true
    })
    updateBatchBar()
  })
  document.getElementById('batchClear').addEventListener('click', clearSelection)
  document.getElementById('batchOpen').addEventListener('click', () => {
    const opened = selectedNodes().filter((node) => /^(https?|file):\/\//i.test(node.url || ''))
    opened.forEach((node) => chrome.tabs.create({ url: node.url }))
    console.log('[bookmarks] 批量打开:', opened.length)
    clearSelection()
  })
  document.getElementById('batchTag').addEventListener('click', () => {
    const text = window.prompt('给选中项添加标签（逗号分隔，追加到现有标签）')
    if (text === null) return
    const additions = text.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)
    if (!additions.length) return
    selectedNodes().forEach((node) => {
      if (!node.url) return
      const previous = metaFor(node.url)
      const tags = previous.tags || []
      additions.forEach((tag) => {
        if (tags.indexOf(tag) === -1) tags.push(tag)
      })
      meta[node.url] = { tags, starred: previous.starred }
    })
    saveMeta().then(() => {
      console.log('[bookmarks] 批量加标签:', additions, selectedIds.size)
      clearSelection()
      return load()
    })
  })
  document.getElementById('batchMove').addEventListener('change', (event) => {
    const parentId = event.target.value
    if (!parentId) return
    const nodes = selectedNodes()
    nodes.reduce((chain, node) => chain.then(() => moveNode(node.id, { parentId, index: -1 })), Promise.resolve())
      .then(() => {
        console.log('[bookmarks] 批量移动到:', parentId, nodes.length)
        clearSelection()
        return load()
      })
      .catch((error) => console.error('[bookmarks] 批量移动失败:', error.message))
  })
  document.getElementById('batchDelete').addEventListener('click', () => {
    const nodes = selectedNodes()
    if (!nodes.length) return
    confirmBatchDelete(nodes).then((ok) => {
      if (!ok) return
      nodes
        .reduce((chain, node) => chain.then(() => removeNode(node.id, !node.url)), Promise.resolve())
        .then(() => {
          showToast('已删除 ' + nodes.length + ' 项', null)
          clearSelection()
          return load()
        })
        .catch((error) => window.alert('批量删除失败：' + error.message))
    })
  })
  document.getElementById('deleteCancel').addEventListener('click', () => closeDeleteConfirm(false))
  document.getElementById('deleteClose').addEventListener('click', () => closeDeleteConfirm(false))
  document.getElementById('deleteMask').addEventListener('click', (event) => {
    if (event.target.id === 'deleteMask') closeDeleteConfirm(false)
  })
  document.getElementById('deleteConfirm').addEventListener('click', (event) => {
    const btn = event.currentTarget
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1'
      btn.textContent = '再点一次确认删'
      return
    }
    closeDeleteConfirm(true)
  })
}

function openEditor(node, mode) {
  editingMode = mode || 'edit'
  editingId = editingMode === 'edit' ? node.id : null
  const isFolder =
    editingMode === 'create-folder' || (editingMode === 'edit' && !node.url)
  editingOldUrl = editingMode === 'edit' && !isFolder ? node.url || '' : ''
  document.getElementById('editorTitle').textContent =
    editingMode === 'create-bookmark'
      ? '新建书签'
      : editingMode === 'create-folder'
        ? '新建文件夹'
        : isFolder
          ? '编辑文件夹'
          : '编辑书签'
  document.getElementById('editTitle').value = editingMode === 'edit' ? node.title || '' : ''
  document.getElementById('editUrl').value =
    editingMode === 'edit' && !isFolder ? node.url || '' : ''
  document.getElementById('editTags').value =
    editingMode === 'edit' && !isFolder ? (metaFor(node.url).tags || []).join(', ') : ''
  document.getElementById('urlField').hidden = isFolder
  document.getElementById('tagsField').hidden = isFolder
  document.getElementById('formError').hidden = true
  document.getElementById('editorMask').hidden = false
  document.getElementById('editTitle').focus()
  console.log('[bookmarks] 打开编辑器:', editingMode, node ? node.id : currentId)
}

function closeEditor() {
  editingId = null
  editingMode = 'edit'
  document.getElementById('editorMask').hidden = true
}

function onSave(event) {
  event.preventDefault()
  const isFolder = document.getElementById('urlField').hidden
  const title = document.getElementById('editTitle').value.trim()
  // textarea 允许换行，但 URL 不应含空白：统一去掉，避免把 \n 存进书签
  const url = document.getElementById('editUrl').value.replace(/\s+/g, '')
  const tags = (document.getElementById('editTags').value || '')
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
  const errorBox = document.getElementById('formError')

  if (!title) return showError('标题不能为空')
  if (!isFolder && !url) return showError('网址不能为空')
  if (!isFolder && /^(javascript|data|vbscript):/i.test(url)) return showError('不允许使用这种网址协议')
  errorBox.hidden = true

  let task
  if (editingMode === 'create-bookmark') task = createNode({ parentId: currentId, title, url })
  else if (editingMode === 'create-folder') task = createNode({ parentId: currentId, title })
  else task = updateNode(editingId, isFolder ? { title } : { title, url })

  task
    .then((saved) => {
      if (!isFolder) {
        const keyUrl = editingMode === 'create-bookmark' ? saved.url : url
        const previous = metaFor(keyUrl)
        meta[keyUrl] = { tags, starred: previous.starred }
        if (editingMode === 'edit' && editingOldUrl && editingOldUrl !== keyUrl) {
          if (meta[editingOldUrl]) delete meta[editingOldUrl]
        }
        saveMeta()
      }
      console.log('[bookmarks] 已保存:', editingMode, title)
      closeEditor()
      return load()
    })
    .catch((error) => {
      showError('保存失败：' + error.message)
      console.error('[bookmarks] 保存失败:', error)
    })

  function showError(message) {
    errorBox.textContent = message
    errorBox.hidden = false
  }
}

// 在 Chrome 自带书签管理器或其他设备同步过来的变更，这里统一重新拉取
function watchChanges() {
  ;['onChanged', 'onCreated', 'onRemoved', 'onMoved', 'onChildrenReordered'].forEach((name) => {
    if (!chrome.bookmarks || !chrome.bookmarks[name]) return
    chrome.bookmarks[name].addListener(() => {
      console.log('[bookmarks] 书签发生变化:', name)
      load()
    })
  })
}

// ---------------- Chrome 原生标签组 ----------------
// 数据来自 chrome.tabGroups + chrome.tabs，与书签树完全独立（书签节点里没有 group 字段）。
const GROUP_COLORS = {
  grey: '#8e8e93', blue: '#007aff', red: '#ff3b30', yellow: '#ffcc00',
  green: '#34c759', pink: '#ff2d55', purple: '#af52de', cyan: '#32ade6',
  orange: '#ff9500',
}
// 标签组默认折叠：只记录被用户手动展开的组 id，持久化到 localStorage。
// 未记录的组一律折叠；这样新增的组也默认折叠，且展开状态跨页面重载保留。
const expandedGroups = new Set()
try {
  const raw = JSON.parse(localStorage.getItem('bm_expanded_groups') || '[]')
  if (Array.isArray(raw)) raw.forEach((id) => expandedGroups.add(id))
} catch (error) {
  console.warn('[bookmarks] 标签组展开状态读取失败:', error.message)
}
function saveExpandedGroups() {
  try {
    localStorage.setItem('bm_expanded_groups', JSON.stringify(Array.from(expandedGroups)))
  } catch (error) {
    console.warn('[bookmarks] 标签组展开状态保存失败:', error.message)
  }
}
const groupTabMap = new Map()
let activeGroupId = null
let activeGroupName = ''
let groupsTimer = null

function updateGroup(id, props) {
  return new Promise((resolve, reject) => {
    if (!chrome.tabGroups || !chrome.tabGroups.update) return resolve(null)
    chrome.tabGroups.update(id, props, (group) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
      resolve(group)
    })
  })
}

function ungroupTabs(tabIds) {
  return new Promise((resolve, reject) => {
    if (!chrome.tabs || !chrome.tabs.ungroup) return resolve()
    chrome.tabs.ungroup(tabIds, () => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
      resolve()
    })
  })
}

function renameGroup(group) {
  const name = window.prompt('重命名标签组', group.title || '未命名组')
  if (name === null) return
  const title = name.trim()
  if (!title || title === group.title) return
  updateGroup(group.id, { title })
    .then(() => {
      console.log('[bookmarks] 标签组重命名:', group.id, title)
      return renderGroups()
    })
    .catch((error) => window.alert('重命名失败：' + error.message))
}

function dismissGroup(group, list) {
  if (!window.confirm('解散标签组「' + (group.title || '未命名组') + '」？组内 ' + list.length + ' 个标签会保留，只是不再分组。')) return
  ungroupTabs(list.map((tab) => tab.id).filter((id) => id !== undefined))
    .then(() => {
      if (activeGroupId === group.id) {
        activeGroupId = null
        render()
      }
      console.log('[bookmarks] 已解散标签组:', group.id)
      return renderGroups()
    })
    .catch((error) => window.alert('解散失败：' + error.message))
}

// query() 在不同 Chrome 版本可能是 callback 或 Promise，两条通道都接住，done 幂等
function queryWindows() {
  if (!chrome.windows || !chrome.windows.getAll) return Promise.resolve([])
  return new Promise((resolve) => {
    let settled = false
    const done = (list) => {
      if (settled) return
      settled = true
      resolve(Array.isArray(list) ? list : [])
    }
    try {
      const ret = chrome.windows.getAll({}, (wins) => done(wins))
      if (ret && typeof ret.then === 'function') ret.then(done, () => done([]))
    } catch (error) {
      done([])
    }
  })
}

function queryGroups() {
  // 先按窗口逐一查询再合并去重：部分 Chrome 版本里 query({}) 只返回当前窗口的组，
  // 分窗口查询可覆盖其它窗口；拿不到窗口列表时回退到 query({})。
  return queryWindows().then((wins) => {
    const ids = wins.length ? wins.map((w) => w.id) : [undefined]
    return Promise.all(ids.map((windowId) => new Promise((resolve) => {
      const queryInfo = windowId === undefined ? {} : { windowId }
      let settled = false
      const done = (list) => {
        if (settled) return
        settled = true
        resolve(Array.isArray(list) ? list : [])
      }
      try {
        const ret = chrome.tabGroups ? chrome.tabGroups.query(queryInfo, done) : null
        if (ret && typeof ret.then === 'function') ret.then(done, () => done([]))
      } catch (error) {
        done([])
      }
      setTimeout(() => done([]), 1500) // 超时保护，避免某个窗口查询悬挂
    })))
  }).then((lists) => {
    const map = new Map()
    lists.forEach((list) => list.forEach((group) => map.set(group.id, group)))
    return Array.from(map.values())
  })
}

function queryAllTabs() {
  if (!chrome.tabs || !chrome.tabs.query) return Promise.resolve([])
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => resolve(Array.isArray(tabs) ? tabs : []))
  })
}

function favicon(url, extraClass) {
  if (typeof window.FAVICON === 'function') return window.FAVICON(url, extraClass)
  return el('span', 'favicon favicon--empty' + (extraClass ? ' ' + extraClass : ''))
}

function renderGroups() {
  return Promise.all([queryGroups(), queryAllTabs(), queryWindows()]).then(([groups, tabs, wins]) => {
    const panel = document.getElementById('groupsPanel')
    const box = document.getElementById('groupsList')
    if (!panel || !box) return

    box.textContent = ''
    groupTabMap.clear()
    const byId = new Map(groups.map((group) => [group.id, group]))
    // 只认能匹配到真实 group 的 groupId，不依赖 TAB_GROUP_ID_NONE 的具体值
    tabs.forEach((tab) => {
      if (!byId.has(tab.groupId)) return
      if (!groupTabMap.has(tab.groupId)) groupTabMap.set(tab.groupId, [])
      groupTabMap.get(tab.groupId).push(tab)
    })

    const total = Array.from(groupTabMap.values()).reduce((sum, list) => sum + list.length, 0)
    document.getElementById('groupsSummary').textContent =
      groups.length + ' 个组 · ' + total + ' 个标签'
    panel.hidden = groups.length === 0

    // 全部标签组都渲染，不截断；控制台可核对 API 实际返回了哪些组
    // 每条带 windowId + 成员数，便于确认跨窗口的组是否被 Chrome 正常暴露
    console.log(
      '[bookmarks] 全部标签组:',
      groups.length,
      groups.map((g) => (g.title || '未命名组') + '#' + g.id + '@win' + g.windowId + '(' + (groupTabMap.get(g.id) || []).length + ')'),
      '| 窗口数:', wins.length, wins.map((w) => w.id + (w.focused ? '(聚焦)' : ''))
    )
    groups.forEach((group) => {
      const list = groupTabMap.get(group.id) || []
      const collapsed = !expandedGroups.has(group.id)
      const card = el('section', 'group-card' + (collapsed ? ' is-collapsed' : '') + (activeGroupId === group.id ? ' is-active' : ''))

      const head = el('div', 'group-head')
      const nameBtn = el('button', 'group-name-btn')
      nameBtn.type = 'button'
      nameBtn.title = '查看组内标签 · 双击重命名'
      const dot = el('span', 'group-dot')
      dot.style.backgroundColor = GROUP_COLORS[group.color] || GROUP_COLORS.grey
      nameBtn.appendChild(dot)
      nameBtn.appendChild(el('span', 'group-name', group.title || '未命名组'))
      nameBtn.appendChild(el('span', 'group-count', list.length))
      nameBtn.addEventListener('click', () => {
        activeGroupId = group.id
        activeGroupName = group.title || '未命名组'
        searchQuery = ''
        activeTag = ''
        const input = document.getElementById('searchInput')
        if (input) input.value = ''
        renderGroups()
        render()
        console.log('[bookmarks] 查看标签组:', group.title || '未命名组')
      })
      nameBtn.addEventListener('dblclick', (event) => {
        event.preventDefault()
        renameGroup(group)
      })
      head.appendChild(nameBtn)

      const actions = el('div', 'group-actions')
      actions.appendChild(
        makeActionButton('group-action-btn', '重命名标签组', '✎', () => renameGroup(group))
      )
      actions.appendChild(
        makeActionButton('group-action-btn group-action-btn--danger', '解散标签组（保留标签）', '×', () =>
          dismissGroup(group, list)
        )
      )
      head.appendChild(actions)

      const caret = el('button', 'group-caret-btn', collapsed ? '▸' : '▾')
      caret.type = 'button'
      caret.title = collapsed ? '展开组内标签' : '折叠组内标签'
      caret.addEventListener('click', () => {
        if (expandedGroups.has(group.id)) expandedGroups.delete(group.id)
        else expandedGroups.add(group.id)
        saveExpandedGroups()
        renderGroups()
      })
      head.appendChild(caret)
      card.appendChild(head)

      if (!collapsed) {
        const body = el('div', 'group-tabs')
        if (!list.length) body.appendChild(el('div', 'group-empty', '该组当前没有标签'))
        list.forEach((tab) => {
          const row = el('button', 'group-tab')
          row.type = 'button'
          row.title = tab.title || tab.url || ''
          row.appendChild(favicon(tab.favIconUrl, 'group-tab-favicon'))
          row.appendChild(el('span', 'group-tab-title', tab.title || tab.url || '未命名标签'))
          row.addEventListener('click', () => {
            if (!/^(https?|file):\/\//i.test(tab.url || '')) return
            chrome.tabs.create({ url: tab.url })
            console.log('[bookmarks] 从标签组打开:', tab.url)
          })
          body.appendChild(row)
        })
        card.appendChild(body)
      }
      box.appendChild(card)
    })
    console.log('[bookmarks] 标签组渲染完成:', groups.length, '组内标签:', total)
  })
}

function scheduleGroupsRefresh() {
  if (groupsTimer) clearTimeout(groupsTimer)
  groupsTimer = setTimeout(() => {
    groupsTimer = null
    renderGroups().catch((error) =>
      console.error('[bookmarks] 刷新标签组失败:', error.message)
    )
  }, 150)
}

function watchGroups() {
  if (chrome.tabGroups) {
    ;['onCreated', 'onUpdated', 'onRemoved', 'onMoved'].forEach((name) => {
      if (chrome.tabGroups[name]) chrome.tabGroups[name].addListener(scheduleGroupsRefresh)
    })
  }
  if (chrome.tabs) {
    ;['onCreated', 'onRemoved', 'onUpdated', 'onMoved'].forEach((name) => {
      if (chrome.tabs[name]) chrome.tabs[name].addListener(scheduleGroupsRefresh)
    })
  }
  // 切换窗口也会改变可见标签组，补一次刷新，避免跨窗口的组没同步进来
  if (chrome.windows && chrome.windows.onFocusChanged) {
    chrome.windows.onFocusChanged.addListener(scheduleGroupsRefresh)
  }
}

// 权限没生效时 chrome.bookmarks 整体是 undefined，给可操作提示而不是抛 TypeError
function showFatal(message) {
  const empty = document.getElementById('empty')
  const text = empty.querySelector('p')
  if (text) text.textContent = message
  empty.hidden = false
  document.getElementById('grid').textContent = ''
  console.error('[bookmarks]', message)
}

function init() {
  // 顶部三个入口：新开标签（与 newtab 页行为一致）
  ;['vBookmarksEntry', 'raindropEntry', 'bookmarksEntry'].forEach((id) => {
    const link = document.getElementById(id)
    if (!link) return
    link.addEventListener('click', (event) => {
      event.preventDefault()
      chrome.tabs.create({ url: link.href })
      console.log('[bookmarks] 新开页面:', id)
    })
  })

  document.getElementById('viewList').addEventListener('click', () => setViewMode('list'))
  document.getElementById('viewGrid').addEventListener('click', () => setViewMode('grid'))
  setViewMode(viewMode)

  // 搜索 / 排序 / 添加
  const searchInput = document.getElementById('searchInput')
  let searchTimer = null
  searchInput.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      searchQuery = searchInput.value.trim().toLowerCase()
      if (searchQuery && activeGroupId) {
        activeGroupId = ''
        activeGroupName = ''
        renderGroups()
      }
      render()
      console.log('[bookmarks] 搜索:', searchQuery || '(清空)')
    }, 120)
  })
  document.getElementById('sortSelect').addEventListener('change', (event) => {
    sortMode = event.target.value
    render()
    console.log('[bookmarks] 排序:', sortMode)
  })
  document.getElementById('addBookmarkBtn').addEventListener('click', () => openEditor(null, 'create-bookmark'))
  document.getElementById('addFolderBtn').addEventListener('click', () => openEditor(null, 'create-folder'))
  document.getElementById('refreshTree').addEventListener('click', () => load())
  bindBatchActions()
  document.getElementById('toastUndo').addEventListener('click', () => {
    if (pendingUndo) {
      const undo = pendingUndo
      pendingUndo = null
      document.getElementById('toast').hidden = true
      undo()
    }
  })

  // 拖到网格空白处 = 移到当前文件夹末尾
  const gridBox = document.getElementById('grid')
  gridBox.addEventListener('dragover', (event) => {
    if (!dragBookmarkId) return
    event.preventDefault()
    gridBox.classList.add('is-drop-target')
  })
  gridBox.addEventListener('dragleave', (event) => {
    if (event.target === gridBox) gridBox.classList.remove('is-drop-target')
  })
  gridBox.addEventListener('drop', (event) => {
    if (!dragBookmarkId) return
    event.preventDefault()
    gridBox.classList.remove('is-drop-target')
    moveNode(dragBookmarkId, { parentId: currentId, index: -1 })
      .then(() => {
        console.log('[bookmarks] 拖入当前文件夹:', dragBookmarkId)
        return load()
      })
      .catch((error) => console.error('[bookmarks] 移动失败:', error.message))
  })

  // 标签组区块独立于书签权限：即使 chrome.bookmarks 不可用也照常渲染
  document.getElementById('refreshGroups').addEventListener('click', scheduleGroupsRefresh)
  watchGroups()
  renderGroups().catch((error) =>
    console.error('[bookmarks] 标签组初始化失败:', error.message)
  )

  if (!chrome.bookmarks || !chrome.bookmarks.getTree) {
    showFatal(
      '无法读取书签：chrome.bookmarks 不可用。请到 chrome://extensions 重新加载本扩展，并确认 manifest.json 的 permissions 里已有 "bookmarks"。'
    )
    return
  }
  document.getElementById('editorForm').addEventListener('submit', onSave)
  // 网址是三行 textarea：Enter 直接保存而不是插入换行，避免把 \n 写进 URL；Shift+Enter 保留换行
  document.getElementById('editUrl').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    onSave(event)
  })
  document.getElementById('closeEditor').addEventListener('click', closeEditor)
  document.getElementById('cancelEditor').addEventListener('click', closeEditor)
  document.getElementById('editorMask').addEventListener('click', (event) => {
    if (event.target.id === 'editorMask') closeEditor()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!document.getElementById('deleteMask').hidden) closeDeleteConfirm(false)
      else if (!document.getElementById('editorMask').hidden) closeEditor()
      else if (searchQuery || activeTag) clearFilters()
      return
    }
    const tag = (event.target && event.target.tagName) || ''
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    if (event.key === '/' && !typing) {
      event.preventDefault()
      searchInput.focus()
      searchInput.select()
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !typing) {
      const focused = document.activeElement
      if (focused && focused.classList && focused.classList.contains('card') && focused._node) {
        event.preventDefault()
        deleteNode(focused._node)
      }
    }
  })

  watchChanges()
  loadCollapsedFolders()
  loadMeta().then(() => {
    load()
    console.log('[bookmarks] 页面已初始化')
  })
}

document.addEventListener('DOMContentLoaded', init)
