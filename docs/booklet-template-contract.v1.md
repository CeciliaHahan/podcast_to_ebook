# Booklet Template Contract v1

Date: 2026-02-26  
Applies to: `templateA-v0-book` content generation for `EPUB + PDF + Markdown`

## 1. Goal

Produce booklet deliverables that match the reading experience of:

- `ep36_templateA_v0.epub` (placeholder/template baseline)
- `ep36_booklet_v0.epub` (filled booklet example)

Expected output is a chapterized "knowledge booklet", not a raw transcript dump.
This contract defines one canonical booklet structure shared by EPUB/PDF/Markdown.

## 2. Canonical Booklet Structure (All Formats)

All formats must represent the same logical section order:

1. 读前速览
2. 关键要点摘要（TL;DR）
3. 目录（建议 5–7 章）
4. 第 1 章..第 7 章（核心内容）
5. 行动清单（汇总版）
6. 概念与术语表
7. 附录：精选原句（按主题）
8. 制作信息

If any format omits a section, it must be marked as intentional and documented.

## 3. Required EPUB Package Shape

Minimum structure:

- `mimetype`
- `META-INF/container.xml`
- `OEBPS/content.opf`
- `OEBPS/nav.xhtml`
- `OEBPS/toc.ncx`
- `OEBPS/styles.css`
- `OEBPS/chap_01.xhtml` ... `OEBPS/chap_14.xhtml`

## 4. Metadata Contract (`content.opf` / format headers)

Required dynamic fields:

- `dc:title`: generated from episode metadata
- `dc:language`: use job language (for Chinese use `zh`)
- `dc:creator`: generator signature (for example: `由播客转写整理（v1）`)
- `dc:date`: generation date (`YYYY-MM-DD`)
- `dc:identifier`: UUID or stable generated id

For other formats:

- PDF must include title, language, generation date, and source reference on first page.
- Markdown must include the same metadata block at top-level heading area.

## 5. Chapter Inventory Contract

The booklet must include exactly these logical sections:

1. `chap_01`: 读前速览
2. `chap_02`: 关键要点摘要（TL;DR）
3. `chap_03`: 目录（建议 5–7 章）
4. `chap_04`..`chap_10`: 第 1 章..第 7 章（核心内容）
5. `chap_11`: 行动清单（汇总版）
6. `chap_12`: 概念与术语表
7. `chap_13`: 附录：精选原句（按主题）
8. `chap_14`: 制作信息

`nav.xhtml` and `toc.ncx` must list the same section order.

## 6. Placeholder Contract

Global placeholders:

- `{BOOK_TITLE}`
- `{BOOK_LANGUAGE}`
- `{GEN_DATE}`
- `{BOOK_CREATOR}`

Chapter title placeholders:

- `{CH1_TITLE}` ... `{CH7_TITLE}`

Per chapter content placeholders (minimum):

- `{CHx_POINT_1}` ... `{CHx_POINT_5}`
- `{CHx_TS_1}` ... `{CHx_TS_4}`
- `{CHx_QUOTE_1}` ... `{CHx_QUOTE_4}`
- `{CHx_ACTION_1}` ... `{CHx_ACTION_3}`

Where `x` is `1..7`.

All placeholders must be resolved before packaging output artifact.

## 7. Content Rules

- Preserve semantic fidelity to transcript (no fabricated facts).
- Prefer concise, actionable language over verbatim transcript blocks.
- Keep timestamped quotes where possible for traceability.
- For Chinese source content, keep Chinese output by default.
- Keep transcript raw lines mainly in appendix, not in chapter body.

## 8. Format Rendering Contract

One canonical content model, three renderers:

- EPUB renderer:
  - full chapterized package with `nav.xhtml` + `toc.ncx`
  - maintain section hierarchy with `h2/h3`
- PDF renderer:
  - preserve the same chapter order and heading labels as EPUB
  - include page breaks between major sections (`chap_01..chap_14`)
  - use CJK-capable fonts for Chinese content
- Markdown renderer:
  - preserve the same chapter order with `##/###` headings
  - keep quote/timestamp lines and checklist items in markdown-native syntax

No renderer may reorder or drop sections silently.

## 9. Styling Contract (`styles.css` + equivalents)

Base style requirements:

- CJK-safe font stack (include `"PingFang SC"` and `"Noto Sans CJK SC"` fallbacks)
- Comfortable line-height (`>=1.5`)
- Distinct heading hierarchy (`h2`, `h3`)
- Quote styling for key citations (`blockquote`)

Equivalent readability rules apply to PDF/Markdown:

- clear heading hierarchy
- visible quote blocks
- no unreadable encoding output

## 10. Validation Checklist

Before returning EPUB artifact:

- All chapter files exist.
- `content.opf` manifest/spine includes all chapter items.
- `nav.xhtml` links are valid and in correct order.
- `toc.ncx` links are valid and in correct order.
- No unresolved placeholder tokens (`{...}`) remain.
- EPUB opens in at least one local reader without structure break.

Cross-format checks:

- PDF and Markdown section order matches EPUB chapter order.
- Metadata values (title/language/date/source) are consistent across all outputs.
- No unresolved placeholder tokens (`{...}`) in any output format.

## 11. Backend Wiring Notes (Minimal Path)

1. Build a structured intermediate object:
- `book_meta`
- `chapter_summaries`
- `chapter_quotes`
- `chapter_actions`
- `appendix_quotes`

2. Render `chap_01..14` from template strings using that object.

3. Generate `content.opf`, `nav.xhtml`, and `toc.ncx` from the same chapter list to avoid drift.

4. Zip as valid EPUB package and store as job artifact.

5. Render PDF and Markdown from the same intermediate object, not from separate ad-hoc templates.
