# 参考 iTab 优化方案（本轮零代码改动）

- 日期：2026-11-12
- 参考对象：<https://go.itab.link/>（iTab 网页版）、<https://www.itab.link/>（官网）、Chrome Web Store 官方功能说明
- 目标：在**不删除、不改动任何现有功能**的前提下，给出可执行的升级方案与可直接复制的实施提示词
- 本轮产物：仅本文档。未修改任何 `.js` / `.css` / `.html` / `manifest.json`

---

## 0. 信息来源与可信度分级

| 来源 | 获取方式 | 可确认的内容 | 可信度 |
|---|---|---|---|
| `go.itab.link` 页面正文 | 直接抓取 | 页面是 SPA 壳，只取到动态文案：`0°` / `AQI` / `最高° 最低°` / `2026年11月` / `第000天 第46周` / `十月初四 周四` / 每日语录。**未取得完整页面截图，未取得具体栅格尺寸、间距、圆角、配色值** | 部分可确认 |
| `www.itab.link` 官网 | 直接抓取 | 6 段营销文案：卡片式小组件、网站导航自定义图标、极简模式、动态壁纸、快速翻译/快速添加/跨平台同步、4K 壁纸 | 官方 |
| Chrome Web Store 官方说明（v2.4.12，2026-11-07 更新） | 检索结果 | 完整功能清单：iOS 式小组件（天气、日历、多平台热搜、备忘录、股市、倒计时、折扣游戏、每日电影/英语/诗词、习惯养成、汇率、播客、ChatGPT）、聚合 20+ 搜索引擎、自定义静态/动态壁纸与毛玻璃、自定义图标样式/大小/布局/分组、深浅色、极简模式、多端同步与本地备份、书签批量导入 | 官方 |
| 腾讯网 / 摩丸 / 西城知道 / Techritual 评测 | 检索结果 | 布局与交互：主体由**图标 + 小组件**构成，辅以**侧边栏 + 搜索框**；图标可拖拽排序、拖到一起成文件夹、尺寸 `1×1` 到 `2×4`；侧边栏分页（编程/设计/产品/AI/娱乐/摸鱼），滚轮翻页；点时间组件一键切极简模式（只留时间 + 搜索框）；壁纸可设遮罩/透明度/毛玻璃 | 第三方，需你确认 |

**我没有核验的**：`go.itab.link` 完整视觉截图、登录后才能看到的小组件库、壁纸库规模、同步服务的后端形态。凡涉及具体像素/色值/间距的结论，本方案一律不给数值，需你提供截图或明确指定。

---

## 1. iTab 能力拆解

### 1.1 功能矩阵（官方描述）

| 类别 | 能力 | 关键特征 |
|---|---|---|
| 起始页结构 | 图标网格 + 小组件 + 侧边栏 + 搜索框 | 组件多尺寸、可拖拽；侧边栏分页 |
| 小组件 | 天气、日历（含农历/周数）、热搜榜、备忘录/待办、股市、倒计时、每日电影/英语/诗词、习惯养成、汇率、播客、每日语录 | 卡片式（iOS 风格），二级面板内联展开 |
| 导航图标 | 常用网站图标，样式/大小/圆角/颜色/分组可自定义 | 拖到一起形成文件夹；内置资源分组 |
| 搜索 | 聚合 20+ 引擎一键切换；搜索栏内快速翻译 | 极简模式下搜索框仍保留 |
| 壁纸与主题 | 静态/动态/4K、每日自动切换、收藏、下载、上传本地；遮罩、透明度、毛玻璃；深浅色、跟随系统 | 视觉层核心 |
| 模式 | 极简模式（点击时间组件清屏，只留时间 + 搜索框，再点恢复） | 一键切换 |
| 数据与同步 | 账号登录多端同步、本地备份、书签批量导入 | 需要账号体系与云端 |
| 插件版专属 | 一键把当前网站添加到主页 | 依赖扩展 API |

### 1.2 当前插件已具备 / 不具备

