# 新标签页插件功能调研与集成建议

- 日期：2026-11-12
- 性质：**调研 + 建议，本轮零代码改动**（未修改任何 `.js` / `.css` / `.html` / `manifest.json`）
- 调研对象：国内 8 类 + 海外 19 款新标签页 / 起始页 / 标签管理扩展
- 判定目标：「还有哪些功能**值得**集成到本插件」

> 与既有文档的关系：`docs/itab-optimization-plan.md` 第 2 节「现有功能保留清单」仍是硬约束，本文档的建议全部建立在不破坏它的前提上；该文档第 3.2 节的 v1 阶段划分已作废。`docs/ISSUES.md` 描述的是旧版代码（提到 jQuery、2 倍速、background timers），与当前实现不符，**未作为本轮依据**。

---

## 0. 结论速览

| 级别 | 功能 | 新增权限 | 核心理由 |
|---|---|---|---|
| **P0-1** | 数据导出 / 导入 / 本地备份 | 无 | 当前 7 个 `storage.local` key 无任何备份路径，卸载扩展即丢；市面几乎全品类都有 |
| **P0-2** | 一键收纳标签（保存后关闭原标签） | 无 | OneTab / Toby / Session Buddy 的核心机制；我们已有保存 + 新窗口恢复，只差「关闭」这一步 |
| **P0-3** | 网址导航可视化增删改 + 右键添加当前站点 | 无（`contextMenus` 已声明未用） | `sites-data.js` 写死 15 条、7 条 `tentative`，是现在最大的功能短板 |
| **P1-1** | 重复标签检测与一键关闭 | 无 | `tabs.query` 已具备；Tab Manager Plus / Toby / tabmanager.io 均有 |
| **P1-2** | 最近关闭的标签 / 窗口 | `sessions` | 与现有「页面历史」语义不同，互补不重复；`MAX_SESSION_RESULTS = 25` |
| **P1-3** | 免账号跨设备同步（仅设置类小数据） | 无（`storage` 已声明） | `chrome.storage.sync` 走 Chrome Sync，不需要后端和账号；但配额严格 |
| **P1-4** | 深浅色主题 + 本地背景图 | 无 | 纯 CSS；市面全品类标配。需注意两套独立 `:root` |
| **P2-1** | 页内统一搜索 / 命令面板 | 无 | 一次搜站点 + 已存标签 + Open Tabs + 历史，数据已全在内存 |
| **P2-2** | 地址栏 omnibox 关键字 | 无（需 manifest `omnibox` key） | 与 newtab override 共存性**官方文档未明确确认**，需实测 |
| **P2-3** | 纯本地小组件（待办 / 便笺 / 倒数日 / 番茄钟） | 无 | 零网络，走「新增 nav-item」路径；但与你此前的收窄决策有边界，见 §5 |

**一句话结论**：市面产品分两条路线 ——「视觉装饰型」（壁纸 / 小组件 / 天气）和「标签治理型」（收纳 / 恢复 / 去重 / 备份）。你已明确砍掉前者里需要接口的部分，而**后者的核心能力恰好是浏览器扩展 API 独占、普通网页版起始页做不到的**，且本插件已经做了一半。所以最值得做的不是加新组件，而是把已有的标签治理链路补完整，再加一层数据保全。

---

## 1. 「值得」的判定标准（把主观词客观化）

| # | 标准 | 依据 |
|---|---|---|
| A | 不删除、不改动任何现有功能 | `docs/itab-optimization-plan.md` 第 2 节；用户第 13 条需求原文「要保留现有的所有功能」 |
| B | 零后端 / 零账号 / 零外部 API 调用 | 用户决策「需要调接口的那些功能都不用管」；项目当前无任何 `fetch` / XHR / WebSocket |
| C | 优先零新增权限；必须新增时明确列出权限名与 reload 成本 | `manifest.json` L12-23 |
| D | 架构兼容：新增 nav-item + `VIEW_MAP` 一行 + 新 `nt_xxx_*` key + 脚本末尾追加 | `docs/itab-optimization-plan.md` §0.4 |
| E | 有可核验来源（官方商店 / 官网 / 官方帮助文档 / 第三方评测），并标注性质 | 本轮调研 |
| F | 不与现有能力重复造轮子 | §2.1 |

### 1.1 来源可信度分级

| 标签 | 含义 | 本轮使用方式 |
|---|---|---|
| 【官方商店】 | Chrome Web Store / Edge Add-ons 详情页 | 可作功能定论 |
| 【官网】 | 官方站点营销文案 | 可作功能定论，措辞可能夸张 |
| 【官方帮助】 | 官方帮助文档 / README / 开发者博客 | 机制细节最可靠 |
| 【第三方】 | 评测、报道、镜像站 | 仅作交叉印证，不单独定论 |
| 【摘要】 | 仅检索索引片段，页面未成功打开 | 只作线索 |
| 【推断】 | 调研方推断 | 一律显式标注，不当事实 |

