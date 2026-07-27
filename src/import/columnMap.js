/* ============================================================
 * columnMap.js — 列映射 / 主列 / 源↔目标预匹配 / 增量预览计算
 *
 * 纯函数模块，被 ImportWizard 复用：
 *   - computeColumnOptions：按类型构造 select/mSelect 选项
 *   - setPrimary：切换主列（主列唯一）
 *   - reapplyHeader：委托 parsers 重新应用表头开关
 *   - autoMatch：源列按列名（大小写不敏感）预匹配到目标 keyID
 *   - computeIncremental：根据去重策略计算 新增/重复/未匹配 计数
 * ============================================================ */

import { buildSelectOptions, buildMSelectOptions, buildRowKey, canonRawCell, canonValueCell } from "../common";
import { reapplyHeader } from "./parsers";

// 按列类型构造选项（select / mSelect）
export function computeColumnOptions(colVals, type) {
  if (type === "select") return buildSelectOptions(colVals);
  if (type === "mSelect") return buildMSelectOptions(colVals);
  return [];
}

// 切换主列（保证唯一）
export function setPrimary(parsed, idx) {
  parsed.primaryIndex = idx;
  return parsed;
}

export { reapplyHeader };

// 源列 → 目标 keyID 的预匹配（按列名大小写不敏感）
// 返回 Map<srcIndex, targetKeyID | null>
export function autoMatch(sourceCols, targetCols) {
  const map = new Map();
  sourceCols.forEach((sc) => {
    const name = (sc.rawName || "").trim().toLowerCase();
    const hit = targetCols.find((tc) => (tc.name || "").trim().toLowerCase() === name);
    map.set(sc.index, hit ? hit.keyID : null);
  });
  return map;
}

// 根据去重策略计算增量预览
// matchMap: Map<srcIndex, targetKeyID | null>
// strategy: "primary" | "row" | "none"
// 返回 { newRows, duplicateRows, skippedEmptyPrimary, unmatchedSource, unmatchedTarget }
export function computeIncremental(parsed, existing, matchMap, strategy) {
  const primaryTarget = existing.columns.find((c) => c.type === "block");
  const existingPrimarySet = new Set((existing.existingPrimary || []).map((s) => String(s).trim()));
  const existingRowHashSet = new Set(existing.rowHashes || []);

  const targetToSrc = {};
  matchMap.forEach((keyID, srcIndex) => {
    if (keyID) targetToSrc[keyID] = srcIndex;
  });

  let duplicateRows = 0;
  let newRows = 0;
  let skippedEmptyPrimary = 0;

  for (const r of parsed.rows) {
    const primarySrcIdx = primaryTarget ? targetToSrc[primaryTarget.keyID] : undefined;
    const primaryVal = primarySrcIdx != null
      ? (r[primarySrcIdx] != null ? String(r[primarySrcIdx]).trim() : "")
      : "";
    let isDup = false;
    if (strategy === "primary" && primaryTarget) {
      if (primaryVal !== "" && existingPrimarySet.has(primaryVal)) isDup = true;
    } else if (strategy === "row") {
      if (existingRowHashSet.has(buildRowKey(r, existing, targetToSrc))) isDup = true;
    }
    if (primaryVal === "") {
      // 主列为空 → 视为无效行（PRD §6.3 / §7），导入时跳过
      skippedEmptyPrimary++;
      continue;
    }
    if (isDup) duplicateRows++;
    else newRows++;
  }

  const usedTargets = new Set([...matchMap.values()].filter(Boolean));
  const unmatchedTarget = existing.columns.filter((c) => !usedTargets.has(c.keyID)).length;
  const unmatchedSource = parsed.columns.filter(
    (c) => !matchMap.has(c.index) || !matchMap.get(c.index)
  ).length;

  return { newRows, duplicateRows, skippedEmptyPrimary, unmatchedSource, unmatchedTarget };
}