| 能力 | 当前插件 | 位置 | 结论 |
|---|---|---|---|
| 聚合搜索 + 自定义引擎 | **已有**：15 个内置引擎、默认启用 4 个、最多 8 个、自定义 `%s` URL、面板第一项固定「添加」 | `newtab/engines.js`、`newtab/search.js` | 不重复实现 |
| 书签浏览与编辑 | **已有**：`getTree()` 保留层级、面包屑、卡片、`bookmarks.update()` 编辑 | `bookmarks/bookmarks.js` | 不重复实现 |
| 浏览器原生标签组展示 | **已有**：`tabGroups.query()` + 折叠 + 组内 tab | `bookmarks/bookmarks.js` | iTab 网页版无此能力，属于本项目优势 |
| 已保存标签集（Toby 风格） | **已有**：按窗口/全局 upsert、刷新、恢复、关闭真实标签、重命名、折叠 | `newtab/sessions.js` | iTab 网页版无此能力，属于本项目优势 |
| 浏览历史 | **已有**：`chrome.history.search` 最近 200 条 | `newtab/history.js` | 保留 |
| 站点自动化 + 工具栏开关 | **已有**：酷学院/百度/考试宝三站点，`chrome.storage.local` 开关 + 热切换 | `src/config.js`、`content/*`、`popup/*` | 与新标签页无关，绝对不动 |
| 卡片式小组件 | 无 | — | 建议 P1 |
| 常用网站图标网格 / 分组 / 拖拽 | 无（书签页是只读卡片，不是桌面） | — | 建议 P1 |
| 壁纸 / 毛玻璃 / 深浅色 | 无 | — | 建议 P2 |
| 极简模式 | 无 | — | 建议 P2 |
| 侧边栏分页 | 部分：左 nav 仅 2 项（标签管理 / 页面历史） | `newtab/newtab.js` `switchView()` | 扩展而非重写 |
| 一键添加当前网站 | 无 | — | 建议 P2 |
| 多端账号同步 / 翻译 / 热搜 / 股市 / mini app | 无 | — | 不建议，见 1.3 |

### 1.3 明确不建议照搬的部分（架构判断）

| iTab 能力 | 本项目不做的理由 |
|---|---|
| 账号登录 + 多端实时同步 | 项目当前是**纯本地 MV3 扩展，无后端、无账号体系**。引入需服务端、鉴权、数据冲突合并，超出「新标签页优化」范围，且会改变现有 7 个 `chrome.storage.local` key 的语义 |
| 翻译 / 热搜榜 / 股市 / 汇率 / 播客 / mini app | 需要外部 API。MV3 扩展页 CSP 为 `script-src 'self'; object-src 'self'`，`fetch` 跨域需 `host_permissions` 且受目标站 CORS 限制；热搜类接口无稳定公开契约，维护成本高 |
| 在线壁纸库 / 每日自动换壁纸 | 远程图片需 `img-src` 白名单，且大图 base64 存 `storage.local` 受配额限制（**具体配额值我不确定，需实测**）。建议先做「本地上传 + 存 dataURL」的离线版 |
| 深浅色跟随系统 | 可做，但当前 `newtab.css` 与 `bookmarks.css` 是**两套独立 `:root`**，统一主题要同时改两份，属于独立阶段 |

**差异化原则**：iTab 网页版没有 `chrome.tabs` / `bookmarks` / `history` / `tabGroups` 权限，读不到真实标签与书签；本项目能读到。升级时应把这些能力**保留并强化**，而不是为了视觉相似把左中右三栏改成纯图标桌面后丢掉「Open Tabs」「已保存集合」「页面历史」。

---

## 2. 现有功能保留清单（实施时的硬约束）

> 以下行号基于本轮盘点时的磁盘内容，后续改动后可能偏移；以文件内实际符号为准。

### 2.1 模块与入口

