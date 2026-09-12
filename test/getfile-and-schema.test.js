/* ============================================================
 * test/getfile-and-schema.test.js
 * 覆盖 P0 修复 ④：getFile 识别 /api/file/getFile 的 HTTP 202 错误信封；
 * 以及 readAV 对非法 schema(keyValues) 的显式校验（绝不静默降级为空库）。
 * ============================================================ */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getFile } from "../src/common.js";
import { readAV } from "../src/import/targetDb.js";

function fakeResp(body, status = 200, statusText = "OK") {
  return { ok: status >= 200 && status < 300, status, statusText, text: async () => body };
}

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; });

describe("④ getFile 识别 202 错误信封（修复前会被当“成功”返回，静默变空库）", () => {
  it("HTTP 202 + {code:404,msg:'',data:null} → getFile 必须抛错", async () => {
    global.fetch = async () => fakeResp(JSON.stringify({ code: 404, msg: "", data: null }), 202, "Accepted");
    await expect(getFile("/data/storage/av/x.json")).rejects.toThrow(/getFile 失败/);
  });

  it("readAV 遇到 202 信封 → 抛『目标数据库不存在』，绝不静默返回空库", async () => {
    global.fetch = async () => fakeResp(JSON.stringify({ code: 404, msg: "", data: null }), 202, "Accepted");
    await expect(readAV("20240101000000-miss", "blk")).rejects.toThrow(/目标数据库不存在/);
  });

  it("反例保护：合法 AV JSON（顶层无 code 字段）→ getFile 正常返回，不得误判", async () => {
    const body = JSON.stringify({ spec: 5, id: "x", keyValues: [] });
    global.fetch = async () => fakeResp(body);
    await expect(getFile("/data/storage/av/x.json")).resolves.toBe(body);
  });

  it("反例保护：code:0 的正常信封 → 不得被误判为错误（原样返回）", async () => {
    const body = JSON.stringify({ code: 0, msg: "", data: { a: 1 } });
    global.fetch = async () => fakeResp(body);
    await expect(getFile("/data/storage/av/x.json")).resolves.toBe(body);
  });

  it("反例保护：code 非数字（如字符串）→ 不视为信封", async () => {
    const body = JSON.stringify({ code: "404", msg: "x", data: null });
    global.fetch = async () => fakeResp(body);
    await expect(getFile("/data/storage/av/x.json")).resolves.toBe(body);
  });
});

describe("④ readAV schema 校验：keyValues 非法形态必须抛错", () => {
  const withFile = (obj) => {
    global.fetch = async (path) => (path === "/api/file/getFile" ? fakeResp(JSON.stringify(obj)) : fakeResp("{}"));
  };

  it("keyValues 为对象 {} → 抛『数据格式异常』", async () => {
    withFile({ spec: 5, id: "x", keyValues: {} });
    await expect(readAV("id", "blk")).rejects.toThrow(/数据格式异常/);
  });

  it("keyValues 为字符串 'x' → 抛『数据格式异常』", async () => {
    withFile({ spec: 5, id: "x", keyValues: "x" });
    await expect(readAV("id", "blk")).rejects.toThrow(/数据格式异常/);
  });

  it("顶层为数组 → 抛『数据格式异常』", async () => {
    withFile([1, 2, 3]);
    await expect(readAV("id", "blk")).rejects.toThrow(/数据格式异常/);
  });

  it("keyValues 缺失（undefined）→ 不抛错，按空库处理", async () => {
    withFile({ spec: 5, id: "x" });
    const av = await readAV("id", "blk");
    expect(av.columns).toEqual([]);
    expect(av.rowCount).toBe(0);
    expect(av.rowHashes).toEqual([]);
  });

  it("keyValues 为 [] → 不抛错，按空库处理", async () => {
    withFile({ spec: 5, id: "x", keyValues: [] });
    const av = await readAV("id", "blk");
    expect(av.columns).toEqual([]);
    expect(av.rowCount).toBe(0);
  });
});
