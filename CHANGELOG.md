# Changelog

## [1.3.3] - 2026-09-12

### Fix: 发版阻断项 + 类型推断 / 分隔符 / 安全 / 性能共 8 组缺陷

本轮来自一次独立二次审查（探针实测 + 代码白盒复核 + 集市规则源码核实）。其中 ① 为**发版阻断项**（不修则集市更新失败），②③ 会**静默写错数据**。

**① 【发版阻断】`preview.png` 扩展名与真实格式不符**
- **现象**：文件名是 `.png`，内容实为 JPEG（魔数 `ff d8 ff e0`，1692×899，201,184 字节）。该文件是 v1.3.0 替换预览图时引入的，当时只校验了体积、未校验格式。
- **根因**：集市规则 `siyuan-note/bazaar` → `rules/images.go`（2026-08-31 引入、09-01 修订）按**扩展名**与**魔数**各算一次 MIME，不一致即报 Issue。规则晚于 v1.3.2 发版，故此前未被拦 —— 任意一次新版本发布都会 `stage-fail`，集市索引不再更新。
- **修复**：转换为**真 PNG**（1280×680、RGB、464,894 字节，≤ 集市 512 KiB 上限）。
- **附带澄清**：preview 体积上限已由旧口径的 200 KiB 放宽至 **512 KiB**；插件包必需文件仅 `README.md` + `plugin.json` + `index.js`，`icon.png` / `preview.png` / `index.css` 均非必需。

**② number 列写入非有限值 → JSON `null`（写坏 AV 且破坏幂等）**
- **现象**：`Infinity` / `NaN` / `1e999` 被判为 number；`buildCell` 写入 `content: Infinity`，经 JSON 序列化变成 `null`，而 `isNotEmpty` 仍为 `true`（单元格被写坏）；同时源侧与目标侧归一结果不对称，导致二次导入重复。
- **修复**：`isNumber` / `buildCell` 改用 `Number.isFinite`；非有限值按空值处理（`isNotEmpty:false`、`content:0`）；`canonRawCell` 与 `canonValueCell` 对非法值统一归空，使源/目标行 key 严格对称。

**③ 含逗号的列与带货币符号的小数被误判成 mSelect / date**
- **现象**：`inferType(["1,000","2,000","3,000"])` 判为 `mSelect`（千分位金额被拆成 `1` / `000` 两个标签写入）；`detectScalar("$3.5")` 判为 `date`（价格列整列变日期字段）。
- **根因**：`MSELECT_SEP_RE` 含逗号且 mSelect 判定早于标量推断；`isDate` 的守卫只覆盖「以符号/点/数字开头」的串，货币符号前缀可绕过。
- **修复**：新增 `isExplicitNumber()`（识别标准千分位与可选货币符号包裹的十进制/科学计数）；`detectScalar` 在日期判定前优先返回 number；`inferType` 在 mSelect 判定前增加数值列守卫。真多选列（如 `["Hello, world","Hi, there"]`）判定不受影响。

**④ CSV 分隔符探测不区分引号内外 → 整表塌成 1 列**
- **现象**：`"Last, First";age` 这类首行含「引号内逗号」的分号 CSV 被判为逗号分隔，全表只剩 1 列且表头被当作数据吞掉。
- **根因**：`detectDelimiter` 只对首行做朴素 `split` 计数，不区分引号内外，且平局时逗号先胜。
- **修复**：重写为**引号感知**的逐字符计数（`""` 视为转义）+ **多行投票**（优先选择使各行列数一致的分隔符）。

**⑤ 安全：完成提示未转义文档标题、预览链接无协议白名单**
- **修复**：导入完成提示中的文档标题与异常消息统一 `escapeHtml`（思源的 `showMessage` 会按 HTML 解析，未转义时文档标题构成注入面）；新增 `safeHref()`，仅放行 `http` / `https` / `ftp`、协议相对的 `//` 以及裸域名（自动补 `https://`），其余（`javascript:` / `data:` / `vbscript:` 等）降级为纯文本渲染。

**⑥ 性能：`listExistingAVs` 为显示名称而整表读取 AV**
- **现象**：缺少可见标题的 AV 会调用 `readAV` 整表读取（包含对全部行×列计算 rowHashes），列出 M 个库时约 O(M×N×C) —— 大文档下打开导入向导明显卡顿。
- **修复**：新增轻量 `readAVMeta()`（只读 `name`，不解析主列、不算 rowHashes）；`readAV` 增加 `needRowHashes` 选项（默认 `true`，保持向后兼容）。

