import { Plugin, showMessage, Dialog, Menu } from "siyuan";

/* ============================================================
 * 表格转数据库 (Table to Database)
 * 一键把思源笔记里的表格块（NodeTable）转换为数据库（属性视图 / Attribute View）块。
 *
 * 1.2.0 新增「导入数据」：从 CSV 文件或 Markdown 表格创建/更新 Attribute View 数据库。
 *   - 公共核心（API 封装、ID 生成、类型推断、单元格值构造、AV JSON 构造、写库序列）
 *     已抽取到 src/common.js，本文件与所有 import/* 子模块共享，消除循环依赖。
 *   - convertTable（现有「表格转数据库」）改为调用 common.writeNewDatabase，行为不变。
 * ============================================================ */

import {
  I18N, setI18N, writeNewDatabase,
  generateId, generateBlockId, getTimestamp, escapeHtml, typeLabel,
  inferType, buildSelectOptions, buildMSelectOptions,
  getBlockInfo, createDocHistory, removeBlock, api,
  buildCell, buildAVJson, FIELD_TYPES, MSELECT_SEP_RE, MSELECT_SPLIT_RE,
  captureCurrentAnchor, setLastFocusedProtyle, refreshAnchorBlockFromSelection,
} from "./common";
import { openImportWizard } from "./import/ImportWizard";

// ---------- 解析 DOM 表格（现有「表格转数据库」专用，保留） ----------

function cleanCell(cell) {
  // 若单元格包含超链接 <a href="...">，优先取真实 Web URL 作为推断/入库值；
  // 思源内部链接（siyuan://…）等非 Web href 回退到 textContent，避免把内部链接当 URL 值。
  const a = cell.querySelector && cell.querySelector("a[href]");
  if (a) {
    const href = (a.getAttribute("href") || "").trim();
    if (href && /^(https?:\/\/|www\.|\/\/)/i.test(href)) return href;
  }
  return (cell.textContent || "").replace(/\s+/g, " ").trim();
}

function parseTable(tableEl, { hasHeader = true } = {}) {
  const rows = Array.from(tableEl.querySelectorAll("tr")).filter((r) =>
    Array.from(r.querySelectorAll("th, td")).some((c) => (c.textContent || "").trim() !== "")
  );
  if (!rows.length) return null;

  const raw = rows.map((r) => Array.from(r.querySelectorAll("th, td")).map(cleanCell));
  const colCount = Math.max(...raw.map((r) => r.length));
  const matrix = raw.map((r) => {
    const row = r.slice(0, colCount);
    while (row.length < colCount) row.push("");
    return row;
  });

  let header, dataRows;
  if (hasHeader && matrix.length > 1) {
    header = matrix[0];
    dataRows = matrix.slice(1);
  } else {
    header = Array.from({ length: colCount }, (_, i) => `列${i + 1}`);
    dataRows = matrix;
  }
  return { header, dataRows };
}

// ---------- 字段类型选择面板（现有「表格转数据库」专用，保留） ----------

