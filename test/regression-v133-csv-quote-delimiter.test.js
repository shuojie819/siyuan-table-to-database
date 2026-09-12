/* ============================================================
 * test/regression-v133-csv-quote-delimiter.test.js
 * 覆盖 v1.3.3 修复 ④：CSV 分隔符探测与切分「引号感知」。
 *
 * 修复前会失败：旧实现对整行朴素 split，把引号内的分隔符也算作列分隔，
 * 例如 '"Last, First";age' 会被按逗号切成 2 列（正确应为分号分隔的 2 列），
 * 或把 '"a;b;c",d' 按分号切成 3 列。修复后：引号内分隔符不参与切分。
 * ============================================================ */

import { describe, it, expect } from "vitest";
import { parseCsv, detectDelimiter } from "../src/import/parsers.js";

describe("④ CSV 引号感知分隔", () => {
  it("分号分隔 + 引号内逗号 → 2 列，表头 ['Last, First','age']", () => {
    const p = parseCsv('"Last, First";age\n"Doe, John";30\n"Roe, Jane";25');
    expect(p.columns.length).toBe(2);
    expect(p.headerNames).toEqual(["Last, First", "age"]);
    expect(p.rows).toEqual([
      ["Doe, John", "30"],
      ["Roe, Jane", "25"],
    ]);
  });

  it("引号内分号不参与分隔 → 首行 2 列 ['a;b;c','d']", () => {
    const p = parseCsv('"a;b;c",d\n1,2');
    expect(p.columns.length).toBe(2);
    expect(p.headerNames).toEqual(["a;b;c", "d"]);
  });

  it("detectDelimiter：引号包裹逗号的行不应被误判为逗号分隔", () => {
    expect(detectDelimiter('"Last, First";age\n"Doe, John";30')).toBe(";");
  });
});

describe("④ 不回归：常规分隔行为不变", () => {
  it.each([
    ["a,b,c\n1,2,3", 3, ","],
    ["a\tb\n1\t2", 2, "\t"],
    ["a;b\n1;2", 2, ";"],
  ])("%j → %i 列（分隔符 %j）", (csv, cols, delim) => {
    expect(parseCsv(csv).columns.length).toBe(cols);
    expect(detectDelimiter(csv)).toBe(delim);
  });
});