**⑦ 健壮性与工程细节**
- `api()` / `putFile()` 的 `JSON.parse` 增加容错：响应非 JSON 时抛出带请求路径与响应片段（截断 200 字符）的明确错误，不再抛裸 `SyntaxError`。
- `generateBlockId()` 补 7 位随机后缀（`YYYYMMDDHHmmss-xxxxxxx`），消除同一秒内重复调用产生相同块 ID 的可能。
- 补齐 `i18n/zh_CN.json` 与 `i18n/en_US.json` 中缺失的 `defaultDBName` 键（此前英文环境默认数据库名仍为中文）。

## [1.3.2] - 2026-07-29

### Fix: 类型推断、去重归一与思源 API 错误语义的 8 处缺陷

本轮修复来自一次全量代码审查 + 独立 QA 回归（44 条用例，覆盖类型推断 / 归一对称 / 思源 API 错误语义 / 大库性能 / Markdown 转义 / 预览等价性）。其中 ③④ 两处会造成**已有数据重复导入**，② 为 ① 的连带缺陷（只修 ① 不够）。

**① 小数、点分数字被误判为 URL**
- **现象**：`1.5`、`100.00`、`2024.1.1` 这类值被推断为 `url`，数值列整体错成 URL 列。
- **根因**：`looksLikeWebUrl` 的域名末段（TLD）正则允许纯数字；而 `detectScalar` 中 `url` 判定排在 `number` / `date` 之前。
- **修复**：域名末段必须以字母或汉字开头（`[a-z一-龥][a-z0-9一-龥-]*`）。`www.` 与协议相对 `//` 分支不变。

**② 小数（含负号 / 前导点）被误判为日期——① 的连带缺陷**
- **现象**：`1.5`、`-0.5`、`-1.5`、`.5` 被判为 `date`。
- **根因**：只修 ① 不够。`isDate` 原守卫仅排除纯整数，而 `parseFlexibleDateToMs` 会把 `.` 归一成 `-`，于是 `Date.parse('1-5')`、`Date.parse('-0-5')` 在 V8 中均为合法日期。
- **修复**：`isDate` 增加「数字字面量」守卫（允许可选正负号与前导点），仅放行形如 4 位年份开头的 `YYYY.M.D` / `YYYY-M-D`。边界：`1.2.3` 归为 `text`。

**③ number 类型三处归一不对称 → 二次导入重复插入**
- **现象**：同一份表格导入两次，第二次整行被判为「新增」，产生重复行。
- **根因**：源侧 `canonRawCell` 用 `String(raw).trim()`（`"007"`）、写入侧 `buildCell` 用 `Number(v)`（`7`）、目标侧 `canonValueCell` 读回 `"7"`——三处形式不一致，导致 `buildRowKey` 与 `readAV` 的 `rowHashes` 对不上。
- **修复**：新增 `normalizeNumberString()`，源侧与目标侧统一调用，与写入侧 `Number(v)` 同源，三者严格一致。

**④ `/api/file/getFile` 的 202 错误信封被当成文件内容 → 静默把已有库当空库**
- **现象**：导入到已有数据库时读取失败被静默忽略，全量行被重复导入；「目标数据库不存在」提示永不出现。
- **根因**：该接口失败时返回 **HTTP 202 + `{code,msg,data}` 信封**。202 落在 `[200,299]` 区间内使 `resp.ok === true`，错误信封被当作文件原文返回，`JSON.parse` 成功，`json.keyValues || []` 得到空数组。
- **修复**：`getFile` 保守识别错误信封（文本为普通对象且 `code` 为非 0 数字、且含 `msg` 或 `data`）并抛错；`readAV` 增加 schema 校验（`keyValues` 存在但非数组即抛错），不再静默降级为空库。

**⑤ `readAV` 逐行请求块内容 → 大库导入极慢**
- **现象**：主列块内容缺失时按行调 `/api/block/getBlockInfo`，1000 行的库即 1000 次请求。
- **修复**：优先用 `/api/query/sql` 批量取回（每批 ≤ 500 个 id）；SQL 不可用（内核不支持 / 被禁用 / 抛错）时**自动降级**回原逐行逻辑，行为不回退。