function openFieldTypePanel(tableBlock) {
  return new Promise((resolve, reject) => {
    const tableEl = tableBlock.querySelector("table");
    if (!tableEl) { reject(new Error(I18N.noTableEl || "未找到 table 元素")); return; }
    const parsed = parseTable(tableEl, { hasHeader: true });
    if (!parsed || parsed.header.length === 0) { reject(new Error(I18N.emptyTable || "表格为空")); return; }

    // 数据库名称默认值：从表格所在文档标题获取，失败则用默认值
    let dbName = "";
    try {
      const protyle = tableBlock.closest(".protyle");
      if (protyle) {
        const titleEl = protyle.querySelector(".protyle-title");
        if (titleEl) dbName = (titleEl.textContent || "").trim();
      }
    } catch (_) {}
    if (!dbName) dbName = I18N.defaultDBName || "表格转数据库";

    // 列定义：所有列（colIndex 即真实列下标 0..N-1），用于生成「列名 → 类型下拉 / 主列标签」
    // 以及「设为主列」按钮。主列默认为第一列（index 0）。
    // selectedType：持久化用户在面板里的类型选择，切主列重新渲染时不丢失。
    const colDefs = parsed.header.map((name, i) => {
      const colValues = parsed.dataRows.map((r) => (r[i] != null ? r[i] : ""));
      const inferred = inferType(colValues);
      return { name: name || `列${i + 1}`, colIndex: i, inferred, selectedType: inferred };
    });

    if (colDefs.length <= 1) {
      showMessage(I18N.onlyOneCol || "表格只有一列，将直接作为数据库主列（无其它字段）");
      resolve({ types: colDefs.map(() => "block"), primaryIndex: 0, dbName: dbName || "表格转数据库" });
      return;
    }

    // 当前主列下标（默认第一列 index 0）
    let primaryIndex = 0;

    // ==== 右侧数据预览（初始 10 行，可通过按钮扩展）====
    // 封装为函数，切主列时同步刷新（高亮当前主列对应的表头）。
    let previewLimit = 10;
    const renderPreview = (container) => {
      const previewData = parsed.dataRows.slice(0, previewLimit);
      const headerCells = parsed.header.map((h, i) => {
        // 主列（标题列）：用 .b3-chip.b3-chip--primary 高亮渲染标题 chip；
        // 普通列保持普通文本，不额外加 chip。
        const name = i === primaryIndex
          ? `<span class="b3-chip b3-chip--primary">${escapeHtml(h)}</span>`
          : escapeHtml(h);
        return `<th style="padding:4px 10px;border-bottom:1px solid var(--b3-border-color);text-align:left;white-space:nowrap;${i === primaryIndex ? "font-weight:600;background:var(--b3-theme-surface);" : ""}">${name}</th>`;
      }).join("");
      const renderCell = (v, colIdx) => {
        if (v === "") return '<span style="color:#bbb;">—</span>';
        const sel = colDefs[colIdx].selectedType;
        if (sel === "mSelect") {
          const parts = v.split(MSELECT_SPLIT_RE).map((x) => x.trim()).filter(Boolean);
          return parts.map((p) => `<span class="b3-chip">${escapeHtml(p)}</span>`).join(" ");
        }
        if (sel === "select") {
          return `<span class="b3-chip">${escapeHtml(v)}</span>`;
        }
        if (sel === "block") {
          // 主键（标题）列：源 CSV 里就是普通 cell 文本 → 显示文本 chip
          return `<span class="b3-chip b3-chip--primary">${escapeHtml(v)}</span>`;
        }
        if (sel === "url") {
          return `<a href="${escapeHtml(v)}" target="_blank" rel="noopener noreferrer" style="color:var(--b3-theme-primary,#4285f4);text-decoration:underline">${escapeHtml(v)}</a>`;
        }
        if (sel === "date") {
          return `<span class="b3-chip b3-chip--primary">${escapeHtml(v)}</span>`;
        }
        if (sel === "checkbox") {
          const checked = ["true", "✓", "✔", "☑", "是", "1", "yes", "y"].includes(v.toLowerCase().trim());
          return `<span style="color:${checked ? "var(--b3-theme-primary)" : "var(--b3-theme-on-surface)"}">${checked ? "✓" : "✗"}</span>`;
        }
        // 文本/数字等普通类型不再 chip 化，直接显示为普通文本（撤销上版过度 chip 化）
        return escapeHtml(v);
      };
      const previewBodyRows = previewData.map((row) =>
        `<tr>${parsed.header.map((_, i) => {
          const v = row[i] != null ? String(row[i]) : "";
          return `<td style="padding:4px 10px;border-bottom:1px solid var(--b3-border-color);white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis;">${renderCell(v, i)}</td>`;
        }).join("")}</tr>`
      ).join("");
      container.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead style="position:sticky;top:0;z-index:1;background:var(--b3-theme-background);">${headerCells}</thead>
        <tbody>${previewBodyRows}</tbody>
      </table>`;
    };

    // ==== 左侧列类型映射行（三区域：左=列名+箭头+下拉，右=主列按钮/标签）====
    // - 左侧用 flex:1 1 auto 包裹，使「列名 → 下拉」紧凑靠左，不再把中间推到最右；
    // - 主列行：下拉位置改为「主列（标题）」标签（思源 AV 主列即标题列，无普通类型）；
    // - 非主列行：显示类型下拉 + 「设为主列」按钮（data-set-primary）。
    const renderFieldRows = (container) => {
      const rows = colDefs.map((f, i) => {
        const isPrimary = i === primaryIndex;
        const left = `
          <div style="display:flex;align-items:center;gap:8px;flex:1 1 auto;min-width:0;">
            <span style="display:inline-block;width:88px;padding:2px 8px;border:1px solid var(--b3-border-color);border-radius:4px;background:var(--b3-theme-surface-light,#f5f5f5);color:var(--b3-theme-on-surface);font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:middle;" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
            <span style="flex:0 0 auto;color:var(--b3-theme-on-surface-light,#999);font-size:13px;padding:0 4px;">→</span>
            ${isPrimary ? "" : `<select data-field="${i}" class="b3-select" style="width:88px;flex-shrink:0;">${FIELD_TYPES.map((t) =>
                  `<option value="${t}"${t === f.selectedType ? " selected" : ""}>${escapeHtml(typeLabel(t))}</option>`).join("")}</select>`}
          </div>`;
        const right = isPrimary
          ? `<span class="b3-button b3-button--text" style="flex:0 0 auto;cursor:default;opacity:.7;">${escapeHtml(I18N.primaryColumn || "主列（标题）")}</span>`
          : `<button class="b3-button b3-button--text" data-set-primary="${i}" style="flex:0 0 auto;">${escapeHtml(I18N.setAsPrimary || "设为主列")}</button>`;
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:6px 0;padding:2px 0;">${left}${right}</div>`;
      }).join("");
      container.innerHTML = rows;
    };

    // 整体纵向 flex：标题(固顶) + 左右分栏(可伸缩) + 底部按钮(固底)。
    // 左右两栏各自 overflow:auto，整体 max-height:70vh；外层 flex 左 3 / 右 7 不变。
    const html = `<style>
      .b3-chip { display:inline-block;padding:0 6px;border-radius:10px;background:var(--b3-theme-primary-lightest,rgba(127,127,127,.12));font-size:11px;margin:1px 2px; }
      .b3-chip--primary { display:inline-block;padding:1px 8px;border-radius:10px;background:#e3f2fd;border:1px solid #90caf9;color:#1565c0;font-size:11px;font-weight:600;margin:1px 2px; }
    </style>
    <div class="b3-dialog__body" style="padding:16px;height:100%;overflow:hidden;display:flex;flex-direction:column;">
        <div style="margin-bottom:12px;flex:0 0 auto;">
          <div style="font-size:12px;color:#999;margin-bottom:4px;">${escapeHtml(I18N.databaseName || "数据库名称（标题）")}</div>
          <input id="db-name-input" class="b3-text-field" value="${escapeHtml(dbName)}" style="width:100%;" />
        </div>
        <div style="display:flex;gap:16px;flex:1 1 auto;min-height:0;">
          <div style="flex:3;min-width:0;display:flex;flex-direction:column;min-height:0;">
            <div style="font-size:12px;color:#999;margin-bottom:6px;flex:0 0 auto;">${(I18N.panelFieldTypes || "列类型映射")}</div>
            <div id="field-rows" style="flex:1 1 auto;min-height:0;overflow:auto;border:1px solid var(--b3-border-color);border-radius:6px;padding:4px 10px;"></div>
          </div>
          <div style="flex:7;min-width:0;display:flex;flex-direction:column;min-height:0;">
            <div style="font-weight:600;margin-bottom:6px;flex:0 0 auto;">${(I18N.dataPreview || "数据预览")}</div>
            <div id="preview-table" style="flex:1 1 auto;min-height:0;overflow:auto;border:1px solid var(--b3-border-color);border-radius:6px;"></div>
            <div id="preview-footer" style="flex:0 0 auto;margin-top:6px;"></div>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;flex:0 0 auto;">
          <button class="b3-button b3-button--cancel" data-act="cancel">${(I18N.panelCancel || "取消")}</button>
          <button class="b3-button b3-button--text" data-act="confirm">${(I18N.panelConfirm || "确认转换")}</button>
        </div>
      </div>`;

    // collect：返回按列下标对齐的 types 数组 + 当前主列下标 primaryIndex。
    // 主列行没有类型下拉，其占位为 "block"（convertTable 会强制把主列类型设为 block/标题列）。
    const collect = (root) => {
      const selects = Array.from(root.querySelectorAll("select[data-field]"));
      const typeByCol = {};
      selects.forEach((s) => { typeByCol[Number(s.getAttribute("data-field"))] = s.value; });
      const types = colDefs.map((_, i) => (typeByCol[i] != null ? typeByCol[i] : "block"));
      const nameInput = root.querySelector("#db-name-input");
      const name = nameInput ? (nameInput.value.trim() || dbName) : dbName;
      return { types, primaryIndex, dbName: name };
    };

    let cleanup;
    const Dlg = typeof Dialog !== "undefined" ? Dialog : window.siyuan && window.siyuan.Dialog;

    // 绑定确认/取消 + 渲染列映射行与预览 + 绑定「设为主列」按钮。
    // 切主列时重新渲染（左侧行、右侧预览高亮）。
    const bindActions = (root) => {
      const confirmBtn = root.querySelector('[data-act="confirm"]');
      const cancelBtn = root.querySelector('[data-act="cancel"]');
      if (confirmBtn) confirmBtn.onclick = () => { cleanup(); resolve(collect(root)); };
      if (cancelBtn) cancelBtn.onclick = () => { cleanup(); reject(new Error("cancel")); };

      const fieldContainer = root.querySelector("#field-rows");
      const previewContainer = root.querySelector("#preview-table");

      const renderPreviewFooter = () => {
        const total = parsed.dataRows.length;
        const shown = Math.min(previewLimit, total);
        const footerEl = root.querySelector("#preview-footer");
        if (!footerEl) return;
        let html = `<div style="color:#999;font-size:12px;margin-top:6px;">${(I18N.previewRows || "预览 {n} 行").replace("{n}", String(shown))} / ${total}</div>`;
        if (shown < total) {
          html += `<div style="display:flex;gap:6px;margin-top:6px;">
            <button class="b3-button" data-act="show-more">${escapeHtml(I18N.showMore || "显示更多")}</button>
            <button class="b3-button" data-act="show-all">${escapeHtml(I18N.showAll || "全部显示")}</button>
          </div>`;
        }
        footerEl.innerHTML = html;
        footerEl.querySelectorAll('[data-act="show-more"]').forEach((btn) => {
          btn.onclick = () => { previewLimit += 10; render(); };
        });
        footerEl.querySelectorAll('[data-act="show-all"]').forEach((btn) => {
          btn.onclick = () => { previewLimit = total; render(); };
        });
      };

      const render = () => {
        renderFieldRows(fieldContainer);
        renderPreview(previewContainer);
        renderPreviewFooter();
        fieldContainer.querySelectorAll('select[data-field]').forEach((sel) => {
          sel.onchange = (e) => {
            const idx = Number(sel.getAttribute("data-field"));
            if (colDefs[idx]) colDefs[idx].selectedType = sel.value;
            // 类型变了 → 重渲染右侧数据预览（对齐导入向导的实时渲染行为）。
            render();
          };
        });
        fieldContainer.querySelectorAll('[data-set-primary]').forEach((btn) => {
          btn.onclick = (e) => {
            e.stopPropagation();
            const idx = Number(btn.getAttribute("data-set-primary"));
            if (idx !== primaryIndex) { primaryIndex = idx; render(); }
          };
        });
      };
      render();
    };

    if (Dlg) {
      const dialog = new Dlg({ title: I18N.convertPreviewTitle || "转换预览", content: html, width: "1066px", height: "720px" });
      cleanup = () => dialog.destroy();
      const body = dialog.element.querySelector(".b3-dialog__body");
      bindActions(body);
    } else {
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;";
      const box = document.createElement("div");
      box.style.cssText = "background:var(--b3-theme-background);color:var(--b3-theme-on-background);border-radius:8px;min-width:520px;max-width:90vw;box-shadow:0 8px 24px rgba(0,0,0,.2);";
      box.innerHTML = html;
      overlay.appendChild(box);
      overlay.onclick = (e) => { if (e.target === overlay) { cleanup(); reject(new Error("cancel")); } };
      document.body.appendChild(overlay);
      cleanup = () => overlay.remove();
      bindActions(box);
    }
  });
}

