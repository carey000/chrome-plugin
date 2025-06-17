// 配置常量
const CONFIG = {
  END_THRESHOLD: 40, // 视频结束阈值（秒）
  PLAYBACK_RATE: 2, // 播放速度
  MIN_DURATION: 120 // 最小视频时长（秒），小于此值不自动返回
}

function study(callback) {
  // DOM 元素选择器
  const selectors = {
    closeButton: '.ant-modal-footer button',
    modalMask: '.ant-modal-mask',
    video: 'video'
  }

  // 获取必要的 DOM 元素
  const btnClose = document.querySelector(selectors.closeButton)
  const getModalMask = () => document.querySelector(selectors.modalMask)
  let videoElement = document.querySelector(selectors.video)

  if (!videoElement) {
    console.error('未找到视频元素，请确认页面加载完成')
  } else {
    try {
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
    } catch (error) {
      console.error('续播过程出错:', error)
    }
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

      let _video;
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList' && !_video) {
            _video = mutation.target.querySelector('video')

            if(_video) {
              console.log(`%c>> $`, 'color:yellow', '子元素发生变化', mutation.target, mutation.target.classList, _video)
              // study(_video)
              observer.disconnect()
            }
          }
        })
      })
      observer.observe(document.body, { childList: true, subtree: true })

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
