/* ============================================================
 * test/preview-dedup-equivalence.test.js
 * 覆盖 P0 修复 ⑥：renderPreview 去重数据从「逐行重建 Set/targetToSrc」提升到循环外只建一次。
 * 这是纯性能重构，验收标准是「与旧实现输出完全等价」+「Set 构造次数不随行数增长」。
 *
 * 等价证明方法：在本文件中内联一个「朴素参照实现」（Set / targetToSrc 每行重建的 O(n×m)
 * 版本，即重构前的行为），用同一份 existing + 同一份行数据分别跑 real / naive，
 * 断言两者产出的 HTML 字符串逐字节相等。
 * ============================================================ */

import { describe, it, expect } from "vitest";
import { ImportWizard } from "../src/import/ImportWizard.js";
import { escapeHtml, buildRowKey, I18N } from "../src/common.js";

const t = (k, fb) => (I18N[k] != null ? I18N[k] : (fb != null ? fb : k));

function makeWizard({ sourceType = "markdown", previewLimit = 10, dedupeStrategy = "row" } = {}) {
  const w = new ImportWizard();
  w.sourceType = sourceType;
  w.previewLimit = previewLimit;
  w.dedupeStrategy = dedupeStrategy;
  return w;
}

// 朴素参照实现：与 ImportWizard.renderPreview 同逻辑，但把 Set / targetToSrc 放回每行重建。
function naiveRenderPreview(w, p, existing, dupMode) {
  const isCSV = w.sourceType === "csv";
  let primarySrcIndex;
  if (existing) {
    const primaryTarget = existing.columns.find((c) => c.type === "block");
    primarySrcIndex = -1;
    if (primaryTarget) {
      for (const [srcIdx, keyID] of w.matchMap.entries()) {
        if (keyID && keyID === primaryTarget.keyID) { primarySrcIndex = srcIdx; break; }
      }
    }
  } else {
    primarySrcIndex = p.primaryIndex;
  }

  const head = `<tr>${p.columns.map((c) => {
    const name = c.index === primarySrcIndex
      ? `<span class="b3-chip b3-chip--primary">${escapeHtml(c.rawName)}</span>`
      : escapeHtml(c.rawName);
    return `<th>${name}</th>`;
  }).join("")}</tr>`;

  const total = p.rows.length;
  const maxRows = Math.min(w.previewLimit, total);
  const rowsHtml = [];
  for (let i = 0; i < maxRows; i++) {
    const r = p.rows[i];
    let dup = false;
    if (dupMode === "row-dedup" && existing) {
      // —— 旧实现：每行都重建 ——
      const primaryTarget = existing.columns.find((c) => c.type === "block");
      const existingPrimarySet = new Set((existing.existingPrimary || []).map((s) => String(s).trim()));
      const existingRowHashSet = new Set(existing.rowHashes || []);
      const targetToSrc = {};
      w.matchMap.forEach((k, s) => { if (k) targetToSrc[k] = s; });
      const pIdx = primaryTarget ? targetToSrc[primaryTarget.keyID] : undefined;
      const pVal = pIdx != null ? (r[pIdx] != null ? String(r[pIdx]).trim() : "") : "";
      if (w.dedupeStrategy === "primary" && primaryTarget && pVal !== "" && existingPrimarySet.has(pVal)) dup = true;
      else if (w.dedupeStrategy === "row" && existingRowHashSet.has(buildRowKey(r, existing, targetToSrc, isCSV))) dup = true;
    }
    const cells = p.columns.map((c) => `<td>${w.previewValue(r[c.index], c.type, isCSV)}</td>`).join("");
    rowsHtml.push(`<tr class="${dup ? "iw-dup" : ""}">${cells}</tr>`);
  }

  let more = `<div style="color:#999;font-size:12px;margin-top:6px;">${escapeHtml(t("previewRows", "预览 {n} 行").replace("{n}", maxRows))} / ${total}</div>`;
  if (maxRows < total) {
    more += `<div style="display:flex;gap:6px;margin-top:6px;">
        <button class="b3-button" data-act="show-more">${escapeHtml(t("showMore", "显示更多"))}</button>
        <button class="b3-button" data-act="show-all">${escapeHtml(t("showAll", "全部显示"))}</button>
      </div>`;
  }
  return `<div class="iw-section-title">${escapeHtml(t("dataPreview", "数据预览"))}</div>
      <table>${head}${rowsHtml.join("")}</table>${more}`;
}

