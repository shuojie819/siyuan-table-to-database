/* ============================================================
 * common.js — 公共核心（从 index.js 抽取的可复用纯函数 + 模块级 I18N）
 *
 * 目的：
 *   1. 收敛「表格转数据库」与「导入数据」两条流程共用的内核 API 封装、
 *      ID 生成、类型推断、选项构造、单元格值构造、AV JSON 构造、写库序列。
 *   2. 提供模块级 I18N + setI18N()，供所有 import/* 子模块共享，打破
 *      「import 模块 ↔ index 入口」的循环依赖。
 *   3. 暴露公共写库序列 writeNewDatabase()（新建库）与 appendRows()（写行），
 *      由 convertTable / newDbWriter / existingDbWriter 共同调用，保证写库行为一致。
 *
 * 注意：本文件不依赖 index.js，也不依赖任何 import/* 子模块（消除循环依赖）。
 * ============================================================ */

// 由 setI18N 注入的 i18n 字符串，供模块级函数使用（import 子模块统一从这里取）
let I18N = {};

export function setI18N(obj) {
  I18N = obj || {};
}

export { I18N };

// 支持的字段类型（顺序即面板下拉顺序）；block（主列）不在普通下拉里
export const FIELD_TYPES = ["text", "number", "checkbox", "select", "mSelect", "url", "email", "phone", "date"];

// 多选单元格常用分隔符（注意：不含 "/"，避免把 URL 拆坏）
export const MSELECT_SEP_RE = /[,，;；|、]/;
// 实际切分单元格时使用的分隔符：在 MSELECT_SEP_RE 基础上加入「空白（空格/制表/换行）」，
// 以支持「同一单元格内用空格分隔多个标签」的需求（Bug #2）。
// 用 \s+ 折叠连续空白并自动忽略首尾空白；仍不含 "/"，避免把路径/URL 拆坏。
export const MSELECT_SPLIT_RE = /[,，;；|、\s]+/;

// ---------- 基础工具 ----------

// 思源块 ID：14 位时间戳（YYYYMMddHHmmss）
export function generateBlockId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return [
    now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
    pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds()),
  ].join("");
}

// AV/Key/View/Table ID：timestamp-7random，符合思源 AV ID 约定
export function generateId() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  const ts = [
    now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
    pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds()),
  ].join("");
  const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
  let rand = "";
  for (let i = 0; i < 7; i++) rand += CHARS[Math.floor(Math.random() * CHARS.length)];
  return `${ts}-${rand}`;
}

export function getTimestamp() {
  return generateBlockId();
}

export function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function typeLabel(t) {
  const key = `type${t.charAt(0).toUpperCase()}${t.slice(1)}`;
  return (I18N[key] || t);
}

// ---------- SiYuan API 封装 ----------

export async function api(path, data) {
  const resp = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data || {}),
  });
  if (!resp.ok) throw new Error(`API ${path} 请求失败 [${resp.status}]: ${resp.statusText}`);
  const text = await resp.text();
  if (!text) return null;
  const json = JSON.parse(text);
  if (json.code !== 0) throw new Error(`API ${path} 失败 [${json.code}]: ${json.msg}`);
  return json.data;
}

export async function putFile(path, content) {
  const form = new FormData();
  form.append("path", path);
  form.append("isDir", "false");
  form.append("modTime", String(Math.floor(Date.now() / 1000)));
  form.append("file", new Blob([content], { type: "application/json" }), "file");
  const resp = await fetch("/api/file/putFile", { method: "POST", body: form });
  if (!resp.ok) throw new Error(`putFile 请求失败 [${resp.status}]: ${resp.statusText}`);
  const text = await resp.text();
  if (!text) return null;
  const json = JSON.parse(text);
  if (json.code !== 0) throw new Error(`putFile 失败 [${json.code}]: ${json.msg}`);
  return json.data;
}

export async function removeFile(path) {
  return api("/api/file/removeFile", { path });
}