**未实测声明**：本轮全部为桌面资料调研 + 本地代码静态核对，**没有实机安装任何一款竞品**，也没有在浏览器里验证下列 API 的实际行为。凡涉及运行时结论的地方都标了「需实测」。

---

## 2. 我们的现状基线（可核验）

### 2.1 已实现，明确不重复推荐

| 能力 | 实现位置 | 市面对应产品 |
|---|---|---|
| 新标签页覆盖、三栏布局、nav 折叠、响应式三断点 | `manifest.json` L28-30；`newtab/newtab.css` L1217-1352 | 全部起始页 |
| 15 个内置引擎 + 自定义引擎 + 引擎面板 / 弹窗 | `newtab/engines.js` L14-30、L121-149；`newtab/search.js` | iTab / Infinity / 青柠 / Bonjourr |
| 网址导航（28 分类 / 启用 6 / 15 站点）+ 顶部横向分类 | `newtab/sites-data.js`、`newtab/sites.js` | iTab / Infinity / WeTab |
| 大时间 + 公历年月日 + 星期 + 农历（`Intl` 零接口） | `newtab/newtab.js` L8-38、L112、L130 | 全品类时钟组件 |
| Open Tabs 按窗口分组、折叠、单个关闭、保存窗口 | `newtab/sessions.js` L129-209 | Toby / Session Buddy / Tabli |
| 集合 upsert 去重、刷新同步、重命名、删除、折叠 | `newtab/sessions.js` L65-83、L250-272、L313-414 | Toby Collections |
| 恢复全部 → `chrome.windows.create({url: urls})` 新窗口 | `newtab/sessions.js` L416-434 | Session Buddy 单窗口恢复 |
| 页面历史（最近 200 条，`history.search`） | `newtab/history.js` L16 | Infinity 侧边栏 |
| 书签树 + 编辑 + 顶部 Chrome 原生标签组 | `bookmarks/bookmarks.js` L12-19、L271-370 | Infinity / Humble / FVD |
| popup 三站点开关、热切换、直达按钮 | `popup/index.js`、`src/config.js` | 本插件独有 |
| 三个站点 content 脚本（酷学院 / 百度 / 考试宝） | `content/`、`manifest.json` L45-52 | 本插件独有 |

### 2.2 已声明但零调用的 5 个权限 —— 这是零成本机会

`manifest.json` L12-23 声明了 10 个权限，其中 `sidePanel`、`scripting`、`activeTab`、`contextMenus`、`notifications` **代码中零调用**。`contextMenus` 可直接支撑 P0-3 的「右键添加当前站点」，无需改 manifest、无需重载扩展。

### 2.3 硬约束（新增功能必须遵守）

| 约束 | 位置 |
|---|---|
| MV3 默认 CSP：无内联脚本 / 内联事件 / 远程 `<script src>` / `eval`；无 `import/export`，无构建链 | 三个 HTML 全部为本地外部脚本 |
| 4 个全局命名空间：`window.NT` / `FAVICON` / `FEATURE_CONFIG` / `AutoBoat` | `newtab/common.js` L4 等 |
| 9 个脚本严格顺序；`sites-data.js` 必须先于 `sites.js`，`engines.js` 必须先于 `search.js`（**加载时求值**） | `newtab/newtab.html` L208-217 |
| 默认视图由 **HTML 初始属性**实现，JS 不调用 `switchView(DEFAULT_VIEW)` | `newtab.html` L27/114/128/140/155；`newtab.js` L62、L106-131 |
| `VIEW_MAP` 的 key / `data-view` / section id 三处强一致；`side` 决定右栏显隐 | `newtab.js` L63-82 |
| 7 个既有 `storage.local` key 不可复用改名：`nt_engine_enabled/active/custom`、`nt_collections`、`feat_kuxueyuan/baidu/kaoshibao` | `newtab/engines.js` L9-11 等 |
| 全部跳转唯一出口 `NT.openInNewTab`（`chrome.tabs.create`），header 链接额外 `preventDefault` | `newtab/common.js` L10-14；`newtab.js` L48-58 |
| `[hidden]{display:none !important}` 是所有视图 / 弹窗显隐的前提 | `newtab.css` L32-34 |
| 两套独立 `:root` 与两套 `.tone-0..7`；popup 无变量 | `newtab.css` L7-17；`bookmarks.css` L7-15 |
| 集合 `source` 是隐形协议：`window:<id>` / `all`，刷新靠 `slice(7)` 解析 | `newtab/sessions.js` L10-15、L250-253 |
| 可访问 URL 正则三套不一致：`sessions.js` / `bookmarks.js` 含 `file://`，`history.js` 不含 | 三处 L9 / L358 / L8 |
| tabs 事件已有三处监听 + 各自 150ms 防抖，再叠加会重复刷新 | `sessions.js` L487-489、`bookmarks.js` L382-393、`background.js` L26 |

---

## 3. 市面功能地图（去重后）