**⑥ 预览去重 O(n×m) → 大表预览卡顿**
- **根因**：`renderPreview` 在每行循环体内重建 `Set(existingPrimary)`、`Set(rowHashes)` 与 `targetToSrc`。
- **修复**：三者提到循环外只算一次。渲染结果与重复行判定经测试证明与旧实现**逐字节等价**。

**⑦ Markdown 表格 `\|` 转义未处理 → 整表列错位**
- **现象**：单元格内含 `\|`（GFM 字面竖线）时被当作分隔符，列数虚高、整表错位。
- **修复**：`splitPipe` 改为逐字符扫描，正确处理 `\|`（字面竖线）与 `\\`（字面反斜杠），保留原有「去首尾 `|`、逐格 trim」语义。

**工程化**
- 引入 vitest + happy-dom 测试基建：`resolve.alias` 将 `^siyuan$` 指向 `test/stubs/siyuan.js`（npm 上的 `siyuan` 包仅含类型声明、无运行时入口）；新增 44 条回归用例覆盖上述全部修复，`npm run test` 全绿。
- 纳入 `package-lock.json`。
- 统一补齐 `src/`、`test/` 下 JS 源文件的 UTF-8 BOM。其中 `columnMap.js`、`existingDbWriter.js`、`newDbWriter.js`、`index.js` 仅为编码变化，**无逻辑改动**。
- 版本提升至 1.3.2，重新构建并打包 `package.zip` / `siyuan-table-to-database.zip`。

## [1.3.1] - 2026-07-29

### Fix: mSelect 非 CSV 路径不再按空格分词（坑 8）

- **现象**：Markdown 表格 / 表格转数据库转换 导入时，含空格的 mSelect 值被错误拆分（如 `硅谷 AI 实验室` → `硅谷`+`AI`+`实验室`）；而 CSV 导入本就需要按空格切（单元格内多值只能用空格分隔）。
- **根因**：`tokenizeMselect` 无条件先按空白切、再按 `MSELECT_SEP_RE` 切，未区分导入来源。
- **修复（8 个源文件全量透传 `isCSV`）**：`tokenizeMselect(text, isCSV=false)` 新增 `isCSV` 参数——`isCSV=true`（CSV 导入）保留「先按空白拆、再标点拆」；`isCSV=false`（Markdown 导入 / 转换，默认）仅按 `MSELECT_SEP_RE` 切、**不按空格切**。同一 `isCSV` 透传到 `canonRawCell`/`canonValueCell`/`buildCell`/`buildMSelectOptions`/`buildRowKey` 及导入入口（`ImportWizard.js`、`parsers.js`），确保「写库」与「去重 canon」用同一规则、同一 `isCSV`，消除切分不对称导致的去重漏匹配或写入不一致。
- **兼容性**：CSV 导入行为完全不变；仅非 CSV 的 Markdown / 转换路径改为「整段（含空格）视为单个标签」。
- 同步更新 `DESIGN.md`（坑 8 标记已修复、各函数签名补充 `isCSV`、当前版本升 1.3.1）。

## [1.3.0] - 2026-07-28

### Chore: 更新 preview.png 预览图并升版至 1.3.0

- 替换 `preview.png` 预览图（用户更新，体积 201,184 字节，满足集市 ≤ 200KiB 上限）；
- `plugin.json` / `package.json` 的 `version` 从 1.2.11 提升至 1.3.0；
- 重新构建并打包 `package.zip` / `siyuan-table-to-database.zip`（8 个标准条目，不含 `package.json`）；
- 无代码逻辑变更，issue #1 的修复内容保持不变。

## [1.2.11] - 2026-07-28

### Chore: 更新 preview.png 预览图并升版

- 替换 `preview.png` 预览图（用户更新）；
- `plugin.json` / `package.json` 的 `version` 从 1.2.10 提升至 1.2.11；
- 重新构建并打包 `package.zip` / `siyuan-table-to-database.zip`（8 个标准条目，不含 `package.json`）；
- 无代码逻辑变更，issue #1 的修复内容保持不变。

## [1.2.10] - 2026-07-28

### Fix: 集市 Release 资源被覆盖导致索引更新失败 (bazaar issue #1968)

