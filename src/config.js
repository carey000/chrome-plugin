/**
 * 功能配置（唯一事实源）
 * - content_script 用它做「域名匹配 + 开关 gating」
 * - popup 用它渲染开关列表
 * 同时兼容 content script（isolated world）与 popup（extension page）两种加载方式。
 */
;(function () {
  const FEATURE_CONFIG = [
    {
      id: 'kuxueyuan',
      label: '酷学院 · 自动看课',
      desc: '静音倍速、防暂停、自动关闭确认弹窗并继续播放',
      storageKey: 'feat_kuxueyuan',
      match(hostname) {
        const h = (hostname || '').toLowerCase()
        if (!h) return false
        if (h.includes('coolcollege')) return true
        if (h.includes('kuxueyuan')) return true
        if (h === 'kxy.cn' || h.endsWith('.kxy.cn') || h.startsWith('kxy.')) return true
        return false
      },
    },
    {
      id: 'baidu',
      label: '百度 · 隐藏热搜栏',
      desc: '自动隐藏搜索结果页右侧热搜 / 广告区域',
      storageKey: 'feat_baidu',
      match(hostname) {
        return hostname === 'baidu.com' || hostname.endsWith('.baidu.com')
      },
    },
    {
      id: 'kaoshibao',
      label: '考试宝 · 解析增强',
      desc: '展开 AI 解析、提取并固定原解析卡片',
      storageKey: 'feat_kaoshibao',
      match(hostname) {
        return hostname === 'kaoshibao.com' || hostname.endsWith('.kaoshibao.com')
      },
    },
  ]

  if (typeof window !== 'undefined') window.FEATURE_CONFIG = FEATURE_CONFIG
  if (typeof module !== 'undefined' && module.exports) module.exports = FEATURE_CONFIG
})()
