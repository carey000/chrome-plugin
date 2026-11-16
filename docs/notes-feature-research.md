# 便签功能集成调研（普通便签 / Todo / 定时提醒）

- 日期：2026-11-16
- 性质：**调研 + 建议，本轮零代码改动**（未修改任何 `.js` / `.css` / `.html` / `manifest.json`）
- 输入：4 张桌面便签软件截图（普通便签教程、待办教程、待办实例、新建提醒弹窗）
- 判定目标：三类便签能力能否集成进本插件；重点回答「定时提醒是否准确」
- 与既有文档的关系：`docs/newtab-feature-research.md` §2.3 与 `docs/itab-optimization-plan.md` §2「现有功能保留清单」仍是硬约束；本文档所有建议都建立在这两份约束之上。

> **未实测声明**：本轮为本地源码静态核对 + 官方文档检索，**没有在浏览器里实测 `chrome.alarms` 的实际误差**，也没有实机安装截图中的桌面便签软件。凡涉及运行时结论的地方均标注「需实测」，数值一律引用官方原文，不编造。

---

## 0. 结论速览

| 类别 | 能否集成 | 新增权限 | 核心结论 |
|---|---|---|---|
| ① 普通便签（富文本） | **能** | 无 | 纯 DOM + `chrome.storage.local`；图片粘贴与 HTML 回显有两处必须处理的坑（配额 / 扩展页 XSS） |
| ② Todo list（checkbox） | **能**，完整度最高 | 无 | 勾选、归档、批量、置顶、排序、时间戳、重复待办全部是本地状态，没有浏览器能力边界 |
| ③ 定时提醒（到点弹窗） | **能，但不能等价** | **`alarms`（唯一新增，需重载扩展）** | 采用 `chrome.alarms` + service worker + `chrome.notifications`；**Chrome 官方不承诺准点，且浏览器关闭 / 设备睡眠期间不会准点触发** |

**一句话结论（直接回答核心问题）**：你的判断「浏览器定时任务通常都不准」**方向正确，但把三种不同性质的问题混在一起了** —— 页面定时器是被节流、service worker 定时器是被直接取消、`chrome.alarms` 是「不早于设定时间 + 官方明确允许任意延迟」；而最致命的一条不是「不准」，是**浏览器没运行 / 设备在睡眠时根本不触发**。所以结论是：**「浏览器开着时的分钟级提醒」可做且够用；「秒级精确、关掉浏览器也能弹、开机自启提醒」纯扩展做不到**。详见 §1 与 §3。

---

## 1. 歧义与口径（先对齐，避免后续跑偏）

### 1.1 需求文字的两处歧义

| 原表述 | 我的处理 | 需你核对 |
|---|---|---|
| 「**标签**功能调研：调研**变迁**功能」 | 按「**便签 sticky notes**」理解。本插件已有「标签管理」视图（`newtab/newtab.js` L66 `tabs: { view: 'viewTabs' }`，管理的是浏览器 tab / 标签组），与本次的「便签」是**两个完全不同的东西**，不要复用 `nt_collections` 或该视图 | 若你实际指的是「标签管理」而非「便签」，本报告结论不适用 |
| 「到点**弹窗**提醒」（截图：提醒方式 = 弹窗） | 桌面软件是独立置顶窗口。扩展侧只能给两种降级形态：**系统托盘通知**或**扩展页 popup 窗口**，见 §4.3。截图里下拉框未展开，**其它提醒方式选项值我不确定** | 需要你提供下拉展开后的选项，或确认接受系统通知形态 |

### 1.2 精确性纠错：「浏览器的定时任务通常都不准」

| 原表述 / 隐含前提 | 问题 | 纠正后（可核验） |
|---|---|---|
| 「浏览器定时任务都不准」 | 把**节流**、**被取消**、**延迟**、**不触发**四种不同机制合并成一个「不准」 | 必须按执行上下文分 4 类，见 §3.1 |
| 认为 `setTimeout` / `setInterval` 在 MV3 后台能用，只是慢一点 | 不是慢，是**会被取消**：官方迁移文档原文 "Terminating service workers can also end timers before they have completed. You'll need to replace them with alarms." | MV3 后台只能用 `chrome.alarms`；监听器必须在脚本**顶层同步注册** |
| 认为 `chrome.alarms` 只是「有几秒误差」 | 官方**没有给出误差上界**：`create()` 原文 "may delay them an arbitrary amount more"；`Alarm.scheduledTime` 原文 "may have been delayed an arbitrary amount beyond this" | 只能表述为「不早于设定时间，延迟量官方无承诺」；具体数值必须本机实测，不能写死 |
| 忽略了设备睡眠与浏览器关闭 | 这两类不是误差，是**触发缺失**：官方 "an alarm will not wake up a device"；浏览器关闭时扩展进程不存在 | 设备唤醒后补发（重复闹钟最多一次并从唤醒时刻重排）；浏览器关闭期间的行为**官方未逐字说明**，见 §8 |
| 忽略版本差异 | 最小间隔随 Chrome 版本变化，且**未打包调试加载与商店打包行为不同**（MDN） | 见 §3.3 版本表；不能按某一个数值写实现 |

---

## 2. 本插件现状基线（可核验）

| 项 | 位置 | 事实 |
|---|---|---|
| Manifest 版本 | `manifest.json` L2 | MV3 |
| 后台 | `manifest.json` L39-41 → `background/background.js` | service worker；当前**只监听 `chrome.tabs.onUpdated`**（`background.js` L26），**零定时逻辑、零 `chrome.alarms`、零 `runtime.onMessage`** |
| 权限 | `manifest.json` L12-23 | 已声明 10 项；其中 `notifications`、`contextMenus`、`sidePanel`、`scripting`、`activeTab` **代码中零调用**；**`alarms` 未声明** |
| UI 落点 | `manifest.json` L28-38 | `chrome_url_overrides.newtab` → `newtab/newtab.html`；`side_panel.default_path` 与 `action.default_popup` 都指向 `popup/popup.html`（当前是三站点开关） |
| 视图注册 | `newtab/newtab.js` L63-67 | `VIEW_MAP` 仅 3 项：`sites` / `tabs` / `history`；新增功能按 §0.4 三处加法 |
| 现有定时器 | `newtab/newtab.js` L112 | 仅 `setInterval(renderDate, 30 * 1000)`，**是页面级时钟，关掉 newtab 页即消失** |
| 存储工具 | `newtab/common.js` L44-60 | `NT.storageGet` / `NT.storageSet` 固定走 `chrome.storage.local`，Promise 包装，带 `runtime.lastError` 处理 |
| 硬约束 | `docs/itab-optimization-plan.md` L181-186、L52-55 | 7 个既有 `storage.local` key 不复用不改名；新增 key 用独立前缀；新增 `chrome.*` 必须做 `!chrome.<api> || !chrome.<api>.<method>` guard；新增 nav-item 走「HTML + VIEW_MAP 一行 + 末尾追加脚本」 |

**零成本机会**：`notifications` 已声明且零调用，提醒 UI 不需要新增权限；真正要加的只有 `alarms`，而新增权限意味着必须在 `chrome://extensions` **重载扩展**才能生效。

---

