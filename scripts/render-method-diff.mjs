#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--run-dir" && argv[i + 1]) {
      out.runDir = path.resolve(argv[i + 1]);
    }
  }
  return out;
}

function esc(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getParseOk(method) {
  const stage = method.inspector?.stages?.find((item) => item.stage === "llm_response");
  return stage?.output?.parse_ok;
}

function classifyLines(methods) {
  const lineCount = new Map();
  for (const method of methods) {
    const uniq = new Set(method.markdownLines);
    for (const line of uniq) {
      lineCount.set(line, (lineCount.get(line) ?? 0) + 1);
    }
  }

  return methods.map((method) => {
    const rows = method.markdownLines.map((line) => {
      const count = lineCount.get(line) ?? 1;
      let cls = "common";
      if (count === 1) cls = "only";
      else if (count === 2) cls = "partial";
      return { line, cls };
    });
    return { ...method, rows };
  });
}

function renderPage(runDirName, methods) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Method Diff ${esc(runDirName)}</title>
    <style>
      body { margin: 0; background: #f3f6fb; color: #1d2a44; font-family: ui-sans-serif, -apple-system, Segoe UI, sans-serif; }
      main { padding: 14px; display: grid; gap: 10px; }
      .card { background: #fff; border: 1px solid #d8e2f1; border-radius: 10px; padding: 12px; }
      .grid { display: grid; grid-template-columns: 1fr; gap: 10px; }
      @media (min-width: 1200px) { .grid { grid-template-columns: 1fr 1fr 1fr; } }
      h1,h2,h3,p { margin: 0 0 8px; }
      .legend { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; }
      .pill { padding: 2px 8px; border-radius: 999px; border: 1px solid #cbd6ea; }
      .only { background: #e8fff1; }
      .partial { background: #fff9d9; }
      .common { background: #ffffff; }
      .pane { border: 1px solid #dbe4f4; border-radius: 8px; overflow: hidden; }
      .pane-header { background: #f4f8ff; border-bottom: 1px solid #dbe4f4; padding: 8px; font-weight: 600; font-size: 13px; }
      .content { max-height: 70vh; overflow: auto; font-family: Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.45; }
      .line { white-space: pre-wrap; word-break: break-word; border-bottom: 1px dashed #edf1f8; padding: 2px 8px; }
      .line.only { background: #e8fff1; }
      .line.partial { background: #fff9d9; }
      .line.common { background: #ffffff; }
      .meta { font-size: 12px; color: #4e5f7e; }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>方法差异高亮</h1>
        <p class="meta">Run: ${esc(runDirName)}</p>
        <div class="legend">
          <span class="pill only">绿色：只在该方法出现</span>
          <span class="pill partial">黄色：在 2 个方法出现</span>
          <span class="pill common">白色：3 个方法都一致</span>
        </div>
      </section>

      <section class="card grid">
        ${methods
          .map(
            (m) => `<div class="pane">
              <div class="pane-header">${esc(m.label)} · parse_ok=${esc(String(m.parseOk))}</div>
              <div class="content">
                ${m.rows.map((row) => `<div class="line ${row.cls}">${esc(row.line)}</div>`).join("\n")}
              </div>
            </div>`,
          )
          .join("\n")}
      </section>
    </main>
  </body>
</html>`;
}

async function main() {
  const { runDir } = parseArgs(process.argv.slice(2));
  if (!runDir) {
    throw new Error("Missing --run-dir /abs/path/to/tasks/method-compare/<runId>");
  }

  const files = [
    { code: "A", label: "Method A" },
    { code: "B", label: "Method B" },
    { code: "C", label: "Method C" },
  ];

  const methods = [];
  for (const item of files) {
    const raw = await fs.readFile(path.join(runDir, `method-${item.code}.json`), "utf8");
    const parsed = JSON.parse(raw);
    methods.push({
      code: item.code,
      label: item.label,
      parseOk: getParseOk(parsed),
      markdownLines: String(parsed.markdownText ?? "").split("\n"),
    });
  }

  const classified = classifyLines(methods);
  const html = renderPage(path.basename(runDir), classified);
  const outPath = path.join(runDir, "diff-highlight.html");
  await fs.writeFile(outPath, html, "utf8");
  // eslint-disable-next-line no-console
  console.log(outPath);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
