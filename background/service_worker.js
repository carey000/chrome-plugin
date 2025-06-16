// 在这里注册和在manifest的content写是一样的
// chrome.scripting.registerContentScripts([
//   {
//     id: 'contentScript',
//     js: ['content/content_script.js'],
//     matches: ["<all_urls>"],
//     runAt: 'document_idle', // document_start document_idle document_end
//     world: 'MAIN',
//   },
// ])

// 当标签被激活时触发，onUpdated是状态（url/title/梯子）改变时
const timers = new Map()

// 启动定时任务
function startTimer(tabId) {
  if (!timers.has(tabId)) {
    console.log(`Starting timer for tab ${tabId}`)
    const intervalId = setInterval(() => {
      chrome.tabs.sendMessage(tabId, { action: 'getVideoDuration' }, (response) => {
        if (response && response.duration !== undefined) {
          console.log(`Video duration in tab ${tabId}: ${response.duration}`)
        }
      })
    }, 1000)
    timers.set(tabId, intervalId)
  }
}

// 停止定时任务
function stopTimer(tabId) {
  if (timers.has(tabId)) {
    console.log(`Stopping timer for tab ${tabId}`)
    clearInterval(timers.get(tabId))
    timers.delete(tabId)
  }
}

// 检查定时任务是否正在运行
function checkTask(tabId, sendResponse) {
  sendResponse({ running: timers.has(tabId) })
}

// 监听标签页激活事件
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    chrome.runtime.sendMessage({ action: 'checkTask', tabId: activeInfo.tabId }, (response) => {
      if (!response.running) {
        chrome.runtime.sendMessage({ action: 'startTask', tabId: activeInfo.tabId })
      }
    })
  })
})

// 监听标签页关闭事件
chrome.tabs.onRemoved.addListener((tabId) => {
  stopTimer(tabId)
})

// 存储当前激活的标签页ID
let currentActiveTabId = null
// 管理视频播放的tab: 只有是看视频的tab才会被存储
const tabObserver = {}
function isContinue(url = '', tabId) {
  if (url.includes('coolcollege.cn') && url.includes('watch') && !Reflect.has(tabObserver, tabId)) {
    return true
  } else {
    return false
  }
}
console.log(`%c>> $`, 'color:yellow', 'service_worker.js: chrome', chrome, tabObserver)

// 注入脚本及回调
function _executeScript(tabId, callback) {
  chrome.scripting
    .executeScript({
      target: { tabId },
      files: ['content_script.js']
    })
    .then(() => {
      callback()
    })
    .catch((error) => {
      console.error('Failed to inject content script:', error)
    })
}

// 监听标签页被激活的事件
chrome.tabs.onActivated.addListener((activeInfo) => {
  tabObserver['__activeInfo__'] = activeInfo
  currentActiveTabId = activeInfo.tabId

  chrome.tabs.get(activeInfo.tabId, (currentTabInfo) => {
    const _isContinue = isContinue(currentTabInfo.url, activeInfo.tabId)

    // 符合继续条件（是学习视频且没有被播放）才继续（注入脚本）
    if (_isContinue) {
      _executeScript(activeInfo.tabId, () => {
        chrome.tabs.sendMessage(
          activeInfo.tabId,
          { action: 'activated tab', tabId: activeInfo.tabId, currentTabInfo, tabObserver },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error(chrome.runtime.lastError.message)
            } else {
              // 只有真正播放了，才记录
              tabObserver[activeInfo.tabId] = {
                tabId: activeInfo.tabId
              }
              console.log(`%c>> $`, 'color:yellow', 'activated tab', response)
            }
          }
        )
      })
    } else {
      chrome.tabs.sendMessage(activeInfo.tabId, { action: 'just see' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message, response)
        } else {
          console.log(`%c>> $`, 'color:yellow', 'just see', response)
        }
      })
    }
  })
})

// 监听标签页状态变化的事件
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  console.log(`%c>> $`, 'color:yellow', 'tab status changeddd', tabId, changeInfo, tab, tabObserver)
  if (changeInfo.status === 'complete') {
    // 确保内容脚本已经注入
  }
  chrome.tabs.sendMessage(tabId, { action: 'tab updated' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError.message, response)
    } else {
      console.log(`%c>> $`, 'color:yellow', 'tab updated', response)
    }
  })
})