// ---------- 主流程：把表格块转换为数据库块（复用 common.writeNewDatabase） ----------

async function convertTable(tableBlock, opts = {}) {
  const blockId = tableBlock.getAttribute("data-node-id");
  if (!blockId) throw new Error(I18N.noBlockId || "无法获取表格块 ID");

  // 转换前（任何写操作之前）：
  // 1) 获取表格所在文档的 rootID，供后续刷新整个编辑器使用；
  // 2) 调用思源官方「文件历史」API 生成文档历史快照，作为转换前的自动备份。
  // 两者均不阻断转换主流程，失败时仅 warn。
  let rootID = "";
  try {
    const info = await getBlockInfo(blockId);
    rootID = (info && info.rootID) || "";
    if (!rootID) console.warn("[table-to-database] 未获取到文档 rootID，后续编辑器刷新可能降级");
  } catch (e) {
    console.warn("[table-to-database] 获取文档 rootID 失败（不影响转换）", e);
  }
  try {
    await createDocHistory(blockId);
    console.log("[table-to-database] 已生成文档历史快照（文件历史）");
  } catch (e) {
    console.warn("[table-to-database] 创建文档历史失败（不影响转换）", e);
  }

  const tableEl = tableBlock.querySelector("table");
  if (!tableEl) throw new Error(I18N.noTableEl || "未在表格块中找到 <table> 元素");

  const parsed = opts.parsed || parseTable(tableEl, { hasHeader: true });
  if (!parsed || parsed.header.length === 0) throw new Error(I18N.emptyTable || "表格为空或无法解析");

  const avID = generateId();
  // 主列下标：默认第一列（向后兼容），可由转换预览面板通过 opts.primaryIndex 指定。
  const primaryIndex = (typeof opts.primaryIndex === "number" && opts.primaryIndex >= 0 && opts.primaryIndex < parsed.header.length)
    ? opts.primaryIndex
    : 0;
  const primaryName = parsed.header[primaryIndex] || (parsed.header[0] || "Name");

  // 字段定义：除主列外的所有列；支持用户通过面板覆盖类型。
  // colIndex 保留该列在 parsed.dataRows 中的真实下标，写库时按列取值（不受主列选择影响，不会错位）。
  const fieldDefs = parsed.header.map((name, colIndex) => {
    if (colIndex === primaryIndex) return null; // 主列单独构造，不进入普通字段
    const colValues = parsed.dataRows.map((r) => (r[colIndex] != null ? r[colIndex] : ""));
    const inferred = inferType(colValues);
    const userType = opts.fieldTypes && opts.fieldTypes[colIndex];
    const type = userType || inferred;
    let options = [];
    if (type === "select") options = buildSelectOptions(colValues);
    else if (type === "mSelect") options = buildMSelectOptions(colValues);
    return { name: name || `列${colIndex + 1}`, type, options, colIndex, isPrimary: false };
  }).filter(Boolean);
  const primaryField = { name: parsed.header[primaryIndex] || "Name", type: "block", colIndex: primaryIndex, isPrimary: true };

  // 类型数组长度 guard：fieldTypes 应与表格总列数一致（含主列占位位）
  if (opts.fieldTypes && opts.fieldTypes.length !== parsed.header.length) {
    throw new Error(I18N.panelMismatch || "字段类型数量与表格列数不一致");
  }

  const dbName = opts.dbName || `${parsed.header[primaryIndex] || "表格"} · 数据库`;

  // 核心写库序列（putFile → insertBlock → appendRows → 删除原表 → 刷新）
  // 交由 common.writeNewDatabase 统一处理，reload:false 表示本函数删除原表后再统一刷新。
  const res = await writeNewDatabase({
    avID,
    dbName,
    fields: [primaryField, ...fieldDefs],
    primaryName,
    rows: parsed.dataRows,
    insertAfterId: blockId,
    rootID,
    reload: false,
  });

  // 删除原表格块（导入流程不删源，这里仅转换流程删除）
  await removeBlock(blockId);

  // 删除原表格后，前端文档视图会重建，必须最后再刷新一次编辑器与属性视图，
  // 否则删除原表的 transaction 会把刚插入数据库块的监听冲掉，导致行不显示、需手动 F5。
  try {
    console.log("[table-to-database] 刷新编辑器");
    await api("/api/ui/reloadProtyle", { id: rootID });
    await api("/api/ui/reloadAttributeView", { id: avID });
    console.log("[table-to-database] 已刷新编辑器与属性视图");
  } catch (refreshErr) {
    console.warn("[table-to-database] 自动刷新失败，可手动 F5 刷新", refreshErr);
  }

  return { avID, rows: res.rows, cols: res.cols, skipped: res.skipped, backup: false };
}

