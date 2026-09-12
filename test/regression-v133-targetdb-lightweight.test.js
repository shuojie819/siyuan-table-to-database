/* ============================================================
 * test/regression-v133-targetdb-lightweight.test.js
 * 覆盖 v1.3.3 修复 ⑥：listExistingAVs 取名改走轻量 readAVMeta（不整表 readAV）；
 * 以及 readAV 新增 needRowHashes 开关（关闭时不算 rowHashes）。
 *
 * 修复前会失败：AV 块缺少 .av__title 时，旧实现为取名调用整表 readAV，
 * 当主列值只存 block.id（无 content）时会触发 /api/query/sql（甚至逐行 getBlockInfo），
 * 文档有 M 个大库时约为 O(M×N×C)，秒级卡顿。修复后仅 getFile + 解析 name。
 * ============================================================ */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { listExistingAVs, readAV, readAVMeta } from "../src/import/targetDb.js";

function fakeResp(body, status = 200, statusText = "OK") {
  return { ok: status >= 200 && status < 300, status, statusText, text: async () => body };
}

let originalFetch;
beforeEach(() => {
  originalFetch = global.fetch;
  document.body.innerHTML = "";
});
afterEach(() => {
  global.fetch = originalFetch;
  document.body.innerHTML = "";
});

// 主列值只存 block.id（无 content）→ 若走整表 readAV 会触发 /api/query/sql。
const avWithBlockIds = {
  spec: 5,
  id: "av-1",
  name: "我的库",
  keyValues: [
    { key: { id: "k-block", name: "Name", type: "block" }, values: [{ block: { id: "b1" } }] },
    { key: { id: "k-num", name: "Num", type: "number" }, values: [{ number: { content: 7, isNotEmpty: true } }] },
  ],
};

// 主列含 content（用于验证 rowHashes 正常计算）
const avWithContent = {
  spec: 5,
  id: "av-1",
  name: "我的库",
  keyValues: [
    { key: { id: "k-block", name: "Name", type: "block" }, values: [{ block: { content: "Row A" } }] },
    { key: { id: "k-num", name: "Num", type: "number" }, values: [{ number: { content: 7, isNotEmpty: true } }] },
  ],
};

function mountProtyle({ withTitle = false } = {}) {
  const titleHtml = withTitle ? '<div class="av__title"> 标题库 </div>' : "";
  document.body.innerHTML =
    '<div class="protyle">' +
    '<div class="protyle-title" data-node-id="root-1"></div>' +
    '<div class="protyle-wysiwyg">' +
    `<div data-type="NodeAttributeView" data-av-id="av-1" data-node-id="blk-1">${titleHtml}</div>` +
    "</div>" +
    "</div>";
  return document.querySelector(".protyle");
}

describe("⑥ listExistingAVs 轻量取名（不触发整表 readAV）", () => {
  it("无 .av__title → 走 getFile(readAVMeta)，不得触发 /api/query/sql 或 getBlockInfo", async () => {
    const protyle = mountProtyle();
    const calls = { getFile: 0, sql: 0, blockInfo: 0 };
    global.fetch = async (path) => {
      if (path === "/api/file/getFile") { calls.getFile++; return fakeResp(JSON.stringify(avWithBlockIds)); }
      if (path === "/api/query/sql") { calls.sql++; return fakeResp(JSON.stringify({ code: 0, data: [] })); }
      if (path === "/api/block/getBlockInfo") { calls.blockInfo++; return fakeResp(JSON.stringify({ code: 0, data: { content: "X" } })); }
      return fakeResp("{}");
    };

    const list = await listExistingAVs({ protyle });

    expect(list).toEqual([{ avID: "av-1", blockID: "blk-1", name: "我的库" }]);
    expect(calls.getFile).toBe(1); // 仅读一次 AV 文件元数据
    expect(calls.sql).toBe(0);     // 关键证据：轻量取名不整表遍历
    expect(calls.blockInfo).toBe(0);
  });

  it("有 .av__title → 直接取标题，连 getFile 都不需要", async () => {
    const protyle = mountProtyle({ withTitle: true });
    let getFile = 0;
    global.fetch = async (path) => {
      if (path === "/api/file/getFile") getFile++;
      return fakeResp("{}");
    };

    const list = await listExistingAVs({ protyle });

    expect(list[0].name).toBe("标题库");
    expect(getFile).toBe(0);
  });
});

describe("⑥ readAVMeta 只取元数据", () => {
  it("readAVMeta(getFile) → {avID, blockID, name}", async () => {
    global.fetch = async (p) => (p === "/api/file/getFile" ? fakeResp(JSON.stringify(avWithBlockIds)) : fakeResp("{}"));
    const meta = await readAVMeta("av-1", "blk-1");
    expect(meta).toEqual({ avID: "av-1", blockID: "blk-1", name: "我的库" });
  });
});

describe("⑥ readAV needRowHashes 开关", () => {
  it("needRowHashes:false → rowHashes 为 []，rowCount 仍正确", async () => {
    global.fetch = async (p) => (p === "/api/file/getFile" ? fakeResp(JSON.stringify(avWithContent)) : fakeResp("{}"));
    const av = await readAV("av-1", "blk-1", false, { needRowHashes: false });
    expect(av.rowHashes).toEqual([]);
    expect(av.rowCount).toBe(1);
  });

  it("默认调用 → rowHashes 正常计算", async () => {
    global.fetch = async (p) => (p === "/api/file/getFile" ? fakeResp(JSON.stringify(avWithContent)) : fakeResp("{}"));
    const av = await readAV("av-1", "blk-1");
    expect(av.rowHashes.length).toBe(1);
    expect(av.rowHashes[0]).toBe("Row A\u00017");
  });
});
