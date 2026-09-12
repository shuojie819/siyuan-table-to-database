/* ============================================================
 * test/markdown-pipe-escape.test.js
 * 覆盖 P0 修复 ⑦：Markdown 表格解析正确处理 `\|`（单元格内字面竖线）与 `\\`（字面反斜杠）。
 * 修复前朴素 split('|') 会把含 `\|` 的行切错 → 整表列错位。
 * ============================================================ */

import { describe, it, expect } from "vitest";
import { parseMarkdown } from "../src/import/parsers.js";

describe("⑦ Markdown 竖线转义", () => {
  it("单元格内 \\| → 该行 2 列，第一格为 'a | b'（修复前会被切错列）", () => {
    const md = "| H1 | H2 |\n| --- | --- |\n| a \\| b | c |\n";
    const p = parseMarkdown(md, { firstRowAsHeader: true });
    expect(p.columns.length).toBe(2);
    expect(p.rows[0][0]).toBe("a | b");
    expect(p.rows[0][1]).toBe("c");
  });

  it("单元格内 \\\\ → 还原为字面单个反斜杠", () => {
    const md = "| H1 | H2 |\n| --- | --- |\n| a \\\\ b | c |\n";
    const p = parseMarkdown(md, { firstRowAsHeader: true });
    expect(p.columns.length).toBe(2);
    expect(p.rows[0][0]).toBe("a \\ b");
    expect(p.rows[0][1]).toBe("c");
  });

  it("回归：普通 GFM 表格（含 :--- / :--: 对齐行）行为不变", () => {
    const md = "| Left | Center |\n| :--- | :--: |\n| L | C |\n";
    const p = parseMarkdown(md, { firstRowAsHeader: true });
    expect(p.columns.length).toBe(2);
    expect(p.rows).toEqual([["L", "C"]]);
    expect(p.columns[0].rawName).toBe("Left");
    expect(p.columns[1].rawName).toBe("Center");
  });

  it("对照：朴素 split('|') 对含 \\| 的行切出的段数 ≠ 2（证明用例对转义敏感）", () => {
    const inner = "| a \\| b | c |".trim().replace(/^\|/, "").replace(/\|$/, "");
    expect(inner.split("|").length).not.toBe(2);
  });
});