- **背景**：v1.2.9 发布后，将新的 `package.zip` 上传/替换到了同一个 v1.2.9 Release 资源中（asset id 发生
  变化），但 Release tag 仍指向同一 commit。SiYuan 集市（bazaar）自动检查不通过，要求每次更新必须对应
  新的 Release tag 与新的 manifest version，不能覆盖旧 Release 的资源。
- **处理（无代码变更）**：
  1. 将 `plugin.json` 与 `package.json` 的 `version` 从 1.2.9 提升至 1.2.10；
  2. 重新打包 `package.zip` / `siyuan-table-to-database.zip`，内含 v1.2.10 清单；
  3. 后续需在 GitHub 新建 tag `v1.2.10` 的 Release，并将新包上传至该 Release，标记为 Latest。
  旧 v1.2.9 Release 不再改动。v1.2.9 中 issue #1 的修复内容保持不变。

## [1.2.9] - 2026-07-28

### Fix: 插件禁用后仍运行 / 工作台仍在输出 (issue #1)

- **根因**：插件类 `TableToDatabase` 原本**没有 `onunload()`**，且在 `registerProtyleFocusTracking()`
  中向全局 `document` 注册了两个**匿名**监听器（`focusin`、`selectionchange`）且从未移除。SiYuan
  禁用插件时调用 `onunload()`（当时不存在），于是这两个全局监听原封不动地留在 `document` 上——
  用户之后任何一次聚焦/编辑文档都会继续触发，表现为「禁用后还在运行」；而 `setLastFocusedProtyle`
  内的 `console.log("[table-to-database] 缓存最后聚焦 protyle…")` 每次 focusin 都会继续打印，即
  「工作台还在输出」。
- **修复（仅改 `src/index.js`，不碰业务逻辑/锚点算法/`common.js` 日志）**：
  1. 两个监听器改为存到实例的具名 handler：`this._onFocusIn` 与 `this._onSelectionChange`，
     注册时传入这两个引用（不再匿名，使后续可精准移除）；
  2. 新增 `onunload()`，在其中 `removeEventListener("focusin", this._onFocusIn)` 与
     `removeEventListener("selectionchange", this._onSelectionChange)`，并置 `null`。
- **可移除性已证明**：add 与 remove 传入的是同一 `this._onFocusIn` / `this._onSelectionChange`
  实例属性（同一对象引用），`removeEventListener` 必然生效。全仓复扫确认无 `setInterval` /
  `window.addEventListener` / 持久 `MutationObserver` / 其它未清理的全局资源（ImportWizard 内的
  局部一次性 `setTimeout` 属正常流程、无需清理）。
- **验收闭环**：无头环境无法跑真实 SiYuan，建议在 SiYuan 桌面端实测——启用后禁用，再聚焦任意文档，
  观察 DevTools 控制台是否仍打印「缓存最后聚焦 protyle」日志；若无该日志，即证明修复生效。

## [1.2.8] - 2026-07-24

### Fix: mSelect/select 整行去重大小写敏感导致二次导入误判新增 (bugfix)

- **真实根因（经 v1.2.7-diag 诊断包的用户运行日志 100% 定位）**：整行去重用的 canon 对大小写
  **敏感**，但 SiYuan 在存储 mSelect / select 选项内容时会把内容**转成小写**。因此：
  - 源侧（来自 Markdown 原文）备注列 mSelect 含大写 token `Agent` → 源 canon = `Agent`；
  - 目标侧（从 AV JSON 读回）该 token 被存成小写 `agent` → 目标 canon = `agent`；
  - 两端不一致 → 整行 key 不匹配 → 该行被误判为「新增」。
  备注原文 `硅谷 AI 实验室；Hermes 系列开源大模型 + Hermes Agent 开源自主智能体` 中，
  `Agent` 是 90 行里**唯一**含大写字母的 mSelect token，故恰好只有 "Nous Research" 一行中招；
  该 bug 只在 mSelect（及 select）出现，因为 SiYuan 只把选项内容转小写，文本列不受影响。
- **更正 v1.2.6 的错误假设**：v1.2.6 误判根因为「内核静默丢弃纯符号 token `+`」。诊断日志证明
  `+` 被完整保留（目标库 tgtItems 中存在 `{"content":"+"}`），纯符号 token 两侧同步丢弃是正确的，
  与本次大小写问题无关。
