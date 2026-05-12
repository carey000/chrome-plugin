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
    this._ksbSiteMo = null
    this._ksbDomFixScheduled = false
    this._analysisWrapAttr = 'data-ksb-analysis-wrap'
    this._originAnalysisClickPending = false
    this._originAnalysisClickAt = 0
    this._originAnalysisRetryTimer = null
    this._originAnalysisFailedKeys = new Set()
    this._originAnalysisCaptureClass = 'ksb-origin-analysis-capturing'
  }

  matches(hostname) {
    return hostname === 'kaoshibao.com' || hostname.endsWith('.kaoshibao.com')
  }

  _pauseMutationObserverForDomWork() {
    if (this._ksbSiteMo) this._ksbSiteMo.disconnect()
  }

  _resumeMutationObserverAfterDomWork() {
    queueMicrotask(() => {
      this._cleanupOriginAnalysisOverlays()
      requestAnimationFrame(() => {
        this._cleanupOriginAnalysisOverlays()
        this._setOriginAnalysisCaptureMode(false)
      })
      this._ksbSiteMo?.observe(document.documentElement, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true
      })
    })
  }

  _ensureOriginAnalysisCaptureStyle() {
    if (document.getElementById('ksb-origin-analysis-capture-style')) return

    const styleEl = document.createElement('style')
    styleEl.id = 'ksb-origin-analysis-capture-style'
    styleEl.textContent = `
      body.${this._originAnalysisCaptureClass} .v-modal,
      body.${this._originAnalysisCaptureClass} .el-dialog__wrapper {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
        visibility: hidden !important;
      }
    `
    document.head?.appendChild(styleEl)
  }

  _setOriginAnalysisCaptureMode(enabled) {
    this._ensureOriginAnalysisCaptureStyle()
    document.body?.classList.toggle(this._originAnalysisCaptureClass, enabled)
  }

  _cleanupOriginAnalysisOverlays() {
    document.querySelectorAll('.v-modal').forEach((el) => {
      el.remove()
    })
    document.querySelectorAll('.el-dialog__wrapper').forEach((el) => {
      if (el.querySelector?.('.origin-analysis-dialog') && el.style.display !== 'none') {
        el.style.display = 'none'
      }
    })
  }

  _closeOriginAnalysisDialogAndCleanupOverlays() {
    const headerBtn = document.querySelector('.origin-analysis-dialog .el-dialog__headerbtn')
    this._pauseMutationObserverForDomWork()
    headerBtn?.click()
    this._resumeMutationObserverAfterDomWork()
  }

  _resetOriginAnalysisRequest() {
    this._originAnalysisClickPending = false
    this._originAnalysisClickAt = 0
    if (this._originAnalysisRetryTimer) {
      clearTimeout(this._originAnalysisRetryTimer)
      this._originAnalysisRetryTimer = null
    }
  }

  _scheduleOriginAnalysisRetry(delay = 800) {
    if (this._originAnalysisRetryTimer) clearTimeout(this._originAnalysisRetryTimer)
    this._originAnalysisRetryTimer = setTimeout(() => {
      this._originAnalysisRetryTimer = null
      this._applyDomTweaks()
    }, delay)
  }

  _hasAiAnalysis() {
    return !!document.querySelector('.answer-analysis-row .answer-analysis, .answer-analysis-row .analysis-mask')
  }

  _ensureAiAnalysisExpanded() {
    const answerMaskEl = document.querySelector('.answer-analysis-row.hide-height')
    const checkAllBtnRowEl = document.querySelector('.check-all-btn-row')
    const analysisMaskEl = document.querySelector('.analysis-mask')

    if (answerMaskEl) answerMaskEl.classList.remove('hide-height')
    if (checkAllBtnRowEl && checkAllBtnRowEl.style.display !== 'none') {
      checkAllBtnRowEl.style.display = 'none'
    }
    if (analysisMaskEl && analysisMaskEl.style.display !== 'none') {
      analysisMaskEl.style.display = 'none'
    }
  }

  _getCurrentQuestionKey() {
    const topicNum = document.querySelector('.topic-num')?.textContent?.trim() || ''
    const questionTitle = document.querySelector('.qusetion-title')?.textContent?.trim() || ''
    return `${topicNum}|${questionTitle}`
  }

  _createOriginAnalysisWrap() {
    const wrap = document.createElement('div')
    wrap.setAttribute(this._analysisWrapAttr, '')
    wrap.style.cssText = [
      'margin:12px 0',
      'padding:12px 14px',
      'border-radius:8px',
      'background:#fff',
      'border:1px solid #e5e7eb',
      'line-height:1.65',
      'color:#111827',
      'box-shadow:0 1px 2px rgba(0,0,0,.04)'
    ].join(';')
    return wrap
  }

  _findOriginAnalysisContentEl() {
    const directEl = document.querySelector('.origin-analysis-dialog .origin-analysis-text')
    if (directEl?.textContent?.trim()) return directEl

    const dialogWrapEl = Array.from(document.querySelectorAll('.el-dialog__wrapper')).find((el) => (
      el.textContent?.includes('原解析')
    ))
    const dialogBodyEl = dialogWrapEl?.querySelector('.el-dialog__body')
    if (!dialogBodyEl) return null

    const clonedBodyEl = dialogBodyEl.cloneNode(true)
    clonedBodyEl.querySelectorAll('button, .el-button').forEach((el) => el.remove())

    const originText = clonedBodyEl.textContent?.replace(/\s+/g, ' ').trim()
    if (!originText || originText === '复制') return null

    const contentEl = document.createElement('div')
    contentEl.className = 'origin-analysis-text'
    contentEl.textContent = originText
    return contentEl
  }

  _moveOriginAnalysisIntoPage() {
    const answerAnalysisRowEl = document.querySelector('.answer-analysis-row')
    const originAnalysisTextEl = this._findOriginAnalysisContentEl()
    const questionKey = this._getCurrentQuestionKey()

    if (!answerAnalysisRowEl || !originAnalysisTextEl) return false

    const originText = originAnalysisTextEl.textContent?.trim()
    if (!originText) return false

    const existingWrap = answerAnalysisRowEl.querySelector(`[${this._analysisWrapAttr}]`)
    const wrap = existingWrap || this._createOriginAnalysisWrap()

    if (!existingWrap) answerAnalysisRowEl.appendChild(wrap)
    wrap.dataset.ksbQuestionKey = questionKey
    wrap.replaceChildren(originAnalysisTextEl)
    this._resetOriginAnalysisRequest()
    this._closeOriginAnalysisDialogAndCleanupOverlays()
    return true
  }

  _requestOriginAnalysisIfNeeded() {
    const answerAnalysisRowEl = document.querySelector('.answer-analysis-row')
    const checkOriginTextBtnEl = document.querySelector('.check-origin-text')
    const existingWrap = answerAnalysisRowEl?.querySelector(`[${this._analysisWrapAttr}]`)
    const questionKey = this._getCurrentQuestionKey()

    if (existingWrap && existingWrap.dataset.ksbQuestionKey !== questionKey) {
      existingWrap.remove()
      this._resetOriginAnalysisRequest()
    }

    if (this._originAnalysisClickPending) {
      const pendingMs = Date.now() - this._originAnalysisClickAt
      if (pendingMs > 1200) {
        this._originAnalysisFailedKeys.add(questionKey)
        this._resetOriginAnalysisRequest()
        this._closeOriginAnalysisDialogAndCleanupOverlays()
      } else {
        this._scheduleOriginAnalysisRetry(Math.max(200, 1300 - pendingMs))
      }
      return
    }

    if (
      !answerAnalysisRowEl ||
      answerAnalysisRowEl.querySelector(`[${this._analysisWrapAttr}]`) ||
      this._originAnalysisFailedKeys.has(questionKey) ||
      this._originAnalysisClickPending
    ) {
      return
    }
    if (!checkOriginTextBtnEl) return

    this._originAnalysisClickPending = true
    this._originAnalysisClickAt = Date.now()
    this._setOriginAnalysisCaptureMode(true)
    checkOriginTextBtnEl.click()
    this._scheduleOriginAnalysisRetry(300)
  }

  _applyDomTweaks() {
    const vipEl = document.querySelector('.vip-quanyi')
    if (vipEl && vipEl.style.display !== 'none') vipEl.style.display = 'none'
    if (document.body && document.body.style.opacity === '0.6') document.body.style.opacity = ''

    const middleContainerEl = document.querySelector('.middle-container.bj-eee')

    if (this._hasAiAnalysis()) {
      this._ensureAiAnalysisExpanded()
      if (!this._moveOriginAnalysisIntoPage()) this._requestOriginAnalysisIfNeeded()
    } else {
      this._resetOriginAnalysisRequest()
      this._setOriginAnalysisCaptureMode(false)
    }

    if (middleContainerEl && middleContainerEl.style.transform !== 'translateY(-25px)') {
      middleContainerEl.style.transform = 'translateY(-25px)'
    }
  }

  init() {
    if (this._ksbSiteMo) return
    this._applyDomTweaks()

    this._ksbSiteMo = new MutationObserver(() => {
      if (this._ksbDomFixScheduled) return
      this._ksbDomFixScheduled = true
      requestAnimationFrame(() => {
        this._ksbDomFixScheduled = false
        this._applyDomTweaks()
      })
    })
    this._ksbSiteMo.observe(document.documentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    })
  }

  restartTweaks() {
    if (!this.matches(location.hostname)) return
    this._ksbDomFixScheduled = false
    if (this._ksbSiteMo) {
      this._ksbSiteMo.disconnect()
      this._ksbSiteMo = null
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
