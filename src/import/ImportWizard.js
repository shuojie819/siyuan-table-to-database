/* ============================================================
 * ImportWizard.js — 导入向导容器（多步 Dialog 状态机）
 *
 * 步骤：Step1 数据源 → Step2 方式 → Step3a 新库（列映射+预览） / Step3b 旧库（列匹配+增量预览）
 * 布局：左侧配置 + 右侧预览（Notion 式），复用思源原生 Dialog + b3-* 工具类 + 原生 DOM。
 * 不引入 React/MUI（保持单文件 bundle）。
 * ============================================================ */

import { Dialog, showMessage } from "siyuan";
import {
  I18N, FIELD_TYPES, typeLabel, escapeHtml, parseFlexibleDateToMs,
  getCurrentBlockId, getBlockInfo, MSELECT_SPLIT_RE,
  captureCurrentAnchor, buildRowKey,
} from "../common";
import { parseCsv, parseMarkdown, reapplyHeader } from "./parsers";
import { computeColumnOptions, setPrimary, autoMatch, computeIncremental } from "./columnMap";
import { listExistingAVs, readAV } from "./targetDb";
import { writeNewDb } from "./newDbWriter";
import { appendToExisting } from "./existingDbWriter";

const t = (k, fb) => (I18N[k] != null ? I18N[k] : (fb != null ? fb : k));

const CSS = `
.iw-root { display:flex; flex-direction:column; height:100%; }
.iw-steps { display:flex; gap:8px; padding:12px 16px; border-bottom:1px solid var(--b3-border-color); font-size:12px; color:var(--b3-theme-on-surface); }
.iw-steps .iw-step { opacity:.5; }
.iw-steps .iw-step.active { opacity:1; font-weight:600; color:var(--b3-theme-primary); }
.iw-body { flex:1; display:flex; gap:16px; min-height:0; padding:16px; }
.iw-left { flex:1; overflow:auto; }
.iw-right { flex:1; overflow:auto; border-left:1px solid var(--b3-border-color); padding-left:16px; }
/* 预览步骤（Step3a/3b）：左侧列映射 / 右侧数据预览，右侧占比更大（约 70%） */
.iw-body.iw-body--preview .iw-left { flex:3; }
.iw-body.iw-body--preview .iw-right { flex:7; }
.iw-footer { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-top:1px solid var(--b3-border-color); gap:8px; }
.iw-card { border:1px solid var(--b3-border-color); border-radius:8px; padding:14px; margin-bottom:12px; cursor:pointer; transition:.15s; }
.iw-card:hover { border-color:var(--b3-theme-primary); }
.iw-card.iw-card--active { border-color:var(--b3-theme-primary); background:var(--b3-theme-primary-lightest, rgba(127,127,127,.06)); }
.iw-card-title { font-weight:600; margin-bottom:8px; }
.iw-textarea { width:100%; min-height:140px; resize:vertical; font-family:monospace; }
.iw-fileinfo { margin-top:8px; color:var(--b3-theme-primary); font-size:12px; }
.iw-dropzone.iw-drag { border-color:var(--b3-theme-primary); background:rgba(127,127,127,.08); }
.iw-row-info { color:#999; font-size:12px; margin-bottom:10px; }
.iw-section-title { font-weight:600; margin:14px 0 8px; }
/* 单列映射行：单行三区域（左=列名框→类型下拉，右=主列按钮/标签），与转换预览一致 */
.iw-colrow { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:6px 0; padding:2px 0; }
/* 左侧容器：列名框 + 箭头 + 类型下拉，紧凑靠左；flex:1 收缩时列名框不溢出 */
.iw-colrow-left { display:flex; align-items:center; gap:8px; flex:1 1 auto; min-width:0; }
/* 列名框：88px 边框盒子，单行省略，悬停 title 显示全名（编辑态 input 复用同款样式，保留列名可改名） */
.iw-colname { display:inline-block; width:88px; padding:2px 8px; border:1px solid var(--b3-border-color); border-radius:4px; background:var(--b3-theme-surface-light,#f5f5f5); color:var(--b3-theme-on-surface); font-size:13px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; vertical-align:middle; }
/* 指向箭头（列名 → 类型下拉） */
.iw-arrow { flex:0 0 auto; color:var(--b3-theme-on-surface-light,#999); font-size:13px; padding:0 4px; }
/* 类型下拉紧凑固定宽度（88px），与转换预览保持一致 */
.iw-coltype { width:88px; flex-shrink:0; }
/* 右侧主列只读标签 */
.iw-primary-tag { flex:0 0 auto; color:var(--b3-theme-primary); font-weight:600; }
/* 右侧「设为主列」按钮 */
.iw-setprimary { flex:0 0 auto; white-space:nowrap; }
.iw-matchrow { display:flex; align-items:center; gap:8px; margin:8px 0; }
.iw-preview table { border-collapse:collapse; width:100%; font-size:12px; }
.iw-preview th, .iw-preview td { border:1px solid var(--b3-border-color); padding:4px 8px; text-align:left; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.iw-preview th { background:var(--b3-theme-background); position:sticky; top:0; }
.iw-preview tr.iw-dup td { color:#bbb; text-decoration:line-through; }
.b3-chip { display:inline-block; padding:0 6px; border-radius:10px; background:var(--b3-theme-primary-lightest, rgba(127,127,127,.12)); font-size:11px; margin:1px 2px; }
.iw-stat { background:var(--b3-theme-background); border:1px solid var(--b3-border-color); border-radius:8px; padding:12px; margin-bottom:12px; }
.iw-stat .iw-num { font-size:20px; font-weight:700; color:var(--b3-theme-primary); }
.iw-radio { display:block; margin:6px 0; }
.iw-status { color:var(--b3-theme-primary); font-size:12px; }
`;

