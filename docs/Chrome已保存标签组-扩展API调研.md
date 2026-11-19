# Chrome「已保存的标签组」扩展 API 可行性调研

日期：2026-11-19

**结论：扩展拿不到这些组。** 截图里的是 Chrome 的 **Saved Tab Groups（已保存的标签组）**，数据存在浏览器 sync 存储层，`chrome.tabGroups` API 只暴露当前窗口里打开的组，不暴露已保存/已关闭的组。

---

## 1. 截图对应的是什么

菜单顶部「创建新标签页分组 Alt+Shift+P」+ 14 个彩色圆点，是 Chrome 标签栏左侧的**标签组菜单**（也在 ⋮ → 标签组）。列出的是已保存/已关闭的 14 个组：

`美`、`Code`、`训练师`、`xlx`、`学`、`performance`、`TW`、`V`、`全`、`SEO`、`Schema`、`日`、`dev`、`登/注`

对照项目现状：书签页面板显示「2 个组 · 5 个标签」，那 2 个是**当前打开**的组，与这 14 个 saved 组不是同一批数据。

## 2. 两类「标签组」的数据边界

| 维度 | 当前打开的 tab group | 已保存的 tab group（截图中的） |
|---|---|---|
| 扩展 API | `chrome.tabGroups.query()` / `onCreated` 等 | **无**，没有任何 API |
| 数据位置 | 浏览器进程内的 tab strip 状态 | Chromium sync 存储层（`components/saved_tab_groups`） |
| 会话结束后 | 消失 | 保留，可跨会话、跨设备同步 |
| 在书签树里 | 否 | **否**（书签栏只是显示入口，不是书签节点） |
| `chrome.bookmarks` 可读 | 否 | 否 |

Chromium 官方仓库 `components/saved_tab_groups/README.md` 原文：

> "Saved Tab Groups are built on sync's storage layer. This storage solution works across sessions and when sync is enabled, saved tab groups will sync across devices updating the tabs and other metadata about the tab group in real-time."

Google 帮助（Product Expert 答复）原文：

> "A closed group isn't deleted and is saved in the bookmarks bar or in the menu. You can open a closed group again."

**关键区分：显示在书签栏 ≠ 存成书签。** 第三方对 Chromium 源码的分析指出，saved groups 使用 `UserSelectableType::kSavedTabGroups` 同步类型，书签使用 `kBookmarks`，是两套独立数据类型。书签 HTML 导出不包含 saved groups。

## 3. 为什么扩展拿不到

`chrome.tabGroups` 官方文档（Chrome 89+，MV3）暴露的全部内容：

| 类型 | 内容 |
|---|---|
| 字段 | `id`、`title`、`color`、`collapsed`、`windowId`、`shared`（Chrome 137+） |
| 方法 | `get()`、`query()`、`move()`、`update()` |
| 事件 | `onCreated`、`onMoved`、`onRemoved`、`onUpdated` |

没有任何 `saved` / `pinned` / `closed` 字段或方法。`query()` 只返回当前存在于窗口中的组。Chrome 137 新增的 `shared` 字段指的是**共享组**，不是已保存组，不解决问题。

### 官方 / 社区追踪

| 来源 | 内容 | 状态 |
|---|---|---|
| W3C webextensions [issue #715](https://github.com/w3c/webextensions/issues/715)（2024-10-29） | 要求增加 `tabGroup.pinned`、把 closed pinned 组纳入 `query()`、提供 open/close/delete | 至今未实现（issue 仍 open） |
| Chromium [issue 327629161](https://issuetracker.google.com/issues/327629161) | pinned tab groups | 功能本身，非扩展 API |
| Chromium [issue 40174035](https://issues.chromium.org/issues/40174035) | tabGroups API 完整性 | 未解决 |
| Chromium Extensions 邮件组（2025-05） | 提问能否 close / 读取 saved / delete 组 | 无实现计划，指向 #715 |

多个第三方扩展的官方说明也一致确认此限制（Tab Group Manager、TabGroups Rock、chrome-close-tab-groups）：已保存但关闭的组不暴露给扩展 API；要管理必须先手动打开。

## 4. 对上次代码改动的影响

上次为「列出全部标签组」做的**分窗口查询 + 去重**（`bookmarks/bookmarks.js:1138-1182`）方向不成立：

- `chrome.tabGroups.query({})` 本身查所有窗口，并非只查当前窗口；
- 真正原因是这 14 个组处于 saved/closed 状态，API 层面就不返回；
- 该改动不会导致错误显示，但增加了复杂度且没有解决问题。

## 5. 若要覆盖这 14 个组，可选方案

| 方案 | 能做到 | 代价 / 限制 |
|---|---|---|
| A. 手动点开保存组 | 打开期间扩展可读到 title / color / 组内 URL，可做快照导出 | 要逐个点开；关闭后又不可见 |
| B. 用书签文件夹替代 | 书签树扩展可完整读写（项目已有书签模块） | 需手动把组「书签化」；颜色、折叠状态不保留 |
| C. 常驻监听 `onCreated` / `onUpdated` 自建存档 | 组还开着时记入 `chrome.storage`，关闭后仍保留快照 | 只能记录安装扩展后新建/打开过的组，**历史 14 个补不回来** |
| D. native messaging 读磁盘 profile 文件 | 理论上可读 sync 落盘数据 | 需安装本地程序、处理文件锁、格式不稳定，不推荐 |
| E. 等 API | #715 实现后可直接支持 | 时间不确定（已挂起约 2 年） |

实际可行的是 **A + B 组合**。

## 6. 事实与待确认

**我确认的（有官方文档 / 源码 README / issue 依据）：**

- 截图是 Chrome 已保存的标签组菜单，共 14 个组；
- saved groups 基于 sync 存储层，不是书签节点；
- `chrome.tabGroups` API 不含 saved/closed 组的读取或管理方式；
- 相关 API 请求 #715 至今未实现。

**需要你确认的：**

- 上次改完后书签页面板现在显示的是「0 个组」还是「2 个组」——报告里按「2 个是当前打开的组」解释，若实际是 0，需要另外排查渲染逻辑。
- 是否要回滚上次的分窗口查询改动。

## 来源

- Chromium `components/saved_tab_groups/README.md`：https://raw.githubusercontent.com/chromium/chromium/main/components/saved_tab_groups/README.md
- `chrome.tabGroups` API 文档：https://developer.chrome.com/docs/extensions/reference/api/tabGroups
- W3C webextensions issue #715：https://github.com/w3c/webextensions/issues/715
- Google 帮助（关闭组仍会保存）：https://support.google.com/a/users/topic/9803983
- Google 帮助社区（saved groups 删除方式）：https://support.google.com/chrome/thread/443177059
