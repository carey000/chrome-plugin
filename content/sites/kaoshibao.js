/* 考试宝练习页：展开 AI 解析、提取并固定原解析卡片 */
;(function () {
  const AB = window.AutoBoat
  const { SiteHandler } = AB

  class KaoshibaoSite extends SiteHandler {
    constructor(id, matchFn) {
      super(id, matchFn)
      this._mo = null
      this._scheduled = false
      this._originCardAttr = 'data-ksb-origin-analysis-card'
      this._originCaptureClass = 'ksb-origin-analysis-capturing'
      this._originTextCache = new Map()
      this._pendingQuestionKey = ''
      this._pendingTimer = null
      this._pendingStartedAt = 0
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
      const directEl = Array.from(
        document.querySelectorAll('.origin-analysis-dialog .origin-analysis-text')
      ).find((el) => this._isVisibleDialogPart(el))
      const directText = directEl?.textContent?.trim()
      if (directText) return directText

      const dialog = Array.from(
        document.querySelectorAll('.el-dialog__wrapper, .el-dialog')
      ).find((el) => this._isVisibleDialogPart(el) && el.textContent?.includes('原解析'))
      if (!dialog) return ''

      const body = dialog.querySelector('.el-dialog__body') || dialog
      const clone = body.cloneNode(true)
      clone
        .querySelectorAll('button, .el-button, .el-dialog__headerbtn')
        .forEach((el) => el.remove())
      return (
        clone.textContent?.replace(/\s+/g, ' ').replace(/^原解析\s*/, '').replace(/\s*复制$/, '').trim() || ''
      )
    }

    _closeOriginDialog() {
      const closeBtn = document.querySelector(
        '.origin-analysis-dialog .el-dialog__headerbtn, .origin-analysis-dialog .el-dialog__close'
      )
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
        subtree: true,
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

    disable() {
      if (this._mo) {
        this._mo.disconnect()
        this._mo = null
      }
      this._clearPending()
      document.body?.classList.remove(this._originCaptureClass)
      const style = document.getElementById('ksb-origin-analysis-capture-style')
      if (style) style.remove()
      document
        .querySelectorAll(`[${this._originCardAttr}]`)
        .forEach((el) => el.remove())
      document.querySelectorAll('.v-modal').forEach((el) => el.remove())
    }
  }

  AB.sites.kaoshibao = KaoshibaoSite
})()
