function study(callback) {
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
        window.history.go(-1)

        if (chrome.runtime.getBackgroundPage() && chrome.runtime.getBackgroundPage().sendMessage) {
          callback({ timer: watchTimer })
        }
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

// 处理来自 service_worker 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'activated':
      console.log(`%c>> $`, 'color:yellow', 'tab 被激活了，开始干活', message, sender)
      // const timer = setInterval(() => {
      //   console.log(`%c>> $`, 'color:yellow', 111)
      // }, 1000)
      // sendResponse({ timer })
      // window.onload(function() {
      //   console.log(`%c>> $`, 'color:yellow', 'loaded')
      //   study(sendResponse)
      // })
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            console.log(`%c>> $`, 'color:yellow', '元素进入视口')
            study(sendResponse)
          }
        })
      })
      observer.observe(document.querySelector('video'))
      // setTimeout(() => {
      //   study(sendResponse)
      // }, 2000)
      return true // 返回 true 表示消息处理函数是异步的，sendResponse 将在消息处理函数执行完毕后调用

    case 'log':
      console.log(`%c>> $`, 'color:yellow', message, sender)
      break

    case 'updated':
      console.log(`%c>> $`, 'color:yellow', 'tab geng xin', message)
      break

    case 'created':
      console.log(`%c>> $`, 'color:yellow', 'tab 被创建', message)
  }
})
