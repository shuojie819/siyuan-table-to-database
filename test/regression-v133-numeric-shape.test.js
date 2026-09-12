/* ============================================================
 * test/regression-v133-numeric-shape.test.js
 * 覆盖 v1.3.3 修复 ③：数值形态优先（千分位 / 货币符号）。
 *
 * 修复前会失败：
 *   - "1,000" / "$3.5" / "¥1,200.50" 被判 mSelect（逗号当分隔符）或 date（被日期解析截胡），
 *     而非 number；
 *   - 整列千分位金额被推断为 mSelect。
 * 反例护栏：非标准千分位 "1,2,3"、以及文本列 "Hello, world" 不得被误判为 number。
 * ============================================================ */

import { describe, it, expect } from "vitest";
import { detectScalar, inferType, isExplicitNumber } from "../src/common.js";

describe("③ 数值形态优先：千分位 / 货币符号 → number", () => {
  it.each([["1,000"], ["$3.5"], ["¥1,200.50"], ["¥1,200"], ["-1,234.5"]])(
    "detectScalar('%s') → number",
    (v) => {
      expect(detectScalar(v)).toBe("number");
    }
  );

  it("inferType：整列数值形态 → number", () => {
    expect(inferType(["1,000", "2,000", "3,000"])).toBe("number");
    expect(inferType(["$3.5", "$4.5", "$5.5"])).toBe("number");
    expect(inferType(["¥1,200", "¥2,300", "¥3,400"])).toBe("number");
  });
});

describe("③ 反例护栏：数值形态修复不误伤文本 / 非标准千分位", () => {
  it("inferType(['Hello, world','Hi, there']) 仍必须是 mSelect", () => {
    expect(inferType(["Hello, world", "Hi, there"])).toBe("mSelect");
  });

  it("detectScalar('1,2,3') 必须是 text（非标准千分位不得判 number）", () => {
    expect(detectScalar("1,2,3")).toBe("text");
    expect(isExplicitNumber("1,2,3")).toBe(false);
  });
});

describe("③ 不回归：既有 number / date / url / text 判定不变", () => {
  it.each([
    ["1.5", "number"],
    ["100.00", "number"],
    ["-0.5", "number"],
    [".5", "number"],
    ["2024.1.1", "date"],
    ["2024-01-01", "date"],
    ["2024/1/1", "date"],
    ["example.com", "url"],
    ["1.2.3", "text"],
  ])("detectScalar('%s') → %s", (v, type) => {
    expect(detectScalar(v)).toBe(type);
  });
});
