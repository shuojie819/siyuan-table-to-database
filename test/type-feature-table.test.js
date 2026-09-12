/* ============================================================
 * test/type-feature-table.test.js
 * 参数化「类型特征表」——把两轮审查暴露的全部反例/特征值固化为回归门禁。
 *
 * 分组：
 *   A) CONFIRMED：期望类型 == 当前实测 → 逐条硬断言（未来若漂移即失败）。
 *   B) FLAGGED（存疑/反例）：我的期望类型 != 当前实测 → 本表**固化当前行为**以防无声漂移，
 *      但不把期望值写成实测值来「迁就实现」；差异已上报 team-lead 裁定
 *      （若裁定为缺陷，应把对应断言的 observed 改为 expected）。
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

// B) 存疑：期望类型 != 当前实测（固化当前行为，已上报 team-lead 并裁定）。
//    三条均已裁定「确认问题但不在本轮 v1.3.3 范围」，故 src 不改，本表继续固化当前实测行为。
//    [输入, 我的期望, 当前实测]
const FLAGGED = [
  // 已裁定：确认缺陷（IPv4 被判 phone），不在 v1.3.3 范围，转 backlog —— 修法为 isPhone 增加三/四段点分数字（IPv4）守卫
  ["192.168.1.1", "text", "phone"],
  // 已裁定：已知限制（文件名与域名同构，无上下文可区分），保留现状
  ["report.pdf", "text", "url"],
  // 已裁定：次要缺陷（数值语义被改写 0x1f→31；源/目标对称不产生重复行），不在 v1.3.3 范围，转 backlog（修法：数值解析限定十进制，排除 0x/0b/0o/_）
  ["0x1f", "text", "number"],
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

describe("类型特征表 B：存疑项（实测 != 期望，已上报）", () => {
  it.each(FLAGGED)(
    "detectScalar('%s') 期望 '%s'，当前实测 '%s'（已裁定转 backlog，本轮不修，固化实测）",
    (v, _expected, observed) => {
      // 断言的是【当前实测值】而非【我的期望值】——两者不一致，已作为存疑/反例上报并裁定：
      // 三条均「确认问题但不在本轮 v1.3.3 范围」，故 src 不改，此处固化当前行为防无声漂移。
      // 后续若在 backlog 修复（192.168.1.1 修 isPhone / report.pdf 维持 / 0x1f 限十进制），
      // 请把对应的 observed 改为 expected。
      expect(detectScalar(v)).toBe(observed);
    }
  );
});
