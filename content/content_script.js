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

function parseTime(seconds) {
  if (isNaN(seconds)) {
    return `${seconds} 不是一个时间戳`
  }
  const M = Math.floor(seconds / 60)
  const S = Math.floor(seconds % 60)
  return `${M}: ${S}`
}

/** 站点处理器基类 */
class SiteHandler {
  /** @param {string} _hostname */
  matches(_hostname) {
    return false
  }

  /** 页面注入后、可见性恢复时执行（百度 / 考试宝等 DOM 常驻改写） */
  init() {}
}

// ---------- 酷学院（kuxueyuan / kxy / coolcollege）----------

/** 酷学院观看页：倍速、临近结束返回、防暂停 */
class KuxueyuanStudy {
  constructor(cfg = KuxueyuanSite.config) {
    this.cfg = cfg
    this.started = false
  }

  attach(videoElement) {
    if (this.started || !videoElement) {
      if (!videoElement) console.error('未找到视频元素，请确认页面加载完成')
      return
    }

    const throttledLog = throttle(() => {
      console.log('当前播放时间:', videoElement.currentTime)
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
        videoElement.duration - videoElement.currentTime <= this.cfg.END_THRESHOLD
      ) {
        console.log('快结束了，返回', parseTime(videoElement.duration), parseTime(videoElement.currentTime))
        videoElement.pause()
        window.history.go(-1)
      }

      if (videoElement.paused) {
        videoElement.play()
        console.log(`%c>> $`, 'color:yellow', '空闲暂停触发，续播')
      }
    }, 3000)

    this.started = true
    try {
      videoElement.addEventListener('play', () => {
        console.log('视频开始播放 ▶️', videoElement)
      })
      videoElement.addEventListener('pause', () => {
        console.log('视频暂停 ⏸️', videoElement)
      })
      videoElement.addEventListener('ended', () => {
        console.log('视频播放结束 ⏹️', videoElement)
      })
      videoElement.addEventListener('timeupdate', throttledLog)
    } catch (error) {
      console.error('续播过程出错:', error)
    }
  }
}

/** 酷学院：background `activated` 时在观看页挂 MutationObserver */
class KuxueyuanSite extends SiteHandler {
  static config = {
    END_THRESHOLD: 40, // 视频结束阈值（秒）
    PLAYBACK_RATE: 6, // 播放速度
    MIN_DURATION: 120 // 最小视频时长（秒），小于此值不自动返回
  }

  static selectors = {
    closeButton: '.ant-modal-footer button',
    modalMask: '.ant-modal-mask'
  }

  /** @param {string} hostname */
  static matchesHost(hostname) {
    const h = (hostname || '').toLowerCase()
    if (!h) return false
    if (h.includes('coolcollege')) return true
    if (h.includes('kuxueyuan')) return true
    if (h === 'kxy.cn' || h.endsWith('.kxy.cn') || h.startsWith('kxy.')) return true
    return false
  }

  constructor() {
    super()
    this._videoStudy = new KuxueyuanStudy()
  }

  matches(hostname) {
    return KuxueyuanSite.matchesHost(hostname)
  }

  /** 支持 hash 路由，如 `/#/course/watch?` */
  isWatchCoursePage(href = location.href) {
    return href.includes('/course/watch')
  }

  /**
   * @param {(result: { ok: boolean, reason?: string }) => void} sendResponse
   */
  handleActivated(sendResponse) {
    if (!this.matches(location.hostname)) {
      sendResponse({ ok: false, reason: 'not_kuxueyuan_host' })
      return
    }
    if (!this.isWatchCoursePage(location.href)) {
      sendResponse({ ok: false, reason: 'not_watch_page' })
      return
    }

    console.log(`%c>> $`, 'color:yellow', 'tab 被激活了，开始干活（酷学院）')

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type !== 'childList') return

        const video = mutation.target.querySelector('video')
        const btnClose = mutation.target.querySelector(KuxueyuanSite.selectors.closeButton)

        if (btnClose) btnClose.click()

        if (video) {
          video.muted = true
          video.playbackRate = KuxueyuanSite.config.PLAYBACK_RATE
          this._videoStudy.attach(video)
        }
      })
    })
    observer.observe(document.body, { childList: true, subtree: true })

    sendResponse({ ok: true })
  }

  init() {
    /* 酷学院暂无「进入页面即改写 DOM」的逻辑，仅响应 activated */
  }
}

// ---------- 百度 ----------

class BaiduSite extends SiteHandler {
  constructor() {
    super()
    this._mo = null
  }

  matches(hostname) {
    return hostname === 'baidu.com' || hostname.endsWith('.baidu.com')
  }

  _hideContentRight() {
    const el = document.getElementById('content_right')
    if (!el) return
    el.style.setProperty('display', 'none', 'important')
  }

  init() {
    if (this._mo) return
    this._hideContentRight()
    this._mo = new MutationObserver(() => this._hideContentRight())
    this._mo.observe(document.documentElement, { childList: true, subtree: true })
  }
}

// ---------- 考试宝 kaoshibao ----------