## 3. 定时提醒准确性（核心章节）

### 3.1 四类「定时器」不是一回事

| # | 执行位置 / API | 官方行为 | 对提醒是否可用 |
|---|---|---|---|
| 1 | 前台页面 `setTimeout` / `setInterval`（如把提醒做在 newtab 页里） | 页面隐藏后先按 **1 秒**粒度检查；隐藏 > 5 分钟、链式计数 ≥5、静音 ≥30 秒、无 WebRTC 时进入 **Intensive throttling：每分钟检查一次**【Chrome 88 官方博客】 | ❌ 不可用。页面一旦隐藏就退化到分钟粒度，关掉页面直接消失 |
| 2 | MV3 service worker 内 `setTimeout` / `setInterval` | SW **空闲 30 秒即被终止**【生命周期文档 "After 30 seconds of inactivity"】；timer 随终止被取消【迁移文档】 | ❌ 不可用。不是不准，是**不会执行** |
| 3 | `chrome.alarms`（官方指定的替代方案） | 触发"Near the time(s) specified"，官方明确 `may delay them an arbitrary amount more`；`scheduledTime` 可被任意延后 | ✅ 唯一可行方案，但**不承诺准点** |
| 4 | 浏览器进程关闭 / 设备睡眠 | 扩展代码只在 Chrome 进程内运行；官方 "an alarm will not wake up a device" | ❌ 期间不触发；设备唤醒后补发，重复闹钟最多一次并从唤醒时刻重新计时 |

### 3.2 官方原文（逐条可核验）

| 主题 | 原文 | 出处 |
|---|---|---|
| 延迟无上界 | "In order to reduce the load on the user's machine, Chrome limits alarms to at most once every second but may delay them an arbitrary amount more." | `developer.chrome.com/docs/extensions/reference/api/alarms` → `create()` |
| 延迟无上界（字段级） | "Time at which this alarm was scheduled to fire... For performance reasons, the alarm may have been delayed an arbitrary amount beyond this." | 同上 → `Alarm.scheduledTime` |
| 设备睡眠 | "Alarms continue to run while a device is sleeping. However, an alarm will not wake up a device. When the device wakes up, any missed alarms will fire. Repeating alarms will fire at most once and then be rescheduled using the specified period starting from when the device wakes..." | 同上 → Concepts / Device sleep |
| SW 空闲终止 | "After 30 seconds of inactivity. Receiving an event or calling an extension API resets this timer."；"Any global variables you set will be lost if the service worker shuts down." | `.../develop/concepts/service-workers/lifecycle` |
| timer 必须换 alarms | "These APIs can fail in service workers, though, because the timers are canceled whenever the service worker is terminated."；"You'll need to replace them with alarms." | `.../develop/migrate/to-service-workers` |
| 启动自检建议 | "it is best to make sure important alarms exists each time your service worker starts up."；"If your alarm is created dynamically based on user action, you may want to store that an alarm was created elsewhere so you know to recreate it if needed." | `.../reference/api/alarms` → Persistence |
| Chrome 120 最小周期 | "Alarms can now be set to a minimum period of 30s to match the service worker lifecycle." | `.../develop/concepts/service-workers/lifecycle` → Chrome 120 |
| 后台页节流 | "In this case, the browser will check timers in this group once per minute."（Intensive throttling，Chrome 88） | `developer.chrome.com/blog/timer-throttling-in-chrome-88/` |

### 3.3 最小间隔：三个来源不一致，必须标注

| 来源 | 表述 | 版本 |
|---|---|---|
| Chrome 官方生命周期页 | 最小周期 **30 秒** | Chrome 120+ |
| Chrome 官方 `alarms` 页（2026-11-16 抓取的当前英文版） | "limits alarms to at most once **every second**"；`delayInMinutes` / `periodInMinutes` 小于 1 秒不被采纳并告警 | 未标注起始版本；同页 `persistAcrossSessions` 标 Chrome 150+、`AlarmCreateInfo.name` 标 Chrome 152+ |
| MDN `alarms.create()` | "unless the extension is loaded unpackaged, alarms do not fire more than once every **30 seconds**"；"Before Chrome 120, this limit was **one minute**"；"From Chrome 117, the number of active alarms is limited to **500**" | Chrome 117 / 120 起 |

> **此处我不确定**：当前稳定版 Chrome 到底按 1 秒还是 30 秒执行，官方文档与 MDN 不同步；且 MDN 明确说**未打包加载（unpacked）时无频率限制**。本插件目前正是「加载已解压的扩展程序」开发方式，**开发机实测结果与打包发布后的行为会不同**。实现时不要依赖小于 30 秒的间隔，误差验收必须在目标 Chrome 版本 + 打包形态下实测。

### 3.4 「准确」能到什么程度（按验收口径给结论）

| 需求口径 | 纯扩展能否满足 | 依据 / 限制 |
|---|---|---|
| 到点**不早于**设定时间触发 | ✅ 能 | `when` 为绝对 epoch 毫秒；alarms 语义为 "Near the time(s) specified"，不会提前（官方未写「不会提前」的逐字条款，此处为语义推断，**标注待实测**） |
| **分钟级**提醒（如截图 08:59）、浏览器保持运行 | ✅ 能用 | 这是唯一推荐承诺的口径 |
| **秒级 / 毫秒级精确** | ❌ 不能 | 官方 `arbitrary amount` 无上界；不提供误差保证值 |
| **设备睡眠时准点弹出** | ❌ 不能 | "an alarm will not wake up a device"；唤醒后补发 |
| **浏览器关闭期间仍提醒** | ❌ 不能 | 扩展代码无进程可运行；见 §8「未核实」 |
| 提醒**必达**（用户一定能看到） | ❌ 不能 | 系统通知受系统勿扰 / 用户关闭扩展通知影响；`chrome.notifications.getPermissionLevel()` 可查 `granted`/`denied` |
| 每天 09:00 / 每周一 09:00 这类**日历型重复** | ✅ 能，但必须重算 | 不要用 `periodInMinutes` 做日历型重复：它是「距上次触发的间隔」，官方明确睡眠唤醒后从唤醒时刻重排，会累积漂移；应每次触发后用绝对 `when` 重算下一次 |

### 3.5 把「不准」压到可控的工程手段（全部有官方依据）

| 手段 | 做法 | 依据 |
|---|---|---|
| 数据才是真相 | 提醒任务存 `chrome.storage.local`（`nt_notes_reminders`），**不依赖 SW 全局变量** | lifecycle："Any global variables you set will be lost..." |
| 顶层同步注册 | `chrome.alarms.onAlarm.addListener(...)` 写在 `background.js` **顶层**，不放在 promise / 回调里 | 迁移文档 "Register listeners synchronously" |
| 启动自检 + 重建 | `runtime.onInstalled` / `runtime.onStartup` 调同一个 `syncAlarms()`：读任务表 → 比对 `alarms.getAll()` → 缺的重建、过期的按策略补发 | alarms 文档 "make sure important alarms exists each time your service worker starts up" |
| 显式持久化标记 | `chrome.alarms.create(name, { when, persistAcrossSessions: true })`；该字段 **Chrome 150+**，低于 150 行为不可预测，所以自检逻辑不能省 | alarms 文档 Persistence |
| 日历型重复重算绝对时间 | 触发时按 `new Date()` + 规则算下一次 `when`，再 `create` 同名 alarm 覆盖 | `create()`："If there is another alarm with the same name... it will be cancelled and replaced" |
| 提醒落地 | `chrome.notifications.create(id, { type:'basic', iconUrl, title, message, requireInteraction:true })`；`onClicked` → `chrome.tabs.create` 打开便签视图 | notifications 文档：`iconUrl` / `title` / `message` / `type` 为 create 必填；`requireInteraction` 让通知常驻直到用户处理 |
| 误差可观测 | `onAlarm` 里 `console.log('[reminder]', alarm.name, { scheduledTime: alarm.scheduledTime, actual: Date.now(), delta: Date.now() - alarm.scheduledTime })` | 项目既有约定：关键节点 `console.log` |

