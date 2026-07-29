/* ============================================================
 * targetDb.js — 目标库（已有 Attribute View）枚举与读取
 *
 * 红线约束（ARCH §6 / R1）：
 *   - 禁止 fs/electron/node 直读 data/；所有文件走 /api/file/getFile。
 *   - 读取 /data/storage/av/{avID}.json 取 schema（keyValues 的 key.id/name/type/options）
 *     与主列值（block.content），并尽力推算整行哈希（用于「整行去重」）。
 * ============================================================ */

import { I18N, getFile, getLastFocusedProtyle, getProtyleRootID, canonValueCell, api } from "../common";

// 将 /api/file/getFile 返回内容统一转为字符串（兼容 base64 / 原始文本）
function fileContentToString(resp) {
  if (!resp) throw new Error("empty response");
  let c;
  if (typeof resp === "string") c = resp;
  else if (resp.content != null) c = resp.content;
  else if (resp.data != null) c = resp.data;
  else c = "";
  if (typeof c !== "string") return String(c);
  const trimmed = c.trim();
  // SiYuan getFile 可能返回 base64（尤其含非 ASCII 时），尝试解码
  if (trimmed.length > 0 && /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length % 4 === 0) {
    try { return decodeBase64Unicode(trimmed); } catch (_) { return c; }
  }
  return c;
}