| 模块 | 文件 | 不可破坏的能力 |
|---|---|---|
| 新标签页骨架 | `newtab/newtab.html`、`newtab.css` | 三栏 `nav 200 / workspace(flex:1) / side 240`、`gap:12px`、header 搜索框常驻、`.main` 与 `.wrapper` 共用 `--main-radius: 24px`、无 footer |
| 视图切换 | `newtab/newtab.js` | `switchView()` 切 `#viewTabs` / `#viewHistory` / `#sidePanel.hidden`；`NT.views` 导出 |
| 工具层 | `newtab/common.js` | `NT.openInNewTab / el / favicon / badge / storageGet / storageSet / tabsQuery / pad2 / formatTime / formatStamp` |
| 搜索引擎 | `newtab/engines.js` | 15 个 PRESETS、`MAX=8`、3 个 key、`subscribe/emit` 观察者、`addCustom` 校验 |
| 搜索交互 | `newtab/search.js` | 引擎面板、添加弹窗、自定义引擎输入框置顶、Escape 关面板、`split('%s').join()` |
| 标签集 | `newtab/sessions.js` | `nt_collections` 结构 `{id,source,name,createdAt,tabs:[{title,url,favIconUrl}]}`、`source` upsert 去重、刷新/恢复/删除/重命名/折叠、关闭真实标签 |
| 历史 | `newtab/history.js` | `chrome.history.search` callback 形式 + 权限缺失 guard |
| favicon | `src/favicon.js` | `window.FAVICON`，有图 `<img>`、失败回退灰占位，`error` 用 `addEventListener` |
| 书签页 | `bookmarks/*` | 书签树只读展示 + 编辑、顶部 tabGroups、面包屑、`onChanged` 等事件同步 |
| 工具栏弹窗 | `popup/*` | 三个站点开关、`f.link` 驱动的 `.jump-inline`、书签入口、runtime id |
| 站点自动化 | `src/config.js`、`content/*` | 三站点 `match(hostname)` + 开关 gating、`FeatureManager`、消息热切换 |
| 后台 | `background/background.js` | `tabs.onUpdated` complete 发 `updated` / `activated`；无 `commands` |

### 2.2 不可破坏的隐式契约

| 契约 | 内容 |
|---|---|
| 脚本顺序 | newtab 7 个：`favicon.js → common.js → engines.js → search.js → sessions.js → history.js → newtab.js`；content 6 个：`config.js → core.js → sites/×3 → boot.js`；popup 2 个；bookmarks 2 个。**新脚本只允许追加在末尾，不插队、不改现有顺序** |
| 全局命名空间 | `window.NT`、`window.AutoBoat` / `AB.sites`、`window.FEATURE_CONFIG`、`window.FAVICON`。无 `import/export`、无模块系统 |
| `storage.local` key（7 个） | `nt_engine_enabled` / `nt_engine_active` / `nt_engine_custom` / `nt_collections` / `feat_kuxueyuan` / `feat_baidu` / `feat_kaoshibao`。**新增功能必须用新 key，不复用、不改名、不改值结构** |
| DOM id（newtab 28 个） | 全部有 JS 引用或初始 `hidden` 依赖。新增视图用新 id，不复用 |
| 旧数据兼容 | `engines.load()` 的 `Array.isArray` / `slice(0,MAX)` / 失效 id 过滤；集合缺 `source` 时刷新走「全部窗口」兜底；缺 `favIconUrl` 走灰占位 |
| innerHTML 注入 SVG | `CARET_ICON` / `PENCIL_ICON` / `REFRESH_ICON` / `ADD_ICON` / `FOLDER_ICON` / `EDIT_ICON`。`flashButton()` 必须保存/恢复 `innerHTML + className`，用 `textContent` 会把 SVG 冲成字符串 |
| 跳转约定 | 全项目统一 `chrome.tabs.create`（`NT.openInNewTab`），无 `location.href =`；header 链接 `preventDefault` + `target="_blank"` 双保险 |
| 权限 guard | MV3 未声明权限时 `chrome.<api>` 命名空间整体 undefined；已有 guard 在 `history.js`、`bookmarks.js`（bookmarks/tabGroups）、`core.js`（try/catch）。新增任何 `chrome.*` 都要同样 guard |
| CSP | 三个 HTML 无内联 `<script>`、无 `on*` 属性、无远程 script；`favicon.js` 的 `error` 用 `addEventListener`。新代码不得引 CDN、不得 `eval`、不得内联事件 |
| 样式 | `newtab.css` 与 `bookmarks.css` 各自独立 `:root`；`.tone-0..7` 两套配色；`[hidden]{display:none !important}`；`--tab-card-favicon-size` / `--main-radius` 等变量已有引用方 |
| 交互细节 | `makeOpenTab` 外层是 `div[role=button][tabindex=0]`（避免 button 嵌套）、`event.target !== row` 键盘判定、`.open-tab-del` 绝对定位不占位；`isRestorable`（含 `file:`）与 `VISITABLE`（不含）规则不同；折叠集合仍 `appendChild(section)` |