export class ImportWizard {
  constructor() {
    this.step = "1";
    this.sourceType = null;       // "csv" | "markdown"
    this.fileName = "";
    this.rawText = "";
    this.rawName = "Markdown 表格";
    this.parsed = null;
    this.parseError = null;
    this.firstRowAsHeader = true;

    this.mode = null;             // "new" | "existing"
    this.dbName = "";
    this.insertPosition = "cursor"; // 默认光标位置
    this.existingList = [];
    this.existingListLoaded = false;
    this.selectedAvID = null;
    this.existing = null;
    this.matchMap = new Map();
    this.dedupeStrategy = "row";  // 默认整行去重

    this.dialog = null;
    this.root = null;

    // 数据预览显示行数（初始 10 行，可通过「显示更多」/「全部显示」按钮增加）
    this.previewLimit = 10;

    // 向导打开（焦点被抢走之前）锁定的插入锚点，避免后续无法再定位当前文档/光标（Bug #1）
    this.anchorBlockId = null;  // 「光标位置」锚块（previousID）
    this.lastBlockId = null;     // 「文档末尾」锚块（previousID）
    this.anchorRootID = "";      // 锚块所在文档的 rootID（与锚块同文档，用于刷新/跨文档检测）
  }

  open() {
    const Dlg = Dialog;
    this.dialog = new Dlg({
      title: t("importData", "导入数据"),
      width: "1066px",
      height: "720px",
      content: `<style>${CSS}</style><div class="iw-root"></div>`,
    });
    this.root = this.dialog.element.querySelector(".iw-root");
    this.render();
  }

  close() {
    if (this.dialog) this.dialog.destroy();
    this.dialog = null;
  }

  // 由当前 step 重新渲染整个向导
  render() {
    if (!this.root) return;
    const stepsHtml = this.renderSteps();
    let bodyHtml = "";
    let footerHtml = "";
    if (this.step === "1") { bodyHtml = this.renderStep1(); footerHtml = this.renderFooter1(); }
    else if (this.step === "2") { bodyHtml = this.renderStep2(); footerHtml = this.renderFooter2(); }
    else if (this.step === "3a") { bodyHtml = this.renderStep3a(); footerHtml = this.renderFooter3a(); }
    else if (this.step === "3b") { bodyHtml = this.renderStep3b(); footerHtml = this.renderFooter3b(); }

    const isPreviewStep = this.step === "3a" || this.step === "3b";
    this.root.innerHTML = `<div class="iw-steps">${stepsHtml}</div><div class="iw-body${isPreviewStep ? " iw-body--preview" : ""}">${bodyHtml}</div><div class="iw-footer">${footerHtml}</div>`;
    this.bind();
  }

  renderSteps() {
    const labels = {
      "1": t("uploadCsv", "数据源"),
      "2": t("createNewDatabase", "导入方式"),
      "3a": t("columnMapping", "列映射"),
      "3b": t("targetColumn", "列匹配"),
    };
    const order = ["1", "2", "3a", "3b"];
    return order.map((s) => {
      // 在「旧库匹配」步骤隐藏「新库列映射」标签，避免重复
      if (this.step === "3b" && s === "3a") return "";
      const active = this.step === s ? " active" : "";
      return `<span class="iw-step${active}">${labels[s]}</span>`;
    }).join('<span>›</span>');
  }

  // ---------- Step1：数据源 ----------
  renderStep1() {
    const left = `
      <div class="iw-card ${this.sourceType === "csv" ? "iw-card--active" : ""}" data-source="csv">
        <div class="iw-card-title">${escapeHtml(t("uploadCsv", "上传 CSV 文件"))}</div>
        <input type="file" accept=".csv,.txt" class="iw-file" />
        <div class="iw-fileinfo">${this.fileName ? escapeHtml(this.fileName) : ""}</div>
        <div class="iw-dropzone" style="margin-top:8px;padding:10px;border:1px dashed var(--b3-border-color);border-radius:6px;color:#999;font-size:12px;text-align:center;">${escapeHtml(t("dragCsvHere", "可将 CSV 文件拖拽到此处"))}</div>
      </div>
      <div class="iw-card ${this.sourceType === "markdown" ? "iw-card--active" : ""}" data-source="markdown">
        <div class="iw-card-title">${escapeHtml(t("pasteMarkdown", "粘贴 Markdown 表格"))}</div>
        <textarea class="iw-textarea b3-text-field" placeholder="${escapeHtml(t("pasteMarkdownPh", "在此粘贴 Markdown 表格…"))}">${escapeHtml(this.rawText)}</textarea>
        <div style="margin-top:8px;"><button class="b3-button b3-button--text" data-act="paste-clipboard">${escapeHtml(t("pasteFromClipboard", "从剪贴板粘贴"))}</button></div>
      </div>`;

    let right = `<div style="color:#999;">${escapeHtml(t("importDataDesc", "从 CSV 文件或 Markdown 表格创建/更新数据库"))}</div>`;
    if (this.parsed) {
      const s = this.parsed.stats;
      right += `<div class="iw-stat">
        <div>${escapeHtml(t("dataPreview", "数据预览"))}</div>
        <div>${escapeHtml(t("totalRows", "总行数"))}：<b>${s.totalRows}</b> ｜ ${escapeHtml(t("totalCols", "总列数"))}：<b>${s.totalCols}</b></div>
        <div>${escapeHtml(t("validRows", "有效行数"))}：<b>${s.validRows}</b> ｜ ${escapeHtml(t("emptyRows", "空行数"))}：<b>${s.emptyRows}</b></div>
      </div>`;
    }
    if (this.parseError) {
      right += `<div class="iw-status">${escapeHtml(t("parseError", "解析失败："))}${escapeHtml(this.parseError)}</div>`;
    }
    return `<div class="iw-left">${left}</div><div class="iw-right">${right}</div>`;
  }

