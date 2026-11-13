// 书签管理页：按 Chrome 原始文件夹层级展示，支持打开与编辑标题 / 网址。
// MV3 扩展页 CSP 禁止内联脚本、eval、new Function，所有逻辑都在这个外部文件里。
// 数据只来自 chrome.bookmarks，不做任何远程请求，也不缓存 node.id 作为跨设备标识。

const ROOT_ID = '0'

let index = new Map()
let currentId = ROOT_ID
let editingId = null

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

function makeCard(node, isFolder) {
  const card = el('article', 'card')
  card.tabIndex = 0
  const info = isFolder ? null : siteInfo(node.url)

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
  body.appendChild(text)
  if (canEdit(node)) body.appendChild(makeEditButton(node))
  card.appendChild(body)

  function activate() {
    if (isFolder) {
      currentId = node.id
      render()
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

function render() {
  const grid = document.getElementById('grid')
  const crumbs = document.getElementById('crumbs')
  const count = document.getElementById('countLabel')
  const empty = document.getElementById('empty')
  const node = currentNode()

  grid.textContent = ''
  crumbs.textContent = ''

  const chain = crumbsFor(currentId)
  chain.forEach((item, i) => {
    if (i > 0) crumbs.appendChild(el('span', 'crumb-sep', '/'))
    const btn = el('button', 'crumb' + (i === chain.length - 1 ? ' crumb--current' : ''), item.title)
    btn.type = 'button'
    btn.addEventListener('click', () => {
      currentId = item.id
      render()
    })
    crumbs.appendChild(btn)
  })

  const children = (node && node.children) || []
  children.forEach((child) => grid.appendChild(makeCard(child, !child.url)))
  if (grid.classList && grid.classList.toggle) grid.classList.toggle('grid--list', viewMode === 'list')

  const folders = children.filter((child) => !child.url).length
  count.textContent = folders + ' 个文件夹 · ' + (children.length - folders) + ' 个书签'
  empty.hidden = children.length > 0

  // 异步、不阻塞：render 已同步完成，检测排到下一个任务
  setTimeout(scheduleLinkCheck, 0)
}

function openEditor(node) {
  editingId = node.id
  const isFolder = !node.url
  document.getElementById('editorTitle').textContent = isFolder ? '编辑文件夹' : '编辑书签'
  document.getElementById('editTitle').value = node.title || ''
  document.getElementById('editUrl').value = node.url || ''
  document.getElementById('urlField').hidden = isFolder
  document.getElementById('formError').hidden = true
  document.getElementById('editorMask').hidden = false
  document.getElementById('editTitle').focus()
  console.log('[bookmarks] 打开编辑器:', node.id, node.title)
}

function closeEditor() {
  editingId = null
  document.getElementById('editorMask').hidden = true
}

function onSave(event) {
  event.preventDefault()
  if (!editingId) return

  const isFolder = document.getElementById('urlField').hidden
  const title = document.getElementById('editTitle').value.trim()
  const url = document.getElementById('editUrl').value.trim()
  const errorBox = document.getElementById('formError')
  const changes = { title }
  if (!isFolder) changes.url = url

  if (!title) return showError('标题不能为空')
  if (!isFolder && !url) return showError('网址不能为空')
  if (!isFolder && /^(javascript|data|vbscript):/i.test(url)) return showError('不允许使用这种网址协议')
  errorBox.hidden = true

  const id = editingId
  updateNode(id, changes)
    .then(() => {
      console.log('[bookmarks] 已保存:', id, changes)
      closeEditor()
      // 显式刷新一次；外部变更由下面的书签事件再刷新
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
const collapsedGroups = new Set()
let groupsTimer = null

// query() 在不同 Chrome 版本可能是 callback 或 Promise，两条通道都接住，done 幂等
function queryGroups() {
  if (!chrome.tabGroups || !chrome.tabGroups.query) return Promise.resolve([])
  return new Promise((resolve) => {
    let settled = false
    const done = (list) => {
      if (settled) return
      settled = true
      resolve(Array.isArray(list) ? list : [])
    }
    try {
      const ret = chrome.tabGroups.query({}, done)
      if (ret && typeof ret.then === 'function') ret.then(done, () => done([]))
    } catch (error) {
      try {
        chrome.tabGroups.query({}).then(done, () => done([]))
      } catch (error2) {
        done([])
      }
    }
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
  return Promise.all([queryGroups(), queryAllTabs()]).then(([groups, tabs]) => {
    const panel = document.getElementById('groupsPanel')
    const box = document.getElementById('groupsList')
    if (!panel || !box) return

    box.textContent = ''
    const byId = new Map(groups.map((group) => [group.id, group]))
    // 只认能匹配到真实 group 的 groupId，不依赖 TAB_GROUP_ID_NONE 的具体值
    const members = new Map()
    tabs.forEach((tab) => {
      if (!byId.has(tab.groupId)) return
      if (!members.has(tab.groupId)) members.set(tab.groupId, [])
      members.get(tab.groupId).push(tab)
    })

    const total = Array.from(members.values()).reduce((sum, list) => sum + list.length, 0)
    document.getElementById('groupsSummary').textContent =
      groups.length + ' 个组 · ' + total + ' 个标签'
    panel.hidden = groups.length === 0

    groups.forEach((group) => {
      const list = members.get(group.id) || []
      const collapsed = collapsedGroups.has(group.id)
      const card = el('section', 'group-card' + (collapsed ? ' is-collapsed' : ''))

      const head = el('button', 'group-head')
      head.type = 'button'
      head.title = collapsed ? '展开' : '折叠'
      head.setAttribute('aria-expanded', String(!collapsed))
      const dot = el('span', 'group-dot')
      dot.style.backgroundColor = GROUP_COLORS[group.color] || GROUP_COLORS.grey
      head.appendChild(dot)
      head.appendChild(el('span', 'group-name', group.title || '未命名组'))
      head.appendChild(el('span', 'group-count', list.length + ' tabs'))
      head.appendChild(el('span', 'group-caret'))
      head.addEventListener('click', () => {
        if (collapsedGroups.has(group.id)) collapsedGroups.delete(group.id)
        else collapsedGroups.add(group.id)
        renderGroups()
      })
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
    console.log('[bookmarks] 标签组:', groups.length, '组内标签:', total)
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
  document.getElementById('viewList').addEventListener('click', () => setViewMode('list'))
  document.getElementById('viewGrid').addEventListener('click', () => setViewMode('grid'))
  setViewMode(viewMode)

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
  document.getElementById('closeEditor').addEventListener('click', closeEditor)
  document.getElementById('cancelEditor').addEventListener('click', closeEditor)
  document.getElementById('editorMask').addEventListener('click', (event) => {
    if (event.target.id === 'editorMask') closeEditor()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeEditor()
  })
  watchChanges()
  load()
  console.log('[bookmarks] 页面已初始化')
}

document.addEventListener('DOMContentLoaded', init)
