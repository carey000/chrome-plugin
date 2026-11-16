// 新标签页 · 左侧「已保存的标签集」+ 右侧「Open Tabs（按窗口分组）」
// 参考 tab ui.png：右侧竖排按窗口分组、可折叠、每组可单独保存；左侧卡片网格展示集合内容。
// 数据存 chrome.storage.local，与书签、Chrome 原生标签组完全隔离。

;(function (NT) {
  'use strict'

  const KEY = 'nt_collections'
  const RESTORABLE = /^(https?|file):\/\//i
  // 左侧集合可接收的拖拽来源：集合内卡片排序、右侧 Open Tabs 加入
  const COLLECTION_DROPS = ['saved-tab', 'open-tab']

  // source 只用于「刷新」按钮定位来源窗口，不再作为去重依据
  function windowSource(windowId) {
    return 'window:' + windowId
  }

  const CARET_ICON =
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
    '<path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>'

  const PENCIL_ICON =
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
    '<path d="M4 20h4l10-10-4-4L4 16v4Z" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linejoin="round"/></svg>'

  // 与 newtab.html 里 #refreshTabsBtn 的图标保持一致
  const REFRESH_ICON =
    '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
    '<path d="M20 11a8 8 0 1 0-2.3 6M20 5v6h-6" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'

  const HISTORY_LIMIT = 50
  const undoStack = []
  const redoStack = []

  let collections = []
  let editingId = null
  let editContext = null
  let refreshTimer = null
  let dragState = null
  let confirmPop = null
  let confirmAnchor = null
  let confirmAction = null
  const collapsedWindows = new Set()
  const collapsedCollections = new Set()

  // ---- 拖拽：左侧集合卡片（本地数组）与右侧真实标签（chrome.tabs.move）共用 ----
  function startDrag(event, payload) {
    dragState = payload
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      try {
        event.dataTransfer.setData('text/plain', JSON.stringify(payload))
      } catch (error) {
        /* 某些环境不允许 setData，用模块内 dragState 兜底 */
      }
    }
    if (event.currentTarget && event.currentTarget.classList) {
      event.currentTarget.classList.add('is-dragging')
    }
    console.log('[newtab][sessions] dragstart:', payload.kind, payload)
  }

  // kind 可传单个字符串或数组：左侧集合同时接收 saved-tab 与 open-tab 两种来源
  function readDrag(event, kinds) {
    let payload = dragState
    if (!payload && event.dataTransfer && event.dataTransfer.getData) {
      try {
        payload = JSON.parse(event.dataTransfer.getData('text/plain'))
      } catch (error) {
        payload = null
      }
    }
    const allowed = Array.isArray(kinds) ? kinds : [kinds]
    return payload && allowed.indexOf(payload.kind) !== -1 ? payload : null
  }

  function clearDragMarks() {
    dragState = null
    if (!document.querySelectorAll) return
    document.querySelectorAll('.is-dragging, .is-drop-target').forEach((node) => {
      node.classList.remove('is-dragging', 'is-drop-target')
    })
  }

  function allowDrop(event, node, kind) {
    if (!readDrag(event, kind)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    if (node && node.classList) node.classList.add('is-drop-target')
  }

  function isRestorable(url) {
    return RESTORABLE.test(url || '')
  }

  // 保存时带上 favIconUrl，重新打开页面才能还原图标；旧数据缺字段时会自动走灰色占位
  function toEntry(tab) {
    return {
      title: tab.title || tab.url,
      url: tab.url,
      favIconUrl: tab.favIconUrl || '',
    }
  }

  // ---- 存储 ----
  function loadCollections() {
    return NT.storageGet([KEY]).then((data) => {
      collections = Array.isArray(data[KEY]) ? data[KEY] : []
      return collections
    })
  }

  function persist() {
    return NT.storageSet({ [KEY]: collections })
  }

  // ---- 撤销 / 反撤销：修改前压快照，Ctrl+Z / Ctrl+Shift+Z 前后切换 ----
  function snapshot() {
    return JSON.parse(JSON.stringify(collections))
  }

  function pushHistory() {
    undoStack.push(snapshot())
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
    redoStack.length = 0
    console.log('[newtab][sessions] 记录快照, undo 深度:', undoStack.length)
  }

  function applyHistory(from, to, label) {
    if (!from.length) {
      console.log('[newtab][sessions] 没有可' + label + '的操作')
      return Promise.resolve()
    }
    // 撤销会整批替换 collections，正在编辑的旧对象引用会失效，先关掉弹窗
    closeTabEditor()
    to.push(snapshot())
    collections = from.pop()
    return persist().then(() => {
      renderCollections()
      console.log('[newtab][sessions] ' + label + ': undo/redo =', undoStack.length, redoStack.length)
    })
  }

  function undo() {
    return applyHistory(undoStack, redoStack, '撤销')
  }

  function redo() {
    return applyHistory(redoStack, undoStack, '反撤销')
  }

  // ---- 集合头操作的按钮下方确认气泡：单例挂 body，点确认才执行 ----
  function ensureConfirmPop() {
    if (confirmPop) return confirmPop
    const pop = NT.el('div', 'confirm-pop')
    pop.hidden = true
    const text = NT.el('p', 'confirm-pop-text')
    const actions = NT.el('div', 'confirm-pop-actions')
    const cancel = NT.el('button', 'mini-btn', '取消')
    cancel.type = 'button'
    cancel.addEventListener('click', (event) => {
      if (event.stopPropagation) event.stopPropagation()
      closeConfirm()
    })
    const ok = NT.el('button', 'mini-btn mini-btn--primary', '确认')
    ok.type = 'button'
    ok.addEventListener('click', (event) => {
      if (event.stopPropagation) event.stopPropagation()
      const action = confirmAction
      closeConfirm()
      if (action) action()
    })
    actions.appendChild(cancel)
    actions.appendChild(ok)
    pop.appendChild(text)
    pop.appendChild(actions)
    pop._text = text
    pop._ok = ok
    document.body.appendChild(pop)
    confirmPop = pop
    return pop
  }

  function closeConfirm() {
    if (!confirmPop) return
    confirmPop.hidden = true
    confirmAnchor = null
    confirmAction = null
  }

  function askConfirm(anchor, message, action, danger) {
    const pop = ensureConfirmPop()
    // 再点同一个按钮 = 收起，不执行
    if (confirmAnchor === anchor && !pop.hidden) {
      closeConfirm()
      return
    }
    closeConfirm()
    confirmAnchor = anchor
    confirmAction = action
    pop._text.textContent = message
    pop._ok.className = 'mini-btn ' + (danger ? 'mini-btn--danger' : 'mini-btn--primary')
    pop._ok.textContent = danger ? '确认删除' : '确认'
    pop.hidden = false
    const rect =
      typeof anchor.getBoundingClientRect === 'function'
        ? anchor.getBoundingClientRect()
        : { left: 0, right: 0, bottom: 0 }
    // 以按钮右边为基准：气泡右边缘与按钮右边缘对齐；靠近视口边缘时夹住不溢出
    const width = pop.offsetWidth || 240
    const vw = window.innerWidth || 1280
    const anchorRight = rect.right || (rect.left || 0) + width
    const right = Math.min(anchorRight, vw - 8)
    const left = Math.max(8, right - width)
    pop.setAttribute('style', 'left:' + left + 'px;top:' + ((rect.bottom || 0) + 6) + 'px')
  }

  function bindConfirmDismiss() {
    document.addEventListener('click', (event) => {
      if (!confirmPop || confirmPop.hidden) return
      const target = event.target
      // icon-btn 里是 <svg>/<path>，点击的 target 常是按钮的子节点；
      // 只比 target === confirmAnchor 会在同一次点击冒泡里把刚打开的气泡立刻关掉
      if (
        target === confirmAnchor ||
        (confirmAnchor && confirmAnchor.contains && confirmAnchor.contains(target))
      ) return
      if (confirmPop.contains && confirmPop.contains(target)) return
      closeConfirm()
    })
  }

  function bindKeydown() {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && confirmPop && !confirmPop.hidden) {
        closeConfirm()
        return
      }
      const modal = document.getElementById('tabEditModal')
      if (event.key === 'Escape' && modal && !modal.hidden) {
        closeTabEditor()
        return
      }
      if (!(event.ctrlKey || event.metaKey)) return
      if (String(event.key || '').toLowerCase() !== 'z') return
      // 输入框里让浏览器原生撤销生效，不劫持
      const t = event.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      // 只在标签管理视图响应，避免在网址导航 / 页面历史误触
      const view = document.getElementById('viewTabs')
      if (view && view.hidden) return
      if (event.preventDefault) event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    })
  }

  // URL 集合忽略顺序比较：排序后逐项比对，长度不同直接不算重复
  function sameUrls(a, b) {
    if (a.length !== b.length) return false
    const urls = (list) => list.map((tab) => tab.url).sort()
    const left = urls(a)
    const right = urls(b)
    return left.every((url, i) => url === right[i])
  }

  // 每次保存都新建集合；若已有内容一模一样的，confirm 询问是否覆盖，取消则本次什么都不做
  function saveCollection(source, name, list) {
    if (!list.length) return Promise.resolve()
    const duplicate = collections.find((item) => sameUrls(item.tabs, list))
    if (duplicate) {
      const message = '已存在相同的标签集「' + duplicate.name + '」，是否覆盖？'
      if (!window.confirm(message)) {
        console.log('[newtab][sessions] 用户取消覆盖，本次不保存:', duplicate.name)
        return Promise.resolve()
      }
      pushHistory()
      duplicate.tabs = list
      duplicate.source = source
      console.log('[newtab][sessions] 覆盖标签集:', duplicate.name, '→', list.length, '个标签')
      return persist().then(renderCollections)
    }
    pushHistory()
    const now = Date.now()
    collections.unshift({
      id: 'c_' + now + '_' + Math.random().toString(36).slice(2, 6),
      source,
      name,
      createdAt: now,
      tabs: list,
    })
    console.log('[newtab][sessions] 新建标签集:', name, list.length, '个标签')
    return persist().then(renderCollections)
  }

  // ---- 右侧：Open Tabs（按窗口分组、可折叠、每组单独保存） ----
  function makeOpenTab(tab) {
    const url = tab.url || ''
    // 外层用 div + role=button，避免删除用的 <button> 嵌套在 <button> 内
    const row = NT.el('div', 'open-tab' + (isRestorable(url) ? '' : ' is-locked'))
    row.tabIndex = 0
    row.setAttribute('role', 'button')
    row.title = tab.title || url
    row.appendChild(NT.favicon(tab.favIconUrl, 'open-tab-favicon'))
    row.appendChild(NT.el('span', 'open-tab-title', tab.title || url || '未命名标签'))
    if (!isRestorable(url)) row.appendChild(NT.el('span', 'open-tab-lock', '不可保存'))

    const del = NT.el('button', 'open-tab-del', '×')
    del.type = 'button'
    del.title = '关闭此标签页'
    del.setAttribute('aria-label', '关闭 ' + (tab.title || url))
    del.addEventListener('click', (event) => {
      event.stopPropagation()
      if (tab.id === undefined || !chrome.tabs || !chrome.tabs.remove) return
      chrome.tabs.remove(tab.id, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.log('[newtab][sessions] 关闭标签失败:', chrome.runtime.lastError.message)
          return
        }
        console.log('[newtab][sessions] 已关闭标签:', tab.id)
        renderOpenTabs().catch((error) =>
          console.error('[newtab][sessions] 刷新 Open Tabs 失败:', error.message)
        )
      })
    })
    row.appendChild(del)

    row.addEventListener('click', () => {
      if (isRestorable(url)) NT.openInNewTab(url)
      else console.log('[newtab][sessions] 该地址不参与保存:', url)
    })
    row.addEventListener('keydown', (event) => {
      if (event.target !== row || (event.key !== 'Enter' && event.key !== ' ')) return
      event.preventDefault()
      row.click()
    })

    // 右侧真实标签拖拽：拖到别的窗口 = 跨窗口移动；拖到同窗口另一行 = 重新排序
    row.draggable = true
    row.addEventListener('dragstart', (event) => {
      startDrag(event, {
        kind: 'open-tab',
        tabId: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        // 带上完整条目，拖到左侧集合时无需再查 chrome.tabs
        entry: toEntry(tab),
      })
    })
    row.addEventListener('dragend', clearDragMarks)
    row.addEventListener('dragover', (event) => allowDrop(event, row, 'open-tab'))
    row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'))
    row.addEventListener('drop', (event) => {
      const payload = readDrag(event, 'open-tab')
      if (!payload) return
      event.preventDefault()
      event.stopPropagation()
      clearDragMarks()
      moveOpenTab(payload, tab.windowId, tab.index)
    })
    return row
  }

  function moveOpenTab(payload, targetWindowId, targetIndex) {
    if (payload.tabId === undefined || !chrome.tabs || !chrome.tabs.move) return
    if (payload.windowId === targetWindowId && payload.index === targetIndex) return
    // 跨窗口时 index 用 -1 追加到目标窗口末尾；同窗口则按目标行的位置排序
    const props =
      payload.windowId === targetWindowId
        ? { index: targetIndex }
        : { windowId: targetWindowId, index: -1 }
    chrome.tabs.move(payload.tabId, props, () => {
      if (chrome.runtime && chrome.runtime.lastError) {
        console.error('[newtab][sessions] 移动标签失败:', chrome.runtime.lastError.message)
        return
      }
      console.log('[newtab][sessions] 已移动标签:', payload.tabId, props)
      scheduleRefresh()
    })
  }

  function renderOpenTabs() {
    return Promise.all([
      NT.tabsQuery({}),
      NT.tabsQuery({ lastFocusedWindow: true }).catch(() => []),
    ]).then(([tabs, focused]) => {
      const box = document.getElementById('openTabsList')
      box.textContent = ''

      const currentWindowId = focused.length ? focused[0].windowId : null
      const groups = new Map()
      tabs.forEach((tab) => {
        if (!groups.has(tab.windowId)) groups.set(tab.windowId, [])
        groups.get(tab.windowId).push(tab)
      })

      // 当前窗口排最前，其余按 windowId 顺序
      const ids = Array.from(groups.keys()).sort((a, b) => {
        if (a === currentWindowId) return -1
        if (b === currentWindowId) return 1
        return a - b
      })

      let windowNo = 0
      ids.forEach((windowId) => {
        const list = groups.get(windowId)
        windowNo += 1
        const isCurrent = windowId === currentWindowId
        const label = isCurrent ? 'This window' : 'Window ' + windowNo
        // 集合名：年月日 时分（当前窗口）/（窗口 N）
        const nameSuffix = isCurrent ? '（当前窗口）' : '（窗口 ' + windowNo + '）'
        const collapsed = collapsedWindows.has(windowId)
        const section = NT.el('section', 'open-window' + (collapsed ? ' is-collapsed' : ''))

        // 组标题：点击展开 / 折叠
        const head = NT.el('button', 'open-window-head')
        head.type = 'button'
        head.title = collapsed ? '展开' : '折叠'
        head.setAttribute('aria-expanded', String(!collapsed))
        head.appendChild(NT.el('span', 'open-window-title', label))
        const caret = NT.el('span', 'open-window-caret')
        caret.innerHTML = CARET_ICON
        head.appendChild(caret)
        head.addEventListener('click', () => {
          if (collapsedWindows.has(windowId)) collapsedWindows.delete(windowId)
          else collapsedWindows.add(windowId)
          renderOpenTabs()
        })
        section.appendChild(head)

        // 标题下方：数量 + 保存该窗口的按钮
        const meta = NT.el('div', 'open-window-meta')
        meta.appendChild(NT.el('span', 'open-window-count', list.length + ' tabs'))
        const save = NT.el('button', 'window-save', '保存窗口标签')
        save.type = 'button'
        save.title = '把 ' + label + ' 的标签保存到左侧（已保存则更新）'
        save.addEventListener('click', () => {
          saveWindowTabs(windowId, nameSuffix).catch((error) =>
            console.error('[newtab][sessions] 保存窗口失败:', error.message)
          )
        })
        meta.appendChild(save)
        section.appendChild(meta)

        if (!collapsed) {
          const listBox = NT.el('div', 'open-window-tabs')
          list.forEach((tab) => listBox.appendChild(makeOpenTab(tab)))
          section.appendChild(listBox)
        }

        // 拖到分组标题 / 空白处 = 追加到该窗口末尾；跨窗口时形成窗口间移动
        section.addEventListener('dragover', (event) => allowDrop(event, section, 'open-tab'))
        section.addEventListener('dragleave', () => section.classList.remove('is-drop-target'))
        section.addEventListener('drop', (event) => {
          const payload = readDrag(event, 'open-tab')
          if (!payload) return
          event.preventDefault()
          clearDragMarks()
          moveOpenTab(payload, windowId, -1)
        })
        box.appendChild(section)
      })

      document.getElementById('openTabsSummary').textContent =
        ids.length + ' windows · ' + tabs.length + ' tabs'
      console.log('[newtab][sessions] Open Tabs:', tabs.length, '个标签')
      return tabs
    })
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      renderOpenTabs().catch((error) =>
        console.error('[newtab][sessions] 刷新 Open Tabs 失败:', error.message)
      )
    }, 150)
  }

  function saveWindowTabs(windowId, nameSuffix) {
    return NT.tabsQuery({ windowId }).then((tabs) => {
      const list = tabs.filter((tab) => isRestorable(tab.url)).map(toEntry)
      if (!list.length) {
        console.log('[newtab][sessions] 该窗口没有可保存的标签:', windowId)
        return
      }
      return saveCollection(
        windowSource(windowId),
        NT.formatStamp(Date.now()) + (nameSuffix || ''),
        list
      )
    })
  }

  // 刷新按钮：重新读取来源窗口（或全部窗口）当前打开的标签，覆盖这个集合
  function flashButton(button, text) {
    const originalHTML = button.innerHTML
    const originalClass = button.className
    button.className = 'mini-btn'
    button.textContent = text
    button.disabled = true
    setTimeout(() => {
      button.className = originalClass
      button.innerHTML = originalHTML
      button.disabled = false
    }, 1800)
  }

  function refreshCollection(collection, button) {
    const source = collection.source || ''
    const fromWindow = source.indexOf('window:') === 0
    const query = fromWindow ? { windowId: Number(source.slice(7)) } : {}
    return NT.tabsQuery(query).then((tabs) => {
      if (fromWindow && !tabs.length) {
        flashButton(button, '窗口已关闭')
        console.log('[newtab][sessions] 来源窗口已关闭，集合未改动:', collection.name)
        return
      }
      const list = tabs.filter((tab) => isRestorable(tab.url)).map(toEntry)
      if (!list.length) {
        flashButton(button, '无可保存标签')
        console.log('[newtab][sessions] 没有可刷新的标签:', collection.name)
        return
      }
      pushHistory()
      collection.tabs = list
      return persist().then(() => {
        renderCollections()
        console.log('[newtab][sessions] 刷新集合:', collection.name, '→', list.length, '个标签')
      })
    })
  }

  // ---- 左侧：已保存的标签集 ----
  function makeTabCard(collection, tab, index) {
    const card = NT.el('div', 'tab-card')
    card.tabIndex = 0
    // favicon 与标题同一行，一起放进 .tab-card-title
    const title = NT.el('div', 'tab-card-title')
    title.appendChild(NT.favicon(tab.favIconUrl, 'tab-card-favicon'))
    title.appendChild(NT.el('span', 'tab-card-title-text', tab.title || tab.url))
    card.appendChild(title)
    const info = NT.badge(tab.title, tab.url)
    card.appendChild(NT.el('div', 'tab-card-host', info.host))

    const del = NT.el('button', 'tab-card-del', '×')
    del.type = 'button'
    del.title = '从集合中移除'
    del.setAttribute('aria-label', '移除 ' + (tab.title || tab.url))
    del.addEventListener('click', (event) => {
      event.stopPropagation()
      pushHistory()
      collection.tabs.splice(index, 1)
      persist().then(() => {
        renderCollections()
        console.log('[newtab][sessions] 移除标签:', tab.url)
      })
    })
    card.appendChild(del)

    const edit = NT.el('button', 'tab-card-edit')
    edit.type = 'button'
    edit.title = '编辑名称与网址'
    edit.setAttribute('aria-label', '编辑 ' + (tab.title || tab.url))
    edit.innerHTML = PENCIL_ICON
    edit.addEventListener('click', (event) => {
      event.stopPropagation()
      openTabEditor(collection, tab)
    })
    card.appendChild(edit)

    function open() {
      if (isRestorable(tab.url)) NT.openInNewTab(tab.url)
    }
    card.addEventListener('click', open)
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        open()
      }
    })

    // 左侧集合卡片拖拽：同集合内排序，或拖到另一个集合里
    card.draggable = true
    card.addEventListener('dragstart', (event) => {
      startDrag(event, { kind: 'saved-tab', collectionId: collection.id, index })
    })
    card.addEventListener('dragend', clearDragMarks)
    card.addEventListener('dragover', (event) => allowDrop(event, card, COLLECTION_DROPS))
    card.addEventListener('dragleave', () => card.classList.remove('is-drop-target'))
    card.addEventListener('drop', (event) => {
      const payload = readDrag(event, COLLECTION_DROPS)
      if (!payload) return
      event.preventDefault()
      // open-tab 交给 section 冒泡处理（追加到集合末尾），这里只处理集合内卡片排序
      if (payload.kind !== 'saved-tab') return
      event.stopPropagation()
      clearDragMarks()
      moveSavedTab(payload, collection, index)
    })
    return card
  }

  function moveSavedTab(payload, targetCollection, targetIndex) {
    const from = collections.find((item) => item.id === payload.collectionId)
    if (!from || !from.tabs[payload.index]) return
    pushHistory()
    const [moved] = from.tabs.splice(payload.index, 1)
    let at = targetIndex
    // 同集合内向前拖动时，源位置移除后目标下标要左移一位
    if (from === targetCollection && payload.index < targetIndex) at -= 1
    at = Math.max(0, Math.min(at, targetCollection.tabs.length))
    targetCollection.tabs.splice(at, 0, moved)
    console.log(
      '[newtab][sessions] 移动标签:',
      moved.url,
      from === targetCollection ? '同集合排序' : '跨集合',
      '→ 位置', at
    )
    persist().then(renderCollections)
  }

  // 右侧 Open Tabs 拖进集合：只追加，不移动 / 关闭真实标签页；同 URL 已存在则什么都不做
  function addOpenTabToCollection(entry, collection) {
    if (!entry || !isRestorable(entry.url)) {
      console.log('[newtab][sessions] 该标签不可加入集合:', entry && entry.url)
      return Promise.resolve()
    }
    if (collection.tabs.some((tab) => tab.url === entry.url)) {
      console.log('[newtab][sessions] 集合中已存在，本次不添加:', entry.url)
      return Promise.resolve()
    }
    pushHistory()
    collection.tabs.push(entry)
    console.log('[newtab][sessions] Open Tabs 加入集合:', collection.name, '←', entry.url)
    return persist().then(renderCollections)
  }

  // ---- 编辑集合内单个标签卡片（名称 + 网址） ----
  // 持有对象引用而非下标：拖拽排序不会让编辑目标错位；被删除 / 被撤销时直接拒绝保存
  function openTabEditor(collection, tab) {
    const nameInput = document.getElementById('tabEditName')
    const urlInput = document.getElementById('tabEditUrl')
    const error = document.getElementById('tabEditError')
    const modal = document.getElementById('tabEditModal')
    if (!nameInput || !urlInput || !error || !modal) return
    editContext = { collection, tab }
    nameInput.value = tab.title || ''
    urlInput.value = tab.url || ''
    error.textContent = ''
    error.hidden = true
    modal.hidden = false
    setTimeout(() => nameInput.focus(), 0)
    console.log('[newtab][sessions] 打开标签编辑器:', tab.url)
  }

  function closeTabEditor() {
    editContext = null
    const modal = document.getElementById('tabEditModal')
    if (modal) modal.hidden = true
  }

  function submitTabEditor() {
    if (!editContext) return
    const { collection, tab } = editContext
    if (collection.tabs.indexOf(tab) === -1) {
      console.log('[newtab][sessions] 编辑目标已不存在，取消保存')
      closeTabEditor()
      return
    }
    const urlInput = document.getElementById('tabEditUrl')
    const error = document.getElementById('tabEditError')
    // textarea 允许换行，但 URL 不应含空白：统一去掉，避免把 \n 存进标签集
    const url = urlInput.value.replace(/\s+/g, '')
    if (!isRestorable(url)) {
      error.textContent = '网址需以 http://、https:// 或 file:// 开头'
      error.hidden = false
      urlInput.focus()
      return
    }
    const title = document.getElementById('tabEditName').value.trim() || url
    pushHistory()
    tab.title = title
    tab.url = url
    closeTabEditor()
    persist().then(() => {
      renderCollections()
      console.log('[newtab][sessions] 编辑标签:', title, url)
    })
  }

  function bindTabEditor() {
    const modal = document.getElementById('tabEditModal')
    if (!modal) return
    document.getElementById('tabEditClose').addEventListener('click', closeTabEditor)
    document.getElementById('tabEditCancel').addEventListener('click', closeTabEditor)
    document.getElementById('tabEditSave').addEventListener('click', submitTabEditor)
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeTabEditor()
    })
    ;['tabEditName', 'tabEditUrl'].forEach((id) => {
      document.getElementById(id).addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          submitTabEditor()
        }
      })
    })
  }

  function makeHead(collection) {
    const head = NT.el('div', 'collection-head')
    const collapsed = collapsedCollections.has(collection.id)

    if (editingId === collection.id) {
      const input = NT.el('input', 'collection-input')
      input.type = 'text'
      input.value = collection.name
      input.setAttribute('aria-label', '集合名称')
      head.appendChild(input)

      const cancel = NT.el('button', 'mini-btn', 'Cancel')
      cancel.type = 'button'
      cancel.addEventListener('click', () => {
        editingId = null
        renderCollections()
      })
      head.appendChild(cancel)

      const save = NT.el('button', 'mini-btn mini-btn--primary', 'Save')
      save.type = 'button'
      save.addEventListener('click', () => {
        const name = input.value.trim()
        if (name && name !== collection.name) {
          pushHistory()
          collection.name = name
        }
        editingId = null
        persist().then(() => {
          renderCollections()
          console.log('[newtab][sessions] 重命名集合:', name)
        })
      })
      head.appendChild(save)
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') save.click()
        if (event.key === 'Escape') cancel.click()
      })
      setTimeout(() => input.focus(), 0)
      return head
    }

    const toggle = NT.el('button', 'collection-title', collection.name)
    toggle.type = 'button'
    toggle.title = collapsed ? '展开' : '折叠'
    toggle.setAttribute('aria-expanded', String(!collapsed))
    const caret = NT.el('span', 'collection-caret')
    caret.innerHTML = CARET_ICON
    toggle.appendChild(caret)
    toggle.addEventListener('click', () => {
      if (collapsedCollections.has(collection.id)) collapsedCollections.delete(collection.id)
      else collapsedCollections.add(collection.id)
      renderCollections()
    })
    head.appendChild(toggle)

    const pencil = NT.el('button', 'icon-btn')
    pencil.type = 'button'
    pencil.title = '重命名'
    pencil.innerHTML = PENCIL_ICON
    pencil.addEventListener('click', () => {
      editingId = collection.id
      renderCollections()
    })
    head.appendChild(pencil)

    head.appendChild(NT.el('span', 'collection-count', collection.tabs.length + ' tabs'))
    head.appendChild(NT.el('span', 'collection-time', NT.formatTime(collection.createdAt)))

    head.appendChild(NT.el('span', 'collection-spacer'))

    const refresh = NT.el('button', 'icon-btn')
    refresh.type = 'button'
    refresh.setAttribute('aria-label', '刷新')
    refresh.innerHTML = REFRESH_ICON
    refresh.title =
      collection.source && collection.source.indexOf('window:') === 0
        ? '重新读取该窗口当前打开的标签，覆盖这个集合'
        : '重新读取当前所有可保存的标签，覆盖这个集合'
    refresh.addEventListener('click', () => {
      askConfirm(
        refresh,
        '刷新「' + collection.name + '」会用窗口当前标签覆盖已保存的 ' + collection.tabs.length + ' 个标签，是否继续？',
        () => {
          refreshCollection(collection, refresh).catch((error) =>
            console.error('[newtab][sessions] 刷新集合失败:', error.message)
          )
        }
      )
    })
    head.appendChild(refresh)

    const restore = NT.el('button', 'mini-btn', '恢复全部')
    restore.type = 'button'
    restore.addEventListener('click', () => {
      askConfirm(
        restore,
        '在新窗口恢复「' + collection.name + '」的 ' + collection.tabs.length + ' 个标签，是否继续？',
        () => restoreAll(collection)
      )
    })
    head.appendChild(restore)

    const del = NT.el('button', 'mini-btn mini-btn--danger', '删除')
    del.type = 'button'
    del.addEventListener('click', () => {
      askConfirm(
        del,
        '删除集合「' + collection.name + '」（' + collection.tabs.length + ' 个标签）？可用 Ctrl+Z 撤销。',
        () => {
          pushHistory()
          collections = collections.filter((item) => item.id !== collection.id)
          collapsedCollections.delete(collection.id)
          persist().then(() => {
            renderCollections()
            console.log('[newtab][sessions] 删除集合:', collection.name)
          })
        },
        true
      )
    })
    head.appendChild(del)
    return head
  }

  function restoreAll(collection) {
    const urls = collection.tabs.filter((tab) => isRestorable(tab.url)).map((tab) => tab.url)
    if (!urls.length) return
    // 一次调用新建独立窗口，url 数组按顺序成为该窗口的标签；当前窗口不受影响
    if (chrome.windows && chrome.windows.create) {
      chrome.windows.create({ url: urls }, (win) => {
        const error = chrome.runtime && chrome.runtime.lastError
        if (error) {
          console.error('[newtab][sessions] 新窗口恢复失败，回退逐个新开:', error.message)
          urls.forEach((url) => NT.openInNewTab(url))
          return
        }
        console.log('[newtab][sessions] 新窗口恢复集合:', collection.name, urls.length, '个标签, windowId:', win && win.id)
      })
      return
    }
    urls.forEach((url) => NT.openInNewTab(url))
    console.log('[newtab][sessions] chrome.windows 不可用，逐个恢复集合:', collection.name, urls.length, '个标签')
  }

  function renderCollections() {
    // 重渲染会换掉 anchor 节点，先收起气泡避免悬空
    closeConfirm()
    const box = document.getElementById('collectionsList')
    box.textContent = ''

    const total = collections.reduce((sum, item) => sum + item.tabs.length, 0)
    document.getElementById('collectionsSummary').textContent =
      collections.length + ' collections · ' + total + ' tabs'

    if (!collections.length) {
      box.appendChild(
        NT.el('div', 'collections-empty', '还没有保存的标签集。点右侧窗口下方的「保存窗口标签」。')
      )
      return
    }

    collections.forEach((collection) => {
      const section = NT.el('section', 'collection')
      section.appendChild(makeHead(collection))
      // 折叠时只保留标题行，整个 section 仍要挂到 DOM 上
      if (!collapsedCollections.has(collection.id)) {
        const grid = NT.el('div', 'collection-grid')
        collection.tabs.forEach((tab, index) =>
          grid.appendChild(makeTabCard(collection, tab, index))
        )
        if (!collection.tabs.length) grid.appendChild(NT.el('div', 'collection-empty', '该集合没有标签'))
        section.appendChild(grid)
      }
      // 集合空白处 / 折叠状态的整行也能接收：
      // saved-tab 追加到末尾；open-tab 去重后加入集合
      section.addEventListener('dragover', (event) => allowDrop(event, section, COLLECTION_DROPS))
      section.addEventListener('dragleave', () => section.classList.remove('is-drop-target'))
      section.addEventListener('drop', (event) => {
        const payload = readDrag(event, COLLECTION_DROPS)
        if (!payload) return
        event.preventDefault()
        clearDragMarks()
        if (payload.kind === 'open-tab') addOpenTabToCollection(payload.entry, collection)
        else moveSavedTab(payload, collection, collection.tabs.length)
      })
      box.appendChild(section)
    })
  }

  function init() {
    document.getElementById('refreshTabsBtn').addEventListener('click', scheduleRefresh)
    bindTabEditor()
    bindKeydown()
    bindConfirmDismiss()

    ;['onCreated', 'onRemoved', 'onUpdated', 'onMoved'].forEach((name) => {
      if (chrome.tabs[name]) chrome.tabs[name].addListener(scheduleRefresh)
    })

    loadCollections()
      .then(renderCollections)
      .then(renderOpenTabs)
      .catch((error) => console.error('[newtab][sessions] 初始化失败:', error.message))

    console.log('[newtab][sessions] 已初始化')
  }

  NT.sessions = {
    init,
    renderCollections,
    renderOpenTabs,
    saveWindowTabs,
    refreshCollection,
    saveCollection,
    moveSavedTab,
    moveOpenTab,
    addOpenTabToCollection,
    undo,
    redo,
    pushHistory,
    openTabEditor,
    closeTabEditor,
    submitTabEditor,
    askConfirm,
    closeConfirm,
    get confirmOpen() { return !!confirmPop && !confirmPop.hidden },
    get collections() { return collections },
    get undoDepth() { return undoStack.length },
    get redoDepth() { return redoStack.length },
  }
})(window.NT)
