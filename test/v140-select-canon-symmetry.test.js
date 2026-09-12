/* ============================================================
 * test/v140-select-canon-symmetry.test.js
 * v1.4.0 select 列 canon 对称（改动 E）：两侧都 trim + lowercase，**不切分**。
 *
 * 修复前会失败：
 *   - 源侧 lower、目标侧未 lower（"Alpha" vs 选项 "Alpha"）→ 大小写不对称；
 *   - 或把 "Hong Kong" 过度归一为 "hong,kong"（与 "Hong,Kong" 混同）。
 * 修复后：select 视为单值 → 整值 trim+lowercase 后归一，不按逗号/空格切分。
 * ============================================================ */

import { describe, it, expect } from "vitest";
import { canonRawCell, canonValueCell } from "../src/common.js";

describe("E select 列 canon 对称（整值 trim + lowercase，不切分）", () => {
  it("canonRawCell('Alpha','select') === 'alpha'", () => {
    expect(canonRawCell("Alpha", "select")).toBe("alpha");
  });

  it("源侧 === 目标侧（{mSelect:[{content:'Alpha'}]}）", () => {
    expect(canonRawCell("Alpha", "select")).toBe(
      canonValueCell({ mSelect: [{ content: "Alpha" }] }, "select")
    );
  });

  it("'Hong Kong' → 'hong kong'（不得变成 'hong,kong'，本轮特意收敛掉的过度归一）", () => {
    expect(canonRawCell("Hong Kong", "select")).toBe("hong kong");
  });

  it("'B,A' → 'b,a'（select 不切分）", () => {
    expect(canonRawCell("B,A", "select")).toBe("b,a");
  });

  it("大小写对称：源 'ALPHA' 与目标选项 'Alpha' 得到同一 key", () => {
    expect(canonRawCell("ALPHA", "select")).toBe(
      canonValueCell({ mSelect: [{ content: "Alpha" }] }, "select")
    );
  });
});
