/* ============================================================
 * test/regression-v133-number-symmetric.test.js
 * 覆盖 v1.3.3 修复 ②：number 列「非有限值」在源侧(canonRawCell)与目标侧(canonValueCell)
 * 统一归空，保证二次导入时源 row key 与目标 row key 严格对称。
 *
 * 修复前会失败：旧实现源侧退化为去空白原文（canonRawCell("Infinity","number") === "Infinity"），
 * 而目标侧读 buildCell 写出的 content:0（isNotEmpty:false）得 "" → 两侧不对称 → 重复导入。
 * ============================================================ */

import { describe, it, expect } from "vitest";
import { canonRawCell, canonValueCell, buildCell, detectScalar } from "../src/common.js";

const NFIELD = { keyID: "k-num", type: "number" };
const valueCell = (raw) => canonValueCell(buildCell(NFIELD, raw), "number");

describe("② number 非有限值：源/目标两侧均归空（对称）", () => {
  it.each(["Infinity", "-Infinity", "NaN", "1e999", "abc"])(
    "'%s'：canonRawCell 与 canonValueCell 均为 '' 且二者相等",
    (x) => {
      expect(canonRawCell(x, "number")).toBe("");
      expect(valueCell(x)).toBe("");
      expect(canonRawCell(x, "number")).toBe(valueCell(x));
    }
  );

  it("buildCell(number, 'Infinity') → isNotEmpty:false 且 content:0", () => {
    const cell = buildCell(NFIELD, "Infinity");
    expect(cell.number.isNotEmpty).toBe(false);
    expect(cell.number.content).toBe(0);
  });

  it("detectScalar('Infinity'/'NaN'/'-Infinity') → text（不再是 number）", () => {
    expect(detectScalar("Infinity")).toBe("text");
    expect(detectScalar("-Infinity")).toBe("text");
    expect(detectScalar("NaN")).toBe("text");
  });
});

describe("② number 正常值不回归", () => {
  it.each([
    ["007", "7"],
    ["1.50", "1.5"],
    ["-0.5", "-0.5"],
    ["0", "0"],
    ["42", "42"],
  ])("'%s' → 两侧均为 '%s'", (raw, want) => {
    expect(canonRawCell(raw, "number")).toBe(want);
    expect(valueCell(raw)).toBe(want);
    expect(canonRawCell(raw, "number")).toBe(valueCell(raw));
  });
});
