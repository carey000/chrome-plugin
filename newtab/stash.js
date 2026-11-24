// 新标签页 · 右侧「暂存区」+ 功能区外壳（折叠 / 拉伸 / Open Tabs 切换）
// 依赖 common.js；数据存 chrome.storage.local 的 nt_stash_items，不碰其它 key。
// 便签待办状态通过 document 事件 nt:notes-changed 双向同步，不做跨模块直接写库。

;(function (NT) {
  'use strict'

  var KEY = 'nt_stash_items'
  var GROUP_KEY = 'nt_stash_groups'
  var WIDTH_KEY = 'nt_side_width'
  var COLLAPSE_KEY = 'nt_side_collapsed'
  var TAB_KEY = 'nt_side_tab'
  var UNDO_MS = 10000
  var MAX_W = 500
  var SOURCE = {
    tab: '标签集 · 标签',
    site: '网址导航',
    'open-tab': 'Open Tabs',
    history: '页面历史',
    note: '便签待办'
  }
  // 暂存区可接收的外部拖拽类型；面板 / 侧栏空白 / 暂存区 tab 三个落点共用
  var DROPPABLE = ['note-todo', 'open-tab', 'saved-tab', 'site', 'history']

  var PIN_ICON =
    '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
    '<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6ZM12 14v7" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'

  var PENCIL_ICON =
    '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
    '<path d="M4 20h4l10-10-4-4L4 16v4Z" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linejoin="round"/></svg>'

  var CARET_ICON =
    '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
    '<path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'

  var items = []
  var groups = []
  var groupsLoaded = false   // 区分「首次迁移」与「用户主动删光分组」，避免删完又被重建
  var currentView = 'sites'
  var sideTab = 'open'
  var collapsed = false
  var currentWidth = 240
  var undoQueue = []
  var undoTimer = null

  function byId(id) { return document.getElementById(id) }

  // ---- 分组 ----
  // 分组名用本地时间的「年-月-日」，与用户要求的命名一致且跨年不会混淆
  function dateName(ts) {
    var d = new Date(ts || Date.now())
    return d.getFullYear() + '-' + NT.pad2(d.getMonth() + 1) + '-' + NT.pad2(d.getDate())
  }

  function newGroupId() {
    return 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
  }

  function normalizeGroups(list) {
    return (Array.isArray(list) ? list : []).filter(function (row) { return row && row.id }).map(function (row) {
      return {
        id: String(row.id),
        name: String(row.name || dateName(row.createdAt)),
        pinned: !!row.pinned,
        collapsed: !!row.collapsed,
        createdAt: Number(row.createdAt) || Date.now()
      }
    })
  }

  // 固定组永远排前面，组内相对顺序保持存储数组顺序
  function orderedGroups() {
    return groups.filter(function (g) { return g.pinned }).concat(groups.filter(function (g) { return !g.pinned }))
  }

  function groupById(id) {
    for (var i = 0; i < groups.length; i++) if (groups[i].id === id) return groups[i]
    return null
  }

  function persistGroups() {
    return NT.storageSet({ [GROUP_KEY]: groups }).catch(function (error) {
      console.error('[newtab][stash] 分组保存失败:', error.message)
    })
  }

  function createGroup(name, silent) {
    var group = { id: newGroupId(), name: name || dateName(Date.now()), pinned: false, collapsed: false, createdAt: Date.now() }
    groups.push(group)
    persistGroups().then(function () { if (!silent) render() })
    console.log('[newtab][stash] 新建分组:', group.name)
    return group
  }

  // 旧数据只有扁平 items：按加入日期拆成日期组；没有内容也要留一个今天的组作为落点
  function migrateGroups() {
    if (groups.length) return
    var byDate = {}
    items.forEach(function (item) {
      var name = dateName(item.addedAt)
      if (!byDate[name]) byDate[name] = []
      byDate[name].push(item)
    })
    var names = Object.keys(byDate).sort().reverse()
    if (!names.length) names = [dateName(Date.now())]
    names.forEach(function (name) {
      var group = { id: newGroupId(), name: name, pinned: false, collapsed: false, createdAt: Date.now() }
      groups.push(group)
      ;(byDate[name] || []).forEach(function (item) { item.groupId = group.id })
    })
    console.log('[newtab][stash] 旧数据分组迁移:', names.length, '组')
  }

  // 条目指向已删除的组时落到第一个组，避免变成看不见的孤儿数据
  function fixOrphans() {
    if (!groups.length) return
    var fallback = orderedGroups()[0]
    items.forEach(function (item) { if (!groupById(item.groupId)) item.groupId = fallback.id })
  }

  function defaultGroup() {
    var list = orderedGroups()
    return list.length ? list[0] : createGroup(dateName(Date.now()), true)
  }

  // ---- 数据 ----
  function normalize(list) {
    return (Array.isArray(list) ? list : []).filter(function (row) { return row && row.id }).map(function (row) {
      return {
        id: String(row.id),
        type: SOURCE[row.type] ? row.type : 'tab',
        title: String(row.title || row.url || '未命名'),
        url: String(row.url || ''),
        favIconUrl: String(row.favIconUrl || ''),
        noteId: row.noteId ? String(row.noteId) : '',
        done: !!row.done,
        noteMissing: !!row.noteMissing,
        due: typeof row.due === 'string' ? row.due : '',
        addedAt: Number(row.addedAt) || Date.now(),
        groupId: row.groupId ? String(row.groupId) : ''
      }
    })
  }

  function persist() {
    return NT.storageSet({ [KEY]: items }).catch(function (error) {
      console.error('[newtab][stash] 保存失败:', error.message)
    })
  }

  function sameEntry(a, b) {
    if (a.type === 'note' || b.type === 'note') {
      return !!(a.noteId && a.noteId === b.noteId)
    }
    return !!(a.url && a.url === b.url)
  }

  function add(entry) {
    if (!entry || (!entry.title && !entry.url && !entry.noteId)) {
      console.warn('[newtab][stash] 空条目，未加入暂存区:', entry)
      return Promise.resolve(false)
    }
    var clean = normalize([Object.assign({}, entry, {
      id: 'st_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
    })])[0]
    if (items.some(function (old) { return sameEntry(old, clean) })) {
      console.log('[newtab][stash] 已存在，未重复加入:', clean.title)
      return Promise.resolve(false)
    }
    var target = defaultGroup()
    expandGroup(target)
    clean.groupId = target.id
    items.unshift(clean)
    console.log('[newtab][stash] 加入暂存区:', clean.type, clean.title, '→ 分组', clean.groupId)
    return persist().then(function () { render(); return true })
  }

  function remove(id) {
    var at = -1
    items.forEach(function (item, i) { if (item.id === id) at = i })
    if (at === -1) return
    var removed = items.splice(at, 1)[0]
    pushUndo(removed, at)
    persist().then(render)
    console.log('[newtab][stash] 移除（10 秒内可撤销）:', removed.title)
  }

  // 底部撤销条：每条移除独立计时，后移除的先撤销；过期自动出队
  function pushUndo(item, index) {
    undoQueue.push({ item: item, index: index, expiresAt: Date.now() + UNDO_MS })
    renderUndo()
  }

  function ensureUndoToast() {
    var toast = byId('stashUndo')
    if (toast) return toast
    toast = NT.el('div', 'stash-undo')
    toast.id = 'stashUndo'
    toast.hidden = true
    var text = NT.el('span', 'stash-undo-text')
    var button = NT.el('button', 'stash-undo-btn', '撤销')
    button.type = 'button'
    button.addEventListener('click', undoLast)
    var bar = NT.el('div', 'stash-undo-bar')
    toast.appendChild(text)
    toast.appendChild(button)
    toast.appendChild(bar)
    document.body.appendChild(toast)
    toast._text = text
    toast._bar = bar
    return toast
  }

  function renderUndo() {
    var toast = ensureUndoToast()
    if (undoTimer) { clearTimeout(undoTimer); undoTimer = null }
    while (undoQueue.length && undoQueue[undoQueue.length - 1].expiresAt <= Date.now()) undoQueue.pop()
    if (!undoQueue.length) { toast.hidden = true; return }
    var last = undoQueue[undoQueue.length - 1]
    var left = Math.max(0, last.expiresAt - Date.now())
    toast._text.textContent = '已移除「' + last.item.title + '」'
    toast.hidden = false
    // 重置进度条动画，让每次移除都从满格开始
    toast._bar.style.animation = 'none'
    void toast._bar.offsetWidth
    toast._bar.style.animation = 'stash-undo-shrink ' + (left / 1000) + 's linear forwards'
    undoTimer = setTimeout(function () { undoQueue.pop(); renderUndo() }, left)
  }

  function undoLast() {
    var last = undoQueue.pop()
    if (!last) return
    items.splice(Math.min(last.index, items.length), 0, last.item)
    // 删光分组后撤销：fixOrphans 无组可落，先补一个组，否则条目藏进 storage 却看不见
    if (!groups.length) createGroup(dateName(Date.now()), true)
    // 若原分组已被删除，撤销回来的条目落到现存分组，避免隐藏
    fixOrphans()
    expandGroup(groupById(last.item.groupId))
    persist().then(render)
    renderUndo()
    console.log('[newtab][stash] 已撤销移除:', last.item.title)
  }

  function syncNotes(noteItems) {
    // 便签存储未就绪时 items 还是空数组，同步会把所有便签暂存项误标为「原待办已删除」
    if (!NT.notes || !NT.notes.ready) return
    var map = {}
    ;(noteItems || []).forEach(function (row) { map[row.id] = row })
    var changed = false
    items.forEach(function (item) {
      if (item.type !== 'note') return
      var note = map[item.noteId]
      var done = note ? !!(note.done || note.abandoned) : item.done
      var missing = !note
      if (item.done !== done || item.noteMissing !== missing) {
        item.done = done
        item.noteMissing = missing
        changed = true
      }
    })
    if (!changed) return
    persist().then(render)
    console.log('[newtab][stash] 已与便签同步完成状态')
  }

  // ---- 暂存区列表 ----
  function readPayload(event, kinds) {
    // dragover 阶段浏览器不允许 getData，跨模块拖拽统一走 NT.dragState
    var payload = NT.dragState
    if (!payload && event.dataTransfer && event.dataTransfer.getData) {
      try { payload = JSON.parse(event.dataTransfer.getData('text/plain')) } catch (error) { payload = null }
    }
    var allowed = Array.isArray(kinds) ? kinds : [kinds]
    return payload && allowed.indexOf(payload.kind) !== -1 ? payload : null
  }

  // dropEffect 必须与来源的 effectAllowed 兼容，否则浏览器在 drop 阶段直接取消，
  // 表现为「面板高亮了但放不进去」。sessions 的标签卡片以 move 拖出，其余来源为 copy。
  function pickDropEffect(event) {
    return event.dataTransfer && event.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy'
  }

  // 外部拖进来的条目统一走这里，避免和「点击加入」的入口分叉
  var DROP_TYPE = {
    'saved-tab': 'tab',
    'open-tab': 'open-tab',
    site: 'site',
    history: 'history'
  }

  function addDropped(kind, payload) {
    if (kind === 'note-todo') {
      return add({
        type: 'note',
        noteId: payload.noteId,
        title: payload.title,
        due: payload.due || '',
        done: !!payload.done
      })
    }
    var entry = payload.entry || payload
    return add({
      type: DROP_TYPE[kind] || 'tab',
      title: entry.title || entry.url,
      url: entry.url || '',
      favIconUrl: entry.favIconUrl || ''
    })
  }

  function makeRow(item) {
    var cls = 'stash-item' + (item.done ? ' is-done' : '')
    var row = NT.el('div', cls)
    row.dataset.id = item.id

    if (item.type === 'note') {
      var check = document.createElement('input')
      check.type = 'checkbox'
      check.className = 'stash-check'
      check.checked = item.done
      check.disabled = item.noteMissing
      check.title = item.noteMissing ? '原待办已删除' : (item.done ? '恢复为待办' : '标记完成')
      check.setAttribute('aria-label', check.title)
      check.addEventListener('change', function () {
        if (!NT.notes || typeof NT.notes.setDone !== 'function') return
        NT.notes.setDone(item.noteId, check.checked)
      })
      row.appendChild(check)
    } else {
      row.appendChild(NT.favicon(item.favIconUrl, 'stash-favicon'))
    }

    var main = NT.el('div', 'stash-main')
    main.appendChild(NT.el('div', 'stash-title', item.title))
    var meta = SOURCE[item.type] || '暂存'
    if (item.due) meta += ' · 计划 ' + item.due
    if (item.noteMissing) meta += ' · 原待办已删除'
    else if (item.type === 'note') meta += item.done ? ' · 已完成' : ' · 待办'
    else meta += ' · ' + NT.formatTime(item.addedAt)
    main.appendChild(NT.el('div', 'stash-meta', meta))
    row.appendChild(main)

    var del = NT.el('button', 'stash-del', '×')
    del.type = 'button'
    del.title = '移出暂存区'
    del.setAttribute('aria-label', '移出暂存区：' + item.title)
    del.addEventListener('click', function (event) {
      event.stopPropagation()
      remove(item.id)
    })
    row.appendChild(del)

    // 有网址的条目可拖进标签管理的标签集；便签待办无网址，不参与
    if (item.url) {
      row.draggable = true
      row.title = item.url + '\n拖到标签管理的标签集可加入收藏'
      row.addEventListener('click', function () { NT.openInNewTab(item.url) })
      row.addEventListener('dragstart', function (event) {
        var payload = { kind: 'stash-tab', entry: item, stashItemId: item.id }
        NT.dragState = payload
        row.classList.add('is-dragging')
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move'
          try {
            event.dataTransfer.setData('text/plain', JSON.stringify(payload))
          } catch (error) {
            console.warn('[newtab][stash] 拖拽数据写入失败:', error.message)
          }
        }
        console.log('[newtab][stash] 拖出:', item.title)
      })
      row.addEventListener('dragend', function () {
        row.classList.remove('is-dragging')
        NT.dragState = null
      })
    }
    return row
  }

  function renameGroup(group) {
    var next = window.prompt('重命名分组', group.name)
    if (next === null) return
    next = next.trim()
    if (!next || next === group.name) return
    group.name = next
    persistGroups().then(render)
    console.log('[newtab][stash] 重命名分组:', next)
  }

  function deleteGroup(group) {
    var removed = items.filter(function (item) { return item.groupId === group.id })
    if (!window.confirm('删除分组「' + group.name + '」及其中的 ' + removed.length + ' 项？条目可在 10 秒内逐条撤销。')) return
    groups = groups.filter(function (g) { return g.id !== group.id })
    items = items.filter(function (item) { return item.groupId !== group.id })
    removed.forEach(function (item) { pushUndo(item, 0) })
    Promise.all([persistGroups(), persist()]).then(render)
    console.log('[newtab][stash] 删除分组:', group.name, removed.length, '项')
  }

  function toggleGroupPin(group) {
    group.pinned = !group.pinned
    // 稳定排序：固定组内部保持原来的相对顺序
    groups.sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) })
    persistGroups().then(render)
    console.log('[newtab][stash] 分组固定状态:', group.name, group.pinned)
  }

  // 有条目进入折叠组时自动展开，否则新内容不可见
  function expandGroup(group) {
    if (!group || !group.collapsed) return
    group.collapsed = false
    persistGroups().catch(function (error) { console.warn('[newtab][stash] 展开状态保存失败:', error.message) })
  }

  function toggleGroupFold(group) {
    group.collapsed = !group.collapsed
    persistGroups().then(render)
    console.log('[newtab][stash] 分组展开状态:', group.name, group.collapsed ? '折叠' : '展开')
  }

  function moveItemToGroup(itemId, groupId) {
    var item = null
    items.forEach(function (row) { if (row.id === itemId) item = row })
    if (!item || item.groupId === groupId) return
    item.groupId = groupId
    expandGroup(groupById(groupId))
    persist().then(render)
    console.log('[newtab][stash] 条目跨组移动:', item.title, '→', (groupById(groupId) || {}).name)
  }

  function makeGroup(group) {
    var section = NT.el('section', 'stash-group' +
      (group.pinned ? ' is-pinned' : '') + (group.collapsed ? ' is-folded' : ''))
    section.dataset.id = group.id

    var head = NT.el('div', 'stash-group-head')
    var grip = NT.el('span', 'stash-group-grip', '⠿')
    grip.title = '拖动排序分组'
    head.appendChild(grip)

    var fold = NT.el('button', 'stash-group-fold')
    fold.type = 'button'
    fold.title = group.collapsed ? '展开分组' : '折叠分组'
    fold.setAttribute('aria-label', fold.title)
    fold.setAttribute('aria-expanded', String(!group.collapsed))
    fold.innerHTML = CARET_ICON
    fold.addEventListener('click', function () { toggleGroupFold(group) })
    head.appendChild(fold)

    var title = NT.el('button', 'stash-group-title', group.name)
    title.type = 'button'
    title.title = group.name + '（点击重命名）'
    title.addEventListener('click', function () { renameGroup(group) })
    head.appendChild(title)

    var count = items.filter(function (item) { return item.groupId === group.id }).length
    head.appendChild(NT.el('span', 'stash-group-count', String(count)))

    var pin = NT.el('button', 'stash-group-pin' + (group.pinned ? ' is-on' : ''))
    pin.type = 'button'
    pin.title = group.pinned ? '取消固定' : '固定在顶部'
    pin.setAttribute('aria-label', pin.title)
    pin.innerHTML = PIN_ICON
    pin.addEventListener('click', function () { toggleGroupPin(group) })
    head.appendChild(pin)

    var pencil = NT.el('button', 'stash-group-rename')
    pencil.type = 'button'
    pencil.title = '重命名分组'
    pencil.innerHTML = PENCIL_ICON
    pencil.addEventListener('click', function () { renameGroup(group) })
    head.appendChild(pencil)

    var del = NT.el('button', 'stash-group-del', '×')
    del.type = 'button'
    del.title = '删除分组及其内容'
    del.addEventListener('click', function () { deleteGroup(group) })
    head.appendChild(del)
    section.appendChild(head)

    var box = NT.el('div', 'stash-group-items')
    var rows = items.filter(function (item) { return item.groupId === group.id })
    if (!rows.length) box.appendChild(NT.el('div', 'stash-group-empty', '拖动条目到这里'))
    else rows.forEach(function (item) { box.appendChild(makeRow(item)) })
    section.appendChild(box)

    // 跨组移动：条目 dragstart 带 stashItemId，空组也能接收
    section.addEventListener('dragover', function (event) {
      var payload = readPayload(event, 'stash-tab')
      if (!payload || !payload.stashItemId) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = pickDropEffect(event)
      section.classList.add('is-drop-target')
    })
    section.addEventListener('dragleave', function (event) {
      if (!section.contains(event.relatedTarget)) section.classList.remove('is-drop-target')
    })
    section.addEventListener('drop', function (event) {
      var payload = readPayload(event, 'stash-tab')
      if (!payload || !payload.stashItemId) return
      event.preventDefault()
      event.stopPropagation()
      section.classList.remove('is-drop-target')
      NT.dragState = null
      moveItemToGroup(payload.stashItemId, group.id)
    })
    return section
  }

  // 分组排序：只改组间顺序，组内条目顺序仍由 items 数组决定
  function initGroupSort() {
    var list = byId('stashList')
    if (!list || typeof window.Sortable === 'undefined') return
    window.Sortable.create(list, {
      animation: 180,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      handle: '.stash-group-grip',
      draggable: '.stash-group',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onEnd: function (event) {
        if (event.from !== event.to) return
        var ids = []
        list.querySelectorAll('.stash-group').forEach(function (el) { if (el.dataset.id) ids.push(el.dataset.id) })
        var byIdMap = {}
        groups.forEach(function (g) { byIdMap[g.id] = g })
        var next = ids.map(function (id) { return byIdMap[id] }).filter(Boolean)
        if (next.length !== groups.length) return
        // 固定组始终置顶，排序只改变同层级内的相对顺序
        groups = next.sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) })
        persistGroups().catch(function (error) { console.warn('[newtab][stash] 分组排序保存失败:', error.message) })
        console.log('[newtab][stash] 分组排序:', groups.map(function (g) { return g.name }).join(' / '))
      }
    })
    console.log('[newtab][stash] 分组拖拽排序已初始化')
  }

  function render() {
    var list = byId('stashList')
    if (!list) return
    var migrated = !groupsLoaded
    if (migrated) { migrateGroups(); groupsLoaded = true }
    fixOrphans()
    if (migrated) Promise.all([persistGroups(), persist()])
    list.textContent = ''
    if (!groups.length) {
      list.appendChild(NT.el('div', 'stash-empty', '还没有分组。点右上角「+」新建，或直接把标签、站点拖进来。'))
    }
    orderedGroups().forEach(function (group) { list.appendChild(makeGroup(group)) })
    var pending = items.filter(function (item) { return !item.done }).length
    var summary = byId('stashSummary')
    if (summary) summary.textContent = items.length + ' 项 · 待读 ' + pending
    var count = byId('sideStashCount')
    if (count) count.textContent = String(items.length)
  }

  // 各来源共用：生成「加入暂存区」按钮，点击不触发所在卡片 / 行的跳转
  function addButton(entry) {
    var button = NT.el('button', 'stash-add', '')
    button.type = 'button'
    button.title = '加入暂存区'
    button.setAttribute('aria-label', '加入暂存区：' + (entry.title || entry.url || ''))
    // 与编辑图标同款描边风格，不用纯文本 "+"
    button.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round"/></svg>'
    button.addEventListener('click', function (event) {
      event.stopPropagation()
      add(entry)
    })
    return button
  }

  // 三个落点共用的拖放绑定；guard 决定当前是否可接收，onDrop 处理各自的附加动作
  function bindDropZone(node, highlight, guard, onDrop) {
    if (!node) return
    function canDrop(event) { return (!guard || guard()) && readPayload(event, DROPPABLE) }
    node.addEventListener('dragover', function (event) {
      if (!canDrop(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = pickDropEffect(event)
      highlight.classList.add('is-drop-target')
    })
    node.addEventListener('dragleave', function (event) {
      if (!node.contains(event.relatedTarget)) highlight.classList.remove('is-drop-target')
    })
    node.addEventListener('drop', function (event) {
      var payload = canDrop(event)
      if (!payload) return
      event.preventDefault()
      event.stopPropagation()
      highlight.classList.remove('is-drop-target')
      NT.dragState = null
      addDropped(payload.kind, payload)
      if (onDrop) onDrop()
    })
  }

  // ---- 功能区外壳：tab 切换 / 折叠 / 拉伸 ----
  function applySideTabs() {
    var side = byId('sidePanel')
    var tabs = byId('sideTabs')
    if (!side || !tabs) return
    var inTabsView = currentView === 'tabs'
    tabs.hidden = !inTabsView
    var effective = inTabsView ? sideTab : 'stash'
    var openPanel = byId('openPanel')
    var stashPanel = byId('stashPanel')
    if (openPanel) openPanel.hidden = effective !== 'open'
    if (stashPanel) stashPanel.hidden = effective !== 'stash'
    tabs.querySelectorAll('.side-tab').forEach(function (btn) {
      var on = btn.dataset.sideTab === effective
      btn.classList.toggle('is-active', on)
      btn.setAttribute('aria-selected', String(on))
    })
    console.log('[newtab][stash] 右侧面板:', effective, '| 标签栏:', inTabsView ? '显示' : '隐藏')
  }

  function setView(view) {
    currentView = view
    applySideTabs()
  }

  function minWidth() {
    return window.matchMedia && window.matchMedia('(max-width: 1100px)').matches ? 210 : 240
  }

  function setWidth(px) {
    var side = byId('sidePanel')
    if (!side) return
    currentWidth = Math.max(minWidth(), Math.min(MAX_W, Math.round(px)))
    side.style.setProperty('--side-width', currentWidth + 'px')
  }

  function bindResize() {
    var side = byId('sidePanel')
    var handle = byId('sideResizer')
    if (!side || !handle) return
    handle.addEventListener('mousedown', function (event) {
      if (collapsed || (window.matchMedia && window.matchMedia('(max-width: 560px)').matches)) return
      event.preventDefault()
      var startX = event.clientX
      var startW = parseFloat(window.getComputedStyle(side).width) || currentWidth
      side.classList.add('is-resizing')
      function move(e) { setWidth(startW + startX - e.clientX) }
      function up() {
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', up)
        side.classList.remove('is-resizing')
        NT.storageSet({ [WIDTH_KEY]: currentWidth })
          .then(function () { console.log('[newtab][stash] 功能区宽度已记住:', currentWidth) })
          .catch(function (error) { console.warn('[newtab][stash] 宽度保存失败:', error.message) })
      }
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    })

    // 窗口变窄时按新的下限夹紧，避免记忆宽度（如 500px）挤压主内容；不写回 storage
    if (window.addEventListener) {
      window.addEventListener('resize', function () { setWidth(currentWidth) })
    }
  }

  function setCollapsed(next) {
    var side = byId('sidePanel')
    var button = byId('sideToggle')
    if (!side || !button) return
    collapsed = !!next
    side.classList.toggle('is-collapsed', collapsed)
    var label = collapsed ? '展开功能区' : '折叠功能区'
    button.setAttribute('aria-expanded', String(!collapsed))
    button.setAttribute('aria-label', label)
    button.title = label
    NT.storageSet({ [COLLAPSE_KEY]: collapsed })
      .then(function () { console.log('[newtab][stash] 功能区折叠状态已记住:', collapsed) })
      .catch(function (error) { console.warn('[newtab][stash] 折叠状态保存失败:', error.message) })
  }

  function bindSide() {
    var toggle = byId('sideToggle')
    if (toggle) toggle.addEventListener('click', function () { setCollapsed(!collapsed) })

    var tabs = byId('sideTabs')
    if (tabs) tabs.addEventListener('click', function (event) {
      var btn = event.target.closest ? event.target.closest('.side-tab') : null
      if (!btn || !btn.dataset.sideTab) return
      sideTab = btn.dataset.sideTab
      NT.storageSet({ [TAB_KEY]: sideTab })
        .then(applySideTabs)
        .catch(function (error) { console.warn('[newtab][stash] 标签选择保存失败:', error.message) })
    })

    var addGroup = byId('stashNewGroupBtn')
    if (addGroup) addGroup.addEventListener('click', function () {
      createGroup(dateName(Date.now()))
      console.log('[newtab][stash] 手动新建分组')
    })

    var refresh = byId('stashRefreshBtn')
    if (refresh) refresh.addEventListener('click', function () {
      syncNotes(NT.notes && NT.notes.items)
      render()
      console.log('[newtab][stash] 手动刷新暂存区')
    })

    // 便签勾选 / 编辑 / 删除后由 notes.js 广播最新待办列表
    document.addEventListener('nt:notes-changed', function (event) { syncNotes(event.detail) })

    // 三个落点：面板本体（含列表下方空白）、右栏空白、标签管理下的「暂存区」tab
    var panel = byId('stashPanel')
    var side = byId('sidePanel')
    var stashTabBtn = tabs && tabs.querySelector('[data-side-tab="stash"]')
    var panelVisible = function () { return !panel.hidden }
    bindDropZone(panel, panel, null, null)
    bindDropZone(side, panel, panelVisible, null)
    bindDropZone(stashTabBtn, stashTabBtn, null, function () {
      sideTab = 'stash'
      applySideTabs()
      NT.storageSet({ [TAB_KEY]: sideTab })
        .catch(function (error) { console.warn('[newtab][stash] 标签选择保存失败:', error.message) })
    })

    bindResize()
    initGroupSort()
  }

  function boot() {
    NT.storageGet([KEY, GROUP_KEY, WIDTH_KEY, COLLAPSE_KEY, TAB_KEY]).then(function (data) {
      items = normalize(data[KEY])
      groups = normalizeGroups(data[GROUP_KEY])
      // 存过分组（哪怕是空数组）就不再迁移；只有完全没有该 key 才按日期重建
      groupsLoaded = Object.prototype.hasOwnProperty.call(data, GROUP_KEY)
      if (typeof data[WIDTH_KEY] === 'number') setWidth(data[WIDTH_KEY])
      if (typeof data[COLLAPSE_KEY] === 'boolean') setCollapsed(data[COLLAPSE_KEY])
      if (data[TAB_KEY] === 'open' || data[TAB_KEY] === 'stash') sideTab = data[TAB_KEY]
      bindSide()
      applySideTabs()
      render()
      syncNotes(NT.notes && NT.notes.items)
      console.log('[newtab][stash] 初始化完成:', items.length, '项 | 宽度', currentWidth, '| 折叠', collapsed)
    }).catch(function (error) {
      bindSide()
      applySideTabs()
      render()
      console.error('[newtab][stash] 初始化失败:', error.message)
    })
  }

  NT.stash = {
    add: add,
    addButton: addButton,
    remove: remove,
    undoLast: undoLast,
    render: render,
    setView: setView,
    get items() { return items },
    get groups() { return groups },
    createGroup: createGroup,
    toggleGroupPin: toggleGroupPin,
    toggleGroupFold: toggleGroupFold,
    moveItemToGroup: moveItemToGroup,
    get collapsed() { return collapsed }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})(window.NT)
