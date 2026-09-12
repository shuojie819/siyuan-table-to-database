/* ============================================================
 * test/regression-v133-url-safety.test.js
 * 覆盖 v1.3.3 修复 ⑤：安全（a）safeHref 协议白名单、(b) escapeHtml 转义、
 * 以及 (c) 预览渲染层 previewValue 对 url 列的 <a> 产出契约。
 *
 * 修复前会失败 / 缺失：safeHref 未做协议白名单时，javascript:/data: 等伪协议会被
 * 直接拼进 <a href>，形成 XSS。此处把白名单与降级行为固化为回归护栏。
 * ============================================================ */

import { describe, it, expect } from "vitest";
import { safeHref, escapeHtml } from "../src/common.js";
import { ImportWizard } from "../src/import/ImportWizard.js";

describe("⑤ safeHref：裸域名补协议 / 白名单协议原样", () => {
  it.each([
    ["example.com", "https://example.com"],
    ["a.io/path?q=1", "https://a.io/path?q=1"],
    ["https://x.com", "https://x.com"],
    ["http://x.com", "http://x.com"],
    ["ftp://x.com", "ftp://x.com"],
    ["//host/x", "//host/x"],
  ])("safeHref('%s') → '%s'", (input, out) => {
    expect(safeHref(input)).toBe(out);
  });

  it("空值 → null", () => {
    expect(safeHref("")).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref("   ")).toBeNull();
  });
});

describe("⑤ safeHref：危险 / 非白名单协议必须为 null", () => {
  it.each([
    ["javascript:alert(1)"],
    ["javascript:alert.com"],
    ["data:text/html,x"],
    ["vbscript:x"],
    ["mailto:a@b.com"],
  ])("safeHref('%s') → null", (input) => {
    expect(safeHref(input)).toBeNull();
  });
});

describe("⑤ escapeHtml：HTML 特殊字符转义", () => {
  it("& < > \" ' 全部转义", () => {
    expect(escapeHtml("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("普通文本 / 中文 / 数字保持原样", () => {
    expect(escapeHtml("abc 中文 123")).toBe("abc 中文 123");
  });
});

describe("⑤ 预览渲染层：url 列仅对白名单协议产出 <a>", () => {
  it("example.com → <a href=\"https://example.com\" ...>example.com</a>", () => {
    const w = new ImportWizard();
    const html = w.previewValue("example.com", "url");
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain(">example.com</a>");
  });

  it("javascript: 伪协议 → 不产出 <a>，降级为纯文本", () => {
    const w = new ImportWizard();
    const html = w.previewValue("javascript:alert(1)", "url");
    expect(html).not.toContain("<a ");
    expect(html).toBe("javascript:alert(1)");
  });

  it("危险输入中的 HTML 特殊字符同时被转义（证明降级路径走 escapeHtml）", () => {
    const w = new ImportWizard();
    const html = w.previewValue("javascript:alert('<b>')", "url");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });
});