// 读取工作区内文件原始内容（如 /data/storage/av/{avID}.json）。
//
// ⚠️ 与通用 api() 不同：/api/file/getFile 直接返回「文件字节」，并不是 SiYuan
// 标准的 { code, data, msg } 信封。若用 api() 解析，会因 json.code 为 undefined
// 被误判为失败（"API /api/file/getFile 失败 [undefined]: undefined"），进而被
// targetDb.readAV 包装成「目标数据库不存在」。
//
// 故此处单独 fetch 并直接返回原始文本（调用方自行 JSON.parse / 解码）。
// 请求体与旧 api() 调用保持一致：POST JSON { path }。
export async function getFile(path) {
  const resp = await fetch("/api/file/getFile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!resp.ok) throw new Error(`getFile 请求失败 [${resp.status}]: ${resp.statusText}`);
  return await resp.text();
}

export async function insertBlockAfter(previousID, dom) {
  // insertBlock 返回 data[0].doOperations[0].id 才是真正生成/确认的块 ID，
  // 不一定等于 DOM 里指定的 data-node-id，调用方必须用这个真实 ID。
  const resp = await api("/api/block/insertBlock", { dataType: "dom", data: dom, previousID });
  let actualId = null;
  if (Array.isArray(resp) && resp[0] && Array.isArray(resp[0].doOperations) && resp[0].doOperations[0]) {
    actualId = resp[0].doOperations[0].id;
  }
  if (!actualId) {
    console.warn("[table-to-database] insertBlock 未返回真实块 ID，回退使用 DOM 中指定的 ID");
  }
  return actualId;
}

export async function removeBlock(id) {
  return api("/api/block/deleteBlock", { id });
}

// 基于表格所在文档生成历史快照（对应用户截图里的「文件历史」）。
// 用思源官方文档历史功能替代旧版手动插入的备份块。
export async function createDocHistory(blockId) {
  return api("/api/history/createDocHistory", { id: blockId });
}

// 获取块所在文档信息（返回 data.rootID，用于刷新整个编辑器）
export async function getBlockInfo(blockId) {
  return api("/api/block/getBlockInfo", { id: blockId });
}

// 一次性追加所有带值的非绑定行（核心修复点）
export async function appendRows(avID, blocksValues) {
  return api("/api/av/appendAttributeViewDetachedBlocksWithValues", { avID, blocksValues });
}

// ---------- 整行去重：统一、稳定的 key 生成 ----------
//
// 「按整行去重」需要源行与目标行生成「视觉相同 → key 相同」的稳定 key。
// 旧实现：源侧用 String(c).trim() 朴素串接（不区分类型、不归一），目标侧用 cellText
// 按 SiYuan Value 结构抽取——两者序列化规则不一致，导致 mSelect 顺序、checkbox、
// date、列顺序等差异使本应相同的行得到不同 key（Bug：整行去重只命中 13/90）。
//
// 以下以 common 为单一来源，源侧（原始字符串）与目标侧（SiYuan Value）共用同一套
// 归一规则：mSelect 排序+trim、checkbox 归一、date 归一为本地零点毫秒、文本/链接/数字 trim。

// 将毫秒时间戳归一到「本地零点」毫秒，抹平时区/毫秒精度差异，保证同一日历日得到相同 key。
export function formatDateCanonical(ms) {
  const n = Number(ms);
  if (!n || isNaN(n)) return "";
  const d = new Date(n);
  if (isNaN(d.getTime())) return "";
  // 用本地年月日组件归零，避免 SiYuan 存储用 UTC 零点或本地零点导致的偏移
  const localMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return String(localMidnight);
}

// 多选/单选内容：trim + 去重（大小写不敏感）+ 排序，返回稳定拼接串
function normalizeMulti(parts) {
  const seen = new Set();
  const out = [];
  parts.forEach((p) => {
    const s = (p == null ? "" : String(p).trim());
    if (s === "") return;
    const k = s.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  });
  // 稳定排序（含中文），保证 "A,B" 与 "B,A" 得到相同 key
  out.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  return out.join(",");
}

const CHECK_TRUE = new Set(["true", "✓", "✔", "☑", "是", "1", "yes", "y"]);

// 源侧（原始字符串 + 目标列类型）→ 规范文本
export function canonRawCell(raw, type) {
  if (raw == null) return "";
  switch (type) {
    case "mSelect": {
      // 两层切分：先按全体分隔符（不含 \s）拆标签组，再按 \s 二次切字词，
      // 扁平化后去重排序。保证 "A；B C" 与 "A B C" 两种写法能 match。
      const firstSplit = String(raw).split(MSELECT_SEP_RE);
      const flattened = [];
      firstSplit.forEach((frag) => {
        const subParts = frag.split(/\s+/).map((s) => s.trim()).filter(Boolean);
        flattened.push(...subParts);
      });
      return normalizeMulti(flattened);
    }
    case "select":
      return String(raw).trim();
    case "checkbox":
      return CHECK_TRUE.has(String(raw).trim().toLowerCase()) ? "1" : "0";
    case "date": {
      const ms = parseFlexibleDateToMs(raw);
      return formatDateCanonical(ms);
    }
    case "number":
      return String(raw).trim();
    case "block":
    case "text":
    case "url":
    case "email":
    case "phone":
    default:
      return String(raw).trim();
  }
}

// 目标侧（SiYuan Value 结构 + 类型）→ 规范文本（与 canonRawCell 同源规则）
export function canonValueCell(v, type) {
  if (!v) return "";
  switch (type) {
    case "block": {
      if (!v.block) return "";
      // block.content 可能是字符串、嵌套 {content:...} 对象、或数字时间戳
      const bc = v.block.content;
      if (bc == null) return "";
      if (typeof bc === "string") return bc.trim();
      if (typeof bc === "object" && bc.content != null) return String(bc.content).trim();
      // 兜底：数字或其他类型
      return String(bc).trim();
    }
    case "text":
      return (v.text && v.text.content != null) ? String(v.text.content).trim() : "";
    case "number":
      return (v.number && v.number.content != null) ? String(v.number.content).trim() : "";
    case "url":
      return (v.url && v.url.content != null) ? String(v.url.content).trim() : "";
    case "email":
      return (v.email && v.email.content != null) ? String(v.email.content).trim() : "";
    case "phone":
      return (v.phone && v.phone.content != null) ? String(v.phone.content).trim() : "";
    case "date": {
      const c = v.date && v.date.content != null ? v.date.content : "";
      let ms = (typeof c === "number") ? c : Number(c);
      if (isNaN(ms) || ms === 0) ms = parseFlexibleDateToMs(String(c));
      return formatDateCanonical(ms);
    }
    case "checkbox":
      return (v.checkbox && v.checkbox.checked) ? "1" : "0";
    case "select":
      return normalizeMulti((v.mSelect || []).map((m) => (m && m.content != null ? m.content : "")));
    case "mSelect": {
      // 与 canonRawCell 对齐：对每个已存标签 content 做两层切分再扁平化，
      // 保证源侧与目标侧得到完全一致的 sort+join 结果。
      const allParts = [];
      (v.mSelect || []).forEach((m) => {
        const content = (m && m.content != null) ? String(m.content).trim() : "";
        if (!content) return;
        const firstSplit = content.split(MSELECT_SEP_RE);
        firstSplit.forEach((frag) => {
          const subParts = frag.split(/\s+/).map((s) => s.trim()).filter(Boolean);
          allParts.push(...subParts);
        });
      });
      return normalizeMulti(allParts);
    }
    default:
      return "";
  }
}

// 由源行生成整行 key：按目标列顺序、用目标列类型规约每个单元格。
// existing: ExistingAV（含 columns，顺序与 av JSON keyValues 一致）；
// targetToSrc: { [keyID]: srcIndex }（列匹配结果）。
// 列顺序与目标库 rowHashes 完全一致，确保「源行 key」与「目标行 key」可直接比较。
export function buildRowKey(row, existing, targetToSrc) {
  const parts = (existing.columns || []).map((col) => {
    const srcIdx = targetToSrc[col.keyID];
    const raw = (srcIdx != null && row[srcIdx] != null) ? row[srcIdx] : null;
    return canonRawCell(raw, col.type);
  });
  return parts.join("\u0001");
}

// ---------- 日期解析 ----------

export function parseFlexibleDateToMs(s) {
  if (s == null) return NaN;
  const t = String(s).trim();
  if (t === "") return NaN;
  // 纯数字时间戳
  if (/^\d{13}$/.test(t)) return Number(t);          // 毫秒
  if (/^\d{10}$/.test(t)) return Number(t) * 1000;    // 秒
  // 规范化常见写法：2024年1月1日 / 2024.1.1 / 2024/1/1
  const norm = t
    .replace(/年/g, "-").replace(/月/g, "-").replace(/日/g, "")
    .replace(/\./g, "-").replace(/\//g, "-");
  let ms = Date.parse(norm);
  if (!isNaN(ms)) return ms;
  ms = Date.parse(t);
  return ms;
}

// ---------- 类型推断（启发式，PRD §6.1，禁止重写） ----------

export function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());
}

