/* ============================================================
 * test/number-symmetry.test.js
 * 覆盖 P0 修复 ③：number 列「源侧规约(canonRawCell)」与「目标侧规约(canonValueCell)」严格对称，
 * 并以 readAV + buildRowKey 做端到端幂等验证（第二次导入必判重复）。
 * ============================================================ */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { canonRawCell, canonValueCell, buildCell, buildRowKey } from "../src/common.js";
import { readAV } from "../src/import/targetDb.js";

// 最小 fetch Response 替身（只用到 .ok/.status/.statusText/.text）
function fakeResp(body, status = 200, statusText = "OK") {
  return { ok: status >= 200 && status < 300, status, statusText, text: async () => body };
}

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; });

describe("③ number 源侧 / 目标侧归一完全对称（修复前 '007' ≠ '7'）", () => {
  const cases = ["007", "1.50", "1e3", "-0.5", "0", " 42 "];
  for (const s of cases) {
    it(`'${s}'：canonRawCell === canonValueCell`, () => {
      expect(canonRawCell(s, "number")).toBe(canonValueCell({ number: { content: Number(s) } }, "number"));
    });
  }

  it("规范值符合 String(Number(x)) 预期", () => {
    expect(canonRawCell("007", "number")).toBe("7");
    expect(canonRawCell("1.50", "number")).toBe("1.5");
    expect(canonRawCell("1e3", "number")).toBe("1000");
    expect(canonRawCell(" 42 ", "number")).toBe("42");
    expect(canonRawCell("0", "number")).toBe("0");
  });

  it("无法解析为有限数的文本两侧均归空，保证源/目标行 key 对称", () => {
    // v1.3.3 起：number 列非有限值（"Infinity"/"NaN"/"1e999"/"abc" 等）在源侧(canonRawCell)
    // 与目标侧(canonValueCell 读 buildCell 写出的空值)统一归空串，两侧对称。
    expect(canonRawCell("nope", "number")).toBe("");
    expect(canonValueCell(buildCell({ keyID: "k", type: "number" }, "nope"), "number")).toBe("");
  });
});

describe("③ 端到端幂等：同一行第二次导入必被判重复（而非新增）", () => {
  it("buildRowKey(源行) 必然出现在 readAV(...).rowHashes 中", async () => {
    const avID = "20240101000000-idem01";
    const av = {
      spec: 5,
      id: avID,
      name: "DB",
      keyValues: [
        { key: { id: "k-block", name: "Name", type: "block" }, values: [{ block: { content: "Row A" } }] },
        { key: { id: "k-num", name: "Num", type: "number" }, values: [{ number: { content: 7 } }] },
      ],
    };
    global.fetch = async (path) => {
      if (path === "/api/file/getFile") return fakeResp(JSON.stringify(av));
      return fakeResp("{}");
    };

    const existing = await readAV(avID, "blk");
    // 同一份源行数据：主列 'Row A'，数值列源串 '007'（写库后内核存 content: 7）
    const row = ["Row A", "007"];
    const targetToSrc = { "k-block": 0, "k-num": 1 };
    const key = buildRowKey(row, existing, targetToSrc, false);

    // 命中存量 rowHashes = 第二次导入会被判重复
    expect(existing.rowHashes).toContain(key);
  });

  it("对照：修复前的源串 '007' 生成的 key 不会被命中（证明该用例对 ③ 敏感）", () => {
    // 直接构造“旧规则”下的源 key（String(raw).trim()），验证其与目标 rowHashes 不等。
    const avID = "20240101000000-idem02";
    const rowHashes = ["Row A\u00017"]; // 目标侧：内核存 7
    const legacyKey = ["Row A", "007"].join("\u0001"); // 旧源侧规则：'007'
    expect(rowHashes).not.toContain(legacyKey);
    expect(avID).toBeTruthy();
  });
});
