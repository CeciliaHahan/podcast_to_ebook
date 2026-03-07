import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { ApiError } from "../lib/errors.js";
import { createId } from "../lib/ids.js";
import type { InspectorPushInput, InspectorStageRecord } from "../repositories/jobsRepo.js";
import type { BookletDraft } from "./workingNotesService.js";

const execFileAsync = promisify(execFile);

type DraftChapterFile = {
  id: string;
  fileName: string;
  title: string;
  bodyHtml: string;
};

function escapeXml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeHtml(input: string): string {
  return escapeXml(input);
}

function paragraphize(input: string): string[] {
  const normalized = String(input || "")
    .split(/\n{2,}/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return normalized.length ? normalized : [String(input || "").replace(/\s+/g, " ").trim()].filter(Boolean);
}

function buildChapterFiles(draft: BookletDraft): DraftChapterFile[] {
  const sections = draft.sections.map((section, index) => ({
    id: section.id || `section_${index + 1}`,
    fileName: `section_${String(index + 1).padStart(2, "0")}.xhtml`,
    title: section.heading,
    bodyHtml: paragraphize(section.body)
      .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
      .join(""),
  }));

  return [
    {
      id: "intro",
      fileName: "intro.xhtml",
      title: "导读",
      bodyHtml: [
        `<p>${escapeHtml(draft.title)}</p>`,
        "<h3>目录</h3>",
        `<ol>${draft.sections.map((section) => `<li>${escapeHtml(section.heading)}</li>`).join("")}</ol>`,
      ].join(""),
    },
    ...sections,
  ];
}

function buildStyles(): string {
  return [
    "body { font-family: serif; line-height: 1.7; margin: 0 auto; max-width: 42rem; padding: 1.5rem; color: #1f2937; }",
    "h1, h2, h3 { color: #0f172a; line-height: 1.3; }",
    "h2 { margin-top: 0; }",
    "p { margin: 0 0 1rem; text-align: justify; }",
    "ol { padding-left: 1.25rem; }",
  ].join("\n");
}

function buildChapterXhtml(chapter: DraftChapterFile, language: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(language)}">
  <head>
    <title>${escapeXml(chapter.title)}</title>
    <meta charset="utf-8" />
    <link rel="stylesheet" type="text/css" href="styles.css" />
  </head>
  <body>
    <section>
      <h2>${escapeHtml(chapter.title)}</h2>
      ${chapter.bodyHtml}
    </section>
  </body>
</html>
`;
}

function buildNavXhtml(chapters: DraftChapterFile[], title: string, language: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(language)}">
  <head>
    <title>${escapeXml(title)} - 导航</title>
    <meta charset="utf-8" />
  </head>
  <body>
    <nav epub:type="toc" id="toc" xmlns:epub="http://www.idpf.org/2007/ops">
      <h1>${escapeHtml(title)}</h1>
      <ol>
        ${chapters.map((chapter) => `<li><a href="${escapeHtml(chapter.fileName)}">${escapeHtml(chapter.title)}</a></li>`).join("\n")}
      </ol>
    </nav>
  </body>
</html>
`;
}

function buildTocNcx(chapters: DraftChapterFile[], identifier: string, title: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(identifier)}" />
    <meta name="dtb:depth" content="1" />
    <meta name="dtb:totalPageCount" content="0" />
    <meta name="dtb:maxPageNumber" content="0" />
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
    ${chapters
      .map(
        (chapter, index) => `<navPoint id="nav-${index + 1}" playOrder="${index + 1}">
      <navLabel><text>${escapeXml(chapter.title)}</text></navLabel>
      <content src="${escapeXml(chapter.fileName)}" />
    </navPoint>`,
      )
      .join("\n")}
  </navMap>
</ncx>
`;
}

function buildContentOpf(chapters: DraftChapterFile[], identifier: string, title: string, language: string): string {
  const generatedDate = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>${escapeXml(language)}</dc:language>
    <dc:creator>由播客转写整理（draft v1）</dc:creator>
    <dc:date>${escapeXml(generatedDate)}</dc:date>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="css" href="styles.css" media-type="text/css" />
    ${chapters
      .map(
        (chapter) =>
          `<item id="${escapeXml(chapter.id)}" href="${escapeXml(chapter.fileName)}" media-type="application/xhtml+xml" />`,
      )
      .join("\n    ")}
  </manifest>
  <spine toc="ncx">
    ${chapters.map((chapter) => `<itemref idref="${escapeXml(chapter.id)}" />`).join("\n    ")}
  </spine>
</package>
`;
}

