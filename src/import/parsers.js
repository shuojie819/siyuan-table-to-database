/* ============================================================
 * parsers.js — CSV / Markdown 解析层 + 统一中间模型 ParsedTable
 *
 * 产出统一的 ParsedTable（PRD §5、ARCH §4），供「新建库」「导入旧库」两分支共享。
 * 关键点：
 *   - CSV：UTF-8 + BOM 去除；逗号/制表符/分号分隔符自动探测；双引号包裹与 "" 转义；
 *          字段内换行；空行跳过；列数不一致按最大列补齐 ""。
 *   - Markdown：标准 GFM（表头 + 分隔行 + 数据行，忽略 :--: 对齐）；额外支持 Tab 分隔语法
 *              （粘贴自电子表格的 Tab 分隔文本也能解析）；仅取纯文本。
 *   - 同时保留 allRows（含表头行的完整清洗矩阵）与 headerNames，供向导在
 *     「将第一行用作标题」开关切换时无需重新解析即可重算。
 * ============================================================ */

import { inferType, buildSelectOptions, buildMSelectOptions } from "../common";

// 去除 UTF-8 BOM（\uFEFF）
export function stripBOM(text) {
  if (!text) return "";
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

// 引号感知地统计一行按 delim 切分后的「列数」：忽略成对双引号之间的分隔符，"" 视为转义引号。
// 旧实现对整行朴素 split，会把引号内的分隔符也算进去，导致带引号的表头被切错列。
function countQuoteAwareColumns(line, delim) {
  let cols = 1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { i++; continue; } // "" → 转义引号，不切换引号状态
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === delim) cols++;
  }
  return cols;
}

// 自动探测分隔符：取前若干非空行（最多 10 行）为样本，按「引号感知」方式计数，
// 以「各行列数一致的行数」优先、其次「列数多者」优先选择（候选顺序 , / \t / ; 保证平局时逗号优先）。
// 若所有候选都没让首行产生 ≥2 列，保留回退行为（默认逗号）。
export function detectDelimiter(text) {
  const candidates = [",", "\t", ";"];
  const lines = String(text == null ? "" : text)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(0, 10);
  if (lines.length === 0) return ",";

  let best = ",";
  let bestConsistent = -1; // 「列数与首行一致」的行数
  let bestCols = 1;        // 首行切出的列数
  for (const d of candidates) {
    const colCounts = lines.map((l) => countQuoteAwareColumns(l, d));
    const firstCols = colCounts[0];
    if (firstCols < 2) continue; // 首行切不出 ≥2 列 → 该候选无效
    const consistent = colCounts.filter((c) => c === firstCols).length;
    if (consistent > bestConsistent || (consistent === bestConsistent && firstCols > bestCols)) {
      bestConsistent = consistent;
      bestCols = firstCols;
      best = d;
    }
  }
  return best;
}