  renderFooter1() {
    return `<div></div><div>
      <button class="b3-button b3-button--cancel" data-act="cancel">${escapeHtml(t("cancel", "取消"))}</button>
      <button class="b3-button b3-button--text" data-act="next">${escapeHtml(t("nextStep", "下一步"))}</button>
    </div>`;
  }

  // ---------- Step2：方式 ----------
  renderStep2() {
    const newCard = `
      <div class="iw-card ${this.mode === "new" ? "iw-card--active" : ""}" data-mode="new">
        <div class="iw-card-title">${escapeHtml(t("createNewDatabase", "创建新数据库"))}</div>
        <div style="color:#999;font-size:12px;">${escapeHtml(t("createNewDatabaseDesc", "从 CSV/Markdown 数据创建新的 Attribute View 数据库。"))}</div>
        ${this.mode === "new" ? `
          <div class="iw-section-title">${escapeHtml(t("databaseName", "数据库名称"))}</div>
          <input class="b3-text-field" data-act="dbname" value="${escapeHtml(this.dbName)}" style="width:100%;" />
          <div class="iw-section-title">${escapeHtml(t("insertPosition", "插入位置"))}</div>
          <select class="b3-select" data-act="position" style="width:100%;">
            <option value="cursor" ${this.insertPosition === "cursor" ? "selected" : ""}>${escapeHtml(t("insertAtCursor", "光标位置"))}</option>
            <option value="end" ${this.insertPosition === "end" ? "selected" : ""}>${escapeHtml(t("insertAtEnd", "文档末尾"))}</option>
          </select>
        ` : ""}
      </div>`;

    let existingInner = `<div class="iw-card-title">${escapeHtml(t("importExistingDatabase", "导入已有数据库"))}</div>
      <div style="color:#999;font-size:12px;">${escapeHtml(t("importExistingDatabaseDesc", "将数据追加/合并到当前文档中已有的数据库。"))}</div>`;
    if (this.mode === "existing") {
      if (!this.existingListLoaded) {
        existingInner += `<div class="iw-status">${escapeHtml(t("loading", "加载中…"))}</div>`;
      } else if (this.existingList.length === 0) {
        existingInner += `<div class="iw-status">${escapeHtml(t("noExistingDb", "当前文档没有已存在的数据库"))}</div>`;
      } else {
        const opts = `<option value="">${escapeHtml(t("selectTargetDatabase", "选择目标数据库"))}</option>` +
          this.existingList.map((d) => `<option value="${d.avID}" ${d.avID === this.selectedAvID ? "selected" : ""}>${escapeHtml(d.name)}</option>`).join("");
        existingInner += `<div class="iw-section-title">${escapeHtml(t("selectTargetDatabase", "选择目标数据库"))}</div>
          <select class="b3-select" data-act="target" style="width:100%;">${opts}</select>`;
      }
    }
    const existingCard = `<div class="iw-card ${this.mode === "existing" ? "iw-card--active" : ""}" data-mode="existing">${existingInner}</div>`;

    const right = `<div class="iw-stat">
      <div>${escapeHtml(t("dataPreview", "数据预览"))}</div>
      <div>${escapeHtml(t("totalRows", "总行数"))}：<b>${this.parsed ? this.parsed.stats.totalRows : 0}</b> ｜ ${escapeHtml(t("totalCols", "总列数"))}：<b>${this.parsed ? this.parsed.stats.totalCols : 0}</b></div>
    </div>`;

    return `<div class="iw-left">${newCard}${existingCard}</div><div class="iw-right">${right}</div>`;
  }

  renderFooter2() {
    return `<button class="b3-button b3-button--cancel" data-act="prev">${escapeHtml(t("prevStep", "上一步"))}</button>
      <div>
        <button class="b3-button b3-button--cancel" data-act="cancel">${escapeHtml(t("cancel", "取消"))}</button>
        <button class="b3-button b3-button--text" data-act="next">${escapeHtml(t("nextStep", "下一步"))}</button>
      </div>`;
  }

  // ---------- Step3a：新库列映射 + 预览 ----------
  renderStep3a() {
    const p = this.parsed;
    const headerToggle = `
      <label class="iw-radio"><input type="checkbox" data-act="header-toggle" ${this.firstRowAsHeader ? "checked" : ""}/> ${escapeHtml(t("firstRowAsHeader", "将第一行用作标题"))}</label>`;

    const cols = p.columns.map((col) => {
      const isPrimary = col.index === p.primaryIndex;
      const typeOptions = FIELD_TYPES.map((ty) =>
        `<option value="${ty}" ${ty === col.type ? "selected" : ""}>${escapeHtml(typeLabel(ty))}</option>`).join("");
      // 单行三区域：左=列名框(→)类型下拉，右=主列标签/按钮；与转换预览布局一致，不跨行、不显示推断类型
      const left = `
        <div class="iw-colrow-left">
          <input class="b3-text-field iw-colname" data-col-name="${col.index}" value="${escapeHtml(col.rawName)}" title="${escapeHtml(col.rawName)}" />
          <span class="iw-arrow">→</span>
          ${isPrimary ? "" : `<select class="b3-select iw-coltype" data-col-type="${col.index}">${typeOptions}</select>`}
        </div>`;
      const right = isPrimary
        ? `<span class="iw-primary-tag">${escapeHtml(t("primaryColumn", "主列（标题）"))}</span>`
        : `<button class="b3-button b3-button--text iw-setprimary" data-set-primary="${col.index}">${escapeHtml(t("setAsPrimary", "设为主列"))}</button>`;
      return `<div class="iw-colrow">${left}${right}</div>`;
    }).join("");

    const left = `<div class="iw-section-title">${escapeHtml(t("columnMapping", "列映射"))}</div>
      ${headerToggle}
      <div class="iw-row-info">${escapeHtml(t("primaryHint", "第一列默认为主列，可点击「设为主列」切换。"))}</div>
      ${cols}`;

    const right = this.renderPreview(p, null, "row");

    return `<div class="iw-left">${left}</div><div class="iw-right iw-preview">${right}</div>`;
  }

