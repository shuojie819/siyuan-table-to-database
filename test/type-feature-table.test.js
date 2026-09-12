/* ============================================================
 * test/type-feature-table.test.js
 * 参数化「类型特征表」——把两轮审查暴露的全部反例/特征值固化为回归门禁。
 *
 * 分组：
 *   A) CONFIRMED：期望类型 == 当前实测 → 逐条硬断言（未来若漂移即失败）。
 *   B) FIXED_IN_V140：原 FLAGGED 三条的 backlog 修法已在 v1.4.0 落地
 *      （IPv4/IPhone 兜底陷阱、文件名 vs 域名、数值限定十进制），断言改为原「期望值」
 *      （v1.4.0 重构前这三条会失败，因为当时实测为 phone / url / number）。
 * ============================================================ */

import { describe, it, expect } from "vitest";
import { detectScalar, inferType } from "../src/common.js";

// A) 已确认：detectScalar 期望 == 实测
const CONFIRMED = [
  ["1.5", "number"],
  ["100.00", "number"],
  ["2024.1.1", "date"],
  ["-0.5", "number"],
  [".5", "number"],
  ["+2.25", "number"],
  ["$3.5", "number"],
  ["¥1,200", "number"],
  ["1,000", "number"],
  ["1,2,3", "text"],
  ["Infinity", "text"],
  ["NaN", "text"],
  ["1_000", "text"],
  ["13:45", "text"],
  ["95%", "text"],
  ["2024年", "date"],
  ["example.com", "url"],
  ["a.io", "url"],
  ["//host/x", "url"],
  ["Hello, world", "text"],
];

// B) v1.4.0 已修复：原 FLAGGED 三条的 backlog 修法落地，期望 == 实测。
//    [输入, 期望]
//    说明：v1.4.0 重构前这三条的实测值分别是 phone / url / number（即本轮修复的旧缺陷），
//    故把它们从「固化实测」改为「断言期望」，即成为回归门禁。
const FIXED_IN_V140 = [
  // 修复：isPhoneStrict 增加三/四段点分数字（IPv4）守卫 → 192.168.1.1 不再是 phone
  ["192.168.1.1", "text"],
  // 修复：URL 判定末段排除已知文件扩展名 → report.pdf 不再是 url
  ["report.pdf", "text"],
  // 修复：数值解析限定十进制（排除 0x/0b/0o/_）→ 0x1f 不再是 number
  ["0x1f", "text"],
];

describe("类型特征表 A：期望 == 实测（回归门禁）", () => {
  it.each(CONFIRMED)("detectScalar('%s') === '%s'", (v, type) => {
    expect(detectScalar(v)).toBe(type);
  });

  it("整列推断不回归", () => {
    expect(inferType(["1,000", "2,000", "3,000"])).toBe("number");
    expect(inferType(["$3.5", "$4.5", "$5.5"])).toBe("number");
    expect(inferType(["Hello, world", "Hi, there"])).toBe("mSelect");
  });
});

describe("类型特征表 B：v1.4.0 已修复（期望 == 实测，回归门禁）", () => {
  it.each(FIXED_IN_V140)("detectScalar('%s') === '%s'", (v, type) => {
    expect(detectScalar(v)).toBe(type);
  });
});
