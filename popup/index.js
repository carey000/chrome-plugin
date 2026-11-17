console.log('%c>> $ popup', 'color:yellow', document, chrome)

const FEATURE_CONFIG = window.FEATURE_CONFIG || []
const flags = {}

const UNCLIP = FEATURE_CONFIG.find((f) => f.id === 'unclip') || {}
const HOSTS_KEY = UNCLIP.hostsKey || 'unclip_hosts'
let unclipHosts = []

const urlMap = {
  ToExtensions: `chrome://extensions?id=${chrome.runtime.id}`,
}

function loadFlags() {
  return new Promise((resolve) => {
    const keys = FEATURE_CONFIG.map((f) => f.storageKey).concat([HOSTS_KEY])
    chrome.storage.local.get(keys, (stored) => {
      FEATURE_CONFIG.forEach((f) => {
        flags[f.id] = stored[f.storageKey] !== false
      })
      unclipHosts = Array.isArray(stored[HOSTS_KEY])
        ? stored[HOSTS_KEY].slice()
        : (UNCLIP.hosts || []).slice()
      resolve()
    })
  })
}

// 把用户输入收敛成主机名：去协议 / 路径 / 端口 / www. 前缀，转小写
function normalizeHost(raw) {
  let h = String(raw || '').trim().toLowerCase()
  h = h.replace(/^https?:\/\//, '').replace(/^[^/]+\/\//, '')
  h = h.split('/')[0].split('?')[0].split('#')[0]
  h = h.replace(/:\d+$/, '').replace(/^www\./, '').replace(/\/+$/, '')
  return h
}

function validHost(h) {
  // 允许 localhost 与常规域名；拒绝空串、空格、通配符以外的非法字符
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) || /^localhost$/.test(h)
}

function saveHosts() {
  chrome.storage.local.set({ [HOSTS_KEY]: unclipHosts.slice() }, () => {
    console.log('[popup] 白名单已保存:', unclipHosts)
  })
}

// 渲染某个 unclip 卡片内的白名单编辑区（单独函数，避免整表重绘丢焦点）
function renderUnclipHosts(meta) {
  let box = meta.querySelector('.unclip-hosts')
  if (!box) {
    box = document.createElement('details')
    box.className = 'unclip-hosts'
    box.innerHTML = `
      <summary>白名单站点 <span class="uh-count"></span></summary>
      <div class="uh-body">
        <div class="uh-chips"></div>
        <div class="uh-add">
          <input type="text" class="uh-input" placeholder="输入域名，如 docs.feishu.cn" />
          <button type="button" class="uh-btn">添加</button>
        </div>
        <div class="uh-tip">仅这些站点接管复制 / 右键；留空则所有站点都不接管</div>
      </div>`
    meta.appendChild(box)

    const input = box.querySelector('.uh-input')
    const add = () => {
      const h = normalizeHost(input.value)
      if (!validHost(h)) {
        input.value = ''
        input.placeholder = '域名格式不对，请重试'
        return
      }
      if (unclipHosts.indexOf(h) === -1) {
        unclipHosts.push(h)
        saveHosts()
      }
      input.value = ''
      renderUnclipHosts(meta)
      box.open = true
      input.focus()
    }
    box.querySelector('.uh-btn').addEventListener('click', add)
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') add()
    })
  }

  box.querySelector('.uh-count').textContent = `(${unclipHosts.length})`
  const chips = box.querySelector('.uh-chips')
  chips.innerHTML = ''
  unclipHosts.forEach((h, i) => {
    const chip = document.createElement('span')
    chip.className = 'uh-chip'
    chip.innerHTML = `${h}<button type="button" class="uh-del" data-i="${i}" title="移除">×</button>`
    chips.appendChild(chip)
  })
  chips.querySelectorAll('.uh-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      unclipHosts.splice(Number(btn.dataset.i), 1)
      saveHosts()
      renderUnclipHosts(meta)
      box.open = true
    })
  })
}

function render() {
  const box = document.getElementById('features')
  box.innerHTML = ''
  FEATURE_CONFIG.forEach((f) => {
    const on = flags[f.id]
    const row = document.createElement('div')
    row.className = 'feature-row'
    row.innerHTML = `
      <div class="feature-meta">
        <div class="feature-label">${f.label}</div>
        <div class="feature-desc">${f.desc}</div>
      </div>
      <label class="switch">
        <input type="checkbox" data-id="${f.id}" ${on ? 'checked' : ''} />
        <span class="slider"></span>
      </label>`
    // 配置里带 link 的功能，把直达按钮放进自己的卡片内（原本独立在列表外面）
    if (f.link) {
      const jump = document.createElement('a')
      jump.className = 'jump-inline'
      jump.href = f.link.url
      jump.textContent = f.link.text
      jump.addEventListener('click', (ev) => {
        ev.preventDefault()
        chrome.tabs.create({ url: f.link.url })
      })
      const meta = row.querySelector('.feature-meta')
      ;(meta || row).appendChild(jump)
    }
    // unclip 卡片内嵌白名单编辑区
    if (f.id === 'unclip') {
      renderUnclipHosts(row.querySelector('.feature-meta'))
    }
    box.appendChild(row)
  })
  box.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', onToggle)
  })
}

function onToggle(e) {
  const id = e.target.dataset.id
  const value = e.target.checked
  flags[id] = value
  const f = FEATURE_CONFIG.find((x) => x.id === id)
  if (!f) return
  chrome.storage.local.set({ [f.storageKey]: value }, () => {
    // 实时同步到当前激活标签页，无需刷新即可生效 / 失效
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab) return
      chrome.tabs.sendMessage(
        tab.id,
        { action: 'feature-flag-changed', id, value },
        () => {
          void chrome.runtime.lastError
        }
      )
    })
  })
}

function bindLinks() {
  document.querySelectorAll('a[id]').forEach((el) => {
    const url = urlMap[el.id]
    if (!url) return
    el.href = url
    el.addEventListener('click', (ev) => {
      ev.preventDefault()
      chrome.tabs.create({ url })
    })
  })
  const rid = document.getElementById('chrome_runtime_id')
  if (rid) rid.textContent = chrome.runtime.id

  const bm = document.getElementById('openBookmarks')
  if (bm) {
    bm.addEventListener('click', () => {
      const url = chrome.runtime.getURL('bookmarks/bookmarks.html')
      console.log('[popup] 打开书签管理页:', url)
      chrome.tabs.create({ url })
    })
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadFlags()
  render()
  bindLinks()
})