### 3.1 覆盖产品

| 方向 | 产品 | 主要来源 |
|---|---|---|
| 国内 | iTab、WeTab、Infinity New Tab Pro、青柠起始页、简 Tab、MONKNOW、BdTab、抓鱼鸭 / 小舒同学 / 几枝 | 【官方商店】+【官网】+ 少数派横评【第三方】 |
| 海外·起始页 | Momentum、Start.me、Bonjourr、Nighttab、Tabliss、Humble New Tab Page、Earth View、FVD Speed Dial、Freedial、New Tab Studio | 【官方商店】+【官网】+【官方帮助】 |
| 海外·标签治理 | OneTab、Toby、Session Buddy、Workona、Tabli、Cluster、Tab Manager Plus、Tab Session Manager、tabmanager.io | 【官方商店】+【官方帮助】 |

### 3.2 功能全集与我们的差距

| 组 | 市面常见功能 | 联网/账号依赖 | 我们 |
|---|---|---|---|
| ① 图标导航 | 图标增删改排、拖拽、文件夹、内置图标库、自定义图标/字体/色、一键添加当前站点、Ctrl+F 本地全局搜索 | 无 | 部分有（写死数据，无增删改） |
| ② 搜索 | 多引擎切换、自定义引擎、聚合搜索、站点内搜索、算式计算、翻译、0-9 数字键 | 翻译需 API | 多引擎 + 自定义已有；算式/站内搜索无 |
| ③ 小组件 | 天气、热搜、股市、汇率、RSS、待办、便笺、倒数日、番茄钟、习惯打卡、一言、日历 | 天气/热搜/股市/汇率/RSS 需接口；待办/便笺/倒数日/番茄钟/一言 **纯本地** | 仅时钟 + 农历 |
| ④ 壁纸主题 | 在线壁纸库、每日图、动态/视频壁纸、本地上传、模糊/遮罩、深浅色、极简模式、自定义 CSS | 在线图源需联网；本地上传与主题无 | 固定 `#f0ede8`，无主题切换 |
| ⑤ 标签治理 | 一键收纳并关闭、逐条/整组恢复、会话快照、时间线回溯、重复标签检测、窗口合并、标签挂起、原生标签组保色、导入导出 | 全部零外网（扩展 API） | 保存/刷新/恢复/关闭已有；**无收纳关闭、无去重、无导入导出、无快照** |
| ⑥ 书签 | 书签树展示、最常访问、最近关闭、坏链/重复链接检查、点击统计 | 坏链检查需联网 | 书签树 + 编辑 + 标签组已有 |
| ⑦ 同步账号 | 云同步、自动/手动备份、历史备份节点、团队空间、SSO | 账号 + 后端（**唯一例外**：`storage.sync` / Chrome 书签同步免账号） | 全本地，无任何备份 |
| ⑧ 导入导出 | JSON / CSV / Markdown / HTML / 纯文本、OPML、剪贴板、跨产品迁移 | 无 | **完全没有** |
| ⑨ 快捷操作 | `/` 聚焦搜索、命令面板、omnibox 关键字、浏览器级全局快捷键、右键菜单 | 无 | 仅 Enter 提交 |
| ⑩ 其他 | 专注模式/网站拦截、侧边栏、徽章、多语言、统计、AI 对话 | 拦截需 `declarativeNetRequest`；AI 需后端 + key | 无 |

### 3.3 一个关键发现

调研里 iTab / WeTab / Infinity / 青柠 / 简 Tab / MONKNOW 这 6 款主流**起始页**，⑤ 标签治理一栏全部是「未查到」；反过来 OneTab / Toby / Session Buddy / Tab Manager Plus 这些**标签管理工具**几乎没有壁纸和小组件。

原因是能力边界：普通网页版起始页拿不到 `chrome.tabs` / `windows` / `tabGroups` / `sessions` / `bookmarks` / `topSites` / `history`；只有扩展能。本插件已声明 `tabs` / `bookmarks` / `tabGroups` / `history` 并实现了三视图，**恰好落在两条路线的交叉点上**。这也是不建议为了视觉相似度把标签治理改弱的原因 —— 那是差异化优势，不是包袱。

---

## 4. 分级建议（逐项可核验依据）

### 4.1 P0 · 强烈建议（零新增权限，直接补短板）

#### P0-1 数据导出 / 导入 / 本地备份

