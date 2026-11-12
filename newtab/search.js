// 新标签页 · 搜索框与搜索引擎选择
// 默认只显示搜索框；点击左侧引擎图标展开面板；面板第一项固定为「添加」。

;(function (NT) {
  'use strict'

  const E = NT.engines

  const ADD_ICON =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
    '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'

  const CLOSE_ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
    '<path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'

  function markNode(name, url, extraClass) {
    const info = NT.badge(name, url)
    const node = NT.el('span', 'mark tone-' + info.tone + (extraClass ? ' ' + extraClass : ''), info.letter)
    return node
  }

  function buildUrl(engine, keyword) {
    const url = engine.url.split('%s').join(encodeURIComponent(keyword))
    if (!/^https?:\/\//i.test(url)) throw new Error('搜索引擎地址必须以 http(s) 开头')
    return url
  }

  // ---- 面板：第一项永远是「添加」，后面是已启用的引擎 ----
  function renderPanel() {
    const row = document.getElementById('enginePanelRow')
    row.textContent = ''

    const add = NT.el('button', 'engine-chip engine-chip--add')
    add.type = 'button'
    add.title = '添加搜索引擎'
    const addMark = NT.el('span', 'engine-chip-mark engine-chip-mark--add')
    addMark.innerHTML = ADD_ICON
    add.appendChild(addMark)
    add.appendChild(NT.el('span', 'engine-chip-name', '添加'))
    add.addEventListener('click', (event) => {
      event.stopPropagation()
      closePanel()
      openModal()
    })
    row.appendChild(add)

    E.enabledList().forEach((engine) => {
      const chip = NT.el('button', 'engine-chip' + (engine.id === E.active().id ? ' is-active' : ''))
      chip.type = 'button'
      chip.title = engine.name
      chip.appendChild(markNode(engine.name, engine.url, 'engine-chip-mark'))
      chip.appendChild(NT.el('span', 'engine-chip-name', engine.name))
      chip.addEventListener('click', (event) => {
        event.stopPropagation()
        E.setActive(engine.id).then(renderTrigger)
        closePanel()
      })
      row.appendChild(chip)
    })
  }

  function openPanel() {
    renderPanel()
    document.getElementById('enginePanel').hidden = false
    document.getElementById('engineTrigger').setAttribute('aria-expanded', 'true')
  }

  function closePanel() {
    document.getElementById('enginePanel').hidden = true
    document.getElementById('engineTrigger').setAttribute('aria-expanded', 'false')
  }

  function togglePanel() {
    const panel = document.getElementById('enginePanel')
    if (panel.hidden) openPanel()
    else closePanel()
  }

  // ---- 添加弹窗 ----
  function renderGrid() {
    const grid = document.getElementById('engineGrid')
    grid.textContent = ''
    const enabled = E.state.enabled

    document.getElementById('engineModalSub').textContent =
      '最多添加' + E.MAX + '种，已添加' + enabled.length + '种'

    E.all().forEach((engine) => {
      const on = enabled.indexOf(engine.id) !== -1
      const card = NT.el('div', 'engine-option' + (on ? ' is-on' : ''))
      card.appendChild(markNode(engine.name, engine.url, 'engine-option-mark'))

      const meta = NT.el('div', 'engine-option-meta')
      meta.appendChild(NT.el('div', 'engine-option-name', engine.name))
      meta.appendChild(NT.el('div', 'engine-option-url', engine.url))
      card.appendChild(meta)

      const radio = NT.el('span', 'engine-radio')
      radio.setAttribute('aria-label', (on ? '取消添加 ' : '添加 ') + engine.name)
      card.appendChild(radio)

      card.addEventListener('click', () => {
        E.setEnabled(engine.id, !on).then((ok) => {
          if (!ok) {
            showCustomError(
              on ? '至少保留 1 个搜索引擎' : '最多只能添加 ' + E.MAX + ' 种，请先取消一个'
            )
            return
          }
          clearCustomError()
          renderGrid()
          renderTrigger()
        })
      })
      grid.appendChild(card)
    })
  }

  function openModal() {
    renderGrid()
    clearCustomError()
    document.getElementById('customEngineUrl').value = ''
    document.getElementById('engineModal').hidden = false
    console.log('[newtab][search] 打开添加搜索引擎弹窗')
  }

  function closeModal() {
    document.getElementById('engineModal').hidden = true
  }

  function showCustomError(message) {
    const box = document.getElementById('customEngineError')
    box.textContent = message
    box.hidden = false
  }

  function clearCustomError() {
    const box = document.getElementById('customEngineError')
    box.textContent = ''
    box.hidden = true
  }

  function onCustomSubmit(event) {
    event.preventDefault()
    const input = document.getElementById('customEngineUrl')
    E.addCustom(input.value)
      .then((engine) => {
        input.value = ''
        clearCustomError()
        renderGrid()
        renderTrigger()
        console.log('[newtab][search] 自定义引擎已启用:', engine.name)
      })
      .catch((error) => showCustomError(error.message))
  }

  function renderTrigger() {
    const engine = E.active()
    const holder = document.getElementById('engineTriggerMark')
    holder.textContent = ''
    holder.appendChild(markNode(engine.name, engine.url))
    document.getElementById('engineTrigger').title = '当前：' + engine.name + '（点击切换）'
    document.getElementById('searchInput').placeholder = '在 ' + engine.name + ' 中搜索'
  }

  function onSubmit(event) {
    event.preventDefault()
    const input = document.getElementById('searchInput')
    const keyword = (input.value || '').trim()
    if (!keyword) return input.focus()

    let url
    try {
      url = buildUrl(E.active(), keyword)
    } catch (error) {
      console.error('[newtab][search] 搜索地址不合法:', error.message)
      return
    }
    closePanel()
    console.log('[newtab][search] 搜索:', E.active().name, keyword)
    NT.openInNewTab(url)
  }

  function init() {
    document.getElementById('searchForm').addEventListener('submit', onSubmit)
    document.getElementById('engineTrigger').addEventListener('click', (event) => {
      event.stopPropagation()
      togglePanel()
    })
    document.getElementById('customEngineForm').addEventListener('submit', onCustomSubmit)
    document.getElementById('engineModalClose').addEventListener('click', closeModal)
    document.getElementById('engineModal').addEventListener('click', (event) => {
      if (event.target.id === 'engineModal') closeModal()
    })
    document.addEventListener('click', (event) => {
      const panel = document.getElementById('enginePanel')
      if (panel.hidden) return
      if (panel.contains(event.target) || document.getElementById('engineTrigger').contains(event.target)) return
      closePanel()
    })
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      if (!document.getElementById('engineModal').hidden) return closeModal()
      if (!document.getElementById('enginePanel').hidden) closePanel()
    })

    E.subscribe(renderTrigger)
    renderTrigger()
    console.log('[newtab][search] 已初始化')
  }

  NT.search = { init, renderTrigger }
})(window.NT)