- **修复**：统一归一化输出转小写，使源 `Agent` 与目标 `agent` 归一到同一字符串，整行 key 一致：
  1. `normalizeMulti(parts)`：`out.push(s)`（保留原始大小写）→ `out.push(k)`（`k` 已是
     `s.toLowerCase()` 的 dedup key），mSelect / select 归一化输出统一小写；
  2. `canonRawCell` 的 `select` 分支：`String(raw).trim()` → `String(raw).trim().toLowerCase()`，
     与目标侧走 `normalizeMulti` 保持对称。
  源侧（`canonRawCell`）与目标侧（`canonValueCell`）对 mSelect / select 现在都归一到小写，
  无论 SiYuan 存储时是否把内容转小写，源 key 与目标 key 始终一致。
- **清理**：移除 v1.2.7-diag 全部 `[diag]` 诊断日志与 `[DIAG-1.2.7]` 注释（含 `computeIncremental`
  的 Nous Research 行明细块、汇总日志、`buildCell` 选项补 id 日志、写后读回 `debugReadBackMSelect`
  验证）；并移除此前为「内核缺选项 id 触发渲染崩溃」这一**未经证实**假设所加的 `stableHash`
  选项补 id 逻辑（`buildCell` / `buildAVJson` 恢复 1.2.3 原样，选项是否带 id 交由 SiYuan 内核决定）；
  同时删除 `readAV` 中已无消费者的 `rawKV` 透传字段。最终出干净正式版 v1.2.8。

## [1.2.7] - DIAG

### 诊断版（无算法大改，收集证据为主）

> 本版本是**无条件诊断版**，目的不是修复，而是收集「备注列=mSelect 时，二次导入同一份数据只有
> Nous Research 一行被误判为新增」的真实运行数据。所有诊断日志统一前缀 `[diag]`，可直接在
> SiYuan 的 `127.0.0.1-*.log` 里 `grep [diag]` 抓取。

- **新增诊断日志（前缀 `[diag]`）**：
  - `src/import/columnMap.js` 的 `computeIncremental`：打印本次比对总行数/新增/重复汇总；对主列含
    "Nous Research" 的行打印：主列值、源整行 key（`buildRowKey`）、目标整行 key（从 `readAV.rowHashes`
    反查对应行）、**仅 mSelect 列**的源原始值/`canonRawCell(raw,"mSelect")`、目标单元格完整原始 JSON
    （`kv.values[k]` 整个对象）、目标 `canonValueCell(cell,"mSelect",options)`，并明确打印
    `sourceKeyEqualsTargetKey` 布尔值。
  - `src/common.js` 的 `writeNewDatabase`（新库）与 `src/import/existingDbWriter.js` 的
    `appendToExisting`（旧库追加）：**写入成功后**按主列值定位 Nous Research 行，调用
    `debugReadBackMSelect` 读回该行 mSelect 单元格的**完整原始 JSON**（选项数组，含 id/content/color），
    确认内核是否丢弃/变形了某些选项（尤其 `+`）。
  - `src/common.js` 的 `buildCell` mSelect 分支 return 前：打印最终写入的 `arr`（选项数组），确认实际
    写入内容；同时打印「补 id 前/后」的选项结构。
  - `src/import/ImportWizard.js` 的 `parseAndSet` / `onImport` 关键时间点（解析完成、开始比对/写入前、
    写入返回后）打印时间戳，用于对照内核 `innerHTML` 崩溃发生的时机，判断崩溃是否打断了比对。
  - `src/import/targetDb.js` 的 `readAV` 额外透传 `rawKV`（原始 keyValues），供上述比对取目标单元格原始 JSON。
- **一个低风险尝试性修复（可选）**：`buildCell` 的 mSelect（及 select）单元格选项补上 `id` 字段——
  若 `field.options` 中存在 name 匹配项且带 id（新库由 `buildAVJson` 生成、旧库来自 SiYuan），则用之；
  否则生成确定性 id `m-${hash(name)}`（`buildAVJson` 选项面板同步补同款 id，便于内核按 id 关联）。
  **理由**：SiYuan 渲染 mSelect 单元格通常需要选项 id 关联 `keyValues.options`，缺 id 可能触发内核渲染
  崩溃（`innerHTML` 报错）乃至数据损坏。若诊断日志显示选项本就无 id 且存储异常，此修复可能直接根治。
  诊断日志会同时打印「补 id 前/后」结构便于确认。