  renderFooter3a() {
    return `<button class="b3-button b3-button--cancel" data-act="prev">${escapeHtml(t("prevStep", "上一步"))}</button>
      <div>
        <button class="b3-button b3-button--cancel" data-act="cancel">${escapeHtml(t("cancel", "取消"))}</button>
        <button class="b3-button b3-button--text" data-act="import">${escapeHtml(t("import", "导入"))}</button>
      </div>`;
  }

  // ---------- Step3b：旧库列匹配 + 增量预览 ----------
  renderStep3b() {
    const p = this.parsed;
    const ex = this.existing;
    const matchRows = p.columns.map((col) => {
      const current = this.matchMap.get(col.index) || "";
      const opts = `<option value="">${escapeHtml(t("ignoreColumn", "不导入/忽略"))}</option>` +
        ex.columns.map((tc) => `<option value="${tc.keyID}" ${tc.keyID === current ? "selected" : ""}>${escapeHtml(tc.name)} (${escapeHtml(typeLabel(tc.type))})</option>`).join("");
      return `<div class="iw-matchrow">
        <span class="iw-src" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(col.rawName)}</span>
        <span class="iw-arrow">→</span>
        <select class="b3-select iw-matchsel" data-match="${col.index}" style="flex:1.4;">${opts}</select>
      </div>`;
    }).join("");

    const dedupe = ["row", "primary", "none"].map((val) => {
      const label = val === "row" ? t("dedupeByRow", "按整行去重")
        : val === "primary" ? t("dedupeByPrimary", "按主列去重")
        : t("noDedupe", "不去重，全部追加");
      return `<label class="iw-radio"><input type="radio" name="dedupe" value="${val}" ${val === this.dedupeStrategy ? "checked" : ""}/> ${escapeHtml(label)}</label>`;
    }).join("");

    const left = `<div class="iw-section-title">${escapeHtml(t("targetColumn", "目标列匹配"))}</div>
      ${matchRows}
      <div class="iw-section-title">${escapeHtml(t("deduplication", "去重策略"))}</div>
      ${dedupe}`;

    const inc = computeIncremental(p, ex, this.matchMap, this.dedupeStrategy);
    const stat = `<div class="iw-stat">
      <div>${escapeHtml(t("newRows", "新增 {n} 行").replace("{n}", inc.newRows))}</div>
      <div>${escapeHtml(t("duplicateRows", "重复 {n} 行").replace("{n}", inc.duplicateRows))}（${escapeHtml(t("skipHint", "将跳过"))}）</div>
      <div>${escapeHtml(t("unmatchedSource", "未匹配源列数"))}：<b>${inc.unmatchedSource}</b> ｜ ${escapeHtml(t("unmatchedTarget", "未匹配目标列数"))}：<b>${inc.unmatchedTarget}</b></div>
      ${inc.skippedEmptyPrimary > 0 ? `<div>${escapeHtml(t("emptyPrimary", "主列为空，已跳过 {n} 行").replace("{n}", inc.skippedEmptyPrimary))}</div>` : ""}
    </div>`;

    const right = stat + this.renderPreview(p, ex, "row-dedup");

    return `<div class="iw-left">${left}</div><div class="iw-right iw-preview">${right}</div>`;
  }

  renderFooter3b() {
    return `<button class="b3-button b3-button--cancel" data-act="prev">${escapeHtml(t("prevStep", "上一步"))}</button>
      <div>
        <button class="b3-button b3-button--cancel" data-act="cancel">${escapeHtml(t("cancel", "取消"))}</button>
        <button class="b3-button b3-button--text" data-act="import">${escapeHtml(t("import", "导入"))}</button>
      </div>`;
  }