// 从超链接 HTML（<a href="...">文本</a>）中提取真实 URL（优先 href 属性）。
// 若字符串本身不是 HTML，则返回 null，调用方回退到原字符串。
function extractAnchorHref(s) {
  if (typeof s !== "string") return null;
  const m =
    s.match(/<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/i) ||
    s.match(/<a\s+[^>]*href\s*=\s*([^\s>"']+)/i);
  return m ? m[1].trim() : null;
}

// 判断字符串是否「像 Web URL」：http/https/ftp、www.、协议相对(//)，
// 或纯域名结构（标签.标签+，可选 :端口，可选 /路径?查询#hash，路径允许中文/特殊字符）。
// 注意：siyuan://、mailto:、tel: 等非 Web 协议不算 URL，避免思源内部链接被误判。
function looksLikeWebUrl(s) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    return /^https?:\/\//i.test(s) || /^ftp:\/\//i.test(s);
  }
  if (/^www\./i.test(s)) return true;
  if (/^\/\//.test(s)) return true; // 协议相对 //host/path
  return /^(?:[a-z0-9一-龥-]+\.)+[a-z0-9一-龥-]+(?::\d{1,5})?(?:\/[^\s]*)?$/i.test(s);
}

export function isUrl(v) {
  const s = String(v == null ? "" : v).trim();
  if (s === "") return false;
  if (s.includes("@")) return false; // 含 @ 视为邮箱候选，不判为 URL（email 推断优先级更高）
  // 若传入的是超链接 HTML（思源单元格可能含 <a href="...">），优先提取真实 URL 判断
  const candidate = extractAnchorHref(s) || s;
  return looksLikeWebUrl(candidate);
}

export function isPhone(v) {
  const s = String(v).trim();
  // 排除日期格式：含日期分隔符且可解析为合法日期的字符串应判为「日期」而非「电话」，
  // 否则 2024-01-01 这类值会被 detectScalar 在 date 之前先命中 phone，导致日期列被误判为电话。
  if (isDate(v)) return false;
  if (!/^[+\d\s().-]{7,20}$/.test(s)) return false;
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  if (/[+\s().-]/.test(s)) return true;
  return digits.length >= 11;
}

export function isDate(v) {
  const s = String(v).trim();
  if (s === "" || /^-?\d+$/.test(s)) return false;       // 纯数字交给 number
  if (!/[-/年月.]/.test(s)) return false;
  return !isNaN(parseFlexibleDateToMs(s));
}

export function isNumber(v) {
  const s = String(v).trim();
  return s !== "" && !isNaN(Number(v));
}

export function detectScalar(v) {
  if (isEmail(v)) return "email";
  if (isUrl(v)) return "url";
  if (isPhone(v)) return "phone";
  if (isDate(v)) return "date";
  if (isNumber(v)) return "number";
  return "text";
}

// 是否视为「有效空值」：空串或常见占位符（无/暂无/空/n-a/null/none 等）不计入类型占比，
// 使「3 个 URL + 1 个『无』」这类列仍能被正确推断为 url，而不被占位符拉低比例。
const EMPTY_LIKE = new Set([
  "无", "暂无", "空", "n/a", "na", "null", "none", "未填写", "待定",
]);
function isEffectivelyEmpty(v) {
  const s = v == null ? "" : String(v).trim().toLowerCase();
  return s === "" || EMPTY_LIKE.has(s);
}

// 是否像多选：有显著比例的单元格包含多值分隔符
export function looksLikeMSelect(values) {
  const nonEmpty = values.filter((v) => !isEffectivelyEmpty(v));
  if (nonEmpty.length < 2) return false;
  const multiCount = nonEmpty.filter((v) => MSELECT_SEP_RE.test(String(v))).length;
  return multiCount >= 2 && multiCount / nonEmpty.length >= 0.2;
}

export function inferType(values) {
  const nonEmpty = values.filter((v) => !isEffectivelyEmpty(v));
  if (nonEmpty.length === 0) return "text";

  const checkboxTokens = ["✓", "✔", "☑", "x", "✗", "✘", "☐", "false", "true", "是", "否", "yes", "no", "y", "n", "1", "0"];
  if (nonEmpty.every((v) => checkboxTokens.includes(String(v).toLowerCase().trim()))) return "checkbox";

  // 多选：含逗号/分号/竖线/顿号等分隔符
  if (looksLikeMSelect(nonEmpty)) return "mSelect";

  // 比例阈值推断「单一标量类型」：非空值中某非文本类型占比 ≥ 80% 且至少 2 个即推断为该类型。
  // 允许列中存在少量空值/短横线/「无」等不影响主体判断；各标量类型由 detectScalar 互斥判定
  // （一个值只归一种类型），故至多一个类型能越过阈值，不会出现多类型争用。
  const SCALAR_TYPES = ["url", "number", "date", "email", "phone"];
  const THRESHOLD = 0.8;
  const MIN_COUNT = 2;
  for (const t of SCALAR_TYPES) {
    const cnt = nonEmpty.reduce((n, v) => (detectScalar(v) === t ? n + 1 : n), 0);
    if (cnt >= MIN_COUNT && cnt / nonEmpty.length >= THRESHOLD) return t;
  }

  // 单选：低基数分类（如 公司性质、国内外、星级）——仅当整列都是纯文本
  // （不含 URL/数字/日期/邮箱/电话）才视为分类列，避免把「含一个 URL 的文本列」误判为分类。
  const allText = nonEmpty.every((v) => detectScalar(v) === "text");
  if (allText) {
    const distinct = new Set(nonEmpty.map((v) => String(v).trim().toLowerCase()));
    const maxDistinct = Math.min(20, Math.max(2, Math.floor(nonEmpty.length / 2)));
    if (distinct.size >= 2 && distinct.size <= maxDistinct) {
      // 额外 guard：平均长度与最大长度都不太长，避免把「句子」当成分类
      const avgLen = nonEmpty.reduce((sum, v) => sum + String(v).length, 0) / nonEmpty.length;
      const maxLen = Math.max(...nonEmpty.map((v) => String(v).length));
      if (avgLen <= 30 && maxLen <= 50) return "select";
    }
  }
  return "text";
}

// 生成单选选项（整单元格作为一个选项）
export function buildSelectOptions(colValues) {
  const seen = new Set();
  const opts = [];
  colValues.forEach((raw) => {
    const v = raw == null ? "" : String(raw).trim();
    if (v === "") return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    opts.push({ name: v, color: String((opts.length % 14) + 1), desc: "" });
  });
  return opts;
}

// 生成多选选项（按分隔符拆分后去重）
export function buildMSelectOptions(colValues) {
  const seen = new Set();
  const opts = [];
  colValues.forEach((raw) => {
    const v = raw == null ? "" : String(raw).trim();
    if (v === "") return;
    v.split(MSELECT_SPLIT_RE).map((s) => s.trim()).filter(Boolean).forEach((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      opts.push({ name: part, color: String((opts.length % 14) + 1), desc: "" });
    });
  });
  return opts;
}

// ---------- 单元格值构造（严格对齐 SiYuan Value 结构） ----------

// field: { keyID, type, options? }  rawValue: 原始单元格文本
export function buildCell(field, rawValue) {
  const v = (rawValue == null ? "" : String(rawValue)).trim();
  const base = { keyID: field.keyID, type: field.type };

  switch (field.type) {
    case "text":
      return { ...base, text: { content: v } };

    case "number": {
      const empty = v === "";
      const n = empty ? 0 : Number(v);
      const ok = !empty && !isNaN(n);
      return {
        ...base,
        number: {
          content: isNaN(n) ? 0 : n,
          isNotEmpty: ok,
          format: "",
          formattedContent: ok ? String(n) : "",
        },
      };
    }

    case "checkbox": {
      const s = v.toLowerCase();
      const checked = ["true", "✓", "✔", "☑", "是", "1", "yes", "y"].includes(s);
      return { ...base, checkbox: { checked } };
    }

    case "select":
    case "mSelect": {
      if (v === "") return { ...base, mSelect: [] };
      const opts = field.options || [];
      const findOpt = (name) =>
        opts.find((o) => o.name === name) ||
        opts.find((o) => o.name.toLowerCase() === name.toLowerCase());

      if (field.type === "mSelect") {
        // 按分隔符 + 空格切分为多个独立标签，去重并保持原顺序。
        // 使用 MSELECT_SPLIT_RE（含 \s）——写库时宽松拆分，源 CSV 列里空格分隔
        // 的多标签会被正确切为多个 item 写入 SiYuan 数据库。
        const parts = v.split(MSELECT_SPLIT_RE).map((s) => s.trim()).filter(Boolean);
        const seenP = new Set();
        const arr = [];
        parts.forEach((p) => {
          const key = p.toLowerCase();
          if (seenP.has(key)) return;
          seenP.add(key);
          const o = findOpt(p) || { name: p, color: "1" };
          arr.push({ content: o.name, color: o.color || "1" });
        });
        return { ...base, mSelect: arr };
      }
      // 单选
      const o = findOpt(v);
      return { ...base, mSelect: o ? [{ content: o.name, color: o.color || "1" }] : [] };
    }

    case "url":
      return { ...base, url: { content: v } };
    case "email":
      return { ...base, email: { content: v } };
    case "phone":
      return { ...base, phone: { content: v } };

    case "date": {
      const ms = parseFlexibleDateToMs(v);
      const notEmpty = !isNaN(ms);
      return {
        ...base,
        date: {
          content: notEmpty ? ms : 0,
          isNotEmpty: notEmpty,
          hasEndDate: false,
          isNotTime: true,
          content2: 0,
          isNotEmpty2: false,
          formattedContent: "",
        },
      };
    }

    case "block":
      // 主列（block）单元格：必须产出 block:{content} 结构，而非 text。
      // 旧库追加时逐列调用 buildCell 包含主列，缺失此分支会落到 default 产出
      // { type:"block", text:{content} }（结构错误），导致 append API 拒绝整批写入。
      return { ...base, block: { content: v } };

    default:
      return { ...base, text: { content: v } };
  }
}

// 构造空 Value（用于旧库写入时「未匹配列」落空值）
export function emptyValue(col) {
  const base = { keyID: col.keyID, type: col.type };
  switch (col.type) {
    case "text": return { ...base, text: { content: "" } };
    case "number": return { ...base, number: { content: 0, isNotEmpty: false, format: "", formattedContent: "" } };
    case "checkbox": return { ...base, checkbox: { checked: false } };
    case "select":
    case "mSelect": return { ...base, mSelect: [] };
    case "url": return { ...base, url: { content: "" } };
    case "email": return { ...base, email: { content: "" } };
    case "phone": return { ...base, phone: { content: "" } };
    case "date": return { ...base, date: { content: 0, isNotEmpty: false, hasEndDate: false, isNotTime: true, content2: 0, isNotEmpty2: false, formattedContent: "" } };
    case "block": return { ...base, block: { content: "" } };
    default: return { ...base, text: { content: "" } };
  }
}

// ---------- 构造 AV JSON（spec 5，对齐 kernel/av 结构） ----------

export function buildAVJson(avID, name, fields, primaryFieldName = "Name") {
  const blockKeyID = generateId();
  const viewID = generateId();
  const tableID = generateId();

  const makeKey = (id, keyName, type, options) => {
    const k = { id, name: keyName, type, icon: "", desc: "", template: "" };
    if (type === "select" || type === "mSelect") k.options = options || [];
    if (type === "number") k.numberFormat = "";
    return k;
  };

  const keyValues = [{ key: makeKey(blockKeyID, primaryFieldName, "block"), values: [] }];
  const columns = [{ id: blockKeyID, wrap: false, hidden: false, pin: false, width: "" }];

  const fieldsOut = [];
  fields.forEach((f) => {
    const keyID = generateId();
    let options;
    if (f.type === "select" || f.type === "mSelect") {
      options = (f.options || []).map((o) => ({ name: o.name, color: o.color || "1", desc: "" }));
    }
    keyValues.push({ key: makeKey(keyID, f.name, f.type, options), values: [] });
    columns.push({ id: keyID, wrap: false, hidden: false, pin: false, width: "" });
    fieldsOut.push({ keyID, type: f.type, name: f.name, options: options || [] });
  });

  const view = {
    id: viewID,
    icon: "",
    name: "Default",
    hideAttrViewName: false,
    desc: "",
    pageSize: 50,
    type: "table",
    table: {
      spec: 0,
      id: tableID,
      showIcon: true,
      columns,
    },
    itemIds: [],
    filters: [],
    sorts: [],
  };

  return {
    spec: 5,
    id: avID,
    name,
    keyValues,
    keyIDs: keyValues.map((kv) => kv.key.id),
    viewID,
    views: [view],
  };
}

// ---------- 公共写库序列：新建 Attribute View 数据库 ----------
//
// cfg = {
//   avID, dbName,
//   fields: Array<{ name, type, options?, colIndex, isPrimary }>,  // 含主列（isPrimary=true）
//   primaryName: string,
//   rows: string[][],                  // 解析后的数据行（已 trim / 补齐）
//   insertAfterId: string,            // 插入位置参考块 ID
//   rootID?: string,                  // 文档 rootID（不传则自动取）
//   reload?: boolean,                 // 写完后是否刷新编辑器（默认 true）
//   onProgress?: (batch, total) => void,
// }
// 返回 { avID, rows, cols, skipped, skippedEmptyPrimary }
export async function writeNewDatabase(cfg) {
  const {
    avID, dbName, fields, primaryName,
    rows, insertAfterId, rootID = "",
    reload = true, onProgress,
  } = cfg;

  const primaryField = fields.find((f) => f.isPrimary) || fields[0];
  const nonPrimary = fields.filter((f) => !f.isPrimary);
  if (!primaryField) throw new Error(I18N.noBlockId || "缺少主列");

  const avJson = buildAVJson(avID, dbName, nonPrimary, primaryName || (primaryField && primaryField.name) || "Name");

  // 行单元格的 keyID 必须与 AV JSON 里 keyValues 中的字段 id 完全一致
  const cellFields = avJson.keyValues.slice(1).map((kv, j) => ({
    keyID: kv.key.id,
    type: kv.key.type,
    name: kv.key.name,
    options: kv.key.options || [],
    colIndex: nonPrimary[j] ? nonPrimary[j].colIndex : j,
  }));
  const primaryKeyID = avJson.keyValues[0].key.id;

  // 预先构造好所有行数据（供后续 API 写入）
  const blocksValues = [];
  let skipped = 0;          // 全空行
  let skippedEmptyPrimary = 0; // 主列为空（PRD §6.3 / §7）
  for (const r of rows) {
    const allEmpty = r.every((c) => c == null || String(c).trim() === "");
    if (allEmpty) { skipped++; continue; }
    const primaryVal = r[primaryField.colIndex] != null ? String(r[primaryField.colIndex]).trim() : "";
    if (primaryVal === "") { skippedEmptyPrimary++; continue; }

    const rowValues = [];
    rowValues.push({ keyID: primaryKeyID, type: "block", block: { content: primaryVal } });
    cellFields.forEach((def) => {
      rowValues.push(buildCell(def, r[def.colIndex]));
    });
    blocksValues.push(rowValues);
  }

  console.log("[table-to-database] 解析行数:", rows.length, "有效行数:", blocksValues.length,
    "跳过空行:", skipped, "主列空跳过:", skippedEmptyPrimary);

  // 1) 写入 AV JSON 文件（骨架，不含行数据）
  await putFile(`/data/storage/av/${avID}.json`, JSON.stringify(avJson, null, 2));

  // 2) 插入数据库块（让前端先加载空库并建立监听，后续 API 的 ReloadAttrView 才能刷到它）
  const avBlockId = generateBlockId();
  const ts = getTimestamp();
  const dom =
    `<div data-node-id="${avBlockId}" data-type="NodeAttributeView" ` +
    `data-av-id="${avID}" data-av-type="custom" class="av" updated="${ts}"></div>`;
  let actualId = null;
  try {
    actualId = await insertBlockAfter(insertAfterId, dom);
  } catch (e) {
    try { await removeFile(`/data/storage/av/${avID}.json`); } catch (_) {}
    throw new Error((I18N.convertFail || "写入数据库失败：") + (e && e.message ? e.message : e));
  }

  // 3) 一次性写入所有行（专用 API，按 keyID 匹配，绝不错位）。
  //    数据库块已存在，API 末尾的 ReloadAttrView 会通知前端刷新，行数据才能显示出来。
  let rowsInserted = 0;
  if (blocksValues.length > 0) {
    try {
      const BATCH = 500; // R6：大文件分批提交并提示进度
      const totalBatches = Math.ceil(blocksValues.length / BATCH);
      for (let i = 0; i < blocksValues.length; i += BATCH) {
        const batch = blocksValues.slice(i, i + BATCH);
        if (onProgress) onProgress(Math.floor(i / BATCH) + 1, totalBatches);
        await appendRows(avID, batch);
        rowsInserted += batch.length;
      }
    } catch (e) {
      // 写行失败：删除已插入的空数据库块与 AV 文件，保留源数据（R7 回滚）
      try { if (actualId) await removeBlock(actualId); } catch (_) {}
      try { await removeFile(`/data/storage/av/${avID}.json`); } catch (_) {}
      throw new Error((I18N.rowFail || "写入数据库行失败：") + (e && e.message ? e.message : e));
    }
  }

  // 4) 刷新编辑器与属性视图
  if (reload) {
    try {
      await api("/api/ui/reloadProtyle", { id: rootID });
      await api("/api/ui/reloadAttributeView", { id: avID });
    } catch (refreshErr) {
      console.warn("[table-to-database] 自动刷新失败，可手动 F5 刷新", refreshErr);
    }
  }

  // blockID 为 insertBlock 返回的真实块 ID（doOperations[0].id），
  // 调用方据此在 DOM 中定位并滚动/高亮新数据库块（见 ImportWizard.showImportResult）。
  return { avID, blockID: actualId, rows: rowsInserted, cols: fields.length, skipped, skippedEmptyPrimary };
}

// ---------- 焦点缓存：在「编辑文档时」锁定最后聚焦的 protyle ----------
//
// 旧方案在「点击顶栏按钮时」才调用 getSelection() 取当前光标，但点击按钮后浏览器焦点已从
// 编辑器转移到了工具栏按钮/菜单，getSelection() 的 anchorNode 不再是编辑器内的块：
//   - 光标位置导入 → 找不到 .protyle → 报错「无法确定插入位置」；
//   - 文档末尾导入 → 回退到 .layout__wnd--active（多文档/分屏下可能是「未命名」）→ 插错文档。
//
// 新方案：通过 focusin 事件代理（index.js 注册），在用户「编辑文档时」就把他最后聚焦的
// protyle 缓存下来（含 rootID 与当时选中块）。点击按钮时直接读缓存，不再依赖实时焦点/选区。
// 事件代理可覆盖用户动态打开的新文档（protyle 动态创建），无需一次性 querySelectorAll 绑定。

// 用户最后聚焦的 .protyle 编辑区（模块级缓存）
let lastFocusedProtyle = null;
// 该 protyle 所属文档的 rootID（标题块 data-node-id），随缓存一并刷新
let lastFocusedRootID = "";
// 该次 focusin 时 protyle 内「当前选中块」的 data-node-id；无选中块则 null（后续回退到末块）
let lastFocusedAnchorBlockId = null;

/**
 * 从 protyle 读取「当前选中/光标所在块」的 data-node-id（优先块级选中，其次实时选区）。
 * 仅在「编辑器持有焦点」时调用（如 focusin 事件回调内），否则返回 null。
 * @param {Element|null} protyle
 * @returns {string|null}
 */
function readSelectedBlockId(protyle) {
  if (!protyle) return null;
  const selected = protyle.querySelector(".protyle-wysiwyg--select");
  if (selected) {
    const id = selected.getAttribute("data-node-id");
    if (id) return id;
  }
  const sel = window.getSelection && window.getSelection();
  if (sel && sel.rangeCount) {
    let node = sel.getRangeAt(0).startContainer;
    if (node && node.nodeType === 3) node = node.parentElement;
    const block = node && node.closest ? node.closest("[data-node-id]") : null;
    if (block && protyle.contains(block)) {
      const id = block.getAttribute("data-node-id");
      if (id) return id;
    }
  }
  return null;
}

/**
 * 设置最后聚焦的 protyle（由 index.js 的 focusin 事件代理调用），同时刷新
 * rootID 与当时选中块。仅当元素确为 .protyle 编辑区时生效。
 * @param {Element|null} protyle
 */
export function setLastFocusedProtyle(protyle) {
  if (!protyle || !protyle.querySelector || !protyle.querySelector(".protyle-wysiwyg")) return;
  lastFocusedProtyle = protyle;
  lastFocusedRootID = getProtyleRootID(protyle);
  lastFocusedAnchorBlockId = readSelectedBlockId(protyle);
  console.log("[table-to-database] 缓存最后聚焦 protyle：", {
    rootID: lastFocusedRootID,
    anchorBlockId: lastFocusedAnchorBlockId,
  });
}

/**
 * 读取缓存的 protyle（供 targetDb.listExistingAVs 等模块使用，避免依赖实时焦点/选区）。
 * @returns {Element|null}
 */
export function getLastFocusedProtyle() {
  return lastFocusedProtyle;
}

/**
 * 读取缓存 protyle 的 rootID（供诊断/调试）。
 * @returns {string}
 */
export function getLastFocusedRootID() {
  return lastFocusedRootID;
}

/**
 * 用户在已聚焦的 protyle 内移动光标时，刷新「当前选中块」缓存。
 * 仅在选区仍位于缓存 protyle 内部时更新，避免菜单/弹窗抢焦点后把锚点清空。
 */
export function refreshAnchorBlockFromSelection() {
  if (!lastFocusedProtyle) return;
  const sel = window.getSelection && window.getSelection();
  if (!sel || !sel.rangeCount) return;
  let node = sel.getRangeAt(0).startContainer;
  if (node && node.nodeType === 3) node = node.parentElement;
  if (!node || !node.closest) return;
  const block = node.closest("[data-node-id]");
  if (block && lastFocusedProtyle.contains(block)) {
    const id = block.getAttribute("data-node-id");
    if (id) {
      lastFocusedAnchorBlockId = id;
      console.log("[table-to-database] 刷新缓存锚点块：", { rootID: lastFocusedRootID, anchorBlockId: id });
    }
  }
}

// 取某个 protyle 编辑区内最后一个带 data-node-id 的块（用于「文档末尾」选项）。
function getLastBlockIdInProtyle(protyle) {
  if (!protyle) return null;
  const wysiwyg = protyle.querySelector(".protyle-wysiwyg");
  if (!wysiwyg) return null;
  const children = wysiwyg.children;
  for (let i = children.length - 1; i >= 0; i--) {
    const id = children[i] && children[i].getAttribute ? children[i].getAttribute("data-node-id") : null;
    if (id) return id;
  }
  return null;
}

// 从 protyle 读取其所属文档的 rootID（标题块的 data-node-id 即文档 id）。
// 纯 DOM 读取，不依赖任何实时焦点/选区，亦不回退到 .layout__wnd--active。
export function getProtyleRootID(protyle) {
  if (!protyle) return "";
  const title = protyle.querySelector(".protyle-title[data-node-id]");
  if (title) {
    const id = title.getAttribute("data-node-id");
    if (id) return id;
  }
  // 兜底：编辑区首个带 data-node-id 的后代（通常是标题块）
  const first = protyle.querySelector(".protyle-wysiwyg [data-node-id]");
  return first ? (first.getAttribute("data-node-id") || "") : "";
}

// 取当前光标块 id（仅作弹窗内/编辑器仍持有焦点时的兜底）：
// 选区被菜单/弹窗清空后无法可靠定位，返回 null，交由调用方使用缓存锚点。
export function getCurrentBlockId() {
  const sel = window.getSelection && window.getSelection();
  if (sel && sel.rangeCount) {
    let node = sel.getRangeAt(0).startContainer;
    if (node && node.nodeType === 3) node = node.parentElement;
    const block = node && node.closest ? node.closest("[data-node-id]") : null;
    if (block) {
      const id = block.getAttribute("data-node-id");
      if (id) return id;
    }
  }
  return null;
}

// 在「用户编辑文档时」已通过 focusin 缓存好最后聚焦的 protyle，这里直接读缓存取出锚点。
// 返回 { anchorBlockId, lastBlockId, rootID }，三者均来自同一 protyle（同一文档）。
// 若缓存为空（用户从未聚焦过任何编辑区），抛出明确错误，交由上层提示，绝不静默落到其它文档。
export function captureCurrentAnchor() {
  const protyle = lastFocusedProtyle;
  if (!protyle) {
    // 缓存为空：用户从未聚焦过任何编辑区，无法定位当前文档——抛出明确错误，
    // 而非回退到 .layout__wnd--active 指向的其它文档（如「未命名」）。
    throw new Error(I18N.noCurrentDoc || "无法确定当前文档，请先在编辑器中点击一下");
  }

  const rootID = lastFocusedRootID || getProtyleRootID(protyle);

  // 光标块：优先用 focusin 时（或之后 selectionchange 刷新时）缓存的选中块；
  // 若当时无选中块，回退到该 protyle 的最后一个块（作为 previousID，即「文档末尾前」插入——
  // 对「光标位置」也合理，至少保证落在正确文档，而非错指到其它文档）。
  let anchorBlockId = lastFocusedAnchorBlockId || null;
  if (!anchorBlockId) {
    const last = getLastBlockIdInProtyle(protyle);
    if (last) anchorBlockId = last;
  }

  // 末块：当前 protyle 的最后一个 data-node-id（同文档），用于「文档末尾」选项。
  const lastBlockId = getLastBlockIdInProtyle(protyle);

  console.log("[table-to-database] 捕获插入锚点（来自缓存 focus）：", {
    rootID,
    anchorBlockId,
    lastBlockId,
    fromCache: true,
  });
  return { anchorBlockId, lastBlockId, rootID };
}
