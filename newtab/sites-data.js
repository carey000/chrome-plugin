// 网址导航 · 本地静态数据（唯一数据源，运行时零网络请求、零 chrome API、零新权限）
//
// 来源说明（2026-11-13 整理自用户提供的 5 张 iTab 分类截图）：
//  1. 分类：按用户指定启用 5 个 —— 开发 / 设计 / 产品 / 娱乐 / 综合，顺序即顶部切换条顺序。
//     ALL_CATEGORIES 仍是 2026-11-12 从 go.itab.link 的 Vite bundle 爬到的 28 个默认分组名，
//     仅作历史参考，不参与渲染。
//  2. 站点：逐行辨认截图里图标下方的中文/英文标签得到，同一站点出现在多张截图里时
//     只保留一条，用 cat 数组表达多分类归属（例：知乎 → ['开发','产品','娱乐','综合']）。
//  3. URL：**截图里没有网址**，全部按公开官网域名填写。2026-11-13 用 HEAD（失败回退 GET）
//     批量核验 95 个 URL：77 个 200，其余 3xx / 403 / 405 / 402 / 502 多为反爬或拒绝 HEAD，
//     域名本身存在。抽屉新热榜、动漫之家两个国内站本机 DNS / 连接无法确认，已改主域并标
//     tentative。**均未在浏览器逐一打开确认内容与标签一致**，tentative: true 表示站名或
//     域名需要你核对。
//  4. url: '' = 该站点我无法确认官方域名，**不编造**，渲染成不可点的「网址待补」条目。
//     补法：直接把 url 填成 'https://…' 即可，无需改其他文件。
//  5. 天气 / 倒数日 / 今天吃什么 / 恐龙快跑 / 2048 / 扩展管理 / 设置 / 书签管理 /
//     历史记录 / i壁纸 等属于 iTab 内置小组件或本地功能，不是外部网址，按之前约定未录入。
//  6. 当前全部站点用 NT.badge 的 8 色字母块，零图片请求。想要真实图标，给条目补
//     icon: 'https://站点/favicon.ico' 即可（会新增图片请求）。

window.NT = window.NT || {}