  // 右侧预览（通用）。dupMode: null | "row" | "row-dedup"
  renderPreview(p, existing, dupMode) {
    const head = `<tr>${p.columns.map((c) => `<th>${escapeHtml(c.rawName)}</th>`).join("")}</tr>`;
    const total = p.rows.length;
    const maxRows = Math.min(this.previewLimit, total);
    const rowsHtml = [];
    for (let i = 0; i < maxRows; i++) {
      const r = p.rows[i];
      let dup = false;
      if (dupMode === "row-dedup" && existing) {
        // 仅作展示：重新判定该行是否重复
        const primaryTarget = existing.columns.find((c) => c.type === "block");
        const existingPrimarySet = new Set((existing.existingPrimary || []).map((s) => String(s).trim()));
        const existingRowHashSet = new Set(existing.rowHashes || []);
        const targetToSrc = {};
        this.matchMap.forEach((k, s) => { if (k) targetToSrc[k] = s; });
        const pIdx = primaryTarget ? targetToSrc[primaryTarget.keyID] : undefined;
        const pVal = pIdx != null ? (r[pIdx] != null ? String(r[pIdx]).trim() : "") : "";
        if (this.dedupeStrategy === "primary" && primaryTarget && pVal !== "" && existingPrimarySet.has(pVal)) dup = true;
        else if (this.dedupeStrategy === "row" && existingRowHashSet.has(buildRowKey(r, existing, targetToSrc))) dup = true;
      }
      const cells = p.columns.map((c) => `<td>${this.previewValue(r[c.index], c.type)}</td>`).join("");
      rowsHtml.push(`<tr class="${dup ? "iw-dup" : ""}">${cells}</tr>`);
    }
    // 行数信息
    let more = `<div style="color:#999;font-size:12px;margin-top:6px;">${escapeHtml(t("previewRows", "预览 {n} 行").replace("{n}", maxRows))} / ${total}</div>`;
    // 「显示更多」和「全部显示」按钮（仅当还有未显示的行时）
    if (maxRows < total) {
      const remaining = total - maxRows;
      more += `<div style="display:flex;gap:6px;margin-top:6px;">
        <button class="b3-button" data-act="show-more">${escapeHtml(t("showMore", "显示更多"))}</button>
        <button class="b3-button" data-act="show-all">${escapeHtml(t("showAll", "全部显示"))}</button>
      </div>`;
    }
    return `<div class="iw-section-title">${escapeHtml(t("dataPreview", "数据预览"))}</div>
      <table>${head}${rowsHtml.join("")}</table>${more}`;
  }

  previewValue(v, type) {
    const s = v == null ? "" : String(v);
    switch (type) {
      case "checkbox": {
        const checked = ["true", "✓", "✔", "☑", "是", "1", "yes", "y"].includes(s.toLowerCase().trim());
        return `<span style="color:${checked ? "var(--b3-theme-primary)" : "var(--b3-theme-on-surface)"}">${checked ? "✓" : "✗"}</span>`;
      }
      case "select":
        return s ? `<span class="b3-chip">${escapeHtml(s)}</span>` : "";
      case "mSelect": {
        const parts = s.split(MSELECT_SPLIT_RE).map((x) => x.trim()).filter(Boolean);
        return parts.map((p) => `<span class="b3-chip">${escapeHtml(p)}</span>`).join(" ");
      }
      case "date": {
        const ms = parseFlexibleDateToMs(s);
        const txt = isNaN(ms) ? s : new Date(ms).toLocaleDateString();
        return `<span class="b3-chip b3-chip--primary">${escapeHtml(txt)}</span>`;
      }
      case "url":
        return s ? `<a href="${escapeHtml(s)}" target="_blank" rel="noopener">${escapeHtml(s)}</a>` : "";
      default:
        return escapeHtml(s);
    }
  }

  // ---------- 事件绑定 ----------
  bind() {
    const root = this.root;
    // 通用底部按钮
    root.querySelectorAll("[data-act]").forEach((el) => {
      const act = el.getAttribute("data-act");
      if (act === "cancel") el.onclick = () => this.close();
      else if (act === "next") el.onclick = () => this.onNext();
      else if (act === "prev") el.onclick = () => this.onPrev();
      else if (act === "import") el.onclick = () => this.onImport();
    });

    if (this.step === "1") this.bindStep1();
    else if (this.step === "2") this.bindStep2();
    else if (this.step === "3a") this.bindStep3a();
    else if (this.step === "3b") this.bindStep3b();
  }

  bindStep1() {
    const root = this.root;
    root.querySelectorAll(".iw-card[data-source]").forEach((card) => {
      card.onclick = (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "BUTTON") return;
        this.sourceType = card.getAttribute("data-source");
        this.render();
      };
    });

