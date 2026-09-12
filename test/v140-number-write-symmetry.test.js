/* ============================================================
 * test/v140-number-write-symmetry.test.js
 * v1.4.0 数值写入对称（改动 A）：修复「已发布版本的静默数据丢失 bug」。
 *
 * 修复前：detectScalar("1,000") 判 number（对），但 canonRawCell("1,000","number") 返回 ""、
 *         buildCell(number,"1,000") 给出 {content:0, isNotEmpty:false} → 金额列被判 number 但值全写空。
 * 修复后：content:1000 / isNotEmpty:true，且源侧(canonRawCell) 与目标侧(canonValueCell(buildCell)) 严格对称。
 *
 * 护栏：Infinity / -Infinity / NaN / 1e999 / abc 两侧仍必须为 ""（v1.3.3 非有限值归空行为不得被破坏）。
 * ============================================================ */

import { describe, it, expect } from "vitest";
import { canonRawCell, canonValueCell, buildCell } from "../src/common.js";

const NFIELD = (keyID = "k-num") => ({ keyID, type: "number" });
const valueCanon = (raw) => canonValueCell(buildCell(NFIELD(), raw), "number");
const rawCanon = (raw) => canonRawCell(raw, "number");

describe("A number 写入不再丢失（修复前含千分位/货币符号被写成空值）", () => {
  it("buildCell(number,'1,000') → content 1000 且 isNotEmpty true", () => {
    const cell = buildCell(NFIELD(), "1,000");
    expect(cell.number.content).toBe(1000);
    expect(cell.number.isNotEmpty).toBe(true);
  });

  it("buildCell(number,'$3.5') → content 3.5 且 isNotEmpty true", () => {
    const cell = buildCell(NFIELD(), "$3.5");
    expect(cell.number.content).toBe(3.5);
    expect(cell.number.isNotEmpty).toBe(true);
  });

  it.each(["1,000", "$3.5", "¥1,200.50", "-1,234.5", "007", "1.50", "-0.5", "0", "42"])(
    "'%s'：canonRawCell === canonValueCell(buildCell)",
    (s) => {
      expect(rawCanon(s)).toBe(valueCanon(s));
    }
  );

  it("源/目标对称值符合结构化解析预期（修复前含千分位者双方均为 ''）", () => {
    expect(rawCanon("1,000")).toBe("1000");
    expect(valueCanon("1,000")).toBe("1000");
    expect(rawCanon("$3.5")).toBe("3.5");
    expect(valueCanon("$3.5")).toBe("3.5");
    expect(rawCanon("¥1,200.50")).toBe("1200.5");
    expect(valueCanon("¥1,200.50")).toBe("1200.5");
    expect(rawCanon("-1,234.5")).toBe("-1234.5");
    expect(valueCanon("-1,234.5")).toBe("-1234.5");
  });
});

describe("A 护栏：非有限 / 不可解析值两侧仍归空（v1.3.3 行为不破）", () => {
  it.each(["Infinity", "-Infinity", "NaN", "1e999", "abc"])(
    "'%s'：canonRawCell 与 canonValueCell 均为 ''",
    (x) => {
      expect(rawCanon(x)).toBe("");
      expect(valueCanon(x)).toBe("");
      expect(rawCanon(x)).toBe(valueCanon(x));
    }
  );

  it("buildCell(number,'Infinity') → content 0 且 isNotEmpty false", () => {
    const cell = buildCell(NFIELD(), "Infinity");
    expect(cell.number.content).toBe(0);
    expect(cell.number.isNotEmpty).toBe(false);
  });
});