class KaoshibaoSite extends SiteHandler {
  constructor() {
    super()
    this._mo = null
    this._scheduled = false
    this._originCardAttr = 'data-ksb-origin-analysis-card'
    this._originCaptureClass = 'ksb-origin-analysis-capturing'
    this._originTextCache = new Map()
    this._pendingQuestionKey = ''
    this._pendingTimer = null
    this._pendingStartedAt = 0
  }

  matches(hostname) {
    return hostname === 'kaoshibao.com' || hostname.endsWith('.kaoshibao.com')
  }

  _ensureStyle() {
    if (document.getElementById('ksb-origin-analysis-capture-style')) return

    const styleEl = document.createElement('style')
    styleEl.id = 'ksb-origin-analysis-capture-style'
    styleEl.textContent = `
      body.${this._originCaptureClass} .v-modal,
      body.${this._originCaptureClass} .el-dialog__wrapper {
        opacity: 0 !important;
        pointer-events: none !important;
        visibility: hidden !important;
      }
      [${this._originCardAttr}] {
        margin: 14px 0 0;
        padding: 12px 14px;
        border: 1px solid #bfdbfe;
        border-radius: 6px;
        background: #eff6ff;
        color: #1f2937;
        line-height: 1.7;
        font-size: 15px;
        user-select: text;
      }
      [${this._originCardAttr}] .ksb-origin-title {
        margin-bottom: 6px;
        color: #1d4ed8;
        font-weight: 700;
      }
      [${this._originCardAttr}] .ksb-origin-text {
        white-space: pre-wrap;
      }
    `
    document.head?.appendChild(styleEl)
  }

  _setCaptureMode(enabled) {
    this._ensureStyle()
    document.body?.classList.toggle(this._originCaptureClass, enabled)
  }

  _getPracticeRoot() {
    return document.querySelector('.lianxi-content')
  }

  _isAnswered(root = this._getPracticeRoot()) {
    return !!root?.querySelector('.answer-box, .answer-box-detail')
  }

  _getQuestionKey(root = this._getPracticeRoot()) {
    const topicNum = root?.querySelector('.topic-num')?.textContent?.trim() || ''
    const questionTitle = root?.querySelector('.qusetion-title')?.textContent?.trim() || ''
    return `${topicNum}|${questionTitle}`
  }

  _clearPending() {
    this._pendingQuestionKey = ''
    this._pendingStartedAt = 0
    if (this._pendingTimer) {
      clearTimeout(this._pendingTimer)
      this._pendingTimer = null
    }
  }

  _scheduleApply(delay = 120) {
    if (this._pendingTimer) clearTimeout(this._pendingTimer)
    this._pendingTimer = setTimeout(() => {
      this._pendingTimer = null
      this._apply()
    }, delay)
  }

  _expandAiAnalysis(root) {
    const row = root.querySelector('.answer-analysis-row')
    const checkAllBtnRow = root.querySelector('.check-all-btn-row')

    row?.classList.remove('hide-height')
    root.querySelectorAll('.analysis-mask').forEach((el) => {
      el.style.setProperty('display', 'none', 'important')
      el.remove()
    })
    if (checkAllBtnRow) {
      checkAllBtnRow.style.setProperty('display', 'none', 'important')
    }
    root.querySelectorAll('.hide-ai-analysis').forEach((el) => {
      el.style.setProperty('display', 'none', 'important')
      el.remove()
    })
    const paragraph = root.querySelector('.answer-analysis')
    if (paragraph) {
      paragraph.style.removeProperty('height')
      paragraph.style.removeProperty('max-height')
      paragraph.style.removeProperty('overflow')
    }
  }

  _isVisibleDialogPart(el) {
    const wrapper = el?.closest?.('.el-dialog__wrapper') || el
    return !!wrapper && getComputedStyle(wrapper).display !== 'none'
  }

  _extractOriginText() {
    const directEl = Array.from(document.querySelectorAll('.origin-analysis-dialog .origin-analysis-text')).find((el) => {
      return this._isVisibleDialogPart(el)
    })
    const directText = directEl?.textContent?.trim()
    if (directText) return directText

    const dialog = Array.from(document.querySelectorAll('.el-dialog__wrapper, .el-dialog')).find((el) => {
      return this._isVisibleDialogPart(el) && el.textContent?.includes('原解析')
    })
    if (!dialog) return ''

    const body = dialog.querySelector('.el-dialog__body') || dialog
    const clone = body.cloneNode(true)
    clone.querySelectorAll('button, .el-button, .el-dialog__headerbtn').forEach((el) => el.remove())
    return clone.textContent?.replace(/\s+/g, ' ').replace(/^原解析\s*/, '').replace(/\s*复制$/, '').trim() || ''
  }

  _closeOriginDialog() {
    const closeBtn = document.querySelector('.origin-analysis-dialog .el-dialog__headerbtn, .origin-analysis-dialog .el-dialog__close')
    closeBtn?.click()
    setTimeout(() => {
      document.querySelectorAll('.v-modal').forEach((el) => el.remove())
      if (!this._pendingQuestionKey) this._setCaptureMode(false)
    }, 120)
  }