    const fileInput = root.querySelector(".iw-file");
    if (fileInput) {
      fileInput.onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        this.fileName = file.name;
        this.rawName = file.name.replace(/\.[^.]+$/, "");
        try {
          const text = await file.text();
          this.sourceType = "csv";
          this.parseAndSet(text, "csv");
        } catch (err) {
          this.parsed = null;
          this.parseError = (err && err.message) || String(err);
          showMessage(t("fileReadError", "文件读取失败：") + this.parseError);
        }
        this.render();
      };
    }

    const dropzone = root.querySelector(".iw-dropzone");
    if (dropzone) {
      const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
      dropzone.ondragover = (ev) => { stop(ev); dropzone.classList.add("iw-drag"); };
      dropzone.ondragleave = (ev) => { stop(ev); dropzone.classList.remove("iw-drag"); };
      dropzone.ondrop = async (ev) => {
        stop(ev);
        dropzone.classList.remove("iw-drag");
        const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
        if (!file) return;
        this.fileName = file.name;
        this.rawName = file.name.replace(/\.[^.]+$/, "");
        try {
          const text = await file.text();
          this.sourceType = "csv";
          this.parseAndSet(text, "csv");
        } catch (err) {
          this.parsed = null;
          this.parseError = (err && err.message) || String(err);
          showMessage(t("fileReadError", "文件读取失败：") + this.parseError);
        }
        this.render();
      };
    }

    const ta = root.querySelector(".iw-textarea");
    if (ta) {
      ta.oninput = (e) => { this.rawText = e.target.value; this.sourceType = "markdown"; };
    }

    const pasteBtn = root.querySelector('[data-act="paste-clipboard"]');
    if (pasteBtn) {
      pasteBtn.onclick = async () => {
        try {
          const text = await navigator.clipboard.readText();
          this.rawText = text;
          this.sourceType = "markdown";
          this.render();
        } catch (err) {
          showMessage(t("clipboardFail", "无法读取剪贴板：") + ((err && err.message) || err));
        }
      };
    }
  }

  bindStep2() {
    const root = this.root;
    root.querySelectorAll(".iw-card[data-mode]").forEach((card) => {
      card.onclick = (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "BUTTON") return;
        this.mode = card.getAttribute("data-mode");
        if (this.mode === "new" && !this.dbName) this.dbName = this.parsed.rawName || "数据库";
        if (this.mode === "existing" && !this.existingListLoaded) {
          this.render(); // 先渲染出「加载中…」
          this.loadExistingList();
          return;
        }
        this.render();
      };
    });
    const dbName = root.querySelector('[data-act="dbname"]');
    if (dbName) dbName.oninput = (e) => { this.dbName = e.target.value; };
    const pos = root.querySelector('[data-act="position"]');
    if (pos) pos.onchange = (e) => { this.insertPosition = e.target.value; };
    const target = root.querySelector('[data-act="target"]');
    if (target) {
      target.onchange = async (e) => {
        this.selectedAvID = e.target.value || null;
        this.existing = null;
        if (this.selectedAvID) {
          try {
            this.existing = await readAV(this.selectedAvID, this.getBlockIDByAv(this.selectedAvID));
            this.matchMap = autoMatch(this.parsed.columns, this.existing.columns);
          } catch (err) {
            showMessage((err && err.message) || String(err));
            this.existing = null;
          }
        }
        this.render();
      };
    }
  }

  bindStep3a() {
    const root = this.root;
    const headerToggle = root.querySelector('[data-act="header-toggle"]');
    if (headerToggle) {
      headerToggle.onchange = (e) => {
        this.firstRowAsHeader = e.target.checked;
        this.parsed = reapplyHeader(this.parsed, this.firstRowAsHeader);
        this.render();
      };
    }
    root.querySelectorAll('[data-col-name]').forEach((inp) => {
      inp.onchange = (e) => {
        const idx = Number(e.target.getAttribute("data-col-name"));
        this.parsed.columns[idx].rawName = e.target.value;
      };
    });
    root.querySelectorAll('[data-col-type]').forEach((sel) => {
      sel.onchange = (e) => {
        const idx = Number(e.target.getAttribute("data-col-type"));
        const ty = e.target.value;
        this.parsed.columns[idx].type = ty;
        if (ty === "select" || ty === "mSelect") {
          const colVals = this.parsed.rows.map((r) => (r[idx] != null ? r[idx] : ""));
          this.parsed.columns[idx].options = computeColumnOptions(colVals, ty);
        } else {
          this.parsed.columns[idx].options = [];
        }
        this.render();
      };
    });
    root.querySelectorAll('[data-set-primary]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute("data-set-primary"));
        setPrimary(this.parsed, idx);
        this.render();
      };
    });
    // 预览「显示更多」/「全部显示」按钮
    this.bindPreviewButtons(root);
  }

  bindStep3b() {
    const root = this.root;
    root.querySelectorAll('[data-match]').forEach((sel) => {
      sel.onchange = (e) => {
        const idx = Number(e.target.getAttribute("data-match"));
        const val = e.target.value || null;
        if (val) this.matchMap.set(idx, val);
        else this.matchMap.set(idx, null);
        this.render();
      };
    });
    root.querySelectorAll('input[name="dedupe"]').forEach((radio) => {
      radio.onchange = (e) => {
        if (e.target.checked) { this.dedupeStrategy = e.target.value; this.render(); }
      };
    });
    // 预览「显示更多」/「全部显示」按钮
    this.bindPreviewButtons(root);
  }

  // 预览「显示更多」/「全部显示」按钮绑定
  bindPreviewButtons(root) {
    root.querySelectorAll('[data-act="show-more"]').forEach((btn) => {
      btn.onclick = () => {
        this.previewLimit += 10;
        this.render();
      };
    });
    root.querySelectorAll('[data-act="show-all"]').forEach((btn) => {
      btn.onclick = () => {
        this.previewLimit = this.parsed.rows.length;
        this.render();
      };
    });
  }

  // ---------- 流程控制 ----------
  parseAndSet(text, source) {
    try {
      const parsed = source === "csv"
        ? parseCsv(text, { firstRowAsHeader: this.firstRowAsHeader, rawName: this.rawName })
        : parseMarkdown(text, { firstRowAsHeader: this.firstRowAsHeader, rawName: this.rawName });
      this.parsed = parsed;
      this.parseError = null;
    } catch (e) {
      this.parsed = null;
      this.parseError = (e && e.message) ? e.message : String(e);
    }
  }

  onNext() {
    if (this.step === "1") {
      if (!this.sourceType) { showMessage(t("selectSource", "请先选择数据源")); return; }
      if (this.sourceType === "csv") {
        if (!this.parsed) {
          showMessage(this.parseError ? (t("parseError", "解析失败：") + this.parseError) : t("uploadCsvFirst", "请先选择 CSV 文件"));
          return;
        }
      } else {
        if (!this.rawText || !this.rawText.trim()) { showMessage(t("pasteMarkdownFirst", "请先粘贴 Markdown 表格")); return; }
        this.parseAndSet(this.rawText, "markdown");
        if (!this.parsed) { showMessage(t("parseError", "解析失败：") + (this.parseError || "")); return; }
      }
      if (this.parsed.columns.length === 0) { showMessage(t("noColumns", "未能识别到任何列")); return; }
      if (this.parsed.rows.length === 0) {
        showMessage(this.parsed.firstRowAsHeader ? t("onlyHeaderRow", "只有表头，没有数据行") : t("noDataRows", "没有可导入的数据行"));
        return;
      }
      if (!this.dbName) this.dbName = this.parsed.rawName || "数据库";
      this.step = "2";
      if (this.mode === "existing" && !this.existingListLoaded) this.loadExistingList();
      this.render();
    } else if (this.step === "2") {
      if (!this.mode) { showMessage(t("selectMode", "请选择导入方式")); return; }
      if (this.mode === "new") {
        if (!this.dbName || !this.dbName.trim()) { showMessage(t("dbNameRequired", "请填写数据库名称")); return; }
        this.step = "3a";
        this.render();
      } else {
        if (!this.existingListLoaded) { this.loadExistingList(); return; }
        if (this.existingList.length === 0) { showMessage(t("noExistingDb", "当前文档没有已存在的数据库")); return; }
        if (!this.selectedAvID || !this.existing) { showMessage(t("selectTargetDatabase", "请选择目标数据库")); return; }
        this.step = "3b";
        this.render();
      }
    }
  }

  onPrev() {
    if (this.step === "2") { this.step = "1"; this.render(); }
    else if (this.step === "3a" || this.step === "3b") { this.step = "2"; this.render(); }
  }

  async loadExistingList() {
    try {
      // 传入向导打开时锁定的文档 rootID，确保枚举「当前文档」而非 .layout__wnd--active 指向的其它文档
      // （多文档/分屏下「未命名」可能是活动窗口，旧逻辑会错列到它）。rootID 为空时回退旧逻辑。
      this.existingList = await listExistingAVs({ rootID: this.anchorRootID || undefined });
    } catch (e) {
      this.existingList = [];
      console.warn("[import] 枚举已有数据库失败", e);
    }
    this.existingListLoaded = true;
    if (this.step === "2") this.render();
  }

  getBlockIDByAv(avID) {
    const found = this.existingList.find((d) => d.avID === avID);
    return found ? found.blockID : avID;
  }

  // 锁定当前文档与光标（在编辑器仍持有焦点/选区时调用，见 openImportWizard）。
  // 用 captureCurrentAnchor 一次性取出「光标块 + 末块 + rootID」，三者均来自同一 protyle（同文档），
  // 避免分别调用 getCurrentBlockId/getLastBlockId 时因焦点丢失而取到不同文档。
  captureAnchor() {
    try {
      const a = captureCurrentAnchor();
      this.anchorBlockId = a.anchorBlockId || null;
      this.lastBlockId = a.lastBlockId || null;
      this.anchorRootID = a.rootID || "";
      console.log("[import] 锁定插入锚点：", {
        anchorBlockId: this.anchorBlockId,
        lastBlockId: this.lastBlockId,
        rootID: this.anchorRootID,
      });
    } catch (_) { /* 忽略定位失败 */ }
  }

  getImportAnchor() {
    // 「文档末尾」：用打开向导前锁定的当前文档末块；
    // 无锁定时返回 null，交由 onImport 明确报错，绝不静默落到别的文档。
    if (this.insertPosition === "end") {
      return this.lastBlockId || null;
    }
    // 「光标位置」：优先用打开向导前锁定的光标块（与用户发起导入那一刻所在文档一致）；
    // 其次用实时选区（用户仍在编辑区内）；均失败则返回 null，交由 onImport 给出明确报错。
    if (this.anchorBlockId) return this.anchorBlockId;
    const live = getCurrentBlockId();
    if (live) return live;
    return null;
  }

  async onImport() {
    try {
      // 记录「发起导入那一刻」所在文档的 rootID（向导打开前已锁定，来自标题块 data-node-id，
      // 同步、可靠），用于跨文档极端情况检测与刷新目标文档。
      const anchorRootID = this.anchorRootID || "";

      if (this.step === "3a") {
        showMessage(t("importing", "导入中…"));
        const fields = this.parsed.columns.map((col) => ({
          name: col.rawName,
          type: col.type,
          options: col.options || [],
          colIndex: col.index,
          isPrimary: col.index === this.parsed.primaryIndex,
        }));
        const anchor = this.getImportAnchor();
        if (!anchor) {
          // 明确报错，而不是静默落到一个错误文档（Bug #1 兜底要求）
          throw new Error(t("noAnchor", "无法确定插入位置：请先在目标文档中点击光标，再打开导入向导。"));
        }
        console.log("[import] 导入（新库）→ 插入位置锚点：", { previousID: anchor, rootID: anchorRootID });
        const res = await writeNewDb(this.parsed, fields, {
          insertAfterId: anchor,
          dbName: this.dbName,
          // 显式传入锚点文档 rootID，确保刷新落在正确文档（不再依赖插入后回查）
          rootID: anchorRootID || undefined,
        });
        await this.showImportResult(res, anchorRootID);
      } else if (this.step === "3b") {
        showMessage(t("importing", "导入中…"));
        const res = await appendToExisting(this.parsed, this.existing, this.matchMap, this.dedupeStrategy, {});
        await this.showImportResult(res, anchorRootID);
      }
    } catch (e) {
      console.error("[import]", e);
      showMessage(t("importFail", "导入失败：") + ((e && e.message) ? e.message : e));
    }
  }

  // 导入成功后：明确提示（文档名 + 位置）+ 自动定位到新数据库块（滚动居中并高亮）
  async showImportResult(res, anchorRootID = "") {
    const avID = res.avID;
    const blockID = res.blockID || avID;

    // 1) 基础统计提示
    let msg = t("importSuccess", "导入成功：共 {rows} 行 / {cols} 列")
      .replace("{rows}", res.rows).replace("{cols}", res.cols);
    if (res.skipped) msg += " " + t("skippedInfo", "（已跳过 {n} 个空行）").replace("{n}", res.skipped);
    if (res.skippedEmptyPrimary) msg += " " + t("emptyPrimary", "主列为空，已跳过 {n} 行").replace("{n}", res.skippedEmptyPrimary);
    if (res.dupCount) msg += " " + t("duplicateRows", "重复 {n} 行").replace("{n}", res.dupCount) + t("skipHint", "（已跳过）");
    if (res.failureCells) msg += " " + t("typeMismatchCells", "（{n} 个单元格因类型不匹配被跳过）").replace("{n}", res.failureCells);

    // 2) 取新建块所在文档的标题（明确提示「创建于哪篇文档」）
    let docTitle = "";
    let rootID = "";
    try {
      const info = await getBlockInfo(blockID);
      rootID = (info && info.rootID) ? info.rootID : "";
      if (rootID && rootID !== blockID) {
        const rootInfo = await getBlockInfo(rootID);
        docTitle = (rootInfo && rootInfo.name) ? rootInfo.name : "";
      }
    } catch (_) { /* 忽略定位失败 */ }

    // 3) 位置描述
    let where = "";
    if (this.mode === "new") {
      where = this.insertPosition === "cursor"
        ? t("insertedAtCursor", "已插入到当前光标位置")
        : t("createdAtDocEnd", "已创建于文档末尾");
    } else {
      where = t("appendedToExistingDb", "已追加到已有数据库");
    }
    let locMsg = where;
    if (docTitle) locMsg += t("inDoc", "，于《{doc}》").replace("{doc}", docTitle);

    // 4) 跨文档极端情况：额外给出可点击的 siyuan:// 跳转链接
    let finalMsg = msg + " " + locMsg;
    const crossDoc = !!(anchorRootID && rootID && anchorRootID !== rootID);
    if (crossDoc) {
      finalMsg += "  siyuan://block/" + blockID + " " + t("clickToJump", "（点击链接可跳转）");
    }

    // 先关闭弹窗、露出编辑器，再提示 + 定位（提示与定位互不阻塞）
    this.close();
    showMessage(finalMsg, 8000);
    this.locateBlock(blockID, avID);
  }

  // 等待新块渲染进 DOM 后滚动居中并高亮（弹窗已关闭，编辑器可见）。
  // 新建库时编辑器 reload 是异步的，故需轮询等待，最多 5 秒。
  locateBlock(blockID, avID) {
    if (!blockID) return;
    const deadline = Date.now() + 5000;
    const attempt = () => {
      let el = document.querySelector(`[data-node-id="${blockID}"]`);
      if (!el && avID) el = document.querySelector(`[data-av-id="${avID}"]`);
      if (el) {
        this.focusBlock(el);
        return;
      }
      if (Date.now() < deadline) setTimeout(attempt, 150);
    };
    attempt();
  }

  // 滚动到可见区域并临时高亮，提示用户新数据库块的位置
  focusBlock(el) {
    this.ensureHighlightStyle();
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (_) { /* 忽略滚动失败 */ }
    try {
      el.classList.add("iw-imported-block");
      setTimeout(() => {
        try { el.classList.remove("iw-imported-block"); } catch (_) {}
      }, 1600);
    } catch (_) { /* 忽略高亮失败 */ }
  }

  // 全局注入高亮样式：dialog 关闭后其内联 <style> 随 DOM 移除，故需常驻 head 才能呈现高亮
  ensureHighlightStyle() {
    if (document.getElementById("iw-imported-block-style")) return;
    const st = document.createElement("style");
    st.id = "iw-imported-block-style";
    st.textContent = `
.iw-imported-block {
  outline: 2px solid var(--b3-theme-primary);
  outline-offset: 2px;
  border-radius: 4px;
  animation: iw-imported-flash 1.6s ease-out;
}
@keyframes iw-imported-flash {
  0% { background: var(--b3-theme-primary-lightest, rgba(127,127,127,.12)); }
  100% { background: transparent; }
}`;
    document.head.appendChild(st);
  }
}

