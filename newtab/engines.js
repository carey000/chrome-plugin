// 新标签页 · 搜索引擎配置
// MV3 扩展页的多个 <script> 共享同一个全局作用域，统一挂到 window.NT，避免同名符号覆盖。
// 配置存 chrome.storage.local；URL 模板里的 %s 会被 encodeURIComponent(关键词) 替换。

;(function (NT) {
  'use strict'

  const MAX = 8
  const KEY_ENABLED = 'nt_engine_enabled'
  const KEY_ACTIVE = 'nt_engine_active'
  const KEY_CUSTOM = 'nt_engine_custom'

  // 内置可选引擎。图标不发远程请求，用域名 hash 生成色块 + 名称首字。
  const PRESETS = [
    { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=%s' },
    { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s' },
    { id: 'github', name: 'GitHub', url: 'https://github.com/search?q=%s' },
    { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
    { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
    { id: 'mdn', name: 'MDN', url: 'https://developer.mozilla.org/zh-CN/search?q=%s' },
    { id: 'stackoverflow', name: 'StackOverflow', url: 'https://stackoverflow.com/search?q=%s' },
    { id: 'zhihu', name: '知乎', url: 'https://www.zhihu.com/search?type=content&q=%s' },
    { id: 'bilibili', name: '哔哩哔哩', url: 'https://search.bilibili.com/all?keyword=%s' },
    { id: 'weibo', name: '微博', url: 'https://s.weibo.com/weibo?q=%s' },
    { id: 'douban', name: '豆瓣', url: 'https://www.douban.com/search?q=%s' },
    { id: 'jd', name: '京东', url: 'https://search.jd.com/Search?keyword=%s' },
    { id: 'taobao', name: '淘宝', url: 'https://s.taobao.com/search?q=%s' },
    { id: 'naver', name: 'Naver', url: 'https://search.naver.com/search.naver?query=%s' },
    { id: 'toutiao', name: '头条搜索', url: 'https://so.toutiao.com/search?keyword=%s' },
  ]

  // 首次运行时默认启用 4 个（对应参考图「已添加4种」）
  const DEFAULT_ENABLED = ['baidu', 'google', 'github', 'bing']

  const state = {
    enabled: DEFAULT_ENABLED.slice(),
    active: 'baidu',
    custom: [],
  }

  const listeners = []

  function emit() {
    listeners.forEach((fn) => fn())
  }

  function all() {
    return PRESETS.concat(state.custom)
  }

  function byId(id) {
    return all().find((item) => item.id === id) || null
  }

  function enabledList() {
    return state.enabled.map(byId).filter(Boolean)
  }

  function active() {
    return byId(state.active) || enabledList()[0] || PRESETS[0]
  }

  function persist() {
    return NT.storageSet({
      [KEY_ENABLED]: state.enabled,
      [KEY_ACTIVE]: state.active,
      [KEY_CUSTOM]: state.custom,
    })
  }

  function load() {
    return NT.storageGet([KEY_ENABLED, KEY_ACTIVE, KEY_CUSTOM]).then((data) => {
      if (Array.isArray(data[KEY_CUSTOM])) state.custom = data[KEY_CUSTOM]
      if (Array.isArray(data[KEY_ENABLED]) && data[KEY_ENABLED].length) {
        state.enabled = data[KEY_ENABLED].slice(0, MAX)
      }
      state.active = data[KEY_ACTIVE] || state.enabled[0] || 'baidu'

      // 清理已失效的 id（比如自定义引擎被删过），至少保留 1 个
      state.enabled = state.enabled.filter(byId).slice(0, MAX)
      if (!state.enabled.length) state.enabled = DEFAULT_ENABLED.slice()
      if (state.enabled.indexOf(state.active) === -1) state.active = state.enabled[0]

      console.log('[newtab][engines] 已启用:', state.enabled.join(','), '当前:', state.active)
      emit()
      return state
    })
  }

  function setEnabled(id, on) {
    if (!byId(id)) return Promise.resolve(false)
    if (on) {
      if (state.enabled.indexOf(id) !== -1) return Promise.resolve(true)
      if (state.enabled.length >= MAX) return Promise.resolve(false)
      state.enabled.push(id)
    } else {
      if (state.enabled.length === 1) return Promise.resolve(false)
      state.enabled = state.enabled.filter((item) => item !== id)
      if (state.active === id) state.active = state.enabled[0]
    }
    return persist().then(() => {
      emit()
      return true
    })
  }

  function setActive(id) {
    if (!byId(id)) return Promise.resolve(false)
    if (state.enabled.indexOf(id) === -1) {
      if (state.enabled.length >= MAX) return Promise.resolve(false)
      state.enabled.push(id)
    }
    state.active = id
    console.log('[newtab][engines] 切换搜索引擎:', id)
    return persist().then(() => {
      emit()
      return true
    })
  }

  function addCustom(raw) {
    const url = (raw || '').trim()
    if (!/^https?:\/\//i.test(url)) {
      return Promise.reject(new Error('地址必须以 http:// 或 https:// 开头'))
    }
    if (url.indexOf('%s') === -1) {
      return Promise.reject(new Error('地址里必须包含 %s 作为关键词占位符'))
    }
    let host = ''
    try {
      host = new URL(url.replace('%s', 'keyword')).hostname
    } catch (error) {
      return Promise.reject(new Error('地址格式不正确'))
    }
    if (state.enabled.length >= MAX) {
      return Promise.reject(new Error('最多只能添加 ' + MAX + ' 种，请先取消一个'))
    }

    const id = 'custom_' + Date.now()
    const engine = { id, name: host.replace(/^www\./, ''), url, custom: true }
    state.custom.push(engine)
    state.enabled.push(id)
    state.active = id
    return persist().then(() => {
      emit()
      console.log('[newtab][engines] 已添加自定义引擎:', id, url)
      return engine
    })
  }

  NT.engines = {
    MAX,
    PRESETS,
    state,
    load,
    all,
    byId,
    enabledList,
    active,
    setEnabled,
    setActive,
    addCustom,
    subscribe(fn) {
      listeners.push(fn)
    },
  }
})((window.NT = window.NT || {}))
