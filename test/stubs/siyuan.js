/* ============================================================
 * test/stubs/siyuan.js — 思源运行时模块 `siyuan` 的测试替身（stub）
 *
 * npm 上的 `siyuan` 包只有 TypeScript 类型声明、没有运行时入口，测试环境无法真正
 * import，故用本 stub 顶替（见 vitest.config.mjs 的 resolve.alias：/^siyuan$/）。
 * 仅覆盖本插件实际用到的导出：见各源文件 `import ... from "siyuan"`——
 *   - src/index.js：Plugin, showMessage, Dialog, Menu
 *   - src/import/ImportWizard.js：Dialog, showMessage
 * 另外补上思源常用符号，避免后续测试新增引用时报错。
 * ============================================================ */

// 类（Plugin 由 index.js 继承；Dialog/Menu 用于弹窗与菜单）
export class Plugin {
  constructor() {}
  onload() {}
  onunload() {}
}

export class Dialog {
  constructor() {}
  destroy() {}
}

export class Menu {
  constructor() {}
  addItem() { return this; }
}

// 函数
export function showMessage() {}
export function fetchPost() { return Promise.resolve({}); }
export function fetchSyncPost() { return Promise.resolve({}); }
export function openTab() {}
export function getFrontend() { return "desktop"; }
export function sql() { return Promise.resolve([]); }

export default {
  Plugin,
  Dialog,
  Menu,
  showMessage,
  fetchPost,
  fetchSyncPost,
  openTab,
  getFrontend,
  sql,
};
