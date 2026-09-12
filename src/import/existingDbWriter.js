/* ============================================================
 * existingDbWriter.js — 旧库追加 / 去重写入器
 *
 * 把 ParsedTable 按列匹配（matchMap）与去重策略落入已有 AV：
 *   - 仅写「未忽略且未重复」的行；
 *   - 按目标 keyID 构造 blocksValues，调用 appendRows（强制批量，禁止逐行 insert）；
 *   - 类型不匹配单元格按 ARCH §8-5 兼容转换/跳过并累计提示，不阻断整库写入；
 *   - 写前调用 createDocHistory（warn-only）。
 *
 * matchMap: Map<srcIndex, targetKeyID | null>（null = 忽略该源列）
 * strategy: "primary" | "row" | "none"
 * ============================================================ */

import {
  api, createDocHistory, getBlockInfo, appendRows, buildCell, emptyValue, buildRowKey,
} from "../common";

// parsed: ParsedTable
// existing: ExistingAV（来自 targetDb.readAV）
// matchMap: Map<srcIndex, targetKeyID | null>
// strategy: "primary" | "row" | "none"
// opts: { rootID?, onProgress? }
// 返回 { avID, rows, newCount, dupCount, failureCells, skippedEmptyPrimary, cols }
export async function appendToExisting(parsed, existing, matchMap, strategy, opts = {}) {
  // 写前历史快照
  try {
    await createDocHistory(existing.blockID);
  } catch (e) {
    console.warn("[import] 创建文档历史失败（不影响导入）", e);
  }

  let rootID = opts.rootID || "";
  if (!rootID) {
    try {
      const info = await getBlockInfo(existing.blockID);
      rootID = (info && info.rootID) || "";
    } catch (_) {
      console.warn("[import] 获取文档 rootID 失败（刷新可能降级）");
    }
  }

  const primaryTarget = existing.columns.find((c) => c.type === "block");
  const existingPrimarySet = new Set((existing.existingPrimary || []).map((s) => String(s).trim()));
  const existingRowHashSet = new Set(existing.rowHashes || []);

  const targetToSrc = {};
  matchMap.forEach((keyID, srcIndex) => {
    if (keyID) targetToSrc[keyID] = srcIndex;
  });

  const blocksValues = [];
  let newCount = 0;
  let dupCount = 0;
  let failureCells = 0;
  let skippedEmptyPrimary = 0;

  for (const r of parsed.rows) {
    const primarySrcIdx = primaryTarget ? targetToSrc[primaryTarget.keyID] : undefined;
    const primaryVal = primarySrcIdx != null
      ? (r[primarySrcIdx] != null ? String(r[primarySrcIdx]).trim() : "")
      : "";

    // 去重判定
    let isDup = false;
    if (strategy === "primary" && primaryTarget) {
      if (primaryVal !== "" && existingPrimarySet.has(primaryVal)) isDup = true;
    } else if (strategy === "row") {
      if (existingRowHashSet.has(buildRowKey(r, existing, targetToSrc, opts.isCSV))) isDup = true;
    }
    if (primaryVal === "") {
      // 主列为空 → 无效行跳过（PRD §6.3 / §7）
      skippedEmptyPrimary++;
      continue;
    }
    if (isDup) {
      dupCount++;
      continue;
    }

    // 构造该行（按目标列顺序，缺失源列落空值；类型不匹配单元格尝试兼容转换，失败跳过并计数）
    const rowValues = [];
    for (const col of existing.columns) {
      const srcIdx = targetToSrc[col.keyID];
      let cell;
      if (srcIdx == null) {
        cell = emptyValue(col);
      } else {
        try {
          cell = buildCell({ keyID: col.keyID, type: col.type, options: col.options || [] }, r[srcIdx], opts.isCSV);
        } catch (e) {
          failureCells++;
          cell = emptyValue(col);
        }
      }
      rowValues.push(cell);
    }
    blocksValues.push(rowValues);
    newCount++;
  }

  // 分批写入（R6）。appendRows 内部 api() 会在 code!=0 时抛错，
  // 由调用方（onImport）捕获并明确提示；此处不静默吞掉失败。
  let inserted = 0;
  const BATCH = 500;
  if (blocksValues.length > 0) {
    const totalBatches = Math.ceil(blocksValues.length / BATCH);
    for (let i = 0; i < blocksValues.length; i += BATCH) {
      const batch = blocksValues.slice(i, i + BATCH);
      if (opts.onProgress) opts.onProgress(Math.floor(i / BATCH) + 1, totalBatches);
      const resp = await appendRows(existing.avID, batch);
      console.log("[import] appendRows 响应：", { avID: existing.avID, batch: batch.length, resp });
      inserted += batch.length;
    }
  }

  // 刷新
  try {
    await api("/api/ui/reloadProtyle", { id: rootID });
    await api("/api/ui/reloadAttributeView", { id: existing.avID });
  } catch (refreshErr) {
    console.warn("[import] 自动刷新失败，可手动 F5 刷新", refreshErr);
  }

  return {
    avID: existing.avID,
    blockID: existing.blockID,
    rows: inserted,
    newCount,
    dupCount,
    failureCells,
    skippedEmptyPrimary,
    cols: existing.columns.length,
  };
}