### 3.6 建议的实测验收（数值留空，不编造）

```
场景 A：浏览器前台、单次提醒 1 / 5 / 30 分钟
场景 B：提醒期间切到别的标签 / 最小化窗口（验证是否被节流）
场景 C：设定后手动让系统睡眠，唤醒后看是否补发、重复闹钟是否只发一次
场景 D：关闭 Chrome → 到点 → 重开 Chrome，看启动自检是否补发
场景 E：unpacked 加载 vs 打包安装，各测一轮（§3.3 的差异）
记录：delta = Date.now() - alarm.scheduledTime，统计 P50 / P95 / max（本机实测值：____）
```
> 在给出这份实测数据之前，**不要对产品承诺「误差 ≤ N 秒」**。任何 N 都是我编的。

---

## 4. 三类便签逐项映射（截图 → 插件能力）

### 4.1 普通便签（截图 1）

| 截图功能 | 插件实现方式 | 结论 |
|---|---|---|
| 单击直接编辑、富文本、字号/颜色 | `contentEditable` + 存 HTML 字符串；CSS 控制样式 | ✅ 可做。**坑**：扩展页拥有 `chrome.tabs` 等高权限，用户输入的 HTML 回显前必须做标签/属性白名单清洗，不能 `innerHTML` 原样写回 |
| 插入图片 / 截图粘贴 | `paste` 事件读 `clipboardData.files` → **Blob 存 IndexedDB**；富文本 HTML 里只留 `data-note-img="<imgId>"` 引用 | ⚠️ **不能把图片 dataURL 写进 `storage.local`**：官方 `QUOTA_BYTES 10485760`（Chrome 113 及更早 5 MB），按「每个值的 JSON 字符串化长度 + key 长度」计量，超限写入立即失败；base64 还会再膨胀约 4/3。完整链路与权限口径见 §10.10。MV3 默认 CSP 禁内联脚本 / `eval`，富文本编辑器不能引 CDN 脚本 |
| 「+」新建、重命名、文件夹/标签、拖拽排序、本地搜索 | DOM + `NT.storageGet/Set`（`newtab/common.js` L44-60） | ✅ 纯本地，零新增权限 |
| 状态栏字数（截图 315 字 / 0-2000 字） | `textContent.length` | ✅ |
| **窗口置顶（图钉）** | `chrome.windows.create` 的 `createData` **没有 `alwaysOnTop` 字段**（只有 `Window` 类型上有该只读属性）；`windows.update` 也没有 | ❌ 做不到等价置顶 |
| **桌面贴边隐藏 / 透明模式 / 换皮肤** | 扩展窗口 API 无贴边隐藏、无透明度字段；网页/扩展页不能脱离浏览器窗口覆盖桌面 | ❌ 做不到；可降级为 newtab 内固定定位面板 |
| 单张便签独立显示 | `chrome.windows.create({ type: 'popup', url: ..., width, height, left, top })` | ⚠️ 可开独立小窗口，但无置顶/贴边/透明，且浏览器必须运行；`'panel'` 已弃用且仅 Chrome OS 白名单扩展可用 |
| 团签成员管理 / 加密 / 团队共享 / 分享为网页 / 登录后多端云同步 | 需账号 + 后端 + 同步冲突合并 | ❌ 与项目「零后端 / 零账号 / 零外部 API」硬约束冲突。`storage.sync` 仅约 100KB、单项 8KB，只能同步设置类小数据，**不能同步便签正文与图片** |
| 卸载后的数据安全 | 官方 "Data is stored locally and cleared when the extension is removed" | ⚠️ 便签数据会随卸载丢失，必须配套 `docs/newtab-feature-research.md` P0-1 的导出/导入 |

### 4.2 Todo list（截图 2 / 3）

| 截图功能 | 插件实现方式 | 结论 |
|---|---|---|
| checkbox 新增（Enter / 「+」）、点击方框完成并自动归档 | 本地数组 + DOM 重渲染 | ✅ |
| 置顶 / 移动 / 排序 / 删除 / 放弃、Ctrl 多选批量 | 本地状态；排序可用 HTML5 DnD（项目 `sessions.js` 已有可复用模式） | ✅ |
| 「今日」切换 今日 / 未来 / 过期 / 已完成；「已完成 / 已放弃」折叠分组 | 过滤 + `hidden` 属性（项目 `[hidden]{display:none !important}` 前提已在） | ✅ |
| 开始 / 完成时间戳（`开始:03-23 完成:03-24 14:23`） | `Date.now()` + `NT.formatTime`（`common.js` L75） | ✅ |
| 有序编号列表（截图 3 的 1–5 发布流程） | 富文本 `<ol>` 或独立字段 | ✅ |
| 「右键可设为重复待办」 | 便签内的右键菜单需**自绘 DOM 菜单** | ⚠️ 已声明的 `contextMenus` 权限是**浏览器网页右键菜单**，不是扩展页内部右键，不要误用 |
| 「右键可设定时弹窗提醒」 | 接 §3 的 alarms 链路 | ✅ 见 §4.3 |

### 4.3 定时提醒（截图 4）

| 截图字段 | 插件对应 | 结论 |
|---|---|---|
| 提醒模式：单次提醒 | `chrome.alarms.create(name, { when: ts })`，不设 `periodInMinutes` | ✅ |
| 提醒模式：重复（下拉其它值截图未展开） | 每次 `onAlarm` 重算绝对 `when` 并同名覆盖；固定间隔才用 `periodInMinutes` | ✅，但**此处我不确定**该软件提供了哪些重复规则 |
| 提醒方式：弹窗 | `chrome.notifications.create`（官方："show these notifications to users in the system tray"）为主；可选 `windows.create({type:'popup'})` 开扩展页窗口 | ⚠️ 是系统通知 / 扩展页窗口，**不是桌面原生置顶弹窗**；系统勿扰或用户关闭通知权限时可能看不到 |
| 提醒时间：年 / 月 / 日(星期) / 时 / 分 + 「设为当前时间」 | 表单拼本地时间 → `new Date(y,m-1,d,h,min).getTime()` 得绝对毫秒 | ✅。注意：存绝对时间戳，显示才转本地；跨时区 / 夏令时按本地时区重算，**系统时钟被手动修改的行为我不确定** |
| 内容 0/2000 字、撤销重做、清除格式、图片、Enter 确定 / Ctrl+Enter 换行 | 表单 + `textarea` / `contentEditable`；项目已有 textarea Enter 处理先例（`.field-textarea`，见 2026-11-13 日志） | ✅ |
| 到点准确性 | 见 §3 | ⚠️ 只能承诺「浏览器运行时的分钟级提醒」 |