// ---------- 触发：从当前光标 / 选区找表格块 ----------

function findTargetTable() {
  let tableBlock = null;

  // 解析一个节点（文本节点取父元素）并向上寻找最近的 NodeTable 块
  const resolveToTable = (node) => {
    if (!node) return null;
    const el = node.nodeType === 3 ? node.parentElement : node;
    return el ? el.closest('[data-type="NodeTable"]') : null;
  };

  // ① 选区检测（覆盖「光标在表格单元格内」「跨单元格选区」等场景）：
  //    window.getSelection 同时尝试 startContainer 与 commonAncestorContainer 向上 closest NodeTable。
  //    思源单元格内嵌 contenteditable，光标文本节点向上经 cell/td/table 链最终命中 NodeTable，故需逐级 closest。
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    tableBlock =
      resolveToTable(range.startContainer) || resolveToTable(range.commonAncestorContainer);
  }

  // ② 焦点编辑区内定位：编辑器获得焦点（.protyle-wysiwyg--focus）时，
  //    借助选区焦点元素 selection.focusNode 向上找所在表格。
  //    注意：.protyle-wysiwyg--focus 是编辑区「根」节点（所有块的祖先），
  //    直接对其 .closest 只会向上遍历、永远找不到身为后代的 NodeTable，故改为用焦点/选区元素解析。
  if (!tableBlock) {
    const wysiwyg =
      document.querySelector(".protyle-wysiwyg--focus") ||
      document.querySelector(".layout__wnd--active .protyle-wysiwyg");
    if (wysiwyg && sel && sel.focusNode) {
      tableBlock = resolveToTable(sel.focusNode);
    }
  }

  // ③ 块级选中（如思源中点击表格块左侧「块选择」使其呈粉色高亮）：
  //    在当前活动 protyle 内查找被标记为 .protyle-wysiwyg--select 的元素，并向上找到 NodeTable。
  //    仅匹配「被选中」的表格，不回退到「任意找一个表」。
  if (!tableBlock) {
    const protyle =
      document.querySelector(".layout__wnd--active .protyle") || document.querySelector(".protyle");
    if (protyle) {
      const selected = protyle.querySelector(".protyle-wysiwyg--select");
      if (selected) tableBlock = selected.closest('[data-type="NodeTable"]') || null;
    }
  }

  // ④ 最后手段（仅限当前获得焦点的编辑区内，且唯一表格时）：
  //    光标确实在编辑器内、但选区 API 失效时的兜底。不跨 protyle、不全局任意找表；
  //    编辑区内无表格（空页面）时 querySelectorAll 长度为 0，必返回 null，不会误匹配。
  if (!tableBlock) {
    const focusWysiwyg = document.querySelector(".protyle-wysiwyg--focus");
    if (focusWysiwyg) {
      const tables = focusWysiwyg.querySelectorAll('[data-type="NodeTable"]');
      if (tables.length === 1) tableBlock = tables[0];
    }
  }

  return tableBlock;
}