function makeDedupFixture() {
  const parsed = {
    columns: [
      { index: 0, rawName: "Name", type: "text" },
      { index: 1, rawName: "Num", type: "number" },
    ],
    rows: [["Row 1", "007"], ["Row 2", "1.50"], ["Row 3", "1e3"], ["Row 4", "nope"]],
    primaryIndex: 0,
  };
  const existing = {
    avID: "av",
    blockID: "blk",
    columns: [
      { keyID: "k-block", name: "Name", type: "block" },
      { keyID: "k-num", name: "Num", type: "number" },
    ],
    existingPrimary: ["Row 1", "Row 3"],
    // 目标侧已存行 key：Row1 数值 007→7；Row3 数值 1e3→1000
    rowHashes: ["Row 1\u00017", "Row 3\u00011000"],
  };
  const matchMap = new Map([[0, "k-block"], [1, "k-num"]]);
  return { parsed, existing, matchMap };
}

describe("⑥ 预览去重重构：与朴素 O(n×m) 参照实现输出完全等价", () => {
  it("row 策略：HTML 逐字节相等，且 iw-dup 行数符合语义预期", () => {
    const { parsed, existing, matchMap } = makeDedupFixture();
    const w = makeWizard({ dedupeStrategy: "row" });
    w.parsed = parsed; w.matchMap = matchMap; w.existing = existing;

    const real = w.renderPreview(parsed, existing, "row-dedup");
    const ref = naiveRenderPreview(w, parsed, existing, "row-dedup");

    expect(real).toBe(ref);
    // 语义：Row1(007→7)、Row3(1e3→1000) 命中存量 → 2 行标 iw-dup；Row2/Row4 不命中
    expect([...real.matchAll(/<tr class="iw-dup">/g)].length).toBe(2);
  });

  it("primary 策略：同样逐字节等价", () => {
    const { parsed, existing, matchMap } = makeDedupFixture();
    const w = makeWizard({ dedupeStrategy: "primary" });
    w.parsed = parsed; w.matchMap = matchMap; w.existing = existing;

    expect(w.renderPreview(parsed, existing, "row-dedup")).toBe(naiveRenderPreview(w, parsed, existing, "row-dedup"));
  });

  it("非去重模式（step3a，existing=null）：等价", () => {
    const { parsed, matchMap } = makeDedupFixture();
    const w = makeWizard();
    w.parsed = parsed; w.matchMap = matchMap;

    expect(w.renderPreview(parsed, null, "row")).toBe(naiveRenderPreview(w, parsed, null, "row"));
  });
});

describe("⑥ 性能证据：Set 构造次数不随行数增长", () => {
  function countSets(fn) {
    const RealSet = globalThis.Set;
    let n = 0;
    class CountingSet extends RealSet { constructor(...a) { super(...a); n++; } }
    globalThis.Set = CountingSet;
    try { fn(); } finally { globalThis.Set = RealSet; }
    return n;
  }

  function bigFixture(rows) {
    const parsed = {
      columns: [
        { index: 0, rawName: "Name", type: "text" },
        { index: 1, rawName: "Num", type: "number" },
      ],
      rows: Array.from({ length: rows }, (_, i) => ["Row " + i, String(i)]),
      primaryIndex: 0,
    };
    const existing = {
      avID: "av",
      blockID: "blk",
      columns: [
        { keyID: "k-block", name: "Name", type: "block" },
        { keyID: "k-num", name: "Num", type: "number" },
      ],
      existingPrimary: ["Row 0"],
      rowHashes: ["Row 0\u00010"],
    };
    const matchMap = new Map([[0, "k-block"], [1, "k-num"]]);
    return { parsed, existing, matchMap };
  }

  it("renderPreview：10 行与 500 行的 Set 构造次数相同（去重数据在循环外只建一次）", () => {
    const run = (n) => {
      const { parsed, existing, matchMap } = bigFixture(n);
      const w = makeWizard({ previewLimit: n, dedupeStrategy: "row" });
      w.parsed = parsed; w.matchMap = matchMap; w.existing = existing;
      return countSets(() => w.renderPreview(parsed, existing, "row-dedup"));
    };
    const c10 = run(10);
    const c500 = run(500);
    expect(c10).toBe(c500);
    expect(c500).toBeLessThanOrEqual(4); // 仅 existingPrimarySet / rowHashSet 两个
  });

  it("对照：朴素参照实现的 Set 构造次数随行数线性增长（证明其为 O(n×m)）", () => {
    const run = (n) => {
      const { parsed, existing, matchMap } = bigFixture(n);
      const w = makeWizard({ previewLimit: n, dedupeStrategy: "row" });
      w.parsed = parsed; w.matchMap = matchMap; w.existing = existing;
      return countSets(() => naiveRenderPreview(w, parsed, existing, "row-dedup"));
    };
    expect(run(500)).toBeGreaterThan(run(10));
  });
});