// 状态机解析 CSV 文本为记录数组（处理引号包裹、"" 转义、字段内换行）
function parseCsvRecords(text, delim) {
  const records = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === delim) {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      if (text[i + 1] === "\n") i += 1;
      row.push(field);
      records.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // 收尾：推入最后一个字段与最后一行（避免把无换行的末行或末字段漏掉）
  if (field !== "" || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  return records;
}

// 拆分 Markdown 表格的一行（去除首尾 | 与两端空格）。
// GFM 转义：`\|` 是单元格内的字面竖线（不作分隔符），`\\` 是字面反斜杠。
// 旧实现朴素 split("|") 会把 `| a \| b | c |` 切成 4 段（应为 2 段）→ 整表列错位、列数虚高。
// 改为逐字符扫描，正确处理上述两种转义，其余字符原样保留。
function splitPipe(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      const nxt = s[i + 1];
      if (nxt === "|") { cur += "|"; i++; continue; }     // \| → 字面竖线
      if (nxt === "\\") { cur += "\\"; i++; continue; }   // \\ → 字面反斜杠
      cur += c;                                            // 其它转义：原样保留反斜杠
      continue;
    }
    if (c === "|") { cells.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

// 由完整清洗矩阵构造 ParsedTable（统一入口）
// allRows：所有非空行（已 trim、已按 maxCols 补齐）的二维数组
// emptyLines：解析时被跳过的空行数（用于统计展示）
export function buildParsedTable(allRows, source, rawName, firstRowAsHeader, emptyLines = 0) {
  const maxCols = allRows.length ? Math.max(...allRows.map((r) => r.length)) : 0;
  const headerNames = allRows.length
    ? allRows[0].map((h, i) => (h != null && String(h).trim() !== "") ? String(h).trim() : `列${i + 1}`)
    : [];

  let rows;
  let colNames;
  if (firstRowAsHeader && allRows.length > 1) {
    rows = allRows.slice(1);
    colNames = headerNames.slice();
  } else if (firstRowAsHeader && allRows.length === 1) {
    // 只有表头、没有数据行
    rows = [];
    colNames = headerNames.slice();
  } else {
    rows = allRows.slice();
    colNames = Array.from({ length: maxCols }, (_, i) => `列${i + 1}`);
  }
  // 补齐列名到 maxCols
  while (colNames.length < maxCols) colNames.push(`列${colNames.length + 1}`);

  // 行补齐到 maxCols
  const paddedRows = rows.map((r) => {
    const rr = r.slice(0, maxCols);
    while (rr.length < maxCols) rr.push("");
    return rr;
  });

  // mSelect 选项拆分规则：CSV 源按「逗号类 + 空白」拆，其它源仅按逗号类拆（不按空格，v1.3.1）
  const isCSV = source === "csv";
  const columns = Array.from({ length: maxCols }, (_, i) => {
    const colVals = paddedRows.map((r) => (r[i] != null ? r[i] : ""));
    const type = inferType(colVals);
    const options = type === "select"
      ? buildSelectOptions(colVals)
      : type === "mSelect"
        ? buildMSelectOptions(colVals, isCSV)
        : [];
    return { index: i, rawName: colNames[i] != null ? colNames[i] : `列${i + 1}`, type, options };
  });

  const validRows = paddedRows.filter((r) => r.some((c) => c != null && String(c).trim() !== "")).length;

  return {
    source,
    rawName,
    allRows,
    headerNames,
    rows: paddedRows,
    columns,
    primaryIndex: maxCols > 0 ? 0 : -1,
    firstRowAsHeader,
    stats: {
      totalRows: paddedRows.length,
      totalCols: maxCols,
      validRows,
      emptyRows: emptyLines,
    },
  };
}

// 解析 CSV 文本 → ParsedTable
export function parseCsv(text, { firstRowAsHeader = true, rawName = "CSV" } = {}) {
  const t = stripBOM(text || "");
  if (t.trim() === "") return buildParsedTable([], "csv", rawName, firstRowAsHeader, 0);

  const delim = detectDelimiter(t);
  const records = parseCsvRecords(t, delim);

  // 跳过完全空行（所有单元格为空），并统计数量
  const nonEmpty = [];
  let emptyLines = 0;
  for (const rec of records) {
    const cleaned = rec.map((c) => (c != null ? String(c).trim() : ""));
    if (cleaned.every((c) => c === "")) {
      emptyLines++;
      continue;
    }
    nonEmpty.push(cleaned);
  }

  const maxCols = nonEmpty.length ? Math.max(...nonEmpty.map((r) => r.length)) : 0;
  const allRows = nonEmpty.map((r) => {
    const rr = r.slice(0, maxCols);
    while (rr.length < maxCols) rr.push("");
    return rr;
  });

  return buildParsedTable(allRows, "csv", rawName, firstRowAsHeader, emptyLines);
}

// 解析 Markdown 表格文本 → ParsedTable（标准 GFM + Tab 分隔扩展）
export function parseMarkdown(text, { firstRowAsHeader = true, rawName = "Markdown 表格" } = {}) {
  const lines = (text || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  if (!lines.length) return buildParsedTable([], "markdown", rawName, firstRowAsHeader, 0);

  let allRows;
  let emptyLines = 0;

  // 扩展：无管道符、含制表符 → 视为 Tab 分隔表（粘贴自电子表格）
  if (!lines.some((l) => l.includes("|")) && lines.some((l) => l.includes("\t"))) {
    const maxCols = Math.max(...lines.map((l) => l.split("\t").length));
    allRows = lines.map((l) => {
      const cells = l.split("\t").map((c) => c.trim());
      const rr = cells.slice(0, maxCols);
      while (rr.length < maxCols) rr.push("");
      return rr;
    });
  } else {
    // 标准 GFM：按 | 拆分
    const rawRows = lines.map((l) => splitPipe(l));
    const maxCols = Math.max(...rawRows.map((r) => r.length));
    const padded = rawRows.map((r) => {
      const rr = r.slice(0, maxCols);
      while (rr.length < maxCols) rr.push("");
      return rr;
    });
    // 定位分隔行（每个单元格形如 :-- / --: / :--: / ----）
    const sepIdx = padded.findIndex(
      (r, idx) => idx > 0 && r.length > 0 && r.every((c) => /^:?-+:?$/.test(c.trim()))
    );
    if (sepIdx >= 0) {
      allRows = padded.slice(0, sepIdx).concat(padded.slice(sepIdx + 1));
    } else {
      allRows = padded;
    }
  }

  return buildParsedTable(allRows, "markdown", rawName, firstRowAsHeader, emptyLines);
}

// 切换「将第一行用作标题」时，从已保存的 allRows 重新构造 ParsedTable（无需重新解析）
export function reapplyHeader(parsed, useHeader) {
  return buildParsedTable(
    parsed.allRows,
    parsed.source,
    parsed.rawName,
    useHeader,
    parsed.stats.emptyRows || 0
  );
}