---

## 3. 建议方案：**新增「桌面」视图，不动现有两个视图**

### 3.1 总体设计

| 决策 | 选择 | 依据 |
|---|---|---|
| 改造方式 | **加法**：新增第 3 个 nav 项「桌面」，`#viewDesktop` 默认 `hidden`，`switchView()` 扩展一个分支 | 现有「标签管理」「页面历史」及其右栏显隐逻辑零改动，回归面最小 |
| 默认视图 | 仍默认「标签管理」 | 保留现有使用习惯 |
| 新模块 | `newtab/desktop.js`、`newtab/widgets.js`、`newtab/desktop.css`，追加在 `newtab.html` 现有 7 个 script 之后、`newtab.js` 之前需评估 —— **更稳妥是放在 `newtab.js` 之前并把初始化挂到 `NT.desktop.init()` 由 `newtab.js` 调用，或新增一个 `desktop-boot.js` 放最后** | 避免修改 `newtab.js` 的 `init()` 顺序；具体挂法在实施前确认 |
| 数据 | 新增 `nt_desktop_icons`、`nt_desktop_widgets`、`nt_desktop_theme` 等独立 key | 与现有 7 个 key 完全隔离 |
| 框架 | 继续原生 DOM + `window.NT`，不引 Vue/React（MV3 CSP 需 runtime-only + 构建步骤） | 与现有工程一致，零构建链 |

### 3.2 阶段划分（每阶段独立验收，不要一次性做完）

| 阶段 | 内容 | 改动文件 | 验收要点 |
|---|---|---|---|
| **P0 视觉基线** | 在 `newtab.css` 补一套主题变量（浅色值保持现状不变），新增 `--card-bg` / `--glass` / `--wallpaper` 等；不改任何 DOM、不改任何 JS | `newtab/newtab.css` | 现有页面视觉零变化；`--bg:#f0ede8`、`--main-radius:24px` 等原值不变 |
| **P1 桌面视图骨架** | 新增第 3 个 nav 项 + `#viewDesktop`；`switchView()` 增加 `desktop` 分支；右栏在桌面视图下隐藏或保留（**需你确认**）。图标网格数据来自新 key，支持增删改、点击 `NT.openInNewTab` | HTML / CSS / `desktop.js`（新）/ `newtab.js`（仅 switchView） | 现有两个视图行为完全不变；28 个原 id 零缺失 |
| **P2 零网络依赖小组件** | 时钟/日期（含周数、年内天数）、倒计时、备忘录、每日一句（本地数组）。每个 widget 一个纯函数返回 DOM，注册到 `NT.widgets` | `widgets.js`（新）/ `desktop.css` | 不发起任何网络请求，不申请新权限 |
| **P3 图标分组与拖拽** | 分组（对应 iTab 侧边栏分页）、HTML5 drag & drop 排序、尺寸档位 | `desktop.js` / `desktop.css` | 拖拽不触发默认导航；持久化顺序 |
| **P4 壁纸 / 极简 / 深浅色** | 本地图片上传 → `FileReader` → dataURL 存 `storage.local`；毛玻璃用 `backdrop-filter`；极简模式用一个 body class 切 `hidden`；深浅色跟随 `prefers-color-scheme` | `desktop.css` / `common.js`（可选工具） | **配额需实测**；远程图需 `img-src` CSP 白名单，首版不做远程 |
| **P5 一键添加当前网站** | `chrome.tabs.query({active:true,currentWindow:true})` → 写入 `nt_desktop_icons` | `desktop.js` | 过滤 `chrome://` 等不可导航协议；不申请新权限（已有 `tabs`） |

### 3.3 明确排除（本方案不含）

- 账号 / 云同步 / 后端 / 数据库
- 外部 API 类组件（天气、热搜、股市、汇率、翻译、mini app）
- 在线壁纸库、每日自动换图
- 引入前端框架或构建工具
- 改动 `content/*`、`src/config.js`、`popup/*`、`background/*`、`bookmarks/*` 的现有逻辑

### 3.4 风险表

