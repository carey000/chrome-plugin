// 仅向可注入脚本的 http(s) 页面发消息，避免 chrome:// 等页面报 "Receiving end does not exist"
function isInjectableUrl(url) {
  if (!url || typeof url !== 'string') return false
  return url.startsWith('http://') || url.startsWith('https://')
}

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

// 标签页加载完成：先通知内容脚本重新应用（如考试宝 restart），再触发「激活」逻辑
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return
  sendToTab(tabId, { action: 'updated' })
  sendToTab(tabId, { action: 'activated' }, (res) => {
    console.log('%c>> $', 'color:yellow', 'tab 激活回调', res)
  })
})
