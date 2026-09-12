/* ============================================================
 * newDbWriter.js — 新库写入器
 *
 * 把 ParsedTable + 列映射（含主列）转换为公共写库序列 writeNewDatabase。
 * 不删除任何源（源是内存中的 CSV/MD，不像 convertTable 要删原 NodeTable）。
 * 写前调用 createDocHistory（warn-only）。
 * ============================================================ */

import {
  generateId, createDocHistory, getBlockInfo, writeNewDatabase,
} from "../common";

// parsed: ParsedTable
// fields: Array<{ name, type, options, colIndex, isPrimary }>  （与 parsed.columns 对应）
// opts: { insertAfterId, rootID?, dbName?, onProgress? }
// 返回 { avID, rows, cols, skipped, skippedEmptyPrimary }
export async function writeNewDb(parsed, fields, opts = {}) {
  const avID = generateId();
  const primaryField = fields.find((f) => f.isPrimary) || fields[0];
  const dbName = opts.dbName || parsed.rawName || "数据库";

  // 写前历史快照（失败仅 warn 不阻断）
  try {
    await createDocHistory(opts.insertAfterId);
  } catch (e) {
    console.warn("[import] 创建文档历史失败（不影响导入）", e);
  }

  let rootID = opts.rootID || "";
  if (!rootID) {
    try {
      const info = await getBlockInfo(opts.insertAfterId);
      rootID = (info && info.rootID) || "";
    } catch (_) {
      console.warn("[import] 获取文档 rootID 失败（刷新可能降级）");
    }
  }

  const res = await writeNewDatabase({
    avID,
    dbName,
    fields,
    primaryName: primaryField ? primaryField.name : "Name",
    rows: parsed.rows,
    insertAfterId: opts.insertAfterId,
    rootID,
    onProgress: opts.onProgress,
    isCSV: opts.isCSV,
  });

  return { ...res, avID };
}