| 风险 | 触发条件 | 后果 | 缓解 |
|---|---|---|---|
| 脚本顺序被改 | 新脚本插到 `common.js` 之前或 `newtab.js` 之后 | `window.NT` 未就绪，整页白屏 | 只允许末尾追加，或由 `newtab.js` 显式 `init()` |
| 复用现有 storage key | 把图标/主题塞进 `nt_collections` 或 `nt_engine_*` | 覆盖集合或引擎配置，数据丢失 | 全部用新 key 前缀 `nt_desktop_*` |
| 新增 `chrome.*` API 无 guard | 权限未声明或旧 profile | `Cannot read properties of undefined` | 复刻 `history.js` / `bookmarks.js` 的 guard 写法 |
| 新权限未 reload | 改 `manifest.json` | 权限不生效，用户误判为 bug | 每次改权限明确提示 `chrome://extensions` 重新加载 |
| CSP 违规 | 引 CDN、内联 `onerror`、远程 script | 脚本被拦截 | 沿用现有 `innerHTML` 静态 SVG + `addEventListener` 模式 |
| `storage.local` 配额 | 壁纸 dataURL 过大 | 写入失败 | 首版限制图片尺寸/大小；**具体配额值需实测，不要写死** |
| 视觉层未经核验 | 依赖我未取得的截图 | 与 iTab 观感不符 | 由你提供截图或指定色值/圆角/间距后再做 P0 |

---

## 4. 验收清单（实施者逐项打勾）

**现有功能回归**
- [ ] 酷学院 / 百度 / 考试宝三站点功能在目标域名内生效、其他域名不生效
- [ ] popup 三个开关可切换，切换后 content 立即热生效（无需刷新页面）
- [ ] 搜索：15 个内置引擎、默认 4 个启用、面板第一项为「添加」、自定义引擎输入框置顶、多 `%s` 替换、非法协议拒绝
- [ ] 标签集：按窗口/全局保存重复点击只更新不新增、命名 `YYYY年M月D日 HH:mm（当前窗口）`、刷新/恢复/删除/重命名/折叠、关闭真实标签
- [ ] 页面历史：最近 200 条、右栏隐藏、header 搜索框仍可用
- [ ] 书签页：层级/面包屑/编辑/顶部 tabGroups 展开折叠
- [ ] 所有跳转新开标签且不覆盖 newtab
- [ ] 7 个 `storage.local` key 的既有数据不丢失、旧集合（无 `source`）不被误并
- [ ] 脚本顺序、28 个 id 引用、HTML 无内联脚本/事件/远程 script
- [ ] `node --check` 全量通过、`manifest.json` 合法、vm 按真实 script 顺序冒烟通过

**新增功能**
- [ ] 桌面视图可切换，切回标签管理/页面历史时状态正确
- [ ] 图标增删改与顺序持久化，点击新开标签
- [ ] 小组件零网络请求
- [ ] 新增权限（如有）已提示重新加载扩展

---

## 5. 实施提示词

### 5.1 总控提示词（一次性交给实施 AI）