| 项 | 内容 |
|---|---|
| 市面依据 | OneTab【官网】"Easily export and import lists of tabs, or share your list as a web page"；Session Buddy【官网】"Support for 15+ formats including plain text, links, JSON, CSV, Markdown, and HTML" + 自动备份 / 一键手动备份 / 恢复误删；Toby【官方博客】设置内含 "import and export options"；Tab Manager Plus / Cluster / tabmanager.io / iTab / Start.me / Nighttab 均有导入导出或备份 |
| 解决什么 | 现在 `nt_collections` 等 7 个 key 只写不备份。OneTab【官方帮助】明确警告 "Uninstalling OneTab will cause your browser to delete your stored tabs" —— `storage.local` 随扩展卸载被清除是同类产品的共同风险 |
| 依赖 | 零新增权限。导出：`Blob` + `URL.createObjectURL` + `<a download>`；导入：`<input type="file">` + `FileReader`。**这是源码级判断，未在扩展页实测**；若 blob 下载被 CSP 拦，退路是 `chrome.downloads`（需新增 `downloads` 权限） |
| 改动面 | 新增 `newtab/backup.js`（或并入 `sessions.js`）+ 一个 nav-item 或设置按钮 + 1 个 `nt_backup_meta` key；`VIEW_MAP` 加一行 |
| 必须做的防护 | 导入要校验 JSON schema、字段类型、URL 协议白名单（挡 `javascript:` / `data:` / `vbscript:`），集合数组非数组要回落空；`flashButton` 用 `innerHTML` 存/恢复 SVG 的契约不能破 |
| 建议范围 | 只导出 newtab 侧 4 个 key（`nt_engine_*` + `nt_collections`）。`feat_*` 属于 content/popup 开关，语义不同，别混在一个文件里 |

#### P0-2 一键收纳标签（保存 + 关闭原标签）

| 项 | 内容 |
|---|---|
| 市面依据 | OneTab【官方商店】"click the OneTab icon to convert all of your tabs into a list" +【官网】"Save up to 95% memory"；Toby【官方商店】"Save a whole window as a session in one click, and Toby closes those tabs for you"；Session Buddy【官网】"Save open tabs with a single click"；Start.me【官方帮助】"Save open browser tabs" |
| 我们差在哪 | `saveWindowTabs` / `saveCurrentTabs` 只写入集合，**不关闭任何标签**；`restoreAll` 已经能一次开新窗口。缺的就是「保存后关闭」这一步，做完即形成 `收纳 → 列表 → 一键恢复` 闭环 |
| 依赖 | 零新增权限：`NT.tabsQuery` + `upsertCollection` + `chrome.tabs.remove`（`sessions.js` L103 已有该 API 的可用性 guard 和 `lastError` 兜底，直接复用） |
| 改动面 | `sessions.js` 加一个 `stashWindow(windowId)`，右栏每组「保存窗口标签」旁加一个「收纳并关闭」按钮；单函数可完成，不拆模块 |
| **必须处理的边界** | ① **不能关掉 newtab 自己**，否则页面直接消失 —— 按 `chrome-extension://<runtime.id>/newtab/` 前缀或 active tab 排除；② `chrome://` 等 `isRestorable` 为 false 的标签不关；③ `tabs.remove` 会触发已有 `onRemoved` → `scheduleRefresh`，已有 150ms 防抖，不用另加监听；④ 保存失败时**不要关闭标签** |
| 未擅自决定 | 「收纳」是否默认关闭原标签、是否给二次确认。Toby 提供「保持打开」选项，OneTab 默认直接关 —— 两种都是合理设计，需要你定 |

#### P0-3 网址导航可视化增删改 + 右键添加当前站点

| 项 | 内容 |
|---|---|
| 市面依据 | iTab【官网】"一键将当前网站 添加到你的iTab主页 *仅支持插件版" +【官方商店】"内置精心整理的全球海量优质网站资源图标库"；Infinity【官方商店】"添加、编辑、重新排序或删除任何快捷方式"；WeTab【官网】"快速添加常用网站"；青柠【官网 W10】"导入浏览器收藏夹"；MONKNOW【官网】"import browser bookmarks" |
| 现状问题 | `sites-data.js` 的 15 条 `SITES` 是**写死在 JS 里的静态常量**，7 条标了 `tentative: true`、URL 未逐一核验（见 `itab-optimization-plan.md` §0.2）。不能增删改 = 这个 nav-item 目前只是个演示页 |
| 依赖 | 零新增权限。方案 B（推荐先做）：视图内「+ 添加」表单 + 编辑/删除，写 `nt_sites_custom`，与静态 `SITES` 合并渲染。方案 A（增强）：`chrome.contextMenus.create({contexts:['page']})` —— `contextMenus` 权限**已声明且零调用**，但需要在 `background/background.js` 加监听，并解决跨上下文通信（现有链路只有 `tabs.sendMessage` → `runtime.onMessage`，**无 `runtime.sendMessage`**；可借 `storage.local` + `storage.onChanged` 传递） |
| 改动面 | 方案 B：`sites.js` + `sites-data.js` + 1 个新 key；方案 A 额外改 `background.js`（注意 background 目前只监听 `tabs.onUpdated`，L26） |
| 约束 | 新 key 必须 `nt_sites_*` 前缀；`sites.js` 自初始化按 `document.readyState` 分支且不判断当前视图（L95-99），改为异步读 storage 后要保证容器已解析，否则 L71 静默 return 不再重试 |