- **版本**：plugin.json / package.json 升至 `1.2.7`（SiYuan 不接受带后缀版本号，故用简单递增号，
  在日志中以 `[DIAG-1.2.7]` 标识）。
- **注意**：本版仅加日志与一个低风险补 id 尝试，**未改动去重算法对称性**（v1.2.6 的
  `isMeaningfulToken` 纯符号 token 两侧同步丢弃仍在）。证据收集完成后，再据真实日志决定是否回归/根治。

## [1.2.6] - 2026-07-27

### Fix: mSelect 整行去重「仅含分隔符的备注行」二次导入误判新增 (bugfix)

- **真实根因（与 v1.2.5 不同）**：v1.2.5 的修复方向有误。经逐行核实 `canonRawCell` /
  `canonValueCell` / `buildCell` 并做往返测试，纯代码的「源 key == 目标 key」在「SiYuan 原样
  存储多个 mSelect 选项」时是**对称**的（verbatim 存储下源/目标完全一致）。真正的不对称发生在
  **写入期 SiYuan 内核的选项丢弃**：当 mSelect 单元格被拆出的某个标签是**纯符号 token**（如本例
  备注 `硅谷 AI 实验室；Hermes 系列开源大模型 + Hermes Agent 开源自主智能体` 中的独立 `+`），
  SiYuan 内核在创建选项时**静默丢弃**这个纯符号选项（不报错，因此首次导入仍"成功"）。
  于是目标库该行备注列只剩 7 个 token，而源侧 `canonRawCell` 拆出 8 个（含 `+`）→ 整行 key 不一致 →
  二次导入被误判为"新增"。其它 89 行的备注为空或单个不含分隔符的词，源/目标都只有 0~1 个 token，
  对得上 → 正确判重复；备注改 text 列也正常（text 不走 mSelect 分词）。这恰好印证"分隔符触发拆分 →
  出现纯符号 token → 被内核丢弃 → 不对称 → 误判"。
- **修复**：新增 `isMeaningfulToken(t)`（含字母/数字/中日韩汉字才视为有意义），并在
  `canonRawCell`(mSelect 源侧) 与 `canonValueCell`(mSelect 目标侧) 的归一化中**同步丢弃**
  纯符号 token。这样无论 SiYuan 内核是否丢弃该选项，"源 row key"与"目标 row key"在备注列始终一致。
- **写路径同步对齐**：`buildCell`(mSelect) 改用与源侧相同的 `tokenizeMselect` 分词，保证"写库拆出的
  标签集合"与"去重源 key 的标签集合"来自同一套规则（写/读对 mSelect「是否拆分、按什么规则拆分」达成一致）。
  写入时仍保留所有 token（含 `+`），由内核自行决定是否丢弃；去重两侧同步丢弃纯符号 token，不影响 UX。
- **往返验证（Node 单测，精确字符串）**：
  - 源侧 `canonRawCell` → `硅谷,开源自主智能体,实验室,系列开源大模型,Agent,AI,Hermes`（7 token，已丢 `+`）。
  - 内核**保留** `+`：目标侧读回 `canonValueCell` → 同 7 token → **PASS**。
  - 内核**丢弃** `+`：目标侧读回 `canonValueCell` → 同 7 token → **PASS**。
  - `buildCell` 写 → 原样读回 → 同 7 token → **PASS**。
  - id 引用 + keyOptions / id 引用(含 content) 无 keyOptions → 均 **PASS**。
- **回归保护**：未改动主键 block content 缺失修复（readAV / getBlockInfo）；select/date/checkbox/
  url/text/number 各列归一化不受影响；mSelect/select 在转换预览与导入预览中的 chip 渲染逻辑不变。
- **关于 v1.2.5**：其 `extractMselectItemContent` 多形态兼容与 `tokenizeMselect` 复用仍保留（对
  "仅存 id 引用 / 嵌套 content / text / value / 数组" 等目标库形态有益），本版在其基础上补上
  "纯符号 token 两侧同步丢弃"这一真正缺失的对称性，而非推翻。

## [1.2.5] - 2026-07-27

### Fix: 整行去重「备注=多选(mSelect)」误判全部新增 (bugfix)