```text
你在 D:/A-works/demos/chrome-plugin 这个 Chrome MV3 扩展项目里工作。
任务：参考 iTab（https://go.itab.link/）优化新标签页，采用「新增桌面视图」的方式做增量升级。
先完整阅读 docs/itab-optimization-plan.md，以该文档第 2 节「现有功能保留清单」为硬性约束。

【最高优先级：不许删改任何现有功能】
- 现有能力包括：三栏布局(nav 200 / workspace / side 240, gap 12px)、header 常驻搜索框、
  15 个内置搜索引擎 + 最多 8 个启用 + 自定义 %s 引擎 + 面板第一项「添加」、
  Toby 风格标签集(nt_collections，按 source upsert 去重、刷新/恢复/删除/重命名/折叠)、
  右栏 Open Tabs(按窗口分组、关闭真实标签、hover × 删除)、页面历史(chrome.history)、
  书签页(层级/编辑/顶部 tabGroups)、popup 三站点开关、content 三站点自动化 + 消息热切换。
- 7 个既有 storage key 只读原结构或完全不碰：nt_engine_enabled / nt_engine_active /
  nt_engine_custom / nt_collections / feat_kuxueyuan / feat_baidu / feat_kaoshibao。
- newtab 的 7 个 script 顺序、content 的 6 个顺序、popup / bookmarks 的顺序不许改；
  新脚本只追加或由 newtab.js 显式 init。
- window.NT / window.AutoBoat / window.FEATURE_CONFIG / window.FAVICON 命名空间不许改。
- 全项目跳转统一 chrome.tabs.create (NT.openInNewTab)，不许出现 location.href =。
- MV3 CSP：不引 CDN、不写内联 script / on* 属性、不用 eval；需要 SVG 时用静态字符串 innerHTML，
  图片 error 用 addEventListener。新增任何 chrome.* 调用都要做
  「!chrome.<api> || !chrome.<api>.<method>」形式的 guard。
- flashButton 必须继续用 innerHTML + className 保存/恢复，不许改回 textContent。

【本阶段范围】只做 docs/itab-optimization-plan.md 第 3.2 节里我指定的那一个阶段，
不要顺手做后续阶段，不要动 content/ src/config.js popup/ background/ bookmarks/ 的现有逻辑。
不引入 Vue/React/构建工具，不引入后端、账号、云同步、外部 API 组件。
外部数据缺失时用占位符或明确标注 caveat，禁止编造数值。

【工作方式】
1. 先输出不超过 10 行的执行计划（任务分解 + 复杂度 + 执行策略），等我确认再动手。
2. 每完成一个模块立即验证：node --check 全部 JS、JSON.parse(manifest.json)、
   newtab.html 的 script 引用与 getElementById id 零缺失、HTML 无内联脚本/事件/远程 script、
   用 Node vm 按真实 script 顺序做 DOM/chrome API 冒烟。
3. 改动说明用表格（文件 / 位置 / 改了什么 / 为什么），只展示变更部分。
4. 关键节点打 console.log 便于 DevTools 核对；Promise/callback 风格便于链式调用。
5. 能用单个函数解决的不要拆成多个；只改我点名的部分，不扩大范围。
6. 如果需求有歧义，先提澄清问题再动手，不要猜。
7. 完成后逐项跑文档第 4 节验收清单，明确列出「已验证」与「需我在浏览器实测」两类。

【交付】列出改动文件清单、验证结果、已知限制；
如果改了 manifest 权限，明确提示需要到 chrome://extensions 重新加载扩展。
```

### 5.2 分阶段提示词（推荐一次发一个）

**P0**
```text
按 docs/itab-optimization-plan.md 第 3.2 节 P0 执行：只改 newtab/newtab.css，
补一套主题变量（浅色值保持现状不变，新增 --card-bg / --glass / --wallpaper 等），
不新增/删除任何 DOM，不改任何 JS，不改现有颜色值。
完成后证明现有页面视觉零变化，并列出新增变量名与默认值。
遵守总控提示词里的全部约束。
```

**P1**
```text
按 docs/itab-optimization-plan.md 第 3.2 节 P1 执行：新增第 3 个 nav 项「桌面」与
#viewDesktop（默认 hidden），扩展 newtab.js 的 switchView() 增加 desktop 分支；
新增 newtab/desktop.js + desktop.css，图标数据用新 key nt_desktop_icons，
支持增删改与点击 NT.openInNewTab。
先回答我：桌面视图下右侧 240px 功能区是隐藏还是保留？我确认后再动手。
现有「标签管理」「页面历史」两个视图的行为必须逐项回归，28 个原有 id 零缺失。
遵守总控提示词里的全部约束。
```

**P2**
```text
按 docs/itab-optimization-plan.md 第 3.2 节 P2 执行：新增 newtab/widgets.js，
实现零网络依赖的小组件（时钟/日期含周数与年内天数、倒计时、备忘录、每日一句），
每个 widget 是返回 DOM 的纯函数并注册到 NT.widgets。
不申请任何新权限、不发起 fetch、不改 manifest。
农历数据如无可靠本地来源，请明确标注 caveat 并先用占位，不要编造。
遵守总控提示词里的全部约束。
```

### 5.3 使用建议

- 一次只发一个阶段提示词，验收通过再发下一个。
- 若你手上有 `go.itab.link` 的截图，直接附在 P0 提示词里并写明「以截图为准」，可省掉大量视觉往返。
- P1 里「桌面视图下右栏是否保留」是必须你定的点，我未擅自决定。
- 农历、天气、热搜、壁纸配额这几项我没有可靠数据来源，方案中已标注为需确认项，实施时不要填猜测值。