### 4.2 P1 · 建议（小改动高收益）

| 编号 | 功能 | 市面依据 | 依赖 / 权限 | 关键 caveat |
|---|---|---|---|---|
| P1-1 | 重复标签检测与一键关闭 | Tab Manager Plus【官方商店】"Highlight duplicate tabs - only the extra copies are selected"；Toby【官方商店】付费版 "find and remove duplicate saved tabs"；tabmanager.io【官方商店】"Remove duplicate Tabs" | 零新增权限，`tabs.query({})` 已有，按归一化 `url` 分组 + `tabs.remove` | 排除 newtab 自身 / pinned / active / `chrome://`；保留哪一份要定规则（Tab Manager Plus 是保留最近使用） |
| P1-2 | 最近关闭的标签 / 窗口 | Humble【官方帮助·README】"recently closed"；Session Buddy【官网】"Resurrect closed tabs long after they've dropped off your browser's 'Recent tabs' list"；Tab Session Manager【官方商店】 | **需新增 `sessions` 权限 → 必须 `chrome://extensions` 重载**。`chrome.sessions.getRecentlyClosed()` / `restore()`；官方【官方帮助】`MAX_SESSION_RESULTS = 25` | 与现有「页面历史」不同：`history.search` 是**访问过的记录**，`sessions` 是**被关闭的窗口/标签**，两者互补。别把 200 条 history 当成它的替身 |
| P1-3 | 免账号跨设备同步（只同步设置类小数据） | 市面云同步普遍要账号 + 后端：iTab【官网】"需要注册并登录账号"、Start.me【官网】"hosted online"、Workona【官方商店】"securely store your spaces in the cloud"；免账号特例：Tabli / Freedial 借 Chrome 书签同步【第三方】、【官方商店】 | **零新增权限**，`storage` 已声明。`chrome.storage.sync` 走 Chrome Sync【官方帮助】"Items in the `sync` storage area are synced using Chrome Sync" | 配额【官方帮助·精确值】：`QUOTA_BYTES 102400` / `QUOTA_BYTES_PER_ITEM 8192` / `MAX_ITEMS 512` / `1800` 次每小时 / `120` 次每分钟；`unlimitedStorage` **不提升 sync 配额**。所以只同步引擎设置 / nav 折叠 / 主题等小数据，**不要同步 `nt_collections`**（含 favIconUrl，易超 8KB 单项）。未登录或未启用同步时【官方帮助】"behaves like `storage.local`"。现有 `NT.storageGet/Set` 固定走 `local`，需要显式新增一个 sync 通道，不要整体替换 |
| P1-4 | 深浅色主题 + 本地背景图 | Momentum / Bonjourr / Start.me / Tabliss / Nighttab / iTab / WeTab 全品类【官方商店】 | 零新增权限，纯 CSS + `storage.local` | ① **两套独立 `:root`**（`newtab.css` L7-17 / `bookmarks.css` L7-15）必须同步，popup 无变量；② 本地图片若用 dataURL 存 `storage.local`，官方【官方帮助】上限 `10485760` B（`unlimitedStorage` 可提额），大图建议 IndexedDB；③ **不要接在线壁纸库**（联网，与决策 B 冲突） |

### 4.3 P2 · 可选，实施前需你确认

| 编号 | 功能 | 市面依据 | 待确认点 |
|---|---|---|---|
| P2-1 | 页内统一搜索 / 命令面板（一次搜站点 + 已存标签 + Open Tabs + 历史） | Toby【官方商店】"One search covers your spaces, collections, saved tabs and open tabs"；Session Buddy【官网】"unified search across open tabs, collections, and tab history"；OneTab【官方帮助】`/` 聚焦；iTab【官网 W3】Ctrl+F 本地全局搜索 | 现在搜索框 Enter 的语义是「提交到搜索引擎」。命令面板要不要复用这个框、用什么键进入命令模式，会改变既有交互，必须先定。数据本身零权限、已全在内存 |
| P2-2 | 地址栏 omnibox 关键字 | OneTab【官方帮助】`11space`；Toby【官方商店】`to/docs`；Start.me【官方博客】`me` | 需 manifest 加 `"omnibox": {"keyword": "..."}`，**无 permissions 项**【官方帮助】。但官方文档**既未记录禁止、也未明确确认**它与 `chrome_url_overrides.newtab` 共存 → 需实测，我不能断言。另外你此前明确删过快捷键链路（`Ctrl+Shift+Alt+B` → `Alt+Shift+B` → 全删），全局快捷操作是否重新引入需你点头 |
| P2-3 | 纯本地小组件（待办 / 便笺 / 倒数日 / 番茄钟 / 一言） | Start.me【官网】"Notes / Tasks / Pomodoro focus timers"；Bonjourr【官方商店】"Markdown notes and checklists / Pomodoro focus timer"；青柠【官方商店】便笺 + Markdown + 倒数日；New Tab Studio【官方商店】130+ 组件（多数需联网，只取纯本地那几个） | 零网络，走「新增 nav-item」路径，正好对应 `docs/itab-optimization-plan.md` §0.4。但你此前说「只需要整理他现有的 tab」「后续有其他功能再新增 nav-item 就行」，所以列为可选，不主动纳入本期 |