- **Root cause**: `canonValueCell` 的 `mSelect`/`select` 分支只读 `m.content` 字符串。SiYuan AV JSON 中多选选项节点在不同内核版本/写入路径下形态并不统一——可能是仅含 `id` 的引用（需反查该列 `keyOptions`）、嵌套对象 `{content:{content}}`、`text`/`value` 字段，或 `content` 为数组。当目标库只回写 `id`（content 缺失）时，旧代码把该列 token 集合读成空串，导致「源 row key」与「目标 row key」中备注列哈希不一致，第二次导入整行去重把所有行误判为「新增」。（文本列因 `text.content` 始终有值而正常，与此现象吻合。）
- **Fix**: 新增 `extractMselectItemContent(m, opts)` 统一抽取选项文本，兼容 `content` 字符串 / 嵌套对象 / `text` 字段 / `value` 字段 / `content` 数组 / 仅 `id` 引用（结合该列 `keyOptions` 反查 `name`）/ 节点本身为字符串或数字等所有形态；`canonValueCell` 的 `select` 与 `mSelect` 分支改用该 helper，且 `mSelect` 仍对每个标签 `tokenizeMselect` 归一，与源侧 `canonRawCell` 完全对称。
- **readAV**: `cellText` / rowHashes 计算时把该列 `keyOptions` 一并传入 `canonValueCell`，使 id 引用能反查回真实文本。
- **Not broken**: 未改动主键 block content 缺失修复；mSelect 在转换预览 / 导入预览中的 chip 渲染逻辑不变；源侧 `canonRawCell` 与 `buildRowKey` 逻辑不变，行 key 列顺序/类型约束保持一致。
- **Verified**: 用真实 `common.js` 逻辑构造 Node 单测，覆盖「标准字符串 / 嵌套对象 / text 字段 / 仅 id 引用(反查)」四种目标库形态，源/目标 mSelect key 完全一致；并做 `buildCell` 写→`canonValueCell` 读 round-trip 验证。

## [1.2.4] - 2026-07-27

### Preview header chip fix (bugfix)
- **Conversion preview & Import preview**: the primary column (主键/主列) header now renders as a `.b3-chip.b3-chip--primary` tag, making the key column clearly identifiable in the preview table header.
- **Reverted over-chip-ification**: text / number (and other plain) cells no longer wrap in a `.b3-chip`. They display as plain text again. Only `mSelect`, `select`, `block`, `date`, `checkbox`, and `url` types keep their chip / special rendering.

## [1.2.3] - 2026-07-27

### Import to existing database
- Target database dropdown now shows **database names** instead of raw IDs.
- Fixed `目标数据库不存在：API /api/file/getFile 失败` error when selecting a target — read AV JSON with a dedicated `getFile()` helper instead of the generic `api()` wrapper.
- **Primary-column dedupe** now correctly recognizes existing rows (e.g. "Nous Research") — when a block cell's `content` is missing from the AV JSON, batch-fetch it via `/api/block/getBlockInfo`.
- **Row dedupe** key now uses **unified two-layer normalization** across source and target: split by punctuation, then by whitespace, deduplicate, sort, and join. Handles multi-word labels (e.g. "硅谷 AI 实验室") and space-separated multi-tags (e.g. "Agent/自动化 办公自动化 文本对话") consistently.
- Import now actually **writes new rows** — `buildCell` was missing a `block` branch, causing the append API to reject the entire batch.

### Import position fixes
- Import no longer inserts into the wrong document (e.g. "未命名") when multiple documents are open. Replaced click-time focus/selection reading with a **`focusin`-based last-focused protyle cache**.
- `listExistingAVs()` also uses the cached protyle so the "existing database" list matches the current document.

### Import preview UI
- Added a **download arrow icon** to the "导入数据" menu item.
- Default preview rows increased from **8 → 10**.
- Added **"显示更多"** (+10 rows) and **"全部显示"** (show all) buttons below the preview table.

### Conversion preview improvements
- Added a **database name input** at the top of the conversion panel (default: document title).
- Added **"显示更多" / "全部显示"** buttons below the conversion preview table.
- Removed the redundant standalone "主键 | 主列（标题）" row.
- Preview layout aligned with the import wizard (title, row count format, button positioning).
- mSelect columns now render as **chip tags** (`.b3-chip`), matching the import preview visual style.
- URL columns render as **clickable links**.

