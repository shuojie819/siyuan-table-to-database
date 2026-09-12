/* ============================================================
 * test/sql-batch-and-fallback.test.js
 * 覆盖 P0 修复 ⑤：readAV 主列块内容解析——优先 /api/query/sql 批量，
 * 用「调用计数器」证明批量确实生效（getBlockInfo 调用为 0），
 * 并验证 SQL 不可用时自动降级逐行 getBlockInfo（行为不回退）。
 * ============================================================ */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readAV } from "../src/import/targetDb.js";

function fakeResp(body, status = 200, statusText = "OK") {
  return { ok: status >= 200 && status < 300, status, statusText, text: async () => body };
}

// AV JSON：仅含 block 主列，值只有 id（无 content）→ 触发 unresolved 分支
function avWithBlocks(ids) {
  return {
    spec: 5,
    id: "av",
    name: "DB",
    keyValues: [
      { key: { id: "k-block", name: "Name", type: "block" }, values: ids.map((id) => ({ block: { id } })) },
    ],
  };
}

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; });

describe("⑤ readAV 主列解析：SQL 批量优先", () => {
  it("SQL 可用 → existingPrimary 正确填充，且 getBlockInfo 调用次数为 0（批量硬证据）", async () => {
    const ids = ["b0", "b1", "b2"];
    const calls = { sql: 0, blockInfo: 0, getFile: 0 };
    global.fetch = async (path) => {
      if (path === "/api/file/getFile") { calls.getFile++; return fakeResp(JSON.stringify(avWithBlocks(ids))); }
      if (path === "/api/query/sql") { calls.sql++; return fakeResp(JSON.stringify({ code: 0, data: ids.map((id) => ({ id, content: "C-" + id })) })); }
      if (path === "/api/block/getBlockInfo") { calls.blockInfo++; return fakeResp(JSON.stringify({ code: 0, data: { content: "X" } })); }
      return fakeResp("{}");
    };
    const av = await readAV("av", "blk");
    expect(av.existingPrimary).toEqual(["C-b0", "C-b1", "C-b2"]);
    expect(calls.sql).toBe(1);        // 一次批量
    expect(calls.blockInfo).toBe(0);  // 未触发逐行回退
  });

  it("SQL 返回 {code:1} → 自动降级 getBlockInfo，且结果仍然正确", async () => {
    const ids = ["b0", "b1"];
    const calls = { sql: 0, blockInfo: 0 };
    global.fetch = async (path, init) => {
      if (path === "/api/file/getFile") return fakeResp(JSON.stringify(avWithBlocks(ids)));
      if (path === "/api/query/sql") { calls.sql++; return fakeResp(JSON.stringify({ code: 1, msg: "SQL disabled" })); }
      if (path === "/api/block/getBlockInfo") {
        calls.blockInfo++;
        const body = JSON.parse(init.body);
        return fakeResp(JSON.stringify({ code: 0, data: { content: "C-" + body.id } }));
      }
      return fakeResp("{}");
    };
    const av = await readAV("av", "blk");
    expect(av.existingPrimary).toEqual(["C-b0", "C-b1"]);
    expect(calls.sql).toBe(1);
    expect(calls.blockInfo).toBe(2); // 降级确实发生
  });

  it("SQL 请求本身抛错（HTTP 500）→ 同样降级，不崩", async () => {
    const ids = ["b0"];
    let blockInfo = 0;
    global.fetch = async (path) => {
      if (path === "/api/file/getFile") return fakeResp(JSON.stringify(avWithBlocks(ids)));
      if (path === "/api/query/sql") return fakeResp("", 500, "Server Error"); // resp.ok=false → api() 抛错
      if (path === "/api/block/getBlockInfo") { blockInfo++; return fakeResp(JSON.stringify({ code: 0, data: { content: "C-b0" } })); }
      return fakeResp("{}");
    };
    const av = await readAV("av", "blk");
    expect(av.existingPrimary).toEqual(["C-b0"]);
    expect(blockInfo).toBe(1);
  });

  it("边界：未决主列 > 500 → SQL 分批（600 个 → 2 批）且结果完整", async () => {
    const ids = Array.from({ length: 600 }, (_, i) => "b" + i);
    const calls = { sql: 0 };
    global.fetch = async (path) => {
      if (path === "/api/file/getFile") return fakeResp(JSON.stringify(avWithBlocks(ids)));
      if (path === "/api/query/sql") { calls.sql++; return fakeResp(JSON.stringify({ code: 0, data: ids.map((id) => ({ id, content: "C-" + id })) })); }
      return fakeResp("{}");
    };
    const av = await readAV("av", "blk");
    expect(calls.sql).toBe(2); // ceil(600 / 500)
    expect(av.existingPrimary.length).toBe(600);
    expect(av.existingPrimary[599]).toBe("C-b599");
  });
});