  _findOriginCard(root, questionKey) {
    return Array.from(root.querySelectorAll(`[${this._originCardAttr}]`)).find((el) => {
      return el.dataset.ksbQuestionKey === questionKey
    })
  }

  _renderOriginText(root, questionKey, originText) {
    const anchor = root.querySelector('.answer-analysis-row')
    if (!anchor || !originText) return false

    root.querySelectorAll(`[${this._originCardAttr}]`).forEach((el) => {
      if (el.dataset.ksbQuestionKey !== questionKey) el.remove()
    })

    let card = this._findOriginCard(root, questionKey)
    if (!card) {
      card = document.createElement('div')
      card.setAttribute(this._originCardAttr, '')
      card.dataset.ksbQuestionKey = questionKey
      anchor.insertAdjacentElement('afterend', card)
    }

    card.replaceChildren()
    const title = document.createElement('div')
    title.className = 'ksb-origin-title'
    title.textContent = '原解析'
    const text = document.createElement('div')
    text.className = 'ksb-origin-text'
    text.textContent = originText
    card.append(title, text)
    return true
  }

  _loadOriginText(root, questionKey) {
    const cachedText = this._originTextCache.get(questionKey)
    if (cachedText) {
      this._renderOriginText(root, questionKey, cachedText)
      return
    }

    if (this._findOriginCard(root, questionKey)) return

    if (this._pendingQuestionKey && this._pendingQuestionKey !== questionKey) {
      this._clearPending()
      this._closeOriginDialog()
    }

    if (this._pendingQuestionKey === questionKey) {
      const currentText = this._extractOriginText()
      if (currentText) {
        this._originTextCache.set(questionKey, currentText)
        this._renderOriginText(root, questionKey, currentText)
        this._clearPending()
        this._closeOriginDialog()
        return
      }

      if (Date.now() - this._pendingStartedAt < 3500) {
        this._scheduleApply(180)
      } else {
        this._clearPending()
        this._closeOriginDialog()
      }
      return
    }

    const trigger = root.querySelector('.check-origin-text')
    if (!trigger) return

    this._pendingQuestionKey = questionKey
    this._pendingStartedAt = Date.now()
    this._setCaptureMode(true)
    trigger.click()
    this._scheduleApply(180)
  }

  _apply() {
    const root = this._getPracticeRoot()
    this._ensureStyle()

    if (!root || !this._isAnswered(root)) {
      this._clearPending()
      this._setCaptureMode(false)
      root?.querySelectorAll(`[${this._originCardAttr}]`).forEach((el) => el.remove())
      return
    }

    root.querySelectorAll('.vip-quanyi').forEach((el) => {
      el.style.setProperty('display', 'none', 'important')
    })
    if (document.body && document.body.style.opacity === '0.6') document.body.style.opacity = ''

    const middleContainerEl = document.querySelector('.middle-container.bj-eee')
    if (middleContainerEl && middleContainerEl.style.transform !== 'translateY(-25px)') {
      middleContainerEl.style.transform = 'translateY(-25px)'
    }

    this._expandAiAnalysis(root)
    this._loadOriginText(root, this._getQuestionKey(root))
  }

  init() {
    if (this._mo) return
    this._apply()

    this._mo = new MutationObserver(() => {
      if (this._scheduled) return
      this._scheduled = true
      requestAnimationFrame(() => {
        this._scheduled = false
        this._apply()
      })
    })
    this._mo.observe(document.documentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    })
  }

  restartTweaks() {
    if (!this.matches(location.hostname)) return
    this._scheduled = false
    this._clearPending()
    if (this._mo) {
      this._mo.disconnect()
      this._mo = null
    }
    this.init()
  }
}

/** 三个站点：酷学院 / 百度 / 考试宝 */
class SiteHooksCoordinator {
  constructor(handlers) {
    this.handlers = handlers
  }

  runMatchingSites() {
    const h = location.hostname
    for (const handler of this.handlers) {
      if (handler.matches(h)) handler.init()
    }
  }

  /** 绑定生命周期事件 */
  bindLifecycle() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.runMatchingSites()
    })
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) this.runMatchingSites()
    })
  }

  start() {
    this.bindLifecycle()
    this.runMatchingSites()
  }

  /**  */
  getKuxueyuanHandler() {
    return this.handlers.find((x) => x instanceof KuxueyuanSite)
  }

  /**  */
  getKaoshibaoHandler() {
    return this.handlers.find((x) => x instanceof KaoshibaoSite)
  }
}

const siteCoordinator = new SiteHooksCoordinator([
  new KuxueyuanSite(),
  new BaiduSite(),
  new KaoshibaoSite()
])

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'activated':
      siteCoordinator.getKuxueyuanHandler()?.handleActivated(sendResponse)
      break

    case 'log':
      console.log(`%c>> $`, 'color:yellow', message, sender)
      break

    case 'updated':
      console.log(`%c>> $`, 'color:yellow', 'tab geng xin', message)
      siteCoordinator.getKaoshibaoHandler()?.restartTweaks()
      break

    case 'created':
      console.log(`%c>> $`, 'color:yellow', 'tab 被创建', message)
      break

    default:
      break
  }
})

siteCoordinator.start()