---

## 5. 两处精确性纠错（避免被旧表述绕晕）

| 原表述 | 问题 | 纠正后 |
|---|---|---|
| `docs/itab-optimization-plan.md` §0.1 把「农历 / 亲戚称呼计算器」和「天气」并列为「需要调接口的功能」 | **农历不需要任何接口**。我们后来已经用浏览器 ICU 本地算出来了：`Intl.DateTimeFormat('zh-CN-u-ca-chinese')` + 30 项中文日名表，落在 `newtab/newtab.js` L8-38，实测 2026-11-12 → 十月初四、2025-01-29 / 2024-02-10 / 2026-02-17 → 正月初一。**亲戚称呼计算器也是纯本地规则计算，同样不调接口** | 真正需要接口的是：天气、热搜榜、股市/汇率、RSS/资讯、在线壁纸库、翻译 API、IP 查询、AI 对话。农历已实现，亲戚称呼只是「小组件类」而非「接口类」 |
| 「需要调接口的功能都不用管」是否等于「所有小组件都不做」 | 你举的两个例子里，一个是真接口（天气），一个不是（亲戚称呼）。所以按字面推会误伤纯本地组件 | 按你的**意图**处理：整类装饰型小组件本期都不纳入，P2-3 只作为「以后加 nav-item」的候选列出并标可选，不进推荐主线。这个理解如有偏差请指出 |

---

## 6. 明确不建议（含理由）

| 功能 | 市面谁有 | 不做的理由 |
|---|---|---|
| 天气 / 热搜榜 / 股市 / 汇率 / RSS / 每日资讯 | iTab、WeTab、Momentum、Start.me、New Tab Studio【官方商店】 | 依赖第三方 API 或抓取。iTab 天气用和风天气【第三方 T1】；与你「需要调接口的都不用管」的决策直接冲突，项目也无后端与 API key 管理 |
| AI 对话 / AI 生成 PPT / AI 绘画 / 文档解析 | WeTabAI【官方商店】"已整合 WetabAI 组件"；Momentum Plus【第三方】；Infinity【第三方】 | 后端大模型 + API key + 账号体系；WeTab 还有网信办算法备案【备案 T10】。远超「纯本地 MV3」范围 |
| 在线壁纸库 / 每日 Bing 图 / Unsplash / 动态视频壁纸 | 全品类 | 联网图源。P1-4 只做本地上传版本 |
| 账号注册登录 / 云同步后端 / 团队 Space / SSO | Toby、Workona、Start.me、iTab、Infinity、青柠、MONKNOW【官方商店】 | 要服务器和账号体系；跨设备同步用 P1-3 的 `storage.sync` 免账号方案即可覆盖设置类需求 |
| 站点拦截 / 专注模式 | Momentum Plus【官方帮助】"Site Blocker"；Freedial【官方商店】"Focus Mode: block distracting sites" | 需 `declarativeNetRequest` / `webRequest` 规则，改变用户全局浏览行为，风险与主线（整理 tab）无关 |
| 标签挂起 / 丢弃（`tabs.discard`） | Workona、Cluster、Tab Manager Plus、tabmanager.io【官方商店】 | 会主动卸载用户标签内容；且【官方帮助】tabs 页**未明确说明 `discard` 需要哪个权限**，我不能给出确定结论。收益低于 P0/P1 |
| Chrome 全局快捷键 | OneTab `alt+shift+1`、Start.me `Alt-h/Alt-b`、Tab Manager Plus `Alt+Shift+M`【官方帮助】 | 你此前明确经历「`Ctrl+Shift+Alt+B` 不合法 → 改 `Alt+Shift+B` → 删掉相关代码」，本轮不主动重引入 |
| Vue3 / React / 引入构建链 | — | MV3 默认 CSP 禁 CDN / 内联脚本 / `eval`；项目是零构建原生 DOM + IIFE + `window` 命名空间，引入框架要连带动 9 个脚本的加载方式与 4 个命名空间，收益不匹配 |
| 最常访问站点（`topSites`） | Infinity、FVD、Humble【官方商店】 | 需新增 `topSites` 权限；且【官方帮助】明确 "These do not include shortcuts customized by the user"，文档**未写明返回数量**、也未明确是否等同真实历史 —— 我们已经有 `history.search` 200 条，重复度高、依据不足 |

---

## 7. 建议实施顺序与验收