async function writeDraftEpubArtifact(filePath: string, draft: BookletDraft, language: string, identifier: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "podcast-draft-epub-"));
  const oebpsDir = path.join(tempRoot, "OEBPS");
  const metaInfDir = path.join(tempRoot, "META-INF");
  const chapters = buildChapterFiles(draft);

  try {
    await fs.writeFile(path.join(tempRoot, "mimetype"), "application/epub+zip", "utf8");
    await fs.mkdir(metaInfDir, { recursive: true });
    await fs.mkdir(oebpsDir, { recursive: true });

    await fs.writeFile(
      path.join(metaInfDir, "container.xml"),
      `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>
`,
      "utf8",
    );
    await fs.writeFile(path.join(oebpsDir, "styles.css"), buildStyles(), "utf8");
    await fs.writeFile(path.join(oebpsDir, "nav.xhtml"), buildNavXhtml(chapters, draft.title, language), "utf8");
    await fs.writeFile(path.join(oebpsDir, "toc.ncx"), buildTocNcx(chapters, identifier, draft.title), "utf8");
    await fs.writeFile(path.join(oebpsDir, "content.opf"), buildContentOpf(chapters, identifier, draft.title, language), "utf8");
    for (const chapter of chapters) {
      await fs.writeFile(path.join(oebpsDir, chapter.fileName), buildChapterXhtml(chapter, language), "utf8");
    }

    await fs.rm(filePath, { force: true });
    await execFileAsync("zip", ["-X0", filePath, "mimetype"], { cwd: tempRoot });
    await execFileAsync("zip", ["-Xr9D", filePath, "META-INF", "OEBPS"], { cwd: tempRoot });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function sha256Hex(input: Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function createEpubFromBookletDraft(params: {
  title: string;
  language: string;
  bookletDraft: BookletDraft;
  metadata?: Record<string, unknown>;
}) {
  if (!params.bookletDraft.sections.length) {
    throw new ApiError(400, "BOOKLET_DRAFT_EMPTY", "Booklet draft must contain at least one section.");
  }

  const jobId = createId("run");
  const createdAt = new Date().toISOString();
  const sourceRef = typeof params.metadata?.episode_url === "string" ? params.metadata.episode_url : undefined;
  const stages: InspectorStageRecord[] = [];
  const pushStage = (stage: InspectorPushInput) => {
    stages.push({
      ...stage,
      ts: new Date().toISOString(),
    });
  };
  const root = path.resolve(process.cwd(), ".dev-artifacts", jobId);
  const fileName = `${jobId}.epub`;
  const filePath = path.join(root, fileName);

  pushStage({
    stage: "normalization",
    input: {
      source_type: "booklet_draft",
      source_ref: sourceRef ?? null,
      section_count: params.bookletDraft.sections.length,
      draft_preview: JSON.stringify(params.bookletDraft, null, 2).slice(0, 2500),
    },
    config: {
      flow: "booklet_draft_to_epub",
      output_format: "epub",
    },
  });

  pushStage({
    stage: "epub",
    input: {
      title: params.title,
      language: params.language,
      section_count: params.bookletDraft.sections.length,
    },
    config: {
      renderer: "draft_epub_writer_v1",
    },
  });

  await fs.mkdir(root, { recursive: true });
  await writeDraftEpubArtifact(filePath, params.bookletDraft, params.language, jobId);
  const bytes = await fs.readFile(filePath);
  const sizeBytes = bytes.byteLength;
  const checksum = sha256Hex(bytes);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  pushStage({
    stage: "epub",
    output: {
      file_name: fileName,
      size_bytes: sizeBytes,
      checksum_sha256: checksum,
    },
  });

  return {
    job_id: jobId,
    status: "succeeded" as const,
    created_at: createdAt,
    artifacts: [
      {
        type: "epub" as const,
        file_name: fileName,
        size_bytes: sizeBytes,
        download_url: `${config.publicBaseUrl}/downloads/${jobId}/${encodeURIComponent(fileName)}?token=dev`,
        expires_at: expiresAt,
      },
    ],
    stages,
    traceability: {
      source_type: "booklet_draft" as const,
      source_ref: sourceRef ?? "internal://source-ref",
      generated_at: new Date().toISOString(),
    },
  };
}
