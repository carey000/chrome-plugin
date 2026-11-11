/* 酷学院观看页：静音倍速、防暂停、自动关闭确认弹窗、临近结束返回 */
;(function () {
  const AB = window.AutoBoat
  const { SiteHandler, throttle, parseTime } = AB

  class KuxueyuanStudy {
    constructor(cfg) {
      this.cfg = cfg
      this.started = false
      this._video = null
      this._onTimeUpdate = null
      this._onPlay = null
      this._onPause = null
      this._onEnded = null
    }

    attach(video) {
      if (this.started || !video) {
        if (!video) console.error('[酷学院] 未找到视频元素')
        return
      }
      this._video = video
      this.started = true

      this._onTimeUpdate = throttle(() => {
        const v = this._video
        if (!v) return
        console.log(
          `[酷学院] 一共：${parseTime(v.duration)}，剩余：${parseTime(v.duration - v.currentTime)}，${v.paused}`
        )
        if (
          !isNaN(v.duration) &&
          !isNaN(v.currentTime) &&
          v.duration - v.currentTime <= this.cfg.END_THRESHOLD
        ) {
          console.log('[酷学院] 快结束，返回上一级')
          v.pause()
          window.history.go(-1)
        }
        if (v.paused) {
          v.play()
          console.log('[酷学院] 空闲暂停，已续播')
        }
      }, 3000)

      this._onPlay = () => console.log('[酷学院] 视频开始播放')
      this._onPause = () => console.log('[酷学院] 视频暂停')
      this._onEnded = () => console.log('[酷学院] 视频播放结束')

      video.addEventListener('timeupdate', this._onTimeUpdate)
      video.addEventListener('play', this._onPlay)
      video.addEventListener('pause', this._onPause)
      video.addEventListener('ended', this._onEnded)
    }

    detach() {
      if (this._video) {
        if (this._onTimeUpdate) this._video.removeEventListener('timeupdate', this._onTimeUpdate)
        if (this._onPlay) this._video.removeEventListener('play', this._onPlay)
        if (this._onPause) this._video.removeEventListener('pause', this._onPause)
        if (this._onEnded) this._video.removeEventListener('ended', this._onEnded)
      }
      this.started = false
      this._video = null
      this._onTimeUpdate = this._onPlay = this._onPause = this._onEnded = null
    }
  }

  class KuxueyuanSite extends SiteHandler {
    static config = {
      END_THRESHOLD: 40, // 视频结束阈值（秒），低于此值不再自动返回
      PLAYBACK_RATE: 6, // 播放速度
    }
    static selectors = {
      closeButton: '.ant-modal-footer button',
      modalMask: '.ant-modal-mask',
    }

    constructor(id, matchFn) {
      super(id, matchFn)
      this._videoStudy = new KuxueyuanStudy(KuxueyuanSite.config)
      this._observer = null
    }

    isWatchCoursePage(href = location.href) {
      return href.includes('/course/watch')
    }

    init() {
      this.enable()
    }

    /** 同站点只建立一个 observer；watch 页通过 hash 路由跳转也能被捕获 */
    enable() {
      if (this._observer) return
      console.log('%c>> $', 'color:yellow', '[酷学院] 功能已启用，开始监听观看页')
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type !== 'childList') continue
          if (!this.isWatchCoursePage()) continue

          // 仅在确认弹窗（.ant-modal-mask）存在时才点击关闭，避免误触无关弹窗
          const mask = document.querySelector(KuxueyuanSite.selectors.modalMask)
          const btnClose = document.querySelector(KuxueyuanSite.selectors.closeButton)
          if (mask && btnClose) {
            console.log('%c', 'color:red', '[酷学院] 自动关闭确认弹窗')
            btnClose.click()
          }

          const video = document.querySelector('video')
          if (video) {
            video.muted = true
            video.playbackRate = KuxueyuanSite.config.PLAYBACK_RATE
            this._videoStudy.attach(video)
          }
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      this._observer = observer
    }

    disable() {
      if (this._observer) {
        this._observer.disconnect()
        this._observer = null
      }
      this._videoStudy.detach()
      console.log('%c>> $', 'color:yellow', '[酷学院] 功能已关闭')
    }
  }

  AB.sites.kuxueyuan = KuxueyuanSite
})()
