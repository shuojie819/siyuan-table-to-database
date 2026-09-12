/* ============================================================
 * test/type-inference.test.js
 * 覆盖 P0 修复 ①②：detectScalar / looksLikeWebUrl(经 isUrl) / isDate 的类型推断。
 * 每条断言都对应「修复前会失败」的场景；末尾含独立发现的负数小数反例。
 * ============================================================ */

import { describe, it, expect } from "vitest";
import { detectScalar, isDate, isUrl, isNumber, inferType } from "../src/common.js";

describe("①② 类型推断：数值不再被误判为 URL / 日期", () => {
  it("小数 / 金额形态 → number（修复前被判 url）", () => {
    expect(detectScalar("1.5")).toBe("number");
    expect(detectScalar("100.00")).toBe("number");
    expect(detectScalar("3.14")).toBe("number");
  });

  it("四位年份开头的点分 / 各类日期分隔写法 → date", () => {
    expect(detectScalar("2024.1.1")).toBe("date");
    expect(detectScalar("2024-01-01")).toBe("date");
    expect(detectScalar("2024/1/1")).toBe("date");
    expect(detectScalar("2024年1月1日")).toBe("date");
  });

  it("域名 / 协议 / 协议相对链接 → url", () => {
    expect(detectScalar("example.com")).toBe("url");
    expect(detectScalar("a.io")).toBe("url");
    expect(detectScalar("sub.example.co.uk")).toBe("url");
    expect(detectScalar("https://a.com")).toBe("url");
    expect(detectScalar("www.abc.com/path?q=1")).toBe("url");
    expect(detectScalar("//host/x")).toBe("url");
  });

  it("整列纯小数 → number（修复前 detectScalar 先判 url → 整列被推断为 url）", () => {
    expect(inferType(["1.5", "2.75", "3.14", "4.0"])).toBe("number");
  });

  it("已知边界：'1.2.3' 既非合法日期也非合法数字 → text（预期行为，不作 number 断言）", () => {
    expect(detectScalar("1.2.3")).toBe("text");
  });

  it("回归护栏：修复①②未误伤既有 url / date / number 判定", () => {
    expect(detectScalar("2024.1.1")).toBe("date");
    expect(detectScalar("100")).toBe("number");
    expect(isUrl("1.5")).toBe(false); // URL 不再截胡小数
    expect(isDate("1.5")).toBe(false); // 日期不再截胡小数
    expect(isNumber("1.5")).toBe(true);
  });
});

/* ---------------------------------------------------------------------------
 * 反例（QA 独立发现，非团队清单预期的“通过项”）
 *
 * isDate 的“小数排除”守卫写作：
 *   if (/^\d+(\.\d+)+$/.test(s) && !/^\d{4}[.\-].../.test(s)) return false;
 * 该正则要求**以数字开头**（^\d+），因此「负数小数」「前导点小数」不进入该守卫；
 * 随后 parseFlexibleDateToMs 会把 '.' 替换为 '-'，'-0.5' → '-0-5'，而 Date.parse('-0-5')
 * 在 V8 中返回合法时间戳 → isDate 返回 true → detectScalar 在 number 之前先命中 date。
 * 影响：一列负数小数（如 '-0.5'）会被整列推断为 date，写库类型错误。
 * ------------------------------------------------------------------------- */
describe("反例：负数 / 前导点小数被误判为 date（团队清单要求为 number）", () => {
  it("detectScalar('-0.5') 应为 number（实测为 date）", () => {
    expect(detectScalar("-0.5")).toBe("number");
  });

  it("detectScalar('-1.5') / detectScalar('.5') 应为 number", () => {
    expect(detectScalar("-1.5")).toBe("number");
    expect(detectScalar(".5")).toBe("number");
  });

  it("整列负小数应推断为 number 而非 date", () => {
    expect(inferType(["-0.5", "-1.5", "-2.5", "-3.5"])).toBe("number");
  });
});