| 阶段 | 内容 | 独立性 | 验收要点 |
|---|---|---|---|
| S1 | P0-1 导入导出 | 完全独立，先做（数据保全优先） | 导出→删数据→导入后 7 个 key 复原；非法 JSON / `javascript:` URL 被拒且不污染现有数据 |
| S2 | P0-2 一键收纳 | 依赖 `sessions.js`，与 S1 无耦合 | 收纳后集合有数据、原标签被关、**newtab 自身仍在**；恢复全部开新窗口；保存失败不关标签 |
| S3 | P0-3 网址导航增删改 | 独立 nav-item | 增删改后刷新仍在；静态 15 条与自定义条目合并正确；不碰原 7 个 key |
| S4 | P1-1 / P1-2 / P1-3 / P1-4 | 各自独立，可单独取舍 | P1-2 需 reload 扩展；P1-3 验证超 8KB 单项时的失败处理；P1-4 两套 `:root` 同步 |

每阶段沿用既有验证链：全量 `node --check` → `manifest.json` JSON 合法 → HTML script/id 零缺失 → CSP 三项 false → 按真实脚本顺序的 Node `vm` 冒烟 → 现有 9 组回归脚本全 PASS。

---

## 8. 可直接复制的实施提示词

### 8.1 总控（一次性交给实施方）

```text
在 D:/A-works/demos/chrome-plugin 按 docs/newtab-feature-research.md 的 P0 阶段做增量实现。
先读 docs/itab-optimization-plan.md 第 2 节（现有功能保留清单，硬约束）与
docs/newtab-feature-research.md 第 2.3 节（技术硬约束）。

硬约束：
- 不删除、不改动任何现有功能；只按点名阶段实施，不顺手扩大范围。
- 不引后端 / 账号 / 云同步服务 / 外部 API / 前端框架 / 构建工具 / CDN / 内联脚本 / eval。
- 优先零新增权限；确需新增时先列出权限名并说明必须 reload 扩展。
- 不动现有 9 个脚本的相对顺序、37 个原有 id、7 个既有 storage.local key、
  window.NT / AutoBoat / FEATURE_CONFIG / FAVICON 命名空间。
- 新增数据用独立 nt_xxx_* key；新 nav-item 走 view + VIEW_MAP 一行 + 末尾追加脚本；
  默认视图仍由 HTML 初始属性决定，不要改成 JS 初始化。
- 跳转统一 NT.openInNewTab；新增 chrome.* 调用做 !chrome.<api> || !chrome.<api>.<method> guard
  并处理 chrome.runtime.lastError。
- 不要重复注册 tabs 事件监听（已有三处 + 150ms 防抖）。

流程：先给不超过 10 行执行计划；每完成一个模块立即验证并简述结果；
改动说明用表格；关键节点 console.log；歧义先提问再动手；
缺失量化数据用占位符或标注 caveat，禁止编造；禁止用生活化比喻讲技术。

验证：全量 node --check、manifest JSON、HTML script/id 零缺失、CSP 三项 false、
按真实 script 顺序的 Node vm 冒烟、现有 9 组回归脚本全 PASS。
```

### 8.2 P0-1 单独实施

```text
只做「数据导出 / 导入 / 本地备份」，不改其它功能。
导出范围：nt_engine_enabled / nt_engine_active / nt_engine_custom / nt_collections 四个 key，
不含 feat_*。导出 JSON 带 version 与 exportedAt 字段。
用 Blob + URL.createObjectURL + <a download> 导出；用 <input type="file"> + FileReader 导入。
导入必须校验：JSON 可解析、顶层结构、数组字段类型、URL 协议白名单
（只放行 http/https/file，挡 javascript:/data:/vbscript:）；任何校验失败都不写入 storage，
给出可见提示。导入前保留一份现有数据的内存快照，失败可回滚。
不新增权限（若 blob 下载在扩展页被 CSP 拦，先报告现象，不要擅自加 downloads 权限）。
入口放在「标签管理」视图的设置区或新 nav-item，由实施方给两个方案让我选。
关键节点 console.log：导出条数、导入校验结果、写入的 key 名。
```

---

## 9. 需要你定的 4 件事

| # | 问题 | 为什么必须定 |
|---|---|---|
| 1 | P0-2「收纳」是**保存后直接关闭标签**（OneTab 式），还是**默认保持打开、给一个开关**（Toby 式）？ | 直接关标签是不可逆操作，且 newtab 自身必须排除；两种都合理，我不替你选 |
| 2 | P1-3 要不要做？`storage.sync` 能免账号同步设置，但**不同步集合数据**（8KB 单项配额） | 如果期望的是「标签集跨电脑可见」，`storage.sync` 满足不了，那需要另一套方案或明确放弃 |
| 3 | P2-3 纯本地小组件是否真的不做？ | 你此前说「只需要整理他现有的 tab」，但「后续有其他功能再新增 nav-item」又留了口子；我按不主动纳入处理 |
| 4 | 是否提供目标产品的**实机截图 / 具体某一款**做视觉校准？ | 本轮只拿到商店文案与官网文字，**没有像素、色值、间距数据**，所以文档里没有任何视觉规格数值 |

---

## 10. 未核实 / 不确定清单（明确列出，不猜）