---

## 5. 最小实现方案（仅示意，本轮不实施）

| 文件 | 改动 | 说明 |
|---|---|---|
| `manifest.json` | `permissions` 加 `"alarms"` | **唯一新增权限，必须 `chrome://extensions` 重载**。`notifications` 已声明，不用加 |
| `background/background.js` | 顶层注册 `chrome.alarms.onAlarm` + `runtime.onInstalled` / `onStartup` → 一个 `syncAlarms()` | 保持「能用一个函数就不拆」：`syncAlarms()` 负责读 `nt_notes_reminders`、比对 `alarms.getAll()`、重建缺失、按策略补发过期、`console.log` 结果 |
| `newtab/newtab.html` | 加 1 个 `nav-item[data-view="notes"]` + `<section id="viewNotes" hidden>` + 末尾追加 `notes.js` | 按 `docs/itab-optimization-plan.md` §0.4 三处加法，原 9 个脚本顺序不动 |
| `newtab/newtab.js` | `VIEW_MAP` 加一行 `notes: { view:'viewNotes', side:false }` | 默认视图仍由 HTML 初始属性决定，不要改成 JS 初始化 |
| `newtab/notes.js` / `notes.css` | 三类便签 UI + 表单 | 新 key 用 `nt_notes_*` 前缀，不碰 7 个既有 key；所有 `chrome.*` 调用做 guard + `runtime.lastError` |
| 通知点击 | `chrome.notifications.onClicked` → `chrome.tabs.create({ url: chrome.runtime.getURL('newtab/newtab.html') + '#notes' })` | **需额外支持 hash 指定视图**：当前 `switchView` 只在 nav 点击时调用（`newtab.js` L69-88），`DEFAULT_VIEW='sites'`；这是一个明确的新改动点，不要漏 |

**关键链路**：`notes.js` 写 `nt_notes_reminders`（存 `when` 绝对毫秒）→ 通知后台重建 alarm → `onAlarm` 发系统通知 → 用户点击打开 `#notes` 视图 → 重复提醒重算下一次 `when`。后台与 newtab 之间现有链路只有 `tabs.sendMessage` → `runtime.onMessage`，**没有 `runtime.sendMessage`**，可用 `chrome.storage.onChanged` 传递（官方 storage 文档有该事件），或补一条 `runtime.onMessage` 顶层监听。

---

## 6. 明确不建议

| 项 | 理由 |
|---|---|
| 用 newtab 页内 `setTimeout` 做提醒 | 隐藏 > 5 分钟被节流到每分钟检查一次，关页即失效（Chrome 88 官方博客） |
| 用 SW 内 `setInterval` 轮询「是否到点」 | 30 秒空闲终止会取消 timer；官方明确要换成 alarms |
| 用 `periodInMinutes` 实现「每天 09:00」 | 睡眠唤醒后从唤醒时刻重排，会漂移；必须用绝对 `when` 重算 |
| 承诺「关掉浏览器也能提醒」「秒级精确」「开机自启弹窗」 | 纯扩展能力边界外。要做到需 Native Messaging + Windows 任务计划程序 / 常驻本地进程，或服务端 Web Push —— 都要突破项目「零后端、零外部调用」硬约束，且引入安装与运维成本 |
| 引入富文本框架 / 构建链 / CDN | MV3 默认 CSP 禁内联脚本、`eval`、远程 `<script src>`；项目为零构建原生 DOM + `window.NT` 命名空间 |
| 复用 `nt_collections` / 「标签管理」视图承载便签 | 语义冲突且会污染既有 7 个 key（`docs/itab-optimization-plan.md` L181） |
| 把 `contextMenus` 权限当作便签内右键菜单 | 该 API 作用于浏览器网页右键，见 §4.2 |

---

## 7. 需要你定的 6 件事

| # | 问题 | 为什么必须定 |
|---|---|---|
| 1 | 提醒精度验收口径：只要求「浏览器开着、分钟级」，还是必须秒级 / 关机也能弹？ | 后者纯扩展做不到，需另起 Native / 服务端方案，架构完全不同 |
| 2 | 是否接受新增 `alarms` 权限并在 `chrome://extensions` 重载扩展？ | 这是唯一的新增权限，不重载则 `chrome.alarms` 为 undefined |
| 3 | 提醒方式选：系统托盘通知 / 扩展页 popup 窗口 / 两者都要？ | 两者形态与可靠性不同，见 §4.3 |
| 4 | 便签 UI 落点：newtab 新 nav-item / sidePanel / 独立 popup 窗口？ | §0.4 三处加法是改动面最小的路径，但视觉上最不像「桌面便签」 |
| 5 | 是否必须支持「插入图片 / 截图粘贴」？ | 决定是否要引入 IndexedDB；只做纯文本可省掉整个存储分支 |
| 6 | 「重复提醒 / 重复待办」需要哪些规则（每日 / 每周 / 固定间隔 / 自定义）？ | 决定是重算绝对 `when` 还是直接用 `periodInMinutes`；截图下拉未展开，我不猜 |

---

## 8. 未核实 / 不确定清单（明确列出，不猜）

| 项 | 状态 |
|---|---|
| 本机 Chrome 上 `chrome.alarms` 的实际误差分布 | **未实测**。§3.6 给出验收场景，数值留空 |
| 当前稳定版最小间隔究竟 1 秒 / 30 秒，以及从哪个版本起变更 | 官方英文页、中文镜像、MDN 不同步；**此处我不确定**，需目标版本实测 |
| 浏览器关闭期间错过的 alarm，重开 Chrome 是否自动补发 | 官方只写了设备睡眠补发与 `persistAcrossSessions`（Chrome 150+，默认 true），**未逐字说明浏览器关闭场景**；架构上应视为不触发，靠 `onStartup` 自检补发，需实测 |
| 系统时钟被手动修改 / 跨夏令时后的 alarm 行为 | 官方文档未查到明确条款，**我不确定**；实现上用绝对 `when` + 每次重算降低风险 |
| `alarms` 是否会因扩展频繁唤醒被额外限频 | 本轮检索未找到明确的官方限频条款，**不采信第三方说法**，需实测或另行查证 |
| 截图「提醒模式」「提醒方式」下拉的其它选项值 | 截图只显示当前值「单次提醒」「弹窗」，**未展开，我不确定** |
| 截图 3 第 5 条等小字内容 | 分辨率下无法完整辨认，未据此推导任何功能结论 |
| 系统通知在 Windows 勿扰 / 通知权限关闭时的实际表现 | 官方文档只给 `getPermissionLevel()` 与 `requireInteraction`，实际表现需本机实测 |
| 桌面便签软件的实机行为（置顶、贴边隐藏、云同步） | 仅依据截图文字与官方扩展 API 对照，**未实机安装验证** |

---

## 9. 主要来源索引（本轮直接抓取）

