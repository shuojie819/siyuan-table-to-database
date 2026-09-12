/* ============================================================
 * test/release-artifacts-png.test.js
 * 覆盖 v1.3.3 修复 ①（发版阻断项 / 门禁）：preview.png 与 icon.png 必须是「真 PNG」。
 *
 * 背景（修复前会失败）：这两张图曾被 Git 大文件代理（LFS / 占位文件）替换成文本指针，
 * 文件不再是 PNG 二进制，导致思源集市发布被阻断。此文件的断言即为该阻断项的防回归护栏：
 *   1) 前 8 字节必须等于 PNG 魔数 89 50 4E 47 0D 0A 1A 0A；
 *   2) 体积不得超过集市规则上限（preview.png ≤ 512 KiB，icon.png ≤ 64 KiB）。
 * 同时校验 dist/ 内的同名副本（随 zip 发布），防止只修根目录、漏修打包产物。
 * ============================================================ */

import { describe, it, expect } from "vitest";
import { readFileSync, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// vitest 的 cwd 为项目根。注意：happy-dom 环境下的全局 URL 对 file: 解析不可靠，
// 故此处不用 import.meta.url，直接用 process.cwd()（= 项目根）拼绝对路径。
const rootPath = (name) => resolve(process.cwd(), name);

// PNG 签名：89 50 4E 47 0D 0A 1A 0A
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function magic8(file) {
  return readFileSync(rootPath(file)).subarray(0, 8);
}

describe("① 发版门禁：PNG 资产真实性（魔数）", () => {
  it.each([
    ["preview.png"],
    ["icon.png"],
    ["dist/preview.png"],
    ["dist/icon.png"],
  ])("%s 存在且前 8 字节为 PNG 魔数", (file) => {
    expect(existsSync(rootPath(file))).toBe(true);
    expect(Buffer.compare(magic8(file), PNG_MAGIC)).toBe(0);
  });

  it("反证：把文本前 8 字节与 PNG 魔数比较必然不等（证明魔数断言对伪 PNG 敏感）", () => {
    const fake = Buffer.from("<html>not a png at all");
    expect(Buffer.compare(fake.subarray(0, 8), PNG_MAGIC)).not.toBe(0);
  });
});

describe("① 发版门禁：资产体积上限", () => {
  it("preview.png ≤ 512 KiB", () => {
    expect(statSync(rootPath("preview.png")).size).toBeLessThanOrEqual(512 * 1024);
  });

  it("icon.png ≤ 64 KiB", () => {
    expect(statSync(rootPath("icon.png")).size).toBeLessThanOrEqual(64 * 1024);
  });
});
