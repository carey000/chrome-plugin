// // https://tool.mkblog.cn/jsobfuscator/

// const observer = new MutationObserver((mutations) => {
//   mutations.forEach((mutation) => {
//     const element = document.querySelector('.ant-modal-mask')
//     const endFlag = Date.now() < 1738108800000 // 安心过年
//     if (element && endFlag) {
//       console.log('Element found:', element)
//       // 你的代码逻辑
//       observer.disconnect() // 找到元素后停止观察
//       study()
//     }
//   })
// })

// const cfg = { childList: true, subtree: true }
// observer.observe(document.body, cfg)

function study() {
  // 在定时器外部选择DOM元素
  const btnClose = document.querySelector('.ant-modal-footer button')
  const getModalMask = () => document.querySelector('.ant-modal-mask')
  let videoElement = document.querySelector('video')

  if (!videoElement) {
    console.error('Video element not found.')
  } else {
    videoElement.muted = true // 静音
    videoElement.playbackRate = 6 // 倍速

    // watchTimer
    const watchTimer = setInterval(() => {
      if (
        !isNaN(videoElement.duration) &&
        !isNaN(videoElement.currentTime) &&
        videoElement.duration - videoElement.currentTime <= 40
      ) {
        console.log('快结束了，返回', parseTime(videoElement.duration), parseTime(videoElement.currentTime))
        videoElement.pause()
        // videoElement = null
        clearInterval(watchTimer)
        window.history.go(-1)
      }
      if (videoElement) {
        if (videoElement.paused) {
          videoElement.play() // 空闲暂停
          console.log(`%c>> $`, 'color:yellow', '空闲暂停触发，续播')
        }

        if (!getModalMask()) {
          console.log(
            `%c`,
            'color:yellow',
            `一共：${parseTime(videoElement.duration)}，剩余：${parseTime(
              videoElement.duration - videoElement.currentTime
            )}，${videoElement.paused}`
          )
        } else {
          console.log('%c', 'color:red', '自动续播')
          btnClose.click()
        }
      }
    }, 2 * 1000)
  }
}

function parseTime(seconds) {
  if (isNaN(seconds)) {
    return `${seconds} 不是一个时间戳`
  }
  const M = Math.floor(seconds / 60)
  const S = Math.floor(seconds % 60)
  return `${M}: ${S}`
}

// 监听来自 service_worker 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('content_script received message:', message, sender)
  const { action, currentTabInfo, tabId, tabObserver } = message

  const videoInfo = {
    videoInfo: '', // 视频信息
    videoStatus: '' // 播放还是暂停
  }
  // 根据消息类型执行不同的操作
  switch (action) {
    case 'activated tab':
      console.log(`%c>> $接收～～～`, 'color:yellow', message)
      study()
      sendResponse('from content_script: tab activated', videoInfo)
      // tab聚焦的时候，开始自动播放

      break
    case 'aust see':
      console.log(`%c>> $你忙你的，我就看看～～～`, 'color:yellow', message)
      sendResponse('from content_script: tab activated', videoInfo)
      // tab聚焦的时候，开始自动播放

      break
    case 'tab updated':
      console.log('Tab URL updated:', message.url)
      sendResponse('from content_script: url updated')
      break
    default:
      sendResponse('from content_script: unknown action')
  }
})
