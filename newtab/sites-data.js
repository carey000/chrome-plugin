// 网址导航 · 本地静态数据（唯一数据源，运行时零网络请求、零 chrome API、零新权限）
//
// 数据来源：
//  1. 基础站点：2026-11-13 整理自用户提供的 iTab 分类截图（开发/设计/产品/娱乐/综合）。
//  2. 2026-11-19 增量更新：按 docs/网址导航-分类链接清单.md（用户提供的最新清单）合并。
//     - 新增分类：常用、鱼、杂、mac（追加在原有 5 个之后，顺序即顶部切换条顺序）。
//     - 同名站点：url 用清单里的值覆盖；分类归属取「原有 + 清单」的并集，避免旧分类被清空。
//     - 清单标「删除」的站点（花瓣好课、图片压缩）已移除；标「（待补充）」的站点 url 留空。
//     - 去空格后同名的站点已合并为一条（如 Java学习/Java 学习）。
//  3. URL 均由用户提供或来自 sites-data.js 历史核验；url: '' 表示官方域名待补，渲染成不可点的「网址待补」条目。
//  4. tentative: true 表示站名或域名仍需用户核对；清单已确认 url 的站点会清除该标记。

window.NT = window.NT || {}

;(function (NT) {
  'use strict'

  // iTab 官方默认分组全量（历史参考，不参与渲染）
  var ALL_CATEGORIES = [
    '主页', '常用', '音乐', '社交', '办公', '娱乐', '购物', '应用', '编程', '学习',
    '阅读', '工具', '喜欢', '收集', '科技', '旅游', '天文', '综合', '绘画', '叶子',
    '图片', '收藏', '健康', '产品', '产品', '标记', '重要', '桶'
  ]

  // 本次启用的分类；顺序即顶部横向切换条的顺序
  var CATEGORIES = ["开发", "设计", "产品", "娱乐", "综合", "常用", "鱼", "杂", "mac"]

  var SITES = [
    // ---------- 开发 ----------
    { name: 'GitHub',             url: 'https://github.com/',                                  cat: '开发' },
    { name: 'Apipost',            url: 'https://www.apipost.cn/',                              cat: ['开发', '综合', '杂'] },
    { name: 'Apifox',             url: 'https://apifox.com/',                                  cat: '开发' },
    { name: 'MDN',                url: 'https://developer.mozilla.org/',                       cat: '开发' },
    { name: 'V2EX',               url: 'https://v2ex.com/',                                    cat: '开发' },
    { name: 'React',              url: 'https://react.dev/',                                   cat: '开发' },
    { name: 'Nuxt.js',            url: 'https://nuxt.com/',                                    cat: '开发' },
    { name: 'Electron',           url: 'https://www.electronjs.org/',                          cat: '开发' },
    { name: '码云 Gitee',           url: 'https://gitee.com/',                                   cat: '开发' },
    { name: 'CSDN',               url: 'https://www.csdn.net/',                                cat: '开发' },
    { name: 'CodeSandBox',        url: 'https://codesandbox.io/',                              cat: '开发' },
    { name: 'CodePen',            url: 'https://codepen.io/',                                  cat: '开发' },
    { name: 'w3school 在线',        url: 'https://www.w3school.com.cn/',                         cat: '开发' },
    { name: 'Stack Overflow',     url: 'https://stackoverflow.com/',                           cat: '开发' },
    { name: 'TypeScript',         url: 'https://www.typescriptlang.org/',                      cat: '开发' },
    { name: '掘金',                 url: 'https://juejin.cn/',                                   cat: ['开发', '常用'] },
    { name: '力扣',                 url: 'https://leetcode.cn/',                                 cat: '开发' },
    { name: 'Vite',               url: 'https://vite.dev/',                                    cat: '开发' },
    { name: 'Vue2',               url: 'https://v2.vuejs.org/',                                cat: '开发' },
    { name: 'Arco Design',        url: 'https://arco.design/',                                 cat: '开发' },
    { name: 'Ant Design',         url: 'https://ant.design/',                                  cat: '开发' },
    { name: 'Flutter 中文',         url: 'https://flutter.cn/',                                  cat: '开发', tentative: true },
    { name: 'Element-UI',         url: 'https://element.eleme.io/',                            cat: '开发' },
    { name: '谷歌翻译',               url: 'https://translate.google.com/',                        cat: ['开发', '综合'] },
    { name: '七牛云存储',              url: 'https://www.qiniu.com/',                               cat: '开发' },
    { name: '开源中国',               url: 'https://www.oschina.net/',                             cat: '开发' },
    { name: 'uni-app',            url: 'https://uniapp.dcloud.net.cn/',                        cat: '开发' },
    { name: '极客时间',               url: 'https://time.geekbang.org/',                           cat: '开发' },
    { name: 'Java 学习',            url: 'https://mrjokersince1997.github.io/My-Notes/#/',       cat: '开发' },
    { name: '亚云',                 url: 'https://www.svyun.com/',                               cat: '开发' },
    { name: '开发者搜索',              url: 'https://kaifa.baidu.com/',                             cat: '开发' },
    { name: '36氪',                url: 'https://36kr.com/',                                    cat: ['开发', '产品'] },
    { name: '知乎',                 url: 'https://www.zhihu.com/',                               cat: ['开发', '产品', '娱乐', '综合', '鱼', '杂'] },
    { name: 'Flutter 中文官方',       url: 'https://flutter.cn/',                                  cat: '开发' },

    // ---------- 设计 ----------
    { name: '即时设计',               url: 'https://js.design/',                                   cat: ['设计', '综合', '杂'] },
    { name: '花瓣',                 url: 'https://huaban.com/',                                  cat: '设计' },
    { name: '站酷',                 url: 'https://www.zcool.com.cn/',                            cat: '设计' },
    { name: 'Dribbble',           url: 'https://dribbble.com/',                                cat: '设计' },
    { name: '优设网',                url: 'https://www.uisdc.com/',                               cat: '设计' },
    { name: '天空之城',               url: 'https://www.skypixel.com/',                            cat: '设计' },
    { name: '大作免费图片',             url: 'https://www.bigbigwork.com/',                          cat: '设计' },
    { name: 'Noun Project',       url: 'https://thenounproject.com/',                          cat: '设计' },
    { name: 'ArtStation',         url: 'https://www.artstation.com/',                          cat: '设计' },
    { name: '昵图网',                url: 'https://www.nipic.com/',                               cat: '设计' },
    { name: 'Wallhaven',          url: 'https://wallhaven.cc/',                                cat: '设计' },
    { name: 'Unsplash',           url: 'https://unsplash.com/',                                cat: '设计' },
    { name: 'TinyPNG',            url: 'https://tinypng.com/',                                 cat: '设计' },
    { name: 'WebGradients',       url: 'https://webgradients.com/',                            cat: '设计' },
    { name: 'Iconfont',           url: 'https://www.iconfont.cn/',                             cat: ['设计', '产品'] },
    { name: '中国色',                url: 'https://zhongguose.com/',                              cat: '设计' },
    { name: 'Pixabay',            url: 'https://pixabay.com/',                                 cat: '设计' },
    { name: '千图网',                url: 'https://www.58pic.com/',                               cat: '设计' },
    { name: 'ColorHub',           url: 'https://colorhub.me/',                                 cat: '设计' },
    { name: '稿定设计',               url: 'https://www.gaoding.com/',                             cat: '设计' },
    { name: 'UI 中国',              url: 'https://www.ui.cn/',                                   cat: '设计' },
    { name: 'Freepik',            url: 'https://www.freepik.com/',                             cat: '设计' },
    { name: '包图网',                url: 'https://ibaotu.com/',                                  cat: '设计' },
    { name: '在线 PS',              url: 'https://ps.gaoding.com/#/',                            cat: ['设计', '综合', '杂'] },
    { name: '绘画艺术',               url: 'https://www.qijishow.com/Brand/Brand23/index',         cat: '设计' },
    { name: 'R 站',                url: 'https://www.btbat.com/',                               cat: '设计' },
    { name: '酷雀',                 url: 'https://www.kuque.com/',                               cat: '设计' },
    { name: '每日 UI 设计',           url: 'https://www.uidesigndaily.com/',                       cat: '设计' },
    { name: '搜图导航',               url: 'https://www.91sotu.com/',                              cat: '设计' },
    { name: '奇迹秀',                url: 'https://www.qijishow.com/down/index',                  cat: '设计' },
    { name: '媒体工具箱',              url: 'https://go.itab.link/app.html?id=3Al4ACgvhEGLZ14T_7WAm4765&component=mediaBox&name=%E5%AA%92%E4%BD%93%E5%B7%A5%E5%85%B7%E7%AE%B1',  cat: '设计' },
    { name: 'Unsplash 加速版',       url: 'https://unsplash.com/',                                cat: '设计' },

    // ---------- 产品 ----------
    { name: '人人都是产品经理',           url: 'https://www.woshipm.com/',                             cat: '产品' },
    { name: 'FlowUs',             url: 'https://flowus.cn/',                                   cat: ['产品', '综合', '杂'] },
    { name: 'Notion',             url: 'https://www.notion.so/',                               cat: '产品' },
    { name: 'uTools',             url: 'https://u.tools/',                                     cat: '产品' },
    { name: '滴答清单',               url: 'https://dida365.com/',                                 cat: '产品' },
    { name: '石墨文档',               url: 'https://shimo.im/',                                    cat: '产品' },
    { name: 'Teambition',         url: 'https://www.teambition.com/',                          cat: '产品' },
    { name: 'ProcessOn',          url: 'https://www.processon.com/',                           cat: '产品', tentative: true },
    { name: '知犀思维导图',             url: 'https://www.zhixi.com/',                               cat: '产品' },
    { name: 'PMCAFF',             url: 'https://www.pmcaff.com/',                              cat: '产品' },
    { name: '奶牛快传',               url: 'https://cowtransfer.com/',                             cat: '产品' },
    { name: '少数派',                url: 'https://sspai.com/',                                   cat: '产品' },
    { name: 'Chrome 应用店',         url: 'https://chromewebstore.google.com/',                   cat: '产品', tentative: true },
    { name: 'iSlide',             url: 'https://www.islide.cc/',                               cat: ['产品', '综合'], tentative: true },
    { name: '芦笋在线录制',             url: 'https://lusun.com/?utm_source=itab',                   cat: '产品' },
    { name: 'ABCD PDF',           url: 'https://onlinepdfedit.com/',                           cat: '产品' },
    { name: '流程思维导图',             url: 'https://www.processon.com/',                           cat: '产品' },
    { name: 'Chrome 应用店（扩展搜索）',   url: 'https://chromewebstore.google.com/',                   cat: '产品' },
    { name: 'iSlide PPT 神器',      url: 'https://www.islide.cc/',                               cat: ['产品', '杂'] },

    // ---------- 娱乐 ----------
    { name: '新浪微博',               url: 'https://weibo.com/',                                   cat: ['娱乐', '综合', '鱼', '杂'] },
    { name: '爱奇艺',                url: 'https://www.iqiyi.com/',                               cat: ['娱乐', '鱼'] },
    { name: '优酷',                 url: 'https://www.youku.com/',                               cat: ['娱乐', '鱼'] },
    { name: '腾讯视频',               url: 'https://v.qq.com/',                                    cat: ['娱乐', '鱼'] },
    { name: 'QQ 音乐',              url: 'https://y.qq.com/',                                    cat: ['娱乐', '鱼'] },
    { name: '网易云音乐',              url: 'https://music.163.com/',                               cat: ['娱乐', '综合', '鱼', '杂'] },
    { name: '哔哩哔哩',               url: 'https://www.bilibili.com/',                            cat: ['娱乐', '综合', '杂'] },
    { name: '脉脉',                 url: 'https://maimai.cn/',                                   cat: ['娱乐', '鱼'] },
    { name: 'Steam',              url: 'https://store.steampowered.com/',                      cat: ['娱乐', '鱼'] },
    { name: '抖音',                 url: 'https://www.douyin.com/',                              cat: ['娱乐', '鱼'] },
    { name: '每日一文',               url: 'https://meiriyiwen.com/',                              cat: ['娱乐', '鱼'] },
    { name: '即刻网页版',              url: 'https://web.okjike.com/',                              cat: ['娱乐', '鱼'] },
    { name: '4399 小游戏',           url: 'https://www.4399.com/',                                cat: ['娱乐', '鱼'] },
    { name: '虎牙直播',               url: 'https://www.huya.com/',                                cat: ['娱乐', '鱼'] },
    { name: '斗鱼',                 url: 'https://www.douyu.com/',                               cat: ['娱乐', '鱼'] },
    { name: '番茄小说',               url: 'https://fanqienovel.com/',                             cat: ['娱乐', '鱼'] },
    { name: '煎蛋',                 url: 'https://jandan.net/',                                  cat: ['娱乐', '鱼'] },
    { name: '豆瓣',                 url: 'https://www.douban.com/',                              cat: ['娱乐', '鱼'] },
    { name: '腾讯动漫',               url: 'https://ac.qq.com/',                                   cat: ['娱乐', '鱼'] },
    { name: '抽屉新热榜',              url: 'https://www.chouti.com/',                              cat: ['娱乐', '鱼'] },
    { name: '起点中文网',              url: 'https://www.qidian.com/',                              cat: ['娱乐', '鱼'] },
    { name: '什么值得买',              url: 'https://www.smzdm.com/',                               cat: ['娱乐', '鱼'] },
    { name: '微信读书',               url: 'https://weread.qq.com/',                               cat: ['娱乐', '鱼'] },
    { name: '动漫之家',               url: 'https://dmzj.com/',                                    cat: ['娱乐', '鱼'] },
    { name: '果核剥壳',               url: 'https://www.ghxi.com/',                                cat: '娱乐', tentative: true },
    { name: '小霸王',                url: '',                                                     cat: ['娱乐', '鱼'], tentative: true },
    { name: '番组放送',               url: '',                                                     cat: ['娱乐', '鱼'], tentative: true },
    { name: '摸鱼',                 url: '',                                                     cat: ['娱乐', '鱼'], tentative: true },
    { name: '半次元',                url: '',                                                     cat: ['娱乐', '鱼'], tentative: true },
    { name: '小众技术资源库',            url: '',                                                     cat: ['娱乐', '鱼'], tentative: true },
    { name: '什么值得读',              url: '',                                                     cat: ['娱乐', '鱼'], tentative: true },
    { name: '猫扑',                 url: '',                                                     cat: ['娱乐', '鱼'], tentative: true },
    { name: '即时工具',               url: 'https://www.67tool.com/?ref=sdk',                      cat: ['娱乐', '综合', '鱼', '杂'] },
    { name: '天涯',                 url: '',                                                     cat: ['娱乐', '鱼'], tentative: true },
    { name: '漫画生成',               url: '',                                                     cat: ['娱乐', '鱼'], tentative: true },
    { name: 'emoji 合成',           url: '',                                                     cat: ['娱乐', '鱼'] },
    { name: '此刻电影日历',             url: '',                                                     cat: ['娱乐', '鱼'], tentative: true },
    { name: '小鸡词典',               url: '',                                                     cat: ['娱乐', '鱼'], tentative: true },

    // ---------- 综合 ----------
    { name: '秘塔写作猫',              url: 'https://xiezuocat.com/',                               cat: ['综合', '杂'] },
    { name: '火山翻译',               url: 'https://translate.volcengine.com/',                    cat: ['综合', '常用', '杂'] },

    // ---------- 常用 ----------
    { name: 'Speed Test',         url: 'https://pagespeed.web.dev/',                           cat: '常用' },
    { name: '字体图标库',              url: '',                                                     cat: '常用' },
    { name: '程序员手册',              url: '',                                                     cat: '常用' },
    { name: 'Nextjs 中文文档',        url: '',                                                     cat: '常用' },
    { name: 'IP 查询',              url: '',                                                     cat: '常用' },
    { name: '正则 reg',             url: 'https://regexr.com/',                                  cat: '常用' },
    { name: 'Google',             url: 'https://www.google.com/',                              cat: '常用' },

    // ---------- 鱼 ----------
    { name: 'Bilibili',           url: 'https://www.bilibili.com/',                            cat: '鱼' },
    { name: '果壳剥壳',               url: 'https://www.ghxi.com/',                                cat: '鱼' },

    // ---------- mac ----------
    { name: 'MacFk → 艾麦…（名称被截断）',  url: 'https://www.macfk.com/',                               cat: 'mac' },
    { name: 'mac',                url: '',                                                     cat: 'mac' },
  ]

  NT.sitesData = {
    allCategories: ALL_CATEGORIES,
    categories: CATEGORIES,
    sites: SITES
  }
})(window.NT)
