// 新标签页 · 右上角工具集合（Google Apps 风格）
// 自初始化模块，只追加在末尾不插队；依赖 common.js 的 NT.el / NT.badge / NT.storageGet / NT.storageSet / NT.openInNewTab。
// 数据：chrome.storage.local 独立 key `nt_apps`，不复用、不修改既有 key。
// 内置 Gmail / iTab 固定不可删；自定义应用可添加、可删除。

;(function (NT) {
  'use strict'

  const KEY = 'nt_apps'
  const BUILTIN = [
    { id: 'builtin-gmail', name: 'Gmail', url: 'https://mail.google.com/', builtin: true },
    { id: 'builtin-itab', name: 'iTab', url: 'https://go.itab.link/', builtin: true },
  ]

  let custom = []

  function hasStorage() {
    return (
      typeof chrome !== 'undefined' &&
      !!chrome.storage &&
      !!chrome.storage.local &&
      typeof NT.storageGet === 'function' &&
      typeof NT.storageSet === 'function'
    )
  }

  function load() {
    if (!hasStorage()) return Promise.resolve()
    return NT.storageGet([KEY])
      .then((data) => {
        custom = Array.isArray(data[KEY]) ? data[KEY] : []
        console.log('[newtab][apps] 已加载自定义应用:', custom.length)
      })
      .catch((error) => console.warn('[newtab][apps] 读取失败:', error.message))
  }

  function persist() {
    if (!hasStorage()) return Promise.resolve()
    return NT.storageSet({ [KEY]: custom })
  }

  function allApps() {
    return BUILTIN.concat(custom)
  }

  function makeTile(app) {
    // 外层用 div + role=button，避免删除用的 <button> 嵌套在 <button> 内
    const tile = NT.el('div', 'app-tile')
    tile.tabIndex = 0
    tile.setAttribute('role', 'button')
    tile.title = app.name + ' · ' + app.url

    const badge = NT.badge(app.name, app.url)
    const icon = NT.el('span', 'app-tile-icon tone-' + badge.tone, badge.letter)
    tile.appendChild(icon)
    tile.appendChild(NT.el('span', 'app-tile-name', app.name))

    // 自定义项右上角删除按钮；内置项不提供删除
    if (!app.builtin) {
      const del = NT.el('button', 'app-tile-del', '×')
      del.type = 'button'
      del.title = '移除 ' + app.name
      del.setAttribute('aria-label', '移除 ' + app.name)
      del.addEventListener('click', (event) => {
        event.stopPropagation()
        custom = custom.filter((item) => item.id !== app.id)
        persist()
          .then(render)
          .then(() => console.log('[newtab][apps] 已移除应用:', app.name))
          .catch((error) => console.error('[newtab][apps] 移除失败:', error.message))
      })
      tile.appendChild(del)
    }

    function open() {
      NT.openInNewTab(app.url)
      closePanel()
    }
    tile.addEventListener('click', open)
    tile.addEventListener('keydown', (event) => {
      if (event.target !== tile || (event.key !== 'Enter' && event.key !== ' ')) return
      event.preventDefault()
      open()
    })
    return tile
  }

  function makeAddTile() {
    const tile = NT.el('button', 'app-tile app-tile--add')
    tile.type = 'button'
    tile.title = '添加应用'
    tile.setAttribute('aria-label', '添加应用')
    const plus = NT.el('span', 'app-tile-plus', '+')
    tile.appendChild(plus)
    tile.appendChild(NT.el('span', 'app-tile-name', '添加'))
    tile.addEventListener('click', () => {
      closePanel()
      openModal()
    })
    return tile
  }

  function render() {
    const grid = document.getElementById('appsGrid')
    if (!grid) return
    grid.textContent = ''
    // 固定第一个坑位：添加应用
    grid.appendChild(makeAddTile())
    allApps().forEach((app) => grid.appendChild(makeTile(app)))
    console.log('[newtab][apps] 渲染应用:', allApps().length, '个（含 2 个内置）')
  }

  function openPanel() {
    render()
    const panel = document.getElementById('appsPanel')
    const trigger = document.getElementById('appsTrigger')
    if (!panel || !trigger) return
    panel.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
    console.log('[newtab][apps] 展开工具集合')
  }

  function closePanel() {
    const panel = document.getElementById('appsPanel')
    const trigger = document.getElementById('appsTrigger')
    if (!panel || !trigger) return
    panel.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
  }

  function togglePanel() {
    const panel = document.getElementById('appsPanel')
    if (panel && panel.hidden) openPanel()
    else closePanel()
  }

  // ---- 添加弹窗 ----
  function openModal() {
    const modal = document.getElementById('appModal')
    if (!modal) return
    document.getElementById('appName').value = ''
    document.getElementById('appUrl').value = ''
    const error = document.getElementById('appError')
    error.textContent = ''
    error.hidden = true
    modal.hidden = false
    setTimeout(() => {
      const input = document.getElementById('appName')
      if (input) input.focus()
    }, 0)
    console.log('[newtab][apps] 打开添加应用弹窗')
  }

  function closeModal() {
    const modal = document.getElementById('appModal')
    if (modal) modal.hidden = true
  }

  function submit() {
    const nameInput = document.getElementById('appName')
    const urlInput = document.getElementById('appUrl')
    const error = document.getElementById('appError')
    if (!nameInput || !urlInput || !error) return

    const name = nameInput.value.trim()
    const url = urlInput.value.trim()
    if (!name) {
      error.textContent = '请输入应用名称'
      error.hidden = false
      nameInput.focus()
      return
    }
    if (!/^https?:\/\//i.test(url)) {
      error.textContent = '网址需以 http:// 或 https:// 开头'
      error.hidden = false
      urlInput.focus()
      return
    }

    const now = Date.now()
    custom.unshift({
      id: 'a_' + now + '_' + Math.random().toString(36).slice(2, 6),
      name,
      url,
      createdAt: now,
    })
    closeModal()
    persist()
      .then(render)
      .then(() => console.log('[newtab][apps] 已添加应用:', name, url))
      .catch((err) => console.error('[newtab][apps] 保存失败:', err.message))
  }

  function bind() {
    const trigger = document.getElementById('appsTrigger')
    if (trigger) trigger.addEventListener('click', (event) => {
      event.stopPropagation()
      togglePanel()
    })

    const panel = document.getElementById('appsPanel')
    if (panel) panel.addEventListener('click', (event) => event.stopPropagation())

    // 点击面板与按钮之外的地方收起
    document.addEventListener('click', (event) => {
      const target = event.target
      if (panel && !panel.hidden) {
        if ((trigger && trigger.contains(target)) || (panel && panel.contains(target))) return
        closePanel()
      }
    })

    const modalClose = document.getElementById('appModalClose')
    const cancel = document.getElementById('appCancel')
    const save = document.getElementById('appSave')
    const modal = document.getElementById('appModal')
    if (modalClose) modalClose.addEventListener('click', closeModal)
    if (cancel) cancel.addEventListener('click', closeModal)
    if (save) save.addEventListener('click', submit)
    if (modal) modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal()
    })
    ;['appName', 'appUrl'].forEach((id) => {
      const input = document.getElementById(id)
      if (input) input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          submit()
        }
        if (event.key === 'Escape') closeModal()
      })
    })
    document.addEventListener('keydown', (event) => {
      const m = document.getElementById('appModal')
      if (event.key === 'Escape' && m && !m.hidden) {
        closeModal()
        return
      }
      if (event.key === 'Escape') closePanel()
    })
  }

  function init() {
    bind()
    load().then(render)
    console.log('[newtab][apps] 已初始化')
  }

  NT.apps = { init, openPanel, closePanel, openModal, render, get apps() { return allApps() } }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})(window.NT)