function buildDoneMessage(res) {
  let msg = (I18N.converted || "已转换为数据库：共 {rows} 行 / {cols} 列 ✓")
    .replace("{rows}", res.rows)
    .replace("{cols}", res.cols);
  if (res.skipped > 0) {
    msg += " " + (I18N.skippedInfo || "（已跳过 {n} 个空行）").replace("{n}", res.skipped);
  }
  if (res.backup) msg += `（${(I18N.backupHint || "")}）`;
  return msg;
}

async function convertFocused() {
  const tableBlock = findTargetTable();
  if (!tableBlock) {
    showMessage(I18N.noTableFocus || "请先选中一个表格块，再执行转换");
    return;
  }
  let panelResult;
  try {
    panelResult = await openFieldTypePanel(tableBlock);
  } catch (e) {
    if (e && e.message === "cancel") return; // 用户取消，静默退出
    throw e;
  }
  try {
    showMessage(I18N.converting || "正在转换表格为数据库…");
    const res = await convertTable(tableBlock, {
      fieldTypes: panelResult.types,
      primaryIndex: panelResult.primaryIndex,
      dbName: panelResult.dbName,
    });
    showMessage(buildDoneMessage(res));
  } catch (e) {
    console.error("[table-to-database]", e);
    showMessage((I18N.convertFail || "转换失败：") + (e && e.message ? e.message : e));
  }
}

