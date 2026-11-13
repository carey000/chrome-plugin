// 网址导航 · 本地静态数据（唯一数据源，运行时零网络请求、零 chrome API、零新权限）
//
// 来源说明（2026-11-12 实际抓取 https://go.itab.link/ 的 Vite bundle）：
//  1. 分类名：assets/HomeNavGroup-BtBDUm4S.js 内 Object.freeze([{name:"主页",...}])
//     共 28 项，原样保存在 ALL_CATEGORIES；CATEGORIES 是本次启用的子集。
//  2. 具体网址 / 图标清单：iTab 存在用户本地 navConfig（localStorage + IndexedDB），
//     登录后才走云同步；公开静态资源里没有清单（js/navConfig.json、data/icon.json、
//     icon/list.json 均 404）。所以这份 SITES 不是从 iTab 爬来的完整清单，而是：
//       - from: 'screenshot' —— 从用户提供的界面截图里可辨认 / 按图标推断的站点
//       - from: 'public'     —— 补充的公开官网示例
//     URL 均按公开官网域名填写，**未在浏览器逐一核验**；tentative: true 表示截图
//     下方中文标签分辨率不足、站点名是按图标推断的，需要你核对或删掉。
//  3. 想换成自己的清单：直接改 SITES。想显示真实图标，给条目补
//     icon: 'https://站点/favicon.ico'；不填则用 NT.badge 的 8 色字母块（零请求）。

window.NT = window.NT || {}

;(function (NT) {
  'use strict'

  // iTab 官方默认分组全量（爬到的原样，含 bundle 内的重复项与末尾截断项）
  var ALL_CATEGORIES = [
    '主页', '常用', '音乐', '社交', '办公', '娱乐', '购物', '应用', '编程', '学习',
    '阅读', '工具', '喜欢', '收集', '科技', '旅游', '天文', '综合', '绘画', '叶子',
    '图片', '收藏', '健康', '产品', '产品', '标记', '重要', '桶'
  ]

  // 本次启用的分类；顺序即顶部横向切换条的顺序
  var CATEGORIES = ['常用', '办公', '产品', '编程', '工具', '阅读']

  var SITES = [
    { name: 'Notion',    url: 'https://www.notion.so/',            cat: '常用', from: 'screenshot' },
    { name: 'FlowUs',    url: 'https://flowus.cn/',                cat: '常用', from: 'screenshot' },
    { name: 'uTools',    url: 'https://u.tools/',                  cat: '常用', from: 'screenshot' },
    { name: '滴答清单',   url: 'https://dida365.com/',              cat: '常用', from: 'screenshot', tentative: true },

    { name: '石墨文档',   url: 'https://shimo.im/',                 cat: '办公', from: 'screenshot' },
    { name: '飞书',      url: 'https://www.feishu.cn/',            cat: '办公', from: 'screenshot', tentative: true },
    { name: 'Trello',    url: 'https://trello.com/',               cat: '办公', from: 'screenshot', tentative: true },

    { name: 'PMCAFF',    url: 'https://www.pmcaff.com/',           cat: '产品', from: 'screenshot' },
    { name: 'MasterGo',  url: 'https://mastergo.com/',             cat: '产品', from: 'screenshot', tentative: true },
    { name: 'Figma',     url: 'https://www.figma.com/',            cat: '产品', from: 'screenshot', tentative: true },

    { name: 'GitHub',    url: 'https://github.com/',               cat: '编程', from: 'public' },
    { name: 'MDN',       url: 'https://developer.mozilla.org/',    cat: '编程', from: 'public' },

    { name: 'Chrome 应用店', url: 'https://chromewebstore.google.com/', cat: '工具', from: 'screenshot', tentative: true },

    { name: '知乎',      url: 'https://www.zhihu.com/',            cat: '阅读', from: 'screenshot' },
    { name: '少数派',    url: 'https://sspai.com/',                cat: '阅读', from: 'screenshot', tentative: true }
  ]

  NT.sitesData = {
    allCategories: ALL_CATEGORIES,
    categories: CATEGORIES,
    sites: SITES
  }
})(window.NT)
