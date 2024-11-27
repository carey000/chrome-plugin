console.log(`%c>> $popup`, 'color:yellow', document, chrome)

// url 映射
const urlMap = {
  kxy: 'https://pro.coolcollege.cn/#/course/management',
  ToExtensions: `chrome://extensions?id=${chrome.runtime.id}`
}

// 跳转
document.addEventListener('DOMContentLoaded', function () {
  var links = document.getElementsByTagName('a')
  const linksArr = [...links]
  linksArr.forEach(function (el) {
    if (el?.id && urlMap[el?.id]) {
      el.href = urlMap[el.id]
      el.addEventListener('click', function (event) {
        event.preventDefault() // 阻止默认行为
        chrome.tabs.create({ url: el.href }) // 打开新标签页
      })
    }
  })

  // 调试
  const chrome_runtime_id = document.querySelector('#chrome_runtime_id')
  chrome_runtime_id.innerText = chrome.runtime.id
})

chrome.tabs.onCreated.addListener(function (tab) {
  console.log(`%c>> $tab-created`, 'color:yellow', tab)
})

chrome.tabs.onActivated.addListener(function (tab) {
  console.log(`%c>> $tab-actived`, 'color:yellow', tab)
})