**Chrome 官方 API / 文档**
- `https://developer.chrome.com/docs/extensions/reference/api/alarms` — 权限 `alarms`、`create()` 延迟无上界、`scheduledTime`、Device sleep、`persistAcrossSessions`（Chrome 150+）
- `https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle` — 空闲 30 秒终止、全局变量丢失、Chrome 120 最小 30 秒
- `https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers` — "Convert timers to alarms"、监听器顶层同步注册
- `https://developer.chrome.com/blog/timer-throttling-in-chrome-88/` — 后台页 1 秒 / 5 分钟后 1 分钟 intensive throttling
- `https://developer.chrome.com/docs/extensions/reference/api/notifications` — 系统托盘通知、必填字段、`requireInteraction`、`getPermissionLevel()`
- `https://developer.chrome.com/docs/extensions/reference/api/storage` — `storage.local` 10 MB（Chrome 113 及更早 5 MB）、`QUOTA_BYTES 10485760`、卸载即清除、`storage.sync` 约 100KB / 单项 8KB
- `https://developer.chrome.com/docs/extensions/reference/api/windows` — `create()` 的 `createData` 字段（无 `alwaysOnTop`）、`type:'popup'`、panel 已弃用
- `https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/alarms/create` — Chrome 117 起 500 个 alarm 上限、Chrome 120 前 1 分钟 / 之后 30 秒、unpacked 例外

**本地（本轮静态核对）**
- `manifest.json` L12-41、`background/background.js` L26、`newtab/common.js` L44-60、`newtab/newtab.js` L63-88 / L112、`newtab/newtab.html` L27-40 / L255-264
- `docs/newtab-feature-research.md` §2.3 / §4.1 P0-1、`docs/itab-optimization-plan.md` §0.4 / §2

---

## 10. 追加调研：无服务器场景下的多端数据同步（本地文件 + git）

- 追加日期：2026-11-16
- 追加提问原文：「这个扩展是我自用的，但我没有服务器无法存储，我能否在本地将改动同步到一个 sql 或者 db 文件，然后将这个文件传到 git 在不同的浏览器或者电脑之间通过 git 保证同一个源」
- 性质：可行性判定 + 方案对比，**本轮仍为零代码改动**（只追加本节文档）

### 10.1 歧义（先对齐）

| 表述 | 我的处理 | 需你核对 |
|---|---|---|
| 「改动」 | 按「**便签数据**的增删改」理解。扩展**代码**本来就应该进 git（项目目录本身即仓库候选），与数据同步是两件事 | 若你指的是「代码 + 数据一起版本化」，请说明，结论会不同 |
| 「不同的浏览器」 | 分两种口径：① Chromium 系（Chrome / Edge / Brave，多电脑或多 profile）—— 同一份扩展 + 同一份数据文件可行；② Firefox / Safari —— MV3 API 与 manifest 有差异，不是同一份扩展直接可用，本节不作承诺 | 你需要的是哪一种 |
| 「保证同一个源」 | 理解为「有一个可追溯的权威副本 + 各端最终一致」，**不是**实时一致性。git 不提供多端并发写的合并语义 | 若期望「一端改完另一端自动生效」，只有 §10.4 方案 C 能覆盖 |

### 10.2 精确性纠错

| 原表述 / 隐含前提 | 问题 | 纠正后 |
|---|---|---|
| 「没有服务器无法存储」 | 扩展已经有本地持久化，不需要自建存储层。**但这句话只对文本 / 元数据成立，图片二进制不适用** | `chrome.storage.local` 是本地持久化（官方 10 MB，Chrome 113 及更早 5 MB；卸载扩展即清除），只装便签正文 / todo / 提醒定义；图片必须走 IndexedDB，见 §10.10。缺的不是「存储」，是「跨设备的文件出口」 |
| 「同步到一个 sql / db 文件」 | ① 扩展页没有 `fs` / Node 模块，不能静默写任意本地路径；② SQLite `.db` 是二进制，git 无法 diff / merge；③ 换存储引擎解决不了跨设备问题 | 运行时仍用 `chrome.storage.local`；跨设备靠**导出成文本文件**（JSON / Markdown），不是换数据库 |
| 「在本地将改动同步」= 自动落盘 | 纯扩展做不到自动写盘 | 写文件必须走三条路径之一，且都要用户手势或额外安装：`chrome.downloads` / File System Access API / Native Messaging，见 §10.3 |
| 「通过 git 保证同一个源」 | git 保证的是版本历史与文件一致性；两端同时修改会冲突，二进制 `.db` 冲突无法人工解；扩展也不会自动感知 `git pull` | 链路必须是「导出 → commit/push → 另一端 pull → 导入」四步；冲突靠人工看 diff 决定，不做自动合并 |
| 隐含「同步后提醒也跟着生效」 | `chrome.alarms` 是**每台浏览器本地注册**的，不是数据 | git 只同步「提醒定义（绝对 `when`）」；另一端导入后必须由 §3.5 的 `syncAlarms()` 在本机重建 alarm |

### 10.3 三条可行路径

| 方案 | 链路 | 新增权限 | 自动化程度 | 代价 / 限制 |
|---|---|---|---|---|
| **A. 手动导出 / 导入 JSON + git（推荐）** | `storage.local` → `Blob` + `<a download>` 导出 `notes.json` → `git add/commit/push` → 另一端 `git pull` → `<input type="file">` + `FileReader` 导入 | 零新增权限（若 Blob 下载被 MV3 CSP 拦，退路是 `chrome.downloads` → 需加 `downloads` 权限并重载扩展） | 每次手动两步 | 改动面最小，直接复用 `docs/newtab-feature-research.md` P0-1 的导出/导入设计；不做自动合并 |
| **B. `chrome.storage.sync`** | 免账号系统的 Chrome Sync 通道 | 零新增权限（`storage` 已声明） | 全自动 | 官方：`If the user enables syncing, the data syncs with every Chrome browser that the user is logged into. If disabled, it behaves like storage.local.`；配额约 **100 KB / 单项 8 KB**，只能同步设置类小数据，**不能装便签正文、图片、提醒列表**；且依赖登录 Chrome 账号并开启同步，不等于「完全无服务器」 |
| **C. Native Messaging + 本地脚本 + git** | 扩展 ↔ 本地 host（Node/Python）↔ 固定路径文件 ↔ 自动 `git commit/push` | `nativeMessaging` | 可做到准自动 | 成本最高，见 §10.4 |

**A 的增强（可选）**：File System Access API 的 `showSaveFilePicker()` 可拿到可写句柄，把句柄存 IndexedDB 后覆盖同一个 `notes.json`，省掉每次下载弹窗。但该 API 要求 transient user activation + 安全上下文、Chromium-only（Chrome/Edge 86+，Firefox/Safari 无 picker）、句柄跨会话需重新 `requestPermission()`。**`chrome-extension://` 扩展页是否完整支持该 API，本轮查到的官方与第三方资料都没有明确结论，此处我不确定，需实测**；在实测前不要把它写进方案主线。

### 10.4 方案 C 的硬约束（全部有官方依据）