- **Row dedupe — mSelect canonicalization unification (user feedback):** when running the same CSV import twice, mSelect cells (e.g. `备注` column with values like `硅谷 AI 实验室；Hermes 系列开源大模型 + Hermes Agent 开源自主智能体`) failed row-dedupe on the second pass — the source canonicalization used a different two-layer split order than the target, leading to subtle token-set asymmetries. Both `canonRawCell` (source) and `canonValueCell` (target) now share a single `tokenizeMselect()` helper that splits whitespace first, then punctuation per token, and flattens. Result: source and target always normalize to the same token set, even if SiYuan stores items with internal whitespace or different boundaries.

- **Conversion preview — live re-render on type change (user feedback):** changing a column's type in the conversion preview's "列类型映射" dropdown now immediately re-renders the data preview table (matching the import wizard's live-re-render behavior). Previously only "设为主列" re-rendered; type changes were picked up only on confirm.

- **Preview chip coverage (user feedback):**
  - **Conversion preview**: `select` (single-select) cells render as `.b3-chip` tags; `block` (primary key) and `date` cells render as `.b3-chip--primary`; `checkbox` cells get their own visual treatment; **all remaining types (text/number/etc.) now also render as `.b3-chip`** so every non-empty cell is wrapped in a chip for visual consistency. Empty cells render a gray `—` placeholder.
  - **Import preview**: same chip treatment — every non-empty cell is wrapped in a `.b3-chip` (or `.b3-chip--primary` for block/date), so all preview cells match the conversion preview's chip-everywhere visual style.

## [1.2.2] - 2026-07-26

- **Import result guidance:** after import, the new block is now automatically scrolled into view with a transient highlight, and a message shows the **document name** and insert position. Cross-document cases include a clickable `siyuan://block/<id>` link.
- **Primary column selection** in the conversion panel: each non-primary row has a "设为主列" button; switching re-renders the panel. Conversion uses the user-selected primary index.
- **Import position anchor fix** (enterprise): replaced click-time focus reading with a `focusin`-based last-focused protyle cache. Import now reliably inserts into the correct document even in multi-pane layouts.

## [1.2.1] - 2026-07-26

- Top-bar dropdown menu now opens anchored to the button.
- Removed block-icon direct conversion; entry is via top-bar button and hotkey only.
- Removed "convert all tables in document" batch feature.
- "Convert current table" now disabled when no table is focused/selected, and shows a **preview dialog** before converting.

## [1.2.0] - 2026-07-26

- **New:** Import data from **CSV files** or pasted **Markdown tables** into new or existing Attribute View databases.
- Two modes: create new database (column mapping + preview) / import into existing (auto matching + deduplication).
- Deduplication: by primary column, by entire row, or none.
- Markdown parsing supports GFM and **Tab-separated** syntax (paste from spreadsheets).
- Insert position: cursor or document end.

## [1.1.9] - 2026-07-24

- Fix: conversion no longer needs manual F5 — `reloadProtyle` was called with wrong parameter key.

## [1.1.8]

- Fix: pure-text columns fall through to `select` type inference.
- Added `maxLen` guard for select detection.
- Moved `reloadProtyle` to after the original table deletion.

## [1.1.7]

- Replaced manual backup block with SiYuan's official File History API snapshot.
- Auto-refresh after conversion.

## [1.1.6]

- Fix: database block appeared empty until manual F5 — added explicit `reloadAttributeView`.

## [1.1.5]

- Fix: rows hidden by default view filter — bumped AV `spec` to 5, removed stale `group` object.

## [1.1.4]

- Restored safer insert-then-write order.

## [1.1.3]

- Fix: `insertBlock` invalid ID — use kernel-assigned real block ID.

## [1.1.2]

- Fix: database had columns but no rows — reordered write sequence.

## [1.1.1]

- Fix: `key not found` when writing rows — pass real `keyID` from AV JSON.

## [1.1.0]

- Rewrote row writing with `/api/av/appendAttributeViewDetachedBlocksWithValues` (2-D array, keyID-matched — no misalignment).
- Cell values strictly aligned to kernel `Value` structure.
- AV JSON aligned to `kernel/av` (`spec`, `keyValues`, `keyIDs`, layout columns).
- Pre-conversion field-type selection panel.
- Smart column-type inference (text / number / checkbox / select / mSelect / url / email / phone / date).