;(function (NT) {
  'use strict'

  // iTab 官方默认分组全量（爬取原样，仅作参考；启用的是下面的 CATEGORIES）
  var ALL_CATEGORIES = [
    '主页', '常用', '音乐', '社交', '办公', '娱乐', '购物', '应用', '编程', '学习',
    '阅读', '工具', '喜欢', '收集', '科技', '旅游', '天文', '综合', '绘画', '叶子',
    '图片', '收藏', '健康', '产品', '产品', '标记', '重要', '桶'
  ]

  // 本次启用的 5 个分类；顺序即顶部横向切换条的顺序
  var CATEGORIES = ['开发', '设计', '产品', '娱乐', '综合']

  var SITES = [
    // ---------- 开发 ----------
    { name: 'GitHub',        url: 'https://github.com/',                 cat: '开发' },
    { name: 'Apipost',       url: 'https://www.apipost.cn/',             cat: ['开发', '综合'] },
    { name: 'Apifox',        url: 'https://apifox.com/',                 cat: '开发' },
    { name: 'MDN',           url: 'https://developer.mozilla.org/',      cat: '开发' },
    { name: 'V2EX',          url: 'https://v2ex.com/',                   cat: '开发' },
    { name: 'React',         url: 'https://react.dev/',                  cat: '开发' },
    { name: 'Nuxt.js',       url: 'https://nuxt.com/',                   cat: '开发' },
    { name: 'Electron',      url: 'https://www.electronjs.org/',         cat: '开发' },
    { name: '码云 Gitee',     url: 'https://gitee.com/',                  cat: '开发' },
    { name: 'CSDN',          url: 'https://www.csdn.net/',               cat: '开发' },
    { name: 'CodeSandBox',   url: 'https://codesandbox.io/',             cat: '开发' },
    { name: 'CodePen',       url: 'https://codepen.io/',                 cat: '开发' },
    { name: 'w3school 在线',  url: 'https://www.w3school.com.cn/',        cat: '开发' },
    { name: 'Stack Overflow',url: 'https://stackoverflow.com/',          cat: '开发' },
    { name: 'TypeScript',    url: 'https://www.typescriptlang.org/',     cat: '开发' },
    { name: '掘金',           url: 'https://juejin.cn/',                  cat: '开发' },
    { name: '力扣',           url: 'https://leetcode.cn/',                cat: '开发' },
    { name: 'Vite',          url: 'https://vite.dev/',                   cat: '开发' },
    { name: 'Vue2',          url: 'https://v2.vuejs.org/',               cat: '开发' },
    { name: 'Arco Design',   url: 'https://arco.design/',                cat: '开发' },
    { name: 'Ant Design',    url: 'https://ant.design/',                 cat: '开发' },
    { name: 'Flutter 中文',   url: 'https://flutter.cn/',                 cat: '开发', tentative: true },
    { name: 'Element-UI',    url: 'https://element.eleme.io/',           cat: '开发' },
    { name: '谷歌翻译',       url: 'https://translate.google.com/',       cat: ['开发', '综合'] },
    { name: '七牛云存储',     url: 'https://www.qiniu.com/',              cat: '开发' },
    { name: '开源中国',       url: 'https://www.oschina.net/',            cat: '开发' },
    { name: 'uni-app',       url: 'https://uniapp.dcloud.net.cn/',       cat: '开发' },
    { name: '极客时间',       url: 'https://time.geekbang.org/',          cat: '开发' },
    { name: 'Java学习',       url: '',                                    cat: '开发', tentative: true },
    { name: '亚云',           url: '',                                    cat: '开发', tentative: true },
    { name: '开发者搜索',     url: '',                                    cat: '开发', tentative: true },

    // ---------- 设计 ----------
    { name: '即时设计',       url: 'https://js.design/',                  cat: ['设计', '综合'] },
    { name: '花瓣',           url: 'https://huaban.com/',                 cat: '设计' },
    { name: '站酷',           url: 'https://www.zcool.com.cn/',           cat: '设计' },
    { name: 'Dribbble',      url: 'https://dribbble.com/',               cat: '设计' },
    { name: '优设网',         url: 'https://www.uisdc.com/',              cat: '设计' },
    { name: '天空之城',       url: 'https://www.skypixel.com/',           cat: '设计', tentative: true },
    { name: '大作免费图片',   url: 'https://www.bigbigwork.com/',         cat: '设计', tentative: true },
    { name: 'Noun Project',  url: 'https://thenounproject.com/',         cat: '设计' },
    { name: 'ArtStation',    url: 'https://www.artstation.com/',         cat: '设计' },
    { name: '昵图网',         url: 'https://www.nipic.com/',              cat: '设计' },
    { name: 'Wallhaven',     url: 'https://wallhaven.cc/',               cat: '设计' },
    { name: 'Unsplash',      url: 'https://unsplash.com/',               cat: '设计' },
    { name: 'TinyPNG',       url: 'https://tinypng.com/',                cat: '设计' },
    { name: 'WebGradients',  url: 'https://webgradients.com/',           cat: '设计' },
    { name: 'Iconfont',      url: 'https://www.iconfont.cn/',            cat: ['设计', '产品'] },
    { name: '中国色',         url: 'https://zhongguose.com/',             cat: '设计', tentative: true },
    { name: 'Pixabay',       url: 'https://pixabay.com/',                cat: '设计' },
    { name: '千图网',         url: 'https://www.58pic.com/',              cat: '设计' },
    { name: 'ColorHub',      url: 'https://colorhub.me/',                cat: '设计', tentative: true },
    { name: '稿定设计',       url: 'https://www.gaoding.com/',            cat: '设计' },
    { name: 'UI中国',         url: 'https://www.ui.cn/',                  cat: '设计' },
    { name: 'Freepik',       url: 'https://www.freepik.com/',            cat: '设计' },
    { name: '包图网',         url: 'https://ibaotu.com/',                 cat: '设计', tentative: true },
    { name: '在线PS',         url: 'https://www.photopea.com/',           cat: ['设计', '综合'], tentative: true },
    { name: '花瓣好课',       url: '',                                    cat: '设计', tentative: true },
    { name: '绘画艺术',       url: '',                                    cat: '设计', tentative: true },
    { name: 'R站',            url: '',                                    cat: '设计', tentative: true },
    { name: '酷雀',           url: '',                                    cat: '设计', tentative: true },
    { name: '每日UI设计',     url: '',                                    cat: '设计', tentative: true },
    { name: '搜图导航',       url: '',                                    cat: '设计', tentative: true },
    { name: '奇迹秀',         url: '',                                    cat: '设计', tentative: true },
    { name: '媒体工具箱',     url: '',                                    cat: '设计', tentative: true },
    { name: '图片压缩',       url: '',                                    cat: '设计', tentative: true },

    // ---------- 产品 ----------
    { name: '人人都是产品经理', url: 'https://www.woshipm.com/',         cat: '产品' },
    { name: 'FlowUs',        url: 'https://flowus.cn/',                  cat: ['产品', '综合'] },
    { name: 'Notion',        url: 'https://www.notion.so/',              cat: '产品' },
    { name: 'uTools',        url: 'https://u.tools/',                    cat: '产品' },
    { name: '滴答清单',       url: 'https://dida365.com/',                cat: '产品' },
    { name: '石墨文档',       url: 'https://shimo.im/',                   cat: '产品' },
    { name: 'Teambition',    url: 'https://www.teambition.com/',         cat: '产品' },
    { name: 'ProcessOn',     url: 'https://www.processon.com/',          cat: '产品', tentative: true },
    { name: '知犀思维导图',   url: 'https://www.zhixi.com/',              cat: '产品', tentative: true },
    { name: 'PMCAFF',        url: 'https://www.pmcaff.com/',             cat: '产品' },
    { name: '奶牛快传',       url: 'https://cowtransfer.com/',            cat: '产品' },
    { name: '少数派',         url: 'https://sspai.com/',                  cat: '产品' },
    { name: 'Chrome 应用店',  url: 'https://chromewebstore.google.com/',  cat: '产品', tentative: true },
    { name: 'iSlide',        url: 'https://www.islide.cc/',              cat: ['产品', '综合'], tentative: true },
    { name: '36氪',           url: 'https://36kr.com/',                   cat: ['开发', '产品'] },
    { name: '知乎',           url: 'https://www.zhihu.com/',              cat: ['开发', '产品', '娱乐', '综合'] },
    { name: '芦笋在线录制',   url: '',                                    cat: '产品', tentative: true },
    { name: 'ABCD PDF',      url: '',                                    cat: '产品', tentative: true },

    // ---------- 娱乐 ----------
    { name: '新浪微博',       url: 'https://weibo.com/',                  cat: ['娱乐', '综合'] },
    { name: '爱奇艺',         url: 'https://www.iqiyi.com/',              cat: '娱乐' },
    { name: '优酷',           url: 'https://www.youku.com/',              cat: '娱乐' },
    { name: '腾讯视频',       url: 'https://v.qq.com/',                   cat: '娱乐' },
    { name: 'QQ音乐',         url: 'https://y.qq.com/',                   cat: '娱乐' },
    { name: '网易云音乐',     url: 'https://music.163.com/',              cat: ['娱乐', '综合'] },
    { name: '哔哩哔哩',       url: 'https://www.bilibili.com/',           cat: ['娱乐', '综合'] },
    { name: '脉脉',           url: 'https://maimai.cn/',                  cat: '娱乐' },
    { name: 'Steam',         url: 'https://store.steampowered.com/',     cat: '娱乐' },
    { name: '抖音',           url: 'https://www.douyin.com/',             cat: '娱乐' },
    { name: '每日一文',       url: 'https://meiriyiwen.com/',             cat: '娱乐', tentative: true },
    { name: '即刻网页版',     url: 'https://web.okjike.com/',             cat: '娱乐', tentative: true },
    { name: '4399小游戏',     url: 'https://www.4399.com/',               cat: '娱乐' },
    { name: '虎牙直播',       url: 'https://www.huya.com/',               cat: '娱乐' },
    { name: '斗鱼',           url: 'https://www.douyu.com/',              cat: '娱乐' },
    { name: '番茄小说',       url: 'https://fanqienovel.com/',            cat: '娱乐', tentative: true },
    { name: '煎蛋',           url: 'https://jandan.net/',                 cat: '娱乐', tentative: true },
    { name: '豆瓣',           url: 'https://www.douban.com/',             cat: '娱乐' },
    { name: '腾讯动漫',       url: 'https://ac.qq.com/',                  cat: '娱乐' },
    { name: '抽屉新热榜',     url: 'https://www.chouti.com/',             cat: '娱乐', tentative: true },
    { name: '起点中文网',     url: 'https://www.qidian.com/',             cat: '娱乐' },
    { name: '什么值得买',     url: 'https://www.smzdm.com/',              cat: '娱乐' },
    { name: '微信读书',       url: 'https://weread.qq.com/',              cat: '娱乐' },
    { name: '动漫之家',       url: 'https://dmzj.com/',                   cat: '娱乐', tentative: true },
    { name: '果核剥壳',       url: 'https://www.ghxi.com/',               cat: '娱乐', tentative: true },
    { name: '小霸王',         url: '',                                    cat: '娱乐', tentative: true },
    { name: '番组放送',       url: '',                                    cat: '娱乐', tentative: true },
    { name: '摸鱼',           url: '',                                    cat: '娱乐', tentative: true },
    { name: '半次元',         url: '',                                    cat: '娱乐', tentative: true },
    { name: '小众技术资源库', url: '',                                    cat: '娱乐', tentative: true },
    { name: '什么值得读',     url: '',                                    cat: '娱乐', tentative: true },
    { name: '猫扑',           url: '',                                    cat: '娱乐', tentative: true },
    { name: '即时工具',       url: '',                                    cat: ['娱乐', '综合'], tentative: true },
    { name: '天涯',           url: '',                                    cat: '娱乐', tentative: true },
    { name: '漫画生成',       url: '',                                    cat: '娱乐', tentative: true },
    { name: 'emoji合成',      url: '',                                    cat: '娱乐', tentative: true },
    { name: '此刻电影日历',   url: '',                                    cat: '娱乐', tentative: true },
    { name: '小鸡词典',       url: '',                                    cat: '娱乐', tentative: true },

    // ---------- 综合（截图里的图标多数已在上面按主分类登记，这里只补综合独有项） ----------
    { name: '秘塔写作猫',     url: 'https://xiezuocat.com/',              cat: '综合', tentative: true },
    { name: '火山翻译',       url: 'https://translate.volcengine.com/',   cat: '综合', tentative: true }
  ]

  NT.sitesData = {
    allCategories: ALL_CATEGORIES,
    categories: CATEGORIES,
    sites: SITES
  }
})(window.NT)
