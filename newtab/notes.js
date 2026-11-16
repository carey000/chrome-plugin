// 便签 · 待办清单（最后一个加载，自初始化，不依赖 newtab.js）
// 依赖：common.js 的 NT.el / NT.pad2 / NT.storageGet / NT.storageSet。
// 数据：chrome.storage.local 独立 key `nt_notes_todos`，不复用、不修改既有 7 个 key。
// 范围：只实现调研 §4.2 的 Todo list 本地能力，不含普通便签富文本、定时提醒、重复待办。

;(function (NT) {
  'use strict'

  var KEY = 'nt_notes_todos'
  var COLLAPSE_KEY = 'nt_notes_todos_collapsed'
  var FILTERS = [
    { id: 'all', label: '全部' },
    { id: 'today', label: '今日' },
    { id: 'future', label: '未来' },
    { id: 'overdue', label: '过期' },
    { id: 'done', label: '已完成' }
  ]
  var MENU_ACTIVE = [
    { id: 'togglePin', label: '置顶 / 取消置顶' },
    { id: 'moveUp', label: '上移' },
    { id: 'moveDown', label: '下移' },
    { id: 'abandon', label: '设为放弃' },
    { id: 'delete', label: '删除' },
    { id: 'clearSelection', label: '取消多选' }
  ]
  var MENU_ARCHIVE = [
    { id: 'restore', label: '恢复为待办' },
    { id: 'delete', label: '删除' },
    { id: 'clearSelection', label: '取消多选' }
  ]

  var items = []
  var filter = 'all'
  var collapsed = false
  var selected = {}          // id -> true，Ctrl / ⌘ 多选
  var editingId = null       // 当前处于行内编辑的条目
  var blankId = null         // 编辑态 Enter 追加的空白条目，空内容失焦即丢弃

  // ---------- 数据层 ----------

  function hasStorage() {
    return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local &&
      typeof NT.storageGet === 'function' && typeof NT.storageSet === 'function'
  }

  function showError(message) {
    var node = document.getElementById('notesError')
    if (!node) return
    node.textContent = message || ''
    node.hidden = !message
  }

  // 坏数据 / 旧数据兜底：缺字段一律补默认值，渲染层不做二次判空
  function normalize(list) {
    return (Array.isArray(list) ? list : []).filter(function (row) {
      return row && row.id
    }).map(function (row) {
      return {
        id: String(row.id),
        text: String(row.text || ''),
        done: !!row.done,
        abandoned: !!row.abandoned,
        pinned: !!row.pinned,
        due: typeof row.due === 'string' ? row.due : '',
        createdAt: Number(row.createdAt) || Date.now(),
        doneAt: Number(row.doneAt) || 0
      }
    })
  }

  function save(label) {
    if (!hasStorage()) {
      showError('chrome.storage.local 不可用，待办无法保存')
      return Promise.resolve()
    }
    var payload = {}
    payload[KEY] = items
    return NT.storageSet(payload).then(function () {
      showError('')
      console.log('[newtab][notes] 已写入', KEY, '| 操作:', label, '| 共', items.length, '条')
    }).catch(function (error) {
      showError('写入失败：' + error.message + '（检查 storage.local 配额）')
      console.error('[newtab][notes] 写入失败:', label, error.message)
    })
  }

  function load() {
    if (!hasStorage()) {
      showError('chrome.storage.local 不可用，待办无法读取')
      render()
      return
    }
    NT.storageGet(KEY).then(function (data) {
      items = normalize(data[KEY])
      render()
      console.log('[newtab][notes] 初始化完成，读取', items.length, '条待办')
    }).catch(function (error) {
      showError('读取失败：' + error.message)
      console.error('[newtab][notes] 读取失败:', error.message)
      render()
    })
  }

  // 多标签页 / 其它 newtab 页写入时同步；正在行内编辑则跳过，避免重建 DOM 丢焦点
  function bindStorageSync() {
    if (!hasStorage() || !chrome.storage.onChanged ||
        typeof chrome.storage.onChanged.addListener !== 'function') return
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local' || !changes[KEY]) return
      var incoming = normalize(changes[KEY].newValue)
      // 本页 save() 也会触发 onChanged；值一致时跳过，避免重复渲染打断输入焦点
      if (JSON.stringify(incoming) === JSON.stringify(items)) return
      if (editingId) {
        console.log('[newtab][notes] 行内编辑中，跳过本次 storage.onChanged 重渲染')
        return
      }
      items = incoming
      render()
      console.log('[newtab][notes] 检测到其它页面写入，已重渲染', items.length, '条')
    })
  }

  function find(id) {
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i]
    return null
  }

  function newItem(text, due) {
    return {
      id: 'todo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      text: text,
      due: due || '',
      done: false,
      abandoned: false,
      pinned: false,
      createdAt: Date.now(),
      doneAt: 0
    }
  }

  function today() {
    var d = new Date()
    return d.getFullYear() + '-' + NT.pad2(d.getMonth() + 1) + '-' + NT.pad2(d.getDate())
  }

  // 截图口径：开始:03-23 完成:03-24 14:23
  function stamp(ts, withTime) {
    var d = new Date(ts)
    var date = NT.pad2(d.getMonth() + 1) + '-' + NT.pad2(d.getDate())
    return withTime ? date + ' ' + NT.pad2(d.getHours()) + ':' + NT.pad2(d.getMinutes()) : date
  }

  function isArchived(item) {
    return item.done || item.abandoned
  }

  // 置顶项稳定排在前面；其余保持数组顺序（上移 / 下移交换数组元素）
  function ordered(list) {
    return list.slice().sort(function (a, b) {
      return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
    })
  }

  // 归档项只由下方「已完成 / 已放弃」分组渲染，活动区一律排除，避免同一条渲染两次
  function matchFilter(item) {
    if (isArchived(item) || filter === 'done') return false
    if (filter === 'all') return true
    var due = item.due || today()
    if (filter === 'today') return due === today()
    if (filter === 'future') return due > today()
    if (filter === 'overdue') return due < today()
    return true
  }

  // ---------- 渲染层 ----------

  function renderFilter() {
    var bar = document.getElementById('notesFilter')
    if (!bar) return
    bar.textContent = ''
    FILTERS.forEach(function (def) {
      var btn = NT.el('button', 'site-cat' + (def.id === filter ? ' is-active' : ''), def.label)
      btn.type = 'button'
      btn.addEventListener('click', function () {
        filter = def.id
        render()
        console.log('[newtab][notes] 切换筛选:', def.label)
      })
      bar.appendChild(btn)
    })
  }

  function emptyText() {
    if (!items.length) return '还没有待办，在上方输入框按 Enter 新增一条'
    if (filter === 'done') {
      return items.some(isArchived) ? '已完成 / 已放弃的待办见下方归档分组' : '还没有已完成 / 已放弃的待办'
    }
    return '当前筛选下没有待办'
  }

  function makeRow(item, archived) {
    var cls = 'notes-row'
    if (archived) cls += ' is-archived'
    if (item.abandoned) cls += ' is-abandoned'
    if (item.pinned) cls += ' is-pinned'
    if (item.due && item.due < today() && !archived) cls += ' is-overdue'
    if (selected[item.id]) cls += ' is-selected'
    var row = NT.el('div', cls)
    row.dataset.id = item.id

    // 原生 checkbox：点击完成并自动归档；归档区点击则恢复为待办
    var check = document.createElement('input')
    check.type = 'checkbox'
    check.className = 'notes-check'
    check.checked = isArchived(item)
    check.setAttribute('aria-label', item.abandoned ? '恢复已放弃待办' : (item.done ? '恢复已完成待办' : '完成待办'))
    check.addEventListener('click', function (event) { event.stopPropagation() })
    check.addEventListener('change', function () {
      if (archived) {
        console.log('[newtab][notes] 恢复待办:', item.id)
        runAction('restore', [item.id], true)
      } else {
        console.log('[newtab][notes] 勾选完成并归档:', item.id, item.text)
        toggleDone(item.id)
      }
    })
    row.appendChild(check)

    var body = NT.el('div', 'notes-body')
    if (editingId === item.id) {
      appendEditor(body, item)
    } else {
      var text = NT.el('span', 'notes-text', item.text || '（空待办，单击编辑）')
      body.appendChild(text)
      var meta = NT.el('div', 'notes-meta')
      var parts = ['开始:' + stamp(item.createdAt, false)]
      if (item.due && item.due !== today()) parts.push('计划:' + item.due)
      if (item.due && item.due < today() && !archived) parts.push('已过期')
      if (isArchived(item)) parts.push((item.abandoned ? '放弃:' : '完成:') + stamp(item.doneAt || item.createdAt, true))
      meta.textContent = parts.join(' · ')
      body.appendChild(meta)
      if (item.pinned) body.appendChild(NT.el('span', 'notes-flag', '置顶'))
      if (item.abandoned) body.appendChild(NT.el('span', 'notes-flag notes-flag--muted', '已放弃'))
    }
    row.appendChild(body)

    var more = NT.el('button', 'notes-more', '···')
    more.type = 'button'
    more.title = '更多操作（也可在本行右键）'
    more.setAttribute('aria-label', '更多操作')
    more.addEventListener('click', function (event) {
      event.stopPropagation()
      var box = more.getBoundingClientRect()
      openMenu(box.left, box.bottom + 4, item.id, archived)
    })
    row.appendChild(more)

    row.addEventListener('click', function (event) {
      if (event.ctrlKey || event.metaKey) {
        toggleSelect(item.id)
        return
      }
      var wantEdit = event.target && event.target.classList &&
        event.target.classList.contains('notes-text')
      selected = {}
      editingId = wantEdit ? item.id : null
      render()
      if (wantEdit) focusEditor()
      console.log('[newtab][notes] 单击', wantEdit ? '进入编辑:' + item.id : '清空多选')
    })

    row.addEventListener('contextmenu', function (event) {
      event.preventDefault()
      openMenu(event.clientX, event.clientY, item.id, archived)
    })
    return row
  }

  // 行内编辑：文本 + 计划日期；Enter 保存并在其后追加一条空白待办，Esc 取消
  function appendEditor(body, item) {
    var input = document.createElement('input')
    input.type = 'text'
    input.className = 'notes-edit-input'
    input.value = item.text
    input.setAttribute('aria-label', '待办内容')
    var date = document.createElement('input')
    date.type = 'date'
    date.className = 'notes-edit-date'
    date.value = item.due
    date.title = '计划日期，留空归入「今日」'
    date.setAttribute('aria-label', '计划日期')
    body.appendChild(input)
    body.appendChild(date)

    var settled = false
    function commit(thenAdd) {
      if (settled) return
      settled = true
      var row = find(item.id)
      if (!row) return
      var text = input.value.trim()
      var due = date.value
      if (!text && blankId === item.id) {
        items = items.filter(function (it) { return it.id !== item.id })
        blankId = null
        editingId = null
        console.log('[newtab][notes] 丢弃空白待办:', item.id)
      } else {
        row.text = text
        row.due = due
        if (blankId === item.id) blankId = null
        if (thenAdd) {
          var blank = newItem('', due)
          var at = items.findIndex(function (it) { return it.id === item.id })
          items.splice(at + 1, 0, blank)
          editingId = blank.id
          blankId = blank.id
        } else {
          editingId = null
        }
      }
      save('编辑待办')
      render()
      if (thenAdd && editingId) focusEditor()
    }
    function cancel() {
      if (settled) return
      settled = true
      if (blankId === item.id) {
        items = items.filter(function (it) { return it.id !== item.id })
        blankId = null
      }
      editingId = null
      render()
      console.log('[newtab][notes] 取消编辑:', item.id)
    }
    function bindKey(node, enterAdds) {
      node.addEventListener('click', function (event) { event.stopPropagation() })
      node.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit(enterAdds)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          cancel()
        }
      })
    }
    bindKey(input, true)
    bindKey(date, false)
    // 两个输入框互相切换焦点时不提交，只有焦点真正离开编辑区才提交
    input.addEventListener('blur', function () {
      window.setTimeout(function () { if (document.activeElement !== date) commit(false) }, 0)
    })
    date.addEventListener('blur', function () {
      window.setTimeout(function () { if (document.activeElement !== input) commit(false) }, 0)
    })
  }

  function focusEditor() {
    var input = document.querySelector('.notes-edit-input')
    if (input) {
      input.focus()
      input.select()
    }
  }

  function render() {
    var list = document.getElementById('notesList')
    var archiveList = document.getElementById('notesArchiveList')
    if (!list || !archiveList) return
    renderFilter()

    var active = []
    var archived = []
    items.forEach(function (item) { (isArchived(item) ? archived : active).push(item) })
    active = ordered(active).filter(matchFilter)
    archived = ordered(archived)

    list.textContent = ''
    archiveList.textContent = ''
    active.forEach(function (item) { list.appendChild(makeRow(item, false)) })
    archived.forEach(function (item) { archiveList.appendChild(makeRow(item, true)) })
    if (!active.length) list.appendChild(NT.el('div', 'notes-empty', emptyText()))
    if (!archived.length) archiveList.appendChild(NT.el('div', 'notes-empty', '暂无已归档待办'))

    var summary = document.getElementById('notesSummary')
    if (summary) {
      summary.textContent = items.length + ' 条 · 待办 ' + items.filter(function (i) { return !isArchived(i) }).length +
        ' · 已完成 ' + items.filter(function (i) { return i.done }).length +
        ' · 已放弃 ' + items.filter(function (i) { return i.abandoned }).length
    }
    var count = document.getElementById('notesArchiveCount')
    if (count) count.textContent = String(archived.length)
    var toggle = document.getElementById('notesArchiveToggle')
    if (toggle) {
      toggle.classList.toggle('is-collapsed', collapsed)
      toggle.setAttribute('aria-expanded', String(!collapsed))
    }
    archiveList.hidden = collapsed
    console.log('[newtab][notes] 渲染:', filter, '活动', active.length, '归档', archived.length)
  }

  // ---------- 操作层 ----------

  function toggleSelect(id) {
    if (selected[id]) delete selected[id]
    else selected[id] = true
    render()
    console.log('[newtab][notes] 多选:', Object.keys(selected).length, '条')
  }

  function toggleDone(id) {
    var item = find(id)
    if (!item) return
    item.done = true
    item.abandoned = false
    item.pinned = false
    item.doneAt = Date.now()
    delete selected[id]
    save('完成待办')
    render()
  }

  function move(id, delta) {
    var visible = ordered(items.filter(function (it) { return !isArchived(it) }))
    var idx = -1
    for (var i = 0; i < visible.length; i++) if (visible[i].id === id) idx = i
    var other = visible[idx + delta]
    if (!other) {
      console.log('[newtab][notes] 已到边界，不移动:', id)
      return
    }
    var a = items.findIndex(function (it) { return it.id === id })
    var b = items.findIndex(function (it) { return it.id === other.id })
    var tmp = items[a]
    items[a] = items[b]
    items[b] = tmp
  }

  // 菜单动作集中在一个 switch，批量与单条走同一条写盘路径
  function runAction(action, ids, archived) {
    var idset = {}
    ids.forEach(function (id) { idset[id] = true })
    if (action === 'clearSelection') {
      selected = {}
      render()
      return
    }
    if (action === 'delete') {
      if (!window.confirm('确定删除选中的 ' + ids.length + ' 条待办？此操作不可撤销。')) return
      items = items.filter(function (it) { return !idset[it.id] })
      editingId = null
    } else if (action === 'togglePin') {
      var allPinned = ids.every(function (id) { var it = find(id); return it && it.pinned })
      items.forEach(function (it) { if (idset[it.id]) it.pinned = !allPinned })
    } else if (action === 'moveUp' || action === 'moveDown') {
      move(ids[0], action === 'moveUp' ? -1 : 1)
    } else if (action === 'abandon') {
      items.forEach(function (it) {
        if (!idset[it.id]) return
        it.abandoned = true
        it.done = false
        it.pinned = false
        it.doneAt = Date.now()
      })
    } else if (action === 'restore') {
      items.forEach(function (it) {
        if (!idset[it.id]) return
        it.done = false
        it.abandoned = false
        it.doneAt = 0
      })
    }
    selected = {}
    save((archived ? '归档区 ' : '') + action + ' ×' + ids.length)
    render()
    console.log('[newtab][notes] 执行', action, '| 目标', ids.length, '条 | 剩余', items.length, '条')
  }

  // ---------- 自绘右键菜单（contextMenus 权限只管网页右键，不管扩展页内部） ----------

  function closeMenu() {
    var menu = document.getElementById('notesMenu')
    if (menu) menu.hidden = true
  }

  function openMenu(x, y, id, archived) {
    var menu = document.getElementById('notesMenu')
    if (!menu) return
    var keys = Object.keys(selected)
    var ids = selected[id] && keys.length > 1 ? keys : [id]
    // 右键未选中的行时以该行为准，同时清掉旧多选；有编辑态时不重渲染，避免丢输入
    if (!selected[id]) {
      selected = {}
      if (!editingId) render()
    }
    menu.textContent = ''
    var defs = archived ? MENU_ARCHIVE : MENU_ACTIVE
    defs.forEach(function (def) {
      if ((def.id === 'moveUp' || def.id === 'moveDown') && ids.length > 1) return
      var label = def.label + (ids.length > 1 ? '（' + ids.length + ' 条）' : '')
      var btn = NT.el('button', 'notes-menu-item' + (def.id === 'delete' ? ' is-danger' : ''), label)
      btn.type = 'button'
      btn.addEventListener('click', function (event) {
        event.stopPropagation()
        closeMenu()
        runAction(def.id, ids, archived)
      })
      menu.appendChild(btn)
    })
    menu.appendChild(NT.el('div', 'notes-menu-tip',
      ids.length > 1 ? '批量操作 · 按住 Ctrl / ⌘ 点击可多选' : '按住 Ctrl / ⌘ 点击其它行可批量操作'))
    menu.hidden = false
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - 200)) + 'px'
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - 240)) + 'px'
    console.log('[newtab][notes] 打开右键菜单:', id, '| 目标', ids.length, '条 |', archived ? '归档区' : '活动区')
  }

  // ---------- 绑定 ----------

  function bind() {
    var form = document.getElementById('notesAddForm')
    var input = document.getElementById('notesInput')
    var due = document.getElementById('notesDue')
    if (form && input && due) {
      form.addEventListener('submit', function (event) {
        event.preventDefault()
        var text = input.value.trim()
        if (!text) return
        var item = newItem(text, due.value)
        items.push(item)
        input.value = ''
        save('新增待办')
        render()
        input.focus()
        console.log('[newtab][notes] 新增待办:', item.id, text, '计划:', item.due || '今日')
      })
    }

    var toggle = document.getElementById('notesArchiveToggle')
    if (toggle) {
      toggle.addEventListener('click', function () {
        collapsed = !collapsed
        try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0') } catch (error) {
          console.warn('[newtab][notes] 折叠状态无法保存:', error.message)
        }
        render()
        console.log('[newtab][notes] 归档分组:', collapsed ? '已折叠' : '已展开')
      })
    }

    var clear = document.getElementById('notesClearDone')
    if (clear) {
      clear.addEventListener('click', function () {
        var count = items.filter(isArchived).length
        if (!count) return
        if (!window.confirm('确定清空 ' + count + ' 条已完成 / 已放弃待办？此操作不可撤销。')) return
        items = items.filter(function (it) { return !isArchived(it) })
        selected = {}
        save('清空归档 ×' + count)
        render()
        console.log('[newtab][notes] 清空归档:', count, '条')
      })
    }

    document.addEventListener('click', closeMenu)
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeMenu()
    })
    window.addEventListener('resize', closeMenu)
  }

  function boot() {
    try { collapsed = localStorage.getItem(COLLAPSE_KEY) === '1' } catch (error) { collapsed = false }
    bind()
    bindStorageSync()
    load()
  }

  NT.notes = {
    init: load,
    render: render,
    get items() { return items },
    get filter() { return filter }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})(window.NT)
