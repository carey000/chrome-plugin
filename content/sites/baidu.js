/* 百度搜索结果页：隐藏右侧热搜 / 广告栏 */
;(function () {
  const AB = window.AutoBoat
  const { SiteHandler } = AB

  class BaiduSite extends SiteHandler {
    constructor(id, matchFn) {
      super(id, matchFn)
      this._mo = null
    }

    _hide() {
      const el = document.getElementById('content_right')
      if (el) el.style.setProperty('display', 'none', 'important')
    }

    init() {
      if (this._mo) return
      this._hide()
      this._mo = new MutationObserver(() => this._hide())
      this._mo.observe(document.documentElement, { childList: true, subtree: true })
    }

    disable() {
      if (this._mo) {
        this._mo.disconnect()
        this._mo = null
      }
      const el = document.getElementById('content_right')
      if (el) el.style.removeProperty('display')
    }
  }

  AB.sites.baidu = BaiduSite
})()