| 项 | 状态 |
|---|---|
| 竞品实机行为 | **未实测**。本轮全部来自官网 / 商店页 / 帮助文档 / 第三方评测，未安装任何一款 |
| `omnibox.keyword` 与 `chrome_url_overrides.newtab` 共存 | 官方 omnibox 页**未记录禁止，也未明确确认**；需实测 |
| `chrome.tabs.discard` 权限要求 | 官方 tabs 页**未明确说明**；文档只泛述 "Most features don't require any permissions" |
| `chrome.topSites.get()` 返回数量、是否等同真实历史 | 官方文档**未写明**，只说明排除用户自定义快捷方式 |
| Blob + `<a download>` 在 MV3 扩展页 CSP 下能否直接触发下载 | **源码级判断，未实测**；退路是 `chrome.downloads`（需新增权限） |
| `chrome.storage.sync` 在用户未登录时的具体表现 | 官方原文只写 "If disabled, it behaves like `storage.local`"，未逐字描述 "not signed in" 状态 |
| iTab 具体网址 / 图标清单 | 上一轮已确认爬不到（存在用户本地 `navConfig`），见 `itab-optimization-plan.md` §0.2 |
| 部分产品的付费价格、Toby 导入导出、Bonjourr / Tabliss 同步能力 | 来源冲突或仅第三方，本轮**未采信为结论** |
| WeTab 与 Infinity 是否同一主体、Infinity 2025 年安全报道 | 前者为调研方【推断】，后者为【第三方】转述且厂商否认，均不作为依据 |

---

## 11. 主要来源索引

**官方帮助 / API 文档（本轮直接抓取）**
- `https://developer.chrome.com/docs/extensions/reference/api/storage` — `storage.sync` 配额与 Chrome Sync 机制
- `https://developer.chrome.com/docs/extensions/reference/api/omnibox` — `omnibox.keyword` manifest 要求
- `https://developer.chrome.com/docs/extensions/reference/api/sessions` — `sessions` 权限、`MAX_SESSION_RESULTS = 25`
- `https://developer.chrome.com/docs/extensions/reference/api/topSites` — `topSites` 权限
- `https://developer.chrome.com/docs/extensions/reference/api/tabs` — `tabs` 权限与 `url/title/favIconUrl`、`discard`
- `https://www.one-tab.com/help`、`https://support.start.me/en/articles/9182794-introduction-to-start-me`、`https://get.momentumdash.help/hc/en-us/articles/115007780748-About-Momentum`

**官方商店 / 官网（功能清单）**
- iTab `https://chromewebstore.google.com/detail/itab%E6%96%B0%E6%A0%87%E7%AD%BE%E9%A1%B5/mhloojimgilafopcmlcikiidgbbnelip`、`https://itab.link/`
- WeTab `https://chromewebstore.google.com/detail/wetab-%E6%96%B0%E6%A0%87%E7%AD%BE%E9%A1%B5/aikflfpejipbpjdlfabpgclhblkpaafo`、`https://www.wetab.link/zh/`
- Infinity Pro `https://chromewebstore.google.com/detail/infinity-new-tab-pro/nnnkddnnlpamobajfibfdgfnbcnkgngh`
- 青柠起始页 `https://intro.limestart.page/`、`http://docs.retiehe.com/limestart/`
- Momentum `https://chromewebstore.google.com/detail/momentum/laookkfknpbbblfpciffpaejjkokdgca`
- Toby `https://chromewebstore.google.com/detail/toby-tab-management-tool/hddnkoipeenegfoeaoibdmnaalmgkpip`、`https://www.gettoby.com/`
- OneTab `https://chromewebstore.google.com/detail/onetab/chphlpgkkbolifaimnlloiipkdnihall`、`https://www.one-tab.com/`
- Start.me `https://start.me/features`、`https://start.me/`
- Session Buddy `https://chromewebstore.google.com/detail/session-buddy/edacconmaakjimmfgnblocblbcdcpbko`、`https://sessionbuddy.com/`
- Workona `https://workona.com/`、`https://chromewebstore.google.com/detail/tab-manager-by-workona/ailcmbgekjpnablpdkmaaccecekgdhlh`
- Bonjourr `https://bonjourr.fr/`、`https://chromewebstore.google.com/detail/Bonjourr%20%C2%B7%20Minimalist%20Startpage/dlnejlppicbjfcfcedcflplfjajinajd`
- Tab Manager Plus `https://chromewebstore.google.com/detail/tab-manager-plus-for-chro/cnkdjjdmfiffagllbiiilooaoofcoeff`
- Nighttab `https://github.com/Chessehead17/nightTab/blob/master/README.md`
- 少数派横评 `https://sspai.com/post/75591`【第三方】

> 完整逐产品功能表（含每条功能的来源性质标签、原文片段、冲突与「未查到」项）在本轮对话的调研输出中，未单独落盘。本文件 §11 只列关键可核验入口。