// ---------- 插件本体 ----------

export default class TableToDatabase extends Plugin {
  constructor(options) {
    super(options);
  }

  onload() {
    // 注入 i18n 到 common（供所有模块共享，打破循环依赖）
    setI18N(this.i18n || {});

    this.addIcons(
      `<symbol id="iconTable2db" viewBox="0 0 32 32">` +
        `<path fill="currentColor" d="M5 7h22a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm0 5v4h22v-4H5zm0 8v4h9v-4H5zm11 0v4h11v-4H16z"/>` +
        `</symbol>` +
      `<symbol id="iconImportData" viewBox="0 0 32 32">` +
        `<path fill="currentColor" d="M25 18h-5V8h-8v10H7l9 9 9-9zM7 26v2h18v-2H7z"/>` +
        `</symbol>`
    );

    // 顶部按钮 → 下拉（转换当前表 / 导入数据）
    this.addTopBar({
      icon: "iconTable2db",
      title: this.i18n.convert,
      position: "right",
      callback: (e) => {
        const M = Menu || (window.siyuan && window.siyuan.Menu);
        if (!M) {
          // Menu 不可用时退化为直接转换（保持旧行为可达）
          convertFocused();
          return;
        }
        // 直接读 focusin 缓存中「用户编辑时已锁定的 protyle」，不再依赖打开菜单后才失效的实时选区。
        // 关键：点击顶栏按钮后浏览器焦点已从编辑器转移到菜单，getSelection() 的 anchorNode 不再是编辑器内的块，
        // 旧方案在此刻取光标会错指到 .layout__wnd--active 指向的另一文档（如「未命名」，Bug #1 真正根因）。
        // 新方案：缓存为空（用户从未聚焦编辑区）时 captureCurrentAnchor 会抛出明确错误，这里捕获后菜单照常打开，
        // 真正导入时 ImportWizard 会给出「无法确定插入位置」提示，不会静默落到错误文档。
        let presetAnchor = null;
        try {
          presetAnchor = captureCurrentAnchor();
        } catch (err) {
          console.warn("[table-to-database] 未捕获到编辑焦点，导入将提示用户先点击文档：", err && err.message);
        }
        const menu = new M("table2db-menu");

        // ④ 「转换当前表格」始终显示（排在「导入数据」之上）；点击时若未选中/聚焦表格，
        //    提示「请先选中一个表格块，再执行转换」并 return，否则执行转换。不依赖 SiYuan Menu 的 disabled 表现。
        menu.addItem({
          icon: "iconTable2db",
          label: I18N.convertCurrentTable || "转换当前表格",
          click: () => {
            if (!findTargetTable()) {
              showMessage(I18N.noTableFocus || "请先选中一个表格块，再执行转换");
              return;
            }
            convertFocused();
          },
        });

        menu.addItem({
          icon: "iconImportData",
          label: I18N.importData || "导入数据",
          click: () => openImportWizard(presetAnchor),
        });

        // ① 在顶部按钮「正下方」弹出：以按钮元素（事件 currentTarget/target）为锚点，
        //    用 getBoundingClientRect() 取视口坐标，确保菜单落在按钮下方而非页面左上角。
        let anchor = null;
        if (e && (e.currentTarget || e.target)) anchor = e.currentTarget || e.target;
        if (anchor && typeof anchor.getBoundingClientRect === "function") {
          const rect = anchor.getBoundingClientRect();
          // 思源 Menu.open 为对象式签名 open({ x, y })，传入视口坐标确保菜单落在按钮下方
          menu.open({ x: rect.left, y: rect.bottom });
        } else if (e && typeof e.clientX === "number" && typeof e.clientY === "number") {
          // 回退：直接使用事件坐标（对象式签名）
          menu.open({ x: e.clientX, y: e.clientY });
        } else {
          // 兜底：无坐标可取时由思源决定默认位置
          menu.open();
        }
      },
    });

    this.addCommand({
      langKey: "convert",
      hotkey: "⇧⌥T",
      callback: () => convertFocused(),
    });
    this.addCommand({
      langKey: "importData",
      callback: () => openImportWizard(),
    });

  }

