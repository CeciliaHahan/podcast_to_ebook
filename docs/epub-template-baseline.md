# EPUB Template Baseline (templateA-v0-book)

## Source

- Original file: `/Users/cecilia/Downloads/ep36_templateA_v0.epub`
- Repository copy: `assets/templates/ep36_templateA_v0.epub`
- Runtime template id: `templateA-v0-book`

## Goal

Use this EPUB as the initial "book-like" output baseline for V1.  
Prompt and system behavior can be tuned later while preserving this structure direction.

## Extracted Structure Snapshot

- Package: EPUB3 (`content.opf`, `nav.xhtml`, `toc.ncx`)
- Main files:
  - `EPUB/text/title_page.xhtml`
  - `EPUB/text/ch001.xhtml`
  - `EPUB/styles/stylesheet1.css`
- Reading shape:
  - Title page
  - Read-first summary section
  - 5-7 chapter-oriented structure
  - Action checklist
  - Optional glossary/resources
  - Appendices (selected transcript and production info)

## Placeholder Patterns Found

- `{CH1_TITLE}`
- `{CH2_TITLE}`
- `{CH3_TITLE}`
- `{CH4_TITLE}`
- `{CH5_TITLE}`

These should be programmatically replaced during generation.

## Implementation Notes

- Keep EPUB as canonical styled output.
- PDF/Markdown should be generated from the same structured intermediate document.
- Source language metadata should be set dynamically per job (do not hardcode from template sample).
- Keep traceability section in appendix or metadata block.

## First Iteration Acceptance Criteria

- Output reads as a coherent short book, not a raw transcript dump.
- TOC works in common EPUB readers.
- Chapter titles and placeholders are fully resolved.
- Actionable sections are present when source content supports them.