| 项 | 官方原文 / 字段 |
|---|---|
| 权限 | "To use these methods, the `\"nativeMessaging\"` permission must be declared in your extension's manifest file." |
| Windows 注册 | "The application installer must create a registry key, either `HKEY_LOCAL_MACHINE\\SOFTWARE\\Google\\Chrome\\NativeMessagingHosts\\<name>` or `HKEY_CURRENT_USER\\SOFTWARE\\Google\\Chrome\\NativeMessagingHosts\\<name>`, and set the default value of that key to the full path to the manifest file." |
| host manifest | 必填 `name` / `description` / `path` / `type: "stdio"` / `allowed_origins: ["chrome-extension://<ID>/"]`；"`allowed_origins` values *can't* contain wildcards" |
| 消息上限 | "The maximum size of a single message from the native messaging host is 1 MB... The maximum size of the message sent to the native messaging host is 64 MiB."（便签含图片 base64 时会撞 1 MB 回传上限） |
| 上下文限制 | "These methods are not available inside content scripts, only inside your extension's pages and service worker." |

由此推导但**需实测**的一点：unpacked 加载的扩展 ID 由加载路径派生，不同电脑路径不同则 ID 不同，而 `allowed_origins` 不允许通配符 → 走方案 C 需要先固定扩展 ID（通常靠 manifest 的 `key`）。官方文档本节未逐字说明 ID 生成规则，**我不确定**，需在你的两台机器上实测 `chrome://extensions` 显示的 ID 是否一致。

### 10.5 为什么不能直接 git `chrome.storage.local` 那个文件夹

| 事实 | 依据 |
|---|---|
| `storage.local` 的物理位置是 Chrome profile 内 `Local Extension Settings/<extension-id>/`，按 profile 与扩展 ID 隔离，各浏览器各 profile 各一份 | 第三方技术资料（gist / dev.to / 扩展路径说明）；**官方 storage 文档未逐字说明物理路径**，标注为【第三方】 |
| 该目录是 **LevelDB 多文件结构**（`.ldb` / `MANIFEST` / `CURRENT` / `LOG`），不是单个 `.db` 文件；Chrome 运行时文件被锁定、值有双重 JSON 编码 | 【第三方】；官方只承诺通过 `chrome.storage` API 读写 |
| 同一扩展在 Chrome 与 Edge 的扩展 ID 不同 → 目录名不同 | 【第三方】 |
| 二进制 LevelDB / SQLite 在 git 里无可读 diff、冲突无法合并；运行中复制会拿到不一致快照 | git 文本合并机制 + LevelDB WAL 特性【推断】 |

**结论**：不要 git 该目录，也不要试图在扩展运行时写它。导出成文本才是可维护的出口。

### 10.6 落在本项目的最小改动面（仅当采纳方案 A）

| 位置 | 改动 |
|---|---|
| `docs/newtab-feature-research.md` P0-1 | 直接复用其导出/导入设计：`Blob` + `URL.createObjectURL` + `<a download>`；`<input type="file">` + `FileReader`；导入前校验 JSON schema、字段类型、URL 协议白名单，失败不写 storage |
| `newtab/common.js` L44-60 | `NT.storageGet/Set` **不动**，仍固定走 `storage.local` |
| 新增 `newtab/notes-sync.js` | 一个模块两个入口（导出 / 导入），不拆多函数；导出范围只含 `nt_notes_*` 三个新 key（`notes` / `todos` / `reminders`），**不含既有 7 个 key**（`docs/itab-optimization-plan.md` L181）。**图片不在这些 key 里**（在 IndexedDB），导出时要单独决策，见 §10.10 |
| `manifest.json` | 走 Blob 下载则不动；若改用 `chrome.downloads.download({ filename, saveAs:true })` 需加 `downloads` 权限并重载扩展。官方原文："A file path relative to the Downloads directory... **Absolute paths**, empty paths, and paths containing back-references `..` **will cause an error**" —— 只能用相对下载目录的路径；`saveAs:true` 弹文件选择器让用户选位置 |
| 仓库侧 | 放 `data/notes.json`（格式化缩进，便于 `git diff`）；**扩展无法静默写入仓库目录**，最后一步「把导出文件放进仓库」必须由人拷贝、或由 `saveAs` 对话框选到仓库路径、或由方案 C 的 host 完成 |
| 提醒联动 | 另一端导入后调 `syncAlarms()` 重建本机 alarm（§3.5）；git 不搬 alarm 注册状态 |

**数据格式口径（最小可行）**：单个 `notes.json` 全量导出覆盖；每条带 `id` / `updatedAt` / `deleted`（墓碑标记，便于以后加合并）；两端都改过时 `git pull` 报冲突，人工看 diff 决定保留哪一版。**不实现 CRDT / 自动合并 / 按字段合并**。`notes.json` 里**不出现任何图片 base64**（运行时富文本 HTML 只存 `imgId` 引用，图片 Blob 在本机 IndexedDB）；图片是否跨端同步需单独决策，见 §10.10。`.sql` 文本只适合当导出脚本，不是运行存储格式。

### 10.7 新增的待确认项（接 §7）

| # | 问题 |
|---|---|
| 7 | 「不同的浏览器」是 Chromium 系多端，还是包含 Firefox / Safari？ |
| 8 | 能接受每次手动「导出 + 导入」两步吗？若必须全自动，只能上方案 C（本地 host + 注册表 + 固定扩展 ID） |
| 9 | git 仓库在哪、是否私有？便签明文（含可能的图片与个人内容）能否提交进仓库？ |
| 10 | 两端同时修改的口径：全量覆盖（建议）还是按 `updatedAt` 合并？ |
| 11 | 图片是否必须跨端同步？ |

### 10.8 本节新增的未核实项

| 项 | 状态 |
|---|---|
| `showSaveFilePicker` 在 MV3 扩展页是否可用、句柄跨会话是否免重新授权 | **我不确定，需实测**；查到的资料只覆盖普通 HTTPS 网页 |
| `chrome.downloads.download({saveAs:true})` 能否选到任意目录（含 git 仓库路径） | 官方文档只写 "Use a file-chooser to allow the user to select a filename"，**未实测** |
| unpacked 扩展 ID 是否随路径变化、能否用 manifest `key` 固定 | 官方 native messaging 文档只写 `allowed_origins` 不允许通配符，**未逐字说明 ID 生成规则，需实测** |
| `chrome.storage.local` 的物理路径与 LevelDB 结构 | 来自【第三方】资料，官方 storage 文档未逐字说明；但「不适合直接 git」的结论不依赖这一点 |
| Firefox / Safari 的 MV3 兼容差异 | 未逐项核实 |
| Blob + `<a download>` 在 MV3 扩展页 CSP 下能否直接触发 | 源码级判断，未实测（沿用 P0-1 结论） |

### 10.9 本节新增来源

