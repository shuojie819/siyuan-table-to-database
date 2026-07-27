# Changelog

## [1.2.3] - 2026-07-27

### Import to existing database
- Target database dropdown now shows **database names** instead of raw IDs.
- Fixed `目标数据库不存在：API /api/file/getFile 失败` error when selecting a target — read AV JSON with a dedicated `getFile()` helper instead of the generic `api()` wrapper.
- **Primary-column dedupe** now correctly recognizes existing rows (e.g. "Nous Research") — when a block cell's `content` is missing from the AV JSON, batch-fetch it via `/api/block/getBlockInfo`.
- **Row dedupe** key now uses **unified two-layer normalization** across source and target: split by punctuation, then by whitespace, deduplicate, sort, and join. Handles multi-word labels (e.g. "硅谷 AI 实验室") and space-separated multi-tags (e.g. "Agent/自动化 办公自动化 文本对话") consistently.
- Import now actually **writes new rows** — `buildCell` was missing a `block` branch, causing the append API to reject the entire batch.

### Import position fixes
- Import no longer inserts into the wrong document (e.g. "未命名") when multiple documents are open. Replaced click-time focus/selection reading with a **`focusin`-based last-focused protyle cache**.
- `listExistingAVs()` also uses the cached protyle so the "existing database" list matches the current document.

### Import preview UI
- Added a **download arrow icon** to the "导入数据" menu item.
- Default preview rows increased from **8 → 10**.
- Added **"显示更多"** (+10 rows) and **"全部显示"** (show all) buttons below the preview table.

### Conversion preview improvements
- Added a **database name input** at the top of the conversion panel (default: document title).
- Added **"显示更多" / "全部显示"** buttons below the conversion preview table.
- Removed the redundant standalone "主键 | 主列（标题）" row.
- Preview layout aligned with the import wizard (title, row count format, button positioning).
- mSelect columns now render as **chip tags** (`.b3-chip`), matching the import preview visual style.
- URL columns render as **clickable links**.

## [1.2.2] - 2026-07-26

- **Import result guidance:** after import, the new block is now automatically scrolled into view with a transient highlight, and a message shows the **document name** and insert position. Cross-document cases include a clickable `siyuan://block/<id>` link.
- **Primary column selection** in the conversion panel: each non-primary row has a "设为主列" button; switching re-renders the panel. Conversion uses the user-selected primary index.
- **Import position anchor fix** (enterprise): replaced click-time focus reading with a `focusin`-based last-focused protyle cache. Import now reliably inserts into the correct document even in multi-pane layouts.

## [1.2.1] - 2026-07-26

- Top-bar dropdown menu now opens anchored to the button.
- Removed block-icon direct conversion; entry is via top-bar button and hotkey only.
- Removed "convert all tables in document" batch feature.
- "Convert current table" now disabled when no table is focused/selected, and shows a **preview dialog** before converting.

## [1.2.0] - 2026-07-26

- **New:** Import data from **CSV files** or pasted **Markdown tables** into new or existing Attribute View databases.
- Two modes: create new database (column mapping + preview) / import into existing (auto matching + deduplication).
- Deduplication: by primary column, by entire row, or none.
- Markdown parsing supports GFM and **Tab-separated** syntax (paste from spreadsheets).
- Insert position: cursor or document end.

## [1.1.9] - 2026-07-24

- Fix: conversion no longer needs manual F5 — `reloadProtyle` was called with wrong parameter key.

## [1.1.8]

- Fix: pure-text columns fall through to `select` type inference.
- Added `maxLen` guard for select detection.
- Moved `reloadProtyle` to after the original table deletion.

## [1.1.7]

- Replaced manual backup block with SiYuan's official File History API snapshot.
- Auto-refresh after conversion.

## [1.1.6]

- Fix: database block appeared empty until manual F5 — added explicit `reloadAttributeView`.

## [1.1.5]

- Fix: rows hidden by default view filter — bumped AV `spec` to 5, removed stale `group` object.

## [1.1.4]

- Restored safer insert-then-write order.

## [1.1.3]

- Fix: `insertBlock` invalid ID — use kernel-assigned real block ID.

## [1.1.2]

- Fix: database had columns but no rows — reordered write sequence.

## [1.1.1]

- Fix: `key not found` when writing rows — pass real `keyID` from AV JSON.

## [1.1.0]

- Rewrote row writing with `/api/av/appendAttributeViewDetachedBlocksWithValues` (2-D array, keyID-matched — no misalignment).
- Cell values strictly aligned to kernel `Value` structure.
- AV JSON aligned to `kernel/av` (`spec`, `keyValues`, `keyIDs`, layout columns).
- Pre-conversion field-type selection panel.
- Smart column-type inference (text / number / checkbox / select / mSelect / url / email / phone / date).
