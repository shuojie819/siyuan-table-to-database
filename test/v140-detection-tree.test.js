/* ============================================================
 * test/v140-detection-tree.test.js
 * v1.4.0 判定树重构（改动 B）回归门禁 + 列级推断（F）。
 *
 * 判定树顺序（detectScalar）：
 *   空→text / isEmail→email / isUrl→url / isPhoneStrict→phone /
 *   isStructuredNumber→number / isDateStrict→date / isNumberStrict→number / 兜底 text
 *
 * 「修复前会失败」的条目（v1.4.0 重构前实测值）：
 *   - 192.168.1.1 / 2024.13.45 → 修复前 phone（phone 兜底陷阱）
 *   - 1721483847000           → 修复前 phone（13 位纯数字落入电话数字位数判定）
 *   - report.pdf / archive.zip→ 修复前 report.pdf 判 url
 *   - 0x1f / 1_000            → 修复前 0x1f 判 number（数值语义被改写为 31）
 *   - data:text/html,x        → 修复前 inferType 会判 mSelect（逗号被当多选分隔符）
 * ============================================================ */

import { describe, it, expect } from "vitest";
import { detectScalar, inferType } from "../src/common.js";

const NUMBERS = ["1.5", "100.00", "-0.5", ".5", "+2.25", "$3.5", "¥1,200", "1,000",
  "1721483847000", "20240101"];
const URLS = ["example.com", "a.io", "//host/x", "https://a.com", "https://x.zip"];
const DATES = ["2024.1.1", "2024-01-01", "2024/1/1", "2024年1月1日", "2024年", "2024-1"];
const TEXTS = ["192.168.1.1", "2024.13.45", "1,2,3", "report.pdf", "archive.zip", "Mr.Smith",
  "0x1f", "1_000", "13:45", "95%", "100kg", "Hello, world", "data:text/html,x",
  "Infinity", "NaN"];
const PHONES = ["+86-13800138000", "138-1234-5678"];

describe("B 判定树：结构化/普通数值 → number", () => {
  it.each(NUMBERS)("detectScalar('%s') === 'number'", (v) => {
    expect(detectScalar(v)).toBe("number");
  });
});

describe("B 判定树：域名 / 协议 / 协议相对 → url", () => {
  it.each(URLS)("detectScalar('%s') === 'url'", (v) => {
    expect(detectScalar(v)).toBe("url");
  });
});

describe("B 判定树：日期书写 → date", () => {
  it.each(DATES)("detectScalar('%s') === 'date'", (v) => {
    expect(detectScalar(v)).toBe("date");
  });
});

describe("B 判定树：非数值/非日期/非电话 → text", () => {
  it.each(TEXTS)("detectScalar('%s') === 'text'", (v) => {
    expect(detectScalar(v)).toBe("text");
  });
});

describe("B 判定树：电话 → phone", () => {
  it.each(PHONES)("detectScalar('%s') === 'phone'", (v) => {
    expect(detectScalar(v)).toBe("phone");
  });
});

describe("B 关键边界（修复前均会失败）", () => {
  it("13 位时间戳纯数字 → number（修复前 phone）", () => {
    expect(detectScalar("1721483847000")).toBe("number");
  });

  it("8 位纯数字 → number（不得被误判为电话/日期）", () => {
    expect(detectScalar("20240101")).toBe("number");
  });

  it("IPv4 → text（修复前 phone，phone 兜底陷阱）", () => {
    expect(detectScalar("192.168.1.1")).toBe("text");
  });

  it("非法日期 2024.13.45 → text（修复前 phone）", () => {
    expect(detectScalar("2024.13.45")).toBe("text");
  });

  it("data: 伪协议 → text（修复前 inferType 会判 mSelect）", () => {
    expect(detectScalar("data:text/html,x")).toBe("text");
  });

  it("anchor HTML 提取 href 保留 url 判定", () => {
    expect(detectScalar('<a href="https://a.com">x</a>')).toBe("url");
    expect(detectScalar('<a href="https://x.com/report.pdf">r</a>')).toBe("url");
  });

  it("反例护栏：'1.2.3' / 'Hello.World' → text", () => {
    expect(detectScalar("1.2.3")).toBe("text");
    expect(detectScalar("Hello.World")).toBe("text");
  });
});

describe("F inferType 列级推断", () => {
  it.each([
    [["1,000", "2,000", "3,000"], "number"],
    [["$3.5", "$4.5", "$5.5"], "number"],
    [["1.5", "2.75", "3.14", "4.0"], "number"],
  ])("数值形态列 %j → number", (vals, type) => {
    expect(inferType(vals)).toBe(type);
  });

  it("反例护栏：['Hello, world','Hi, there'] 仍必须是 mSelect（真多选不被数值规则误伤）", () => {
    expect(inferType(["Hello, world", "Hi, there"])).toBe("mSelect");
  });

  it.each([
    [["example.com", "a.io"], "url"],
    [["2024-01-01", "2024-02-01"], "date"],
    [["Alpha", "Beta"], "select"],
    [["是", "否"], "checkbox"],
  ])("列 %j → %s", (vals, type) => {
    expect(inferType(vals)).toBe(type);
  });
});