  // 布局就绪后注册「最后聚焦 protyle」缓存（解决点击顶栏按钮后焦点转移、取不到当前文档的问题）。
  // 通过 focusin / selectionchange 事件代理（监听 document），可覆盖用户动态打开的新文档
  // （protyle 动态创建），无需一次性 querySelectorAll 绑定。
  onLayoutReady() {
    this.registerProtyleFocusTracking();
  }

  // 事件代理：用户「编辑文档时」缓存其最后聚焦的 .protyle（含 rootID 与当时选中块）。
  // 点击顶栏按钮后焦点转移到菜单，但缓存仍保留上次编辑的 protyle，导入时据此定位正确文档。
  registerProtyleFocusTracking() {
    // 编辑器内任意可聚焦元素（块/标题/内容区）获得焦点都会冒泡到 document 的 focusin
    // 处理函数存到实例上（this._onFocusIn），便于 onunload() 时精准 removeEventListener。
    this._onFocusIn = (e) => {
      const node = e.target;
      if (!node || !node.closest) return;
      const protyle = node.closest(".protyle");
      if (protyle) setLastFocusedProtyle(protyle);
    };
    document.addEventListener("focusin", this._onFocusIn);
    // 用户在已聚焦的 protyle 内移动光标时，刷新「当前选中块」缓存，使「光标位置」更精准。
    // 处理函数同样存到实例上（this._onSelectionChange），与 addEventListener 时传入的是同一引用。
    this._onSelectionChange = () => {
      refreshAnchorBlockFromSelection();
    };
    document.addEventListener("selectionchange", this._onSelectionChange);
  }

  // 插件禁用 / 卸载时移除全局监听，避免禁用后仍在运行、工作台仍在输出。
  // 必须传入与 addEventListener 时完全相同的处理函数引用（即 this._onFocusIn / this._onSelectionChange）。
  onunload() {
    if (this._onFocusIn) {
      document.removeEventListener("focusin", this._onFocusIn);
      this._onFocusIn = null;
    }
    if (this._onSelectionChange) {
      document.removeEventListener("selectionchange", this._onSelectionChange);
      this._onSelectionChange = null;
    }
  }
}
