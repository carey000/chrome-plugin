const timers = new Map()

/** content script 只会注入到普通 http(s) 页，对 chrome:// 等发消息会报 Receiving end does not exist */
function isInjectableUrl(url) {
  if (!url || typeof url !== 'string') return false
  return url.startsWith('http://') || url.startsWith('https://')
}

/**
 * @param {number} tabId
 * @param {object} message
 * @param {(response: any) => void} [onReply] 不传表示发完即走，不等待回复
 */
function sendToTab(tabId, message, onReply) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return
    if (!isInjectableUrl(tab.url)) return

    if (onReply) {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) return
        onReply(response)
      })
    } else {
      chrome.tabs.sendMessage(tabId, message, () => {
        void chrome.runtime.lastError
      })
    }
  })
}

function works(currentTabId) {
  if (!timers.has(currentTabId)) {
    sendToTab(
      currentTabId,
      {
        action: 'activated',
        timers
      },
      (response) => {
        console.log(`%c>> $tab被点击之后，传给service_script.js`, 'color:yellow', response)
        if (response?.timer) {
          timers.set(currentTabId, response?.timer)
        }
      }
    )
  } else {
    sendToTab(currentTabId, {
      action: 'log',
      logMsg: '已经在干活啦～',
      logData: timers
    })
  }
}
// 监听标签页被激活的事件
// chrome.tabs.onActivated.addListener((activeInfo) => {
//   tabObserver['__activeInfo__'] = activeInfo
//   currentActiveTabId = activeInfo.tabId

//   chrome.tabs.get(activeInfo.tabId, (currentTabInfo) => {
//     works(activeInfo.tabId)
//   })
// })

// 监听标签页更新（包括刷新）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  console.log(`%c>> $刷新-更新`, 'color:yellow', tabId, changeInfo)

  if (changeInfo.status === 'complete') {
    sendToTab(tabId, {
      action: 'updated',
      logMsg: 'geng xin～'
    })
    works(tabId)
  }
})