function decodeBase64Unicode(b64) {
  const binary = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

// 从 SiYuan Value 结构中提取整行去重用的规范文本（统一委托 common.canonValueCell，
// 确保与目标库 readAV 的 rowHashes 及源侧 buildRowKey 采用同一套归一规则）。
// options: 该列 keyOptions（mSelect/select 单元格若只存 id 引用，可据此反查文本）。
// isCSV：透传自导入入口，决定 mSelect 是否按空格切分（与源侧 buildRowKey 保持同一规则）。
function cellText(v, type, options, isCSV = false) {
  return canonValueCell(v, type, options, isCSV);
}

// 枚举指定文档全部 NodeAttributeView 块，返回 { avID, blockID, name }[]
// opts.protyle：显式指定要枚举的编辑区（多文档/分屏下避免错列到 .layout__wnd--active 指向的其它文档）。
// opts.rootID：指定文档 rootID，据此定位对应 protyle（与导入锚点同文档）。
// 两者均未传时回退到旧的「活动窗口首个 protyle」逻辑（向下兼容，不影响其它调用方）。
export async function listExistingAVs(opts = {}) {
  let protyle = opts.protyle || null;
  // 通过 rootID 精确定位该文档的 protyle（标题块 .protyle-title 的 data-node-id 即文档 rootID）
  if (!protyle && opts.rootID) {
    const all = Array.from(document.querySelectorAll(".protyle"));
    for (const p of all) {
      const title = p.querySelector(".protyle-title[data-node-id]");
      if (title && title.getAttribute("data-node-id") === opts.rootID) { protyle = p; break; }
    }
  }
  // rootID 未传或匹配失败时，优先用「用户最后聚焦的 protyle」缓存（来自 focusin 事件代理），
  // 避免多文档/分屏下 .layout__wnd--active 指向「未命名」等其它文档而错列到错误文档。
  if (!protyle) {
    protyle = getLastFocusedProtyle() || null;
  }
  // 最终兜底：缓存也为空时，回退到活动窗口 / 任意 protyle（仅此一处保留 .layout__wnd--active，向下兼容）。
  if (!protyle) {
    protyle = document.querySelector(".layout__wnd--active .protyle") || document.querySelector(".protyle");
  }
  if (!protyle) return [];
  const blocks = Array.from(protyle.querySelectorAll('.protyle-wysiwyg [data-type="NodeAttributeView"]'));
  const list = [];
  for (const b of blocks) {
    const avID = b.getAttribute("data-av-id");
    const blockID = b.getAttribute("data-node-id");
    if (!avID) continue;
    // 名称解析（分层，保证下拉框显示「数据库名称」而非 ID）：
    //   1) 编辑器内可见的 Attribute View 标题（用户最熟悉的名称，.av__title 文本）；
    //   2) av JSON 的 name 字段（来自 /api/file/getFile 读取的文件内容）；
    //   3) 兜底回退到 avID。
    let name = "";
    const titleEl = b.querySelector(".av__title");
    if (titleEl && titleEl.textContent && titleEl.textContent.trim()) {
      name = titleEl.textContent.trim();
    }
    if (!name) {
      try {
        const av = await readAV(avID, blockID);
        if (av && av.name && av.name !== avID) name = av.name;
      } catch (_) {
        // 读不到也保留（可能正在被其它操作占用），稍后回退到 avID
      }
    }
    if (!name) name = avID;
    list.push({ avID, blockID, name });
  }
  console.log("[import] 枚举已有数据库：", {
    rootID: opts.rootID || getProtyleRootID(protyle) || "",
    cachedRootID: getProtyleRootID(getLastFocusedProtyle() || null) || "",
    count: list.length,
  });
  return list;
}

// 读取单个已有 AV 的 schema、主列值、整行哈希
// 抛错（目标库不存在 / 解析失败）由调用方捕获并提示
// isCSV：透传自导入入口，决定 mSelect 是否按空格切分（与目标库 rowHashes 计算及源侧 canon 保持同一规则）
export async function readAV(avID, blockID, isCSV = false) {
  let json;
  try {
    // 注意：/api/file/getFile 返回的是文件原始内容（不是标准 {code,data} 信封），
    // 必须用专用 getFile()（直接返回文本）解析，不能用通用 api()（会把 json.code 为
    // undefined 误判为失败，从而抛出「目标数据库不存在」）。
    const raw = await getFile(`/data/storage/av/${avID}.json`);
    const text = fileContentToString(raw);
    json = JSON.parse(text);
  } catch (e) {
    throw new Error((I18N.targetDbNotFound || "目标数据库不存在") + (e && e.message ? "：" + e.message : ""));
  }

  const kvs = json.keyValues || [];
  const columns = kvs.map((kv) => ({
    keyID: kv.key.id,
    name: kv.key.name,
    type: kv.key.type,
    options: kv.key.options || [],
  }));

  // 构造主列值集合（用于"按主列去重"）
  //
  // block 类型单元格在 AV JSON 文件中通常仅存储 { block: { id: "…" } }，
  // content 字段在块创建时已被内核消费（写入块自身内容），并不回写到 AV JSON。
  // 因此 v.block.content 在许多场景下为 undefined，导致 existingPrimary 全为空，
  // 进而使「按主列去重」永远无法命中任何已存在行（Bug: 按主列去重漏命中）。
  //
  // 修复策略：
  //   1) 先尝试从 v.block.content 直接取（字符串/嵌套对象/数字均兼容）；
  //   2) 取不到时按 v.block.id 通过 /api/block/getBlockInfo 获取块内容文本；
  //   3) 并行批量请求（最多 20 并发），失败时该行降级为空串。
  const primary = columns.find((c) => c.type === "block");
  const primaryKV = primary ? kvs.find((kv) => kv.key.id === primary.keyID) : null;
  const rawPrimary = primaryKV
    ? (primaryKV.values || []).map((v) => {
        if (!v || !v.block) return "";
        const bc = v.block.content;
        if (bc != null) {
          if (typeof bc === "string" && bc.trim() !== "") return bc.trim();
          if (typeof bc === "object" && bc.content != null) return String(bc.content).trim();
          if (typeof bc === "number") return String(bc);
        }
        // content 不可用 → 暂记 blockId，稍后通过 API 解析
        if (v.block.id) return "\x00BLOCK\x00" + v.block.id;
        return "";
      })
    : [];

  const existingPrimary = [];
  const unresolvedIndices = [];
  rawPrimary.forEach((val, idx) => {
    if (typeof val === "string" && val.startsWith("\x00BLOCK\x00")) {
      unresolvedIndices.push({ idx, blockId: val.slice("\x00BLOCK\x00".length) });
      existingPrimary[idx] = ""; // 占位，API 解析后回填
    } else {
      existingPrimary[idx] = val;
    }
  });

  // 通过 API 解析未决的块内容（并行请求，限并发 20，避免压垮后端）
  if (unresolvedIndices.length > 0) {
    const CONCURRENCY = 20;
    console.log("[import] readAV 主列块内容缺失，通过 API 解析：", unresolvedIndices.length, "个");
    for (let i = 0; i < unresolvedIndices.length; i += CONCURRENCY) {
      const batch = unresolvedIndices.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(({ blockId }) => api("/api/block/getBlockInfo", { id: blockId }))
      );
      results.forEach((r, j) => {
        if (r.status === "fulfilled" && r.value) {
          // getBlockInfo 返回 data 层（api() 已解包），包含 content（块文本）
          const text = (r.value.content || "").trim();
          existingPrimary[batch[j].idx] = text;
        } else {
          // API 失败则降级为空串（该行不会匹配任何源行，安全）
          existingPrimary[batch[j].idx] = "";
        }
      });
    }
  }

  const rowCount = kvs.length ? (kvs[0].values || []).length : 0;

  // 尽力推算整行哈希（R1：若 av JSON 的 values 为空，则 rowHashes 为空，
  // 「整行去重」将退化为「不基于存量去重」，属安全降级）
  const rowHashes = [];
  for (let k = 0; k < rowCount; k++) {
    // 把该列的 keyOptions 一并传入，供 canonValueCell 在 mSelect/select 单元格
    // 仅存 id 引用时反查真实文本（修复「备注=多选」整行去重误判新增）。
    const parts = kvs.map((kv) => cellText(kv.values ? kv.values[k] : null, kv.key.type, kv.key.options || [], isCSV));
    rowHashes.push(parts.join("\u0001"));
  }

  return {
    avID,
    blockID: blockID || (json.blockID || ""),
    name: json.name || (primary ? primary.name : avID),
    columns,
    existingPrimary,
    rowHashes,
    rowCount,
  };
}
