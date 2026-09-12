/* ============================================================
 * test/smoke.test.js — vitest 基建冒烟用例
 *
 * 目的：验证测试基建可用——
 *   1) resolve.alias 把 `siyuan` 解析到 test/stubs/siyuan.js；
 *   2) src/common.js 能被 happy-dom 环境导入并使用。
 * 回归用例由 QA 在 test/ 下另行编写。
 * ============================================================ */

import { describe, it, expect } from "vitest";
import * as siyuan from "siyuan";
import { detectScalar, canonRawCell, canonValueCell } from "../src/common.js";

describe("vitest 基建自检", () => {
  it("siyuan 别名解析到本地 stub", () => {
    expect(typeof siyuan.showMessage).toBe("function");
    expect(typeof siyuan.Dialog).toBe("function");
    expect(typeof siyuan.Plugin).toBe("function");
    expect(typeof siyuan.Menu).toBe("function");
  });

  it("common.js 可导入且基础类型推断可用", () => {
    expect(typeof detectScalar).toBe("function");
    expect(detectScalar("example.com")).toBe("url");
    // number 归一：源侧与目标侧严格一致（P0 缺陷③）
    expect(canonRawCell("007", "number")).toBe(canonValueCell({ number: { content: 7 } }, "number"));
  });
});
