# Table to Database

One-click convert a SiYuan **table block** into an **Attribute View (database)**, or **import CSV / Markdown tables** into new or existing databases.

---

## Features

### Table → Database
- Convert any plain table into a filterable, sortable database.
- **Pre-conversion panel** with column-name preview, per-column type override, and **primary-column picker**.
- **Smart type inference**: `text`, `number`, `checkbox`, `select`, `mSelect`, `url`, `email`, `phone`, `date`.
- Set the **database name** before converting.
- Live **data preview** (default 10 rows) with **Show more / Show all** buttons.
- mSelect columns render as **chip tags** with correct visual style.

### Import Data (CSV / Markdown Table)
- **Create new database** from CSV or pasted Markdown tables.
- **Import into existing database** — auto column matching + deduplication.
- Deduplication options: by **primary column**, by **entire row**, or **no dedupe**.
- **Live preview** showing matched/mismatched columns, new/duplicate row counts, and data preview.
- Insert at **cursor position** or **document end**.
- Full column-type mapping (reuse existing field types or override).
- Multi-value columns correctly normalized across all separator styles (commas, semicolons, spaces).

### General
- **Document history snapshot** before every write (convert or import) — revert anytime via SiYuan's File History.
- Full **Chinese / English** UI (follows SiYuan's language setting).
- Dual entry via **top-bar button** (`⇧⌥T`) or **command palette**.

---

## How to use

### Convert a table
1. Place the cursor inside a table, or select the table block.
2. Click the top-bar **「表格转数据库」** icon, or press `Shift+Alt+T`.
3. The pre-conversion panel opens — review column types, pick a primary column, set the database name.
4. Click **确认转换** to convert.

### Import data
1. Click the top-bar icon → **导入数据**.
2. **Step 1:** Paste CSV/Markdown, or upload a CSV file.
3. **Step 2:** Choose **Create new database** or **Import into existing database**.
4. **Step 3:** Configure column mapping, deduplication strategy, and insert position.
5. Click **导入** to execute.

---

## Installation

### From Bazaar
1. SiYuan → Settings → Bazaar → Plugins.
2. Search **"Table to Database"** → Install.
3. Enable the plugin.

### Manual (development)
1. Download the latest `package.zip` from [Releases](https://github.com/shuojie819/siyuan-table-to-database/releases).
2. SiYuan → Settings → Bazaar → Plugins → Import from package.
3. Or extract into `<workspace>/data/plugins/siyuan-table-to-database/`.

---

## Field types supported

`text` · `number` · `checkbox` · `select` · `mSelect` · `url` · `email` · `phone` · `date`

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full history.

---

## License

MIT © ShuoJie
