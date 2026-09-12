/* ============================================================
 * test/v140-date-parse-strict.test.js
 * v1.4.0 日期解析收紧（改动 C）：parseFlexibleDateToMs 彻底去掉 Date.parse 兜底。
 *
 * 修复前会失败（旧实现用 Date.parse 宽松兜底）：
 *   - "1.5" / "1.2.3" / "www.abc.com/path?q=1" / "$3-5" / "Hello.World"
 *     会被 Date.parse 当成合法日期 → 返回「莫须有」的毫秒值；
 *   - "2024-02-30" / "2024-13-01" 会被 V8 滚动/容错 → 返回非 NaN。
 * 修复后：只认确定性模式（10/13 位时间戳 + 明确日期书写），其余一律 NaN。
 * ============================================================ */

import { describe, it, expect } from "vitest";
import { parseFlexibleDateToMs } from "../src/common.js";

describe("C 必须成功解析（返回有限毫秒）", () => {
  it.each(["2024-01-01", "2024/1/1", "2024.1.1", "2024年1月1日"])(
    "parseFlexibleDateToMs('%s') 返回有限毫秒",
    (s) => {
      expect(Number.isFinite(parseFlexibleDateToMs(s))).toBe(true);
    }
  );

  it("13 位时间戳原值返回", () => {
    expect(parseFlexibleDateToMs("1721483847000")).toBe(1721483847000);
  });

  it("10 位时间戳 ×1000", () => {
    expect(parseFlexibleDateToMs("1721483847")).toBe(1721483847000);
  });
});

describe("C 必须返回 NaN（修复前返回莫须有日期）", () => {
  it.each(["1.5", "1.2.3", "www.abc.com/path?q=1", "$3-5", "2024-02-30", "2024-13-01", "Hello.World"])(
    "parseFlexibleDateToMs('%s') === NaN",
    (s) => {
      expect(Number.isNaN(parseFlexibleDateToMs(s))).toBe(true);
    }
  );

  it("2024-02-30（2 月无 30 日）不得被 V8 滚动成 3 月 1 日", () => {
    expect(Number.isNaN(parseFlexibleDateToMs("2024-02-30"))).toBe(true);
  });

  it("空串 / null / undefined → NaN", () => {
    expect(Number.isNaN(parseFlexibleDateToMs(""))).toBe(true);
    expect(Number.isNaN(parseFlexibleDateToMs("   "))).toBe(true);
    expect(Number.isNaN(parseFlexibleDateToMs(null))).toBe(true);
    expect(Number.isNaN(parseFlexibleDateToMs(undefined))).toBe(true);
  });
});

describe("C 时区一致性：'-' 与 '/' 写法必须落在同一时刻", () => {
  it("parseFlexibleDateToMs('2024-01-01') === parseFlexibleDateToMs('2024/1/1')", () => {
    // 重构前一个按 UTC、一个按本地，差 8 小时；重构后同一代码路径，必须相等。
    expect(parseFlexibleDateToMs("2024-01-01")).toBe(parseFlexibleDateToMs("2024/1/1"));
  });

  it("点分写法与 '-' 同样一致", () => {
    expect(parseFlexibleDateToMs("2024.1.1")).toBe(parseFlexibleDateToMs("2024-01-01"));
  });
});