- `https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging` — `nativeMessaging` 权限、Windows 注册表键、host manifest 字段、1 MB / 64 MiB 消息上限
- `https://developer.chrome.com/docs/extensions/reference/api/downloads` — `downloads` 权限、`DownloadOptions.filename` 相对路径限制、`saveAs`、`conflictAction`
- `https://developer.chrome.com/docs/extensions/reference/api/storage` — `storage.local` 10 MB、`QUOTA_BYTES 10485760`、卸载即清除、`storage.sync` 约 100 KB / 单项 8 KB 与 Chrome Sync 行为
- `https://developer.chrome.com/articles/file-system-access`（及 MDN / 第三方兼容性资料）— `showSaveFilePicker` 的用户手势、安全上下文、Chromium-only、句柄持久化与重新授权
- `https://gist.github.com/bkataru/ba0e7cb4fd43bf1a0ed2a96ed124b99b/ae5c52d8a43fbdba9fb855236aead745a2d3e4d7`、`https://dev.to/protemir/modheader-got-pulled-from-the-chrome-web-store-heres-how-to-get-your-profiles-back-1mc0`【第三方】— `Local Extension Settings/<id>` 路径、LevelDB 结构、跨浏览器 ID 差异

---

### 10.10 修正：`storage.local` 装不下富文本里的截图

用户纠错原文：「chrome.storage.local 不行啊，富文本如果放两张截图，就爆了」。**该判断成立**，且比 §10.2 / §10.6 原先的笼统表述更严重。本节修正前文三处表述（§4.1、§10.2、§10.6 已同步改），并给出替代方案。

#### 10.10.1 确认的事实（官方原文）

| 项 | 依据 |
|---|---|
| 上限 | `storage.local` → `QUOTA_BYTES 10485760`（Chrome 113 及更早 5 MB） |
| 计量方式 | 官方："The maximum amount (in bytes) of data that can be stored in local storage, **as measured by the JSON stringification of every value plus every key's length**" —— 是**所有 key 的总量**，不是单张图片，也不是单个 value |
| 超限后果 | 官方："Updates that would cause this limit to be exceeded **fail immediately** and set `runtime.lastError` when using a callback, or **a rejected Promise** if using async/await" —— 是写入失败，不是变慢 |
| 为什么会爆 | `dataURL` = base64，体积约为原二进制的 **4/3**（编码机制，非实测值）；设单张截图 X MB，两张 ≈ 2.67X MB，再加 JSON 转义、其它便签正文、todo、提醒定义，逼近 10 MB 是常态。**X 的具体值取决于你的截图，本节不编造** |
| 连带问题 | 每个 `nt_notes_*` key 的读写都是整个对象 JSON 序列化；大 base64 会拖慢读写、撑大导出的 `notes.json`、让 git diff 不可读 |

#### 10.10.2 两个选项

| 选项 | 做法 | 新增权限 | 代价 |
|---|---|---|---|
| **A. 加 `unlimitedStorage`（改动最小）** | `manifest.json` 的 `permissions` 加 `"unlimitedStorage"`，在 `chrome://extensions` 重载；代码零改动，图片继续用 dataURL | `unlimitedStorage` | 官方："but can be increased by requesting the `\"unlimitedStorage\"` permission" / "This value will be ignored if the extension has the `unlimitedStorage` permission"。**但**大 base64 仍走全量 JSON 序列化，导出文件与 git 仓库会膨胀；解除后的具体上限官方未写明 |
| **B. 分层存储（推荐）** | 文本 / 元数据 → `storage.local`（`nt_notes_*`，KB 级）；图片二进制 → **IndexedDB 存 Blob** | **零新增权限**（IndexedDB 不需要 manifest 权限） | 新增一个图片模块 + 富文本引用链路，见下 |

推荐 B 的理由（承接 §10）：它不只解决配额，还让 `notes.json` 保持小且可 diff —— 否则即便加了 `unlimitedStorage`，git 同步链路仍会被 base64 毁掉。官方依据：extension service worker 生命周期文档把 IndexedDB 列为持久化选项，原文 "A low-level API for client-side storage of structured data, **including files and blobs**"；web.dev《Storage for the web》"For other data, use IndexedDB"、"accessible from the `window` object, web workers, and **service workers**"。Blob 直接入库，不经过 base64，不产生 4/3 膨胀。

#### 10.10.3 富文本里的图片引用链路（方案 B）

| 步 | 做法 |
|---|---|
| 1 | `paste` 事件读 `event.clipboardData.files[i]`，拿到 `File` / `Blob` |
| 2 | 生成 `imgId`（简单自增 / 时间戳即可；若要跨端去重用内容哈希，需 `crypto.subtle.digest`，扩展页是否可用**需实测**） |
| 3 | IndexedDB `objectStore.put(blob, imgId)` |
| 4 | 富文本 HTML **只存** `<img data-note-img="<imgId>">`。**不存 `blob:` URL**（刷新后失效），**不存 `data:` URL**（回到配额问题） |
| 5 | 渲染时 `get(imgId)` → `URL.createObjectURL(blob)` → 赋给 `img.src`；重渲染 / 卸载时 `URL.revokeObjectURL()` |
| 6 | 删除便签时删对应 Blob，或留孤儿记录定期清理 |
| 7 | 改动面：新增 `newtab/note-images.js`（一个模块，`put` / `get` 两个入口，不拆多函数）+ 富文本编辑器接入 + CSS 占位样式；`manifest.json` **不动** |

**MV3 CSP 提示**：默认 `extension_pages` CSP 未列 `img-src`，按推断 `<img src="blob:...">` 可用，**但我没有实测，此处需你验证**；若被拦，退路是把 Blob 转 `data:` 后临时赋给 `img.src`（只在渲染时存在于内存，**不写入 storage**）。

#### 10.10.4 对 git 同步的影响（接 §10.6）

| 口径 | 结论 |
|---|---|
| `notes.json` | 只含文本 + `imgId` 引用，保持小、可 diff、可人工合并 |
| 图片**默认不进 git** | 每台电脑的 IndexedDB 各存一份。另一端 `git pull` 导入后，`imgId` 在本机找不到 → 显示占位「图片未同步（缺 `<imgId>`）」，不破坏便签正文 |
| 若图片**必须**跨端 | 需要额外导出通道：逐张下载 / FSA 目录句柄 / Native Messaging host / 打包 zip（MV3 零构建链下要引库）。二进制进 git 会让仓库膨胀且无 diff。这与 §10.3 方案 A 的「单文件导出」前提冲突，必须先定这一条 |
| 卸载扩展后的图片 | 官方只写了 `storage.local` "cleared when the extension is removed"；**IndexedDB 属于 origin 数据，卸载是否一并清除我不确定，需实测**。因此导出/备份功能对图片同样必要 |

#### 10.10.5 本节新增待确认 / 不确定

| 类型 | 项 |
|---|---|
| 待你定 | 12. 选 A（`unlimitedStorage`）还是 B（分层 IndexedDB）？13. 图片是否必须跨设备同步？14. 单张图片是否设大小上限（超限压缩或拒绝）？ |
| **我不确定 / 需实测** | 扩展 origin（`chrome-extension://<id>`）的 IndexedDB 是否适用 web.dev 的「单 origin 最多 60% 总磁盘空间」规则 —— 用 `navigator.storage.estimate()` 在扩展页实测；官方 web.dev 原文 "An origin can use up to 60% of the total disk space"，但讲的是普通网页 |
| **我不确定 / 需实测** | `unlimitedStorage` 解除 10 MB 后的实际上限（官方未写明）；默认 best-effort 数据在磁盘紧张时可能被回收（web.dev，可请求 `navigator.storage.persist()`） |
| **我不确定 / 需实测** | 卸载扩展是否清除 IndexedDB、MV3 CSP 是否放行 `blob:` 图片、`crypto.subtle` 在扩展页可用性 |
| 来源 | `https://developer.chrome.com/docs/extensions/reference/api/storage`（`QUOTA_BYTES 10485760`、`unlimitedStorage`、超限行为）；`https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle`（IndexedDB 支持 blobs）；`https://web.dev/articles/storage-for-the-web`（配额 60% / `estimate()` / `QuotaExceededError` / best-effort 回收） |

