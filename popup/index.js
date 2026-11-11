console.log('%c>> $ popup', 'color:yellow', document, chrome)

const FEATURE_CONFIG = window.FEATURE_CONFIG || []
const flags = {}

const urlMap = {
  kxy: 'https://pro.coolcollege.cn/#/course/management',
  ToExtensions: `chrome://extensions?id=${chrome.runtime.id}`,
}

function loadFlags() {
  return new Promise((resolve) => {
    const keys = FEATURE_CONFIG.map((f) => f.storageKey)
    if (!keys.length) return resolve()
    chrome.storage.local.get(keys, (stored) => {
      FEATURE_CONFIG.forEach((f) => {
        flags[f.id] = stored[f.storageKey] !== false
      })
      resolve()
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
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadFlags()
  render()
  bindLinks()
})