// 入口：打开导入向导
// presetAnchor：调用方在「菜单打开前、编辑器仍持有选区/焦点」时锁定的锚点
//   { anchorBlockId, lastBlockId, rootID }（由 common.captureCurrentAnchor 产生）。
//   顶栏菜单路径务必传此值——因为菜单打开即抢走编辑器焦点，届时再定位会错指到其它文档（Bug #1 真正根因）。
//   命令/快捷键路径可不传（此时编辑器仍有焦点，openImportWizard 内部即时捕获即可）。
export function openImportWizard(presetAnchor) {
  const w = new ImportWizard();
  if (presetAnchor && (presetAnchor.anchorBlockId || presetAnchor.lastBlockId || presetAnchor.rootID)) {
    // 使用调用方在焦点丢失前已锁定的锚点（最可靠）
    w.anchorBlockId = presetAnchor.anchorBlockId || null;
    w.lastBlockId = presetAnchor.lastBlockId || null;
    w.anchorRootID = presetAnchor.rootID || "";
    console.log("[import] 使用调用方预设锚点：", {
      anchorBlockId: w.anchorBlockId,
      lastBlockId: w.lastBlockId,
      rootID: w.anchorRootID,
    });
  } else {
    // 命令/快捷键路径：弹窗打开前立即捕获（此时编辑器仍持有焦点，选区有效）
    w.captureAnchor();
  }
  w.open();
}