---

## 11. Todo list 实施记录（2026-11-16）

**范围**：按用户「新增一个便签 nav，完成以上调研的 todo list 功能」，只落地 §4.2 的 Todo list 本地能力。**普通便签富文本、定时提醒、重复待办本轮不做**。`manifest.json` 零改动 —— `storage` 权限已声明，不需要 `alarms` / `notifications`。

### 11.1 改动文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `newtab/newtab.html` | 第 4 个 `nav-item[data-view="notes"]`（文字「便签」）+ `<section id="viewNotes" hidden>` + 单例 `#notesMenu` + 末尾追加 `notes.js` | 按 §0.4 三处加法，原 9 个脚本顺序不动；新增 id 不复用既有 28 个 |
| `newtab/newtab.js` | `VIEW_MAP` 加 1 行 `notes: { view:'viewNotes', side:false }`，顶部脚本顺序注释同步 | `DEFAULT_VIEW` 仍是 `sites`，`switchView` / `init()` 未改 |
| `newtab/notes.js` | **新建**，自初始化 IIFE，挂 `window.NT.notes` | 依赖仅 `common.js`；所有 `chrome.*` 走 `NT.storageGet/Set` + `hasStorage()` guard + `runtime.lastError` 检查 |
| `newtab/newtab.css` | 末尾追加 `.notes-*` 样式段（含 560px 媒体查询） | 上方 1694 行既有规则零改动；筛选按钮复用 `.site-cat`、标题复用 `.collections-head` |

### 11.2 数据口径（为 §10 的导出/导入预留）

`chrome.storage.local` **只新增 1 个 key**：`nt_notes_todos`（数组）。不复用、不修改既有 7 个 key；后续做普通便签 / 提醒时再加 `nt_notes_*` 其它 key，本轮没有。

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | string | `todo-<ms>-<随机>` |
| `text` | string | 待办正文（纯文本，不做富文本 / HTML 回显，因此无 XSS 清洗需求） |
| `done` / `abandoned` / `pinned` | boolean | 完成 / 放弃 / 置顶；`done || abandoned` 即「已归档」 |
| `due` | string | `YYYY-MM-DD`，空串表示归入「今日」；只存字符串，便于直接进 `notes.json` 且可 diff |
| `createdAt` / `doneAt` | number | 绝对毫秒，显示时才用 `NT.pad2` 转 `开始:03-23` / `完成:03-24 14:23` |

折叠状态存 `localStorage` 的 `nt_notes_todos_collapsed`（UI 偏好，不是业务数据，不进 git）。

### 11.3 功能对照（§4.2 / 截图 2、3）

| 调研 / 截图条目 | 实现 | 说明 |
|---|---|---|
| 新增待办：`+` / Enter | ✅ | `#notesAddForm`，提交后输入框保持焦点可连续录入；可同时设 `due` |
| 点击某条后按 Enter 新增下一条 | ✅ | 单击文字进入行内编辑，Enter 保存并在其后插入空白待办并聚焦；空白条空内容失焦自动丢弃 |
| 点击左侧方框完成并自动归档 | ✅ | `change` → `doneAt = Date.now()` → 移入下方「已完成 / 已放弃」分组；归档区点 checkbox 恢复 |
| 开始 / 完成时间戳 | ✅ | `开始:MM-DD · 计划:YYYY-MM-DD · 完成:MM-DD HH:mm` |
| 「今日 / 未来 / 过期 / 已完成」切换（+ 全部） | ✅ | 过滤函数 `matchFilter()`；未设 `due` 归入今日；归档项只在分组渲染，不重复 |
| 「已完成 / 已放弃」折叠分组 | ✅ | `#notesArchiveToggle`，折叠状态持久化 |
| 置顶 / 移动 / 排序 / 删除 / 放弃 | ✅ | 自绘右键菜单（行尾「···」也可打开）；置顶稳定排序，上移/下移交换数组元素；删除 / 清空归档带 `confirm` |
| Ctrl 多选批量 | ✅ | Ctrl / ⌘ 点击选中，右键菜单批量执行（菜单标注条数）；右键未选中行时自动清旧多选 |
| 右键菜单权限口径 | ✅ | 用 `contextmenu` + `preventDefault` 自绘 DOM，**未误用** `contextMenus`（那是网页右键） |
| 多标签页同步 | ✅ | `chrome.storage.onChanged` 监听 `nt_notes_todos`，同值写入跳过、编辑态跳过，避免重建 DOM 丢焦点 |

### 11.4 明确未做（不是遗漏，是范围边界）

| 项 | 理由 |
|---|---|
| 普通便签富文本、图片粘贴 / IndexedDB | 属于 ① 类，需编辑器 + §10.10 图片链路 |
| 定时弹窗提醒、`alarms` / `background.js`、`#notes` hash 跳转 | 属于 ③ 类，需新增权限并重载扩展；调研 §3 的准确性问题未验收 |
| 右键「设为重复待办」 | 与 ③ 类的重复规则绑定，截图下拉未展开，规则清单未定 |
| 有序编号列表（截图 3 的 1–5 发布流程） | 是便签正文里的 `<ol>` 富文本内容，不是 checkbox 待办实体 |
| 多个便签清单 / 左侧便签列表 / 窗口置顶 | 前者是 ① 类的分组管理，后者 `windows.create` 做不到（§4.1） |
| 导出 / 导入 `notes.json` + git（§10 方案 A） | 属同步能力，不是 todo 本体；数据结构已按可导出设计（`due` 为字符串、纯文本） |

### 11.5 验证状态（区分「已验证」与「需实测」）

| 状态 | 内容 |
|---|---|
| **已验证（静态 + 逻辑）** | `node --check` 通过；HTML 61 个 id 无重复；CSS 花括号平衡；用轻量 DOM 桩实际跑 `common.js + notes.js`，26 项断言全 PASS：初始化空态、新增 3 条、四种筛选、勾选归档 / 恢复、行内编辑 Enter 追加 / 空白丢弃、右键置顶排序、Ctrl 批量删除、清空归档、全程无写入错误 |
| **未实测（需你操作）** | 未在真实 Chrome 加载 unpacked 扩展：需在 `chrome://extensions` 点「重新加载」后打开新标签页 → 点「便签」nav，验证布局、原生 `date` 输入、右键菜单遮挡、CSP 是否放行、多标签页同步。`NT.notes.init()` / `NT.notes.render()` 可在 DevTools 手动调用强制重读 |
| **不编造的数值** | 真机渲染尺寸、菜单是否越界、`storage.local` 实际占用量：本轮未采集 |
