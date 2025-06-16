const timers = new Map()

function works(currentTabId) {
  if (!timers.has(currentTabId)) {
    chrome.tabs.sendMessage(
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
    chrome.tabs.sendMessage(currentTabId, {
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
    // handleTabChange(tabId);
    chrome.tabs.sendMessage(tabId, {
      action: 'updated',
      logMsg: 'geng xin～'
    })
    works(tabId)
  }
})
