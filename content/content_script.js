// 配置常量
const CONFIG = {
  END_THRESHOLD: 40, // 视频结束阈值（秒）
  PLAYBACK_RATE: 6, // 播放速度
  MIN_DURATION: 120 // 最小视频时长（秒），小于此值不自动返回
}
// DOM 元素选择器
const selectors = {
  closeButton: '.ant-modal-footer button',
  modalMask: '.ant-modal-mask'
}

function throttle(func, delay) {
  let lastCall = 0
  return function (...args) {
    const now = Date.now()
    if (now - lastCall >= delay) {
      func.apply(this, args)
      lastCall = now
    }
  }
}

let started
function study(videoElement) {
  if (started) return

  const throttledLog = throttle(() => {
    console.log('当前播放时间:', videoElement.currentTime)

    // console.log('当前播放时间:', videoElement.currentTime);
    console.log(
      `%c`,
      'color:yellow',
      `一共：${parseTime(videoElement.duration)}，剩余：${parseTime(
        videoElement.duration - videoElement.currentTime
      )}，${videoElement.paused}`
    )

    if (
      !isNaN(videoElement.duration) &&
      !isNaN(videoElement.currentTime) &&
      videoElement.duration - videoElement.currentTime <= 40
    ) {
      console.log('快结束了，返回', parseTime(videoElement.duration), parseTime(videoElement.currentTime))
      videoElement.pause()
      window.history.go(-1)
    }

    if (videoElement.paused) {
      videoElement.play() // 空闲暂停
      console.log(`%c>> $`, 'color:yellow', '空闲暂停触发，续播')
    }
  }, 3000)

  if (!videoElement) {
    console.error('未找到视频元素，请确认页面加载完成')
  } else {
    started = true
    try {
      // 监听播放开始
      videoElement.addEventListener('play', () => {
        console.log('视频开始播放 ▶️', videoElement)
      })

      // 监听暂停
      videoElement.addEventListener('pause', () => {
        console.log('视频暂停 ⏸️', videoElement)
        // btnClose?.click()
      })

      // 监听播放结束
      videoElement.addEventListener('ended', () => {
        console.log('视频播放结束 ⏹️', videoElement)
      })

      // 监听播放进度（实时触发）throttledLog
      videoElement.addEventListener('timeupdate', throttledLog)
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
      if (location.href.includes('/course/watch?')) {
        console.log(`%c>> $`, 'color:yellow', 'tab 被激活了，开始干活', message, sender)

        let _video
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
              _video = mutation.target.querySelector('video')
              const btnClose = mutation.target.querySelector(selectors.closeButton)

              if (!!btnClose) {
                btnClose.click()
              }

              if (_video) {
                _video.muted = true // 静音
                _video.playbackRate = CONFIG.PLAYBACK_RATE // 倍速
                study(_video)
                // observer.disconnect()
              }
            }
          })
        })
        observer.observe(document.body, { childList: true, subtree: true })

        return true // 返回 true 表示消息处理函数是异步的，sendResponse 将在消息处理函数执行完毕后调用
      }

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
