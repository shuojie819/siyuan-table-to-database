/* ============================================================
 * test/v140-mselect-cross-source-dedup.test.js
 * v1.4.0 B5 跨源 isCSV 去重失效修复（改动 D，方案 C：去重归一与 isCSV 解耦）。
 *
 * 场景：库中已由 CSV 写入形态存入 3 个标签（AI / Agent / 知识库）；
 *       再用 Markdown（isCSV=false）把整段 "AI Agent 知识库" 作为 1 个标签导入。
 *
 * 修复前：源 key = "ai agent 知识库"，目标 key = "知识库,agent,ai" → 整行 key 不一致
 *         → 判为新增（newRows===1）→ 重复插入。
 * 修复后：去重 key 恒定按最细粒度切分（与 isCSV 解耦）→ 判重复（duplicateRows===1, newRows===0）。
 *
 * 注意：写入形态不受影响——buildCell(mSelect,…,isCSV=false) 仍写单个选项（Markdown 路径不变）。
 * ============================================================ */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { canonRawCell, canonValueCell, buildCell } from "../src/common.js";
import { computeIncremental } from "../src/import/columnMap.js";
import { appendToExisting } from "../src/import/existingDbWriter.js";
import { readAV } from "../src/import/targetDb.js";

function fakeResp(body, status = 200, statusText = "OK") {
  return { ok: status >= 200 && status < 300, status, statusText, text: async () => body };
}

const S = "AI Agent 知识库";
const STORED = { mSelect: [{ content: "AI" }, { content: "Agent" }, { content: "知识库" }] };

describe("D B5 跨源 mSelect 去重归一（与 isCSV 解耦）", () => {
  it("源整段 vs 目标三标签 → 同一去重 key（修复前 'ai agent 知识库' ≠ '知识库,agent,ai'）", () => {
    expect(canonRawCell(S, "mSelect", false)).toBe(
      canonValueCell(STORED, "mSelect", [], false)
    );
  });

  it("canonRawCell(S,'mSelect',true) === canonRawCell(S,'mSelect',false)（去重 key 与 isCSV 无关）", () => {
    expect(canonRawCell(S, "mSelect", true)).toBe(canonRawCell(S, "mSelect", false));
  });

  it("写入形态不变：buildCell(mSelect, S, false).mSelect.length === 1（Markdown 路径仍写单个选项）", () => {
    const cell = buildCell({ keyID: "k", type: "mSelect" }, S, false);
    expect(cell.mSelect.length).toBe(1);
    expect(cell.mSelect[0].content).toBe(S);
  });
});

// —— 端到端 fixture：库中已存 CSV 写入形态（3 标签），以 isCSV=false（Markdown）再导入 ——
const avJson = {
  spec: 5,
  id: "av-b5",
  name: "库",
  keyValues: [
    { key: { id: "k-block", name: "Name", type: "block" }, values: [{ block: { content: "Row A" } }] },
    { key: { id: "k-tags", name: "Tags", type: "mSelect", options: [] }, values: [STORED] },
  ],
};

const parsed = {
  columns: [
    { index: 0, rawName: "Name", type: "block" },
    { index: 1, rawName: "Tags", type: "mSelect" },
  ],
  rows: [["Row A", S]],
  primaryIndex: 0,
  stats: { totalRows: 1, totalCols: 2, validRows: 1, emptyRows: 0 },
};
const matchMap = new Map([[0, "k-block"], [1, "k-tags"]]);

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; });

describe("D 端到端：跨源重复行必须被判重复（修复前 newRows===1）", () => {
  it("computeIncremental(isCSV=false) → duplicateRows 1 / newRows 0", async () => {
    global.fetch = async (path) =>
      path === "/api/file/getFile"
        ? fakeResp(JSON.stringify(avJson))
        : fakeResp(JSON.stringify({ code: 0, data: {} }));

    const existing = await readAV("av-b5", "blk-1", false);
    const inc = computeIncremental(parsed, existing, matchMap, "row", false);
    expect(inc.duplicateRows).toBe(1);
    expect(inc.newRows).toBe(0);
  });

  it("预览一致：computeIncremental(...).duplicateRows === appendToExisting(...).dupCount", async () => {
    global.fetch = async (path) =>
      path === "/api/file/getFile"
        ? fakeResp(JSON.stringify(avJson))
        : fakeResp(JSON.stringify({ code: 0, data: {} }));

    const existing = await readAV("av-b5", "blk-1", false);
    const inc = computeIncremental(parsed, existing, matchMap, "row", false);
    const res = await appendToExisting(parsed, existing, matchMap, "row", { isCSV: false });
    expect(res.dupCount).toBe(inc.duplicateRows);
    expect(res.newCount).toBe(0);
    expect(res.rows).toBe(0);
  });
});
