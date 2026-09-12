/* ============================================================
 * test/regression-v133-robustness-i18n.test.js
 * 覆盖 v1.3.3 修复 ⑦：健壮性与 i18n
 *   (a) api()/putFile() 收到 HTTP 200 + 非 JSON body 时抛出「非 JSON 响应」并带请求路径，
 *       而非裸 SyntaxError（修复前 JSON.parse 直接抛 SyntaxError，无法定位接口）；
 *   (b) generateBlockId() 形态 = 14 位时间戳 + '-' + 7 位随机后缀（防同秒碰撞）；
 *   (c) i18n/zh_CN.json 与 en_US.json 键集合完全一致且都含 defaultDBName。
 * ============================================================ */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { api, putFile, generateBlockId } from "../src/common.js";

function fakeResp(body, status = 200, statusText = "OK") {
  return { ok: status >= 200 && status < 300, status, statusText, text: async () => body };
}

async function catchErr(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; });

describe("⑦ api()：HTTP 200 + 非 JSON → 明确报错（含路径），非裸 SyntaxError", () => {
  it("抛『非 JSON 响应』并包含请求路径", async () => {
    global.fetch = async () => fakeResp("<html>oops</html>", 200);
    const err = await catchErr(() => api("/api/av/foo", {}));
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("非 JSON 响应");
    expect(err.message).toContain("/api/av/foo");
    expect(err.message).not.toMatch(/SyntaxError/);
  });
});

describe("⑦ putFile()：HTTP 200 + 非 JSON → 明确报错（含文件路径）", () => {
  it("抛『非 JSON 响应』并包含文件 path", async () => {
    global.fetch = async () => fakeResp("oops-not-json", 200);
    const target = "/data/storage/av/x.json";
    const err = await catchErr(() => putFile(target, "{}"));
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("非 JSON 响应");
    expect(err.message).toContain(target);
    expect(err.message).not.toMatch(/SyntaxError/);
  });
});

describe("⑦ generateBlockId：形态与防碰撞", () => {
  it("匹配 /^\\d{14}-[a-z0-9]{7}$/", () => {
    expect(generateBlockId()).toMatch(/^\d{14}-[a-z0-9]{7}$/);
  });

  it("连续 200 次调用产生 > 1 个不同值（随机后缀降低同秒碰撞）", () => {
    const set = new Set();
    for (let i = 0; i < 200; i++) set.add(generateBlockId());
    expect(set.size).toBeGreaterThan(1);
  });
});

describe("⑦ i18n：双语键集合一致", () => {
  const load = (name) => {
    // vitest 的 cwd 为项目根；happy-dom 的全局 URL 对 file: 解析不可靠，故用 process.cwd()。
    const p = resolve(process.cwd(), "i18n", `${name}.json`);
    return JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  };

  it("zh_CN 与 en_US 均含 defaultDBName", () => {
    expect(load("zh_CN")).toHaveProperty("defaultDBName");
    expect(load("en_US")).toHaveProperty("defaultDBName");
  });

  it("两文件 key 集合完全一致（缺失 / 多余均报）", () => {
    const zh = Object.keys(load("zh_CN")).sort();
    const en = Object.keys(load("en_US")).sort();
    expect(zh).toEqual(en);
  });
});
