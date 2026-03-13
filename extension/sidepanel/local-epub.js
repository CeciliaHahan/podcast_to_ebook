const encoder = new TextEncoder();
const crcTable = new Uint32Array(256);

for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function createLocalId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function escapeXml(input) {
  return String(input || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function paragraphize(input) {
  const normalized = String(input || "")
    .split(/\n{2,}/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return normalized.length ? normalized : [String(input || "").replace(/\s+/g, " ").trim()].filter(Boolean);
}

function formatSpeakerText(entry) {
  if (!entry?.text) {
    return "";
  }
  return entry.speaker ? `${entry.speaker}：${entry.text}` : entry.text;
}

function renderEntryBlock(label, entries, variant) {
  if (!entries?.length) {
    return "";
  }
  return [
    `<div class="section-label">${escapeXml(label)}</div>`,
    `<div class="entry-group ${escapeXml(variant)}">`,
    entries.map((entry) => `<blockquote>${escapeXml(formatSpeakerText(entry))}</blockquote>`).join(""),
    "</div>",
  ].join("");
}

function renderArgumentPyramid(section) {
  if (!section.claims?.length && !section.why?.length && !section.butAlso?.length) {
    return "";
  }
  const parts = [`<div class="section-label">主要观点与论据</div>`, `<div class="argument-group">`];
  if (section.claims?.length) {
    parts.push(`<div class="argument-subtitle">主要观点</div>`);
    parts.push(`<ul class="argument-list claims">${section.claims.map((claim) => `<li>${escapeXml(claim)}</li>`).join("")}</ul>`);
  }
  if (section.why?.length) {
    parts.push(`<div class="argument-subtitle">为什么这么说</div>`);
    parts.push(`<ul class="argument-list why">${section.why.map((item) => `<li>${escapeXml(item)}</li>`).join("")}</ul>`);
  }
  if (section.butAlso?.length) {
    parts.push(`<div class="argument-subtitle">但也要看到</div>`);
    parts.push(`<ul class="argument-list but-also">${section.butAlso.map((item) => `<li>${escapeXml(item)}</li>`).join("")}</ul>`);
  }
  parts.push(`</div>`);
  return parts.join("");
}

function renderDraftSectionBody(section) {
  const parts = [];
  if (section.intro) {
    parts.push(`<div class="section-label">这一部分在讲什么</div>`);
    parts.push(...paragraphize(section.intro).map((paragraph) => `<p class="intro">${escapeXml(paragraph)}</p>`));
  }
  parts.push(renderArgumentPyramid(section));
  parts.push(renderEntryBlock("原话摘录", section.quotes, "quotes"));
  parts.push(renderEntryBlock("关键对话", section.dialogue, "dialogue"));

  if (!parts.filter(Boolean).length) {
    return paragraphize(section.body)
      .map((paragraph) => `<p>${escapeXml(paragraph)}</p>`)
      .join("");
  }
  return parts.filter(Boolean).join("");
}

function buildChapterFiles(draft) {
  const sections = draft.sections.map((section, index) => ({
    id: section.id || `section_${index + 1}`,
    fileName: `section_${String(index + 1).padStart(2, "0")}.xhtml`,
    title: section.heading,
    bodyHtml: renderDraftSectionBody(section),
  }));

  return [
    {
      id: "intro",
      fileName: "intro.xhtml",
      title: "导读",
      bodyHtml: [
        `<p>${escapeXml(draft.title)}</p>`,
        "<h3>目录</h3>",
        `<ol>${draft.sections.map((section) => `<li>${escapeXml(section.heading)}</li>`).join("")}</ol>`,
      ].join(""),
    },
    ...sections,
  ];
}

function buildStyles() {
  return [
    "body { font-family: serif; line-height: 1.7; margin: 0 auto; max-width: 42rem; padding: 1.5rem; color: #1f2937; }",
    "h1, h2, h3 { color: #0f172a; line-height: 1.3; }",
    "h2 { margin-top: 0; }",
    ".section-label { margin: 1rem 0 0.5rem; font-size: 0.8rem; font-weight: 700; color: #0f766e; letter-spacing: 0.02em; }",
    ".intro { color: #475569; }",
    "p { margin: 0 0 1rem; text-align: justify; }",
    "ul { margin: 0 0 1rem; padding-left: 1.25rem; }",
    "li { margin: 0 0 0.45rem; }",
    ".argument-group { margin: 0 0 1rem; padding: 0.95rem 1rem; border-radius: 0.75rem; background: #f8fafc; border: 1px solid #e2e8f0; }",
    ".argument-subtitle { margin: 0 0 0.45rem; font-size: 0.82rem; font-weight: 700; color: #334155; }",
    ".argument-subtitle + .argument-list { margin-top: 0; }",
    ".argument-list { margin-bottom: 0.85rem; }",
    ".argument-list:last-child { margin-bottom: 0; }",
    ".argument-list.why li { color: #334155; }",
    ".argument-list.but-also li { color: #475569; }",
    ".entry-group { display: grid; gap: 0.6rem; margin: 0 0 1rem; }",
    ".entry-group blockquote { margin: 0; padding: 0.7rem 0.9rem; border-radius: 0.5rem; border-left: 3px solid #94a3b8; background: #f8fafc; }",
    ".entry-group.quotes blockquote { background: #eff6ff; border-left-color: #3b82f6; color: #1d4ed8; }",
    ".entry-group.dialogue blockquote { background: #fff7ed; border-left-color: #f59e0b; color: #9a3412; white-space: pre-wrap; }",
    "ol { padding-left: 1.25rem; }",
  ].join("\n");
}

function buildChapterXhtml(chapter, language) {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(language)}">
  <head>
    <title>${escapeXml(chapter.title)}</title>
    <meta charset="utf-8" />
    <link rel="stylesheet" type="text/css" href="styles.css" />
  </head>
  <body>
    <section>
      <h2>${escapeXml(chapter.title)}</h2>
      ${chapter.bodyHtml}
    </section>
  </body>
</html>
`;
}

function buildNavXhtml(chapters, title, language) {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(language)}">
  <head>
    <title>${escapeXml(title)} - 导航</title>
    <meta charset="utf-8" />
  </head>
  <body>
    <nav epub:type="toc" id="toc" xmlns:epub="http://www.idpf.org/2007/ops">
      <h1>${escapeXml(title)}</h1>
      <ol>
        ${chapters.map((chapter) => `<li><a href="${escapeXml(chapter.fileName)}">${escapeXml(chapter.title)}</a></li>`).join("\n")}
      </ol>
    </nav>
  </body>
</html>
`;
}

function buildTocNcx(chapters, identifier, title) {
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

function buildContentOpf(chapters, identifier, title, language) {
  const generatedDate = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>${escapeXml(language)}</dc:language>
    <dc:creator>由播客转写整理（extension local）</dc:creator>
    <dc:date>${escapeXml(generatedDate)}</dc:date>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="css" href="styles.css" media-type="text/css" />
    ${chapters
      .map((chapter) => `<item id="${escapeXml(chapter.id)}" href="${escapeXml(chapter.fileName)}" media-type="application/xhtml+xml" />`)
      .join("\n    ")}
  </manifest>
  <spine toc="ncx">
    ${chapters.map((chapter) => `<itemref idref="${escapeXml(chapter.id)}" />`).join("\n    ")}
  </spine>
</package>
`;
}

function writeUint16(target, offset, value) {
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
  view.setUint16(offset, value, true);
}

function writeUint32(target, offset, value) {
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
  view.setUint32(offset, value >>> 0, true);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  return {
    time: (hours << 11) | (minutes << 5) | seconds,
    date: ((year - 1980) << 9) | (month << 5) | day,
  };
}

function concatUint8Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function buildStoredZip(entries) {
  const fileDate = getDosDateTime(new Date());
  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const checksum = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    writeUint32(localHeader, 0, 0x04034b50);
    writeUint16(localHeader, 4, 20);
    writeUint16(localHeader, 6, 0);
    writeUint16(localHeader, 8, 0);
    writeUint16(localHeader, 10, fileDate.time);
    writeUint16(localHeader, 12, fileDate.date);
    writeUint32(localHeader, 14, checksum);
    writeUint32(localHeader, 18, dataBytes.byteLength);
    writeUint32(localHeader, 22, dataBytes.byteLength);
    writeUint16(localHeader, 26, nameBytes.length);
    writeUint16(localHeader, 28, 0);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    writeUint32(centralHeader, 0, 0x02014b50);
    writeUint16(centralHeader, 4, 20);
    writeUint16(centralHeader, 6, 20);
    writeUint16(centralHeader, 8, 0);
    writeUint16(centralHeader, 10, 0);
    writeUint16(centralHeader, 12, fileDate.time);
    writeUint16(centralHeader, 14, fileDate.date);
    writeUint32(centralHeader, 16, checksum);
    writeUint32(centralHeader, 20, dataBytes.byteLength);
    writeUint32(centralHeader, 24, dataBytes.byteLength);
    writeUint16(centralHeader, 28, nameBytes.length);
    writeUint16(centralHeader, 30, 0);
    writeUint16(centralHeader, 32, 0);
    writeUint16(centralHeader, 34, 0);
    writeUint16(centralHeader, 36, 0);
    writeUint32(centralHeader, 38, 0);
    writeUint32(centralHeader, 42, localOffset);
    centralHeader.set(nameBytes, 46);

    localChunks.push(localHeader, dataBytes);
    centralChunks.push(centralHeader);
    localOffset += localHeader.byteLength + dataBytes.byteLength;
  }

  const centralDirectory = concatUint8Arrays(centralChunks);
  const end = new Uint8Array(22);
  writeUint32(end, 0, 0x06054b50);
  writeUint16(end, 4, 0);
  writeUint16(end, 6, 0);
  writeUint16(end, 8, entries.length);
  writeUint16(end, 10, entries.length);
  writeUint32(end, 12, centralDirectory.byteLength);
  writeUint32(end, 16, localOffset);
  writeUint16(end, 20, 0);

  return new Blob([...localChunks, centralDirectory, end], { type: "application/epub+zip" });
}

async function sha256Hex(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (item) => item.toString(16).padStart(2, "0")).join("");
}

export async function createEpubFromBookletDraft(params) {
  if (!params.bookletDraft?.sections?.length) {
    throw new Error("请先生成 Booklet Draft。");
  }

  const jobId = createLocalId("run");
  const createdAt = new Date().toISOString();
  const sourceRef = typeof params.metadata?.episode_url === "string" ? params.metadata.episode_url : undefined;
  const stages = [];
  const pushStage = (stage) => {
    stages.push({
      ...stage,
      ts: new Date().toISOString(),
    });
  };

  pushStage({
    stage: "normalization",
    input: {
      source_type: "booklet_draft",
      source_ref: sourceRef ?? null,
      section_count: params.bookletDraft.sections.length,
      draft_preview: JSON.stringify(params.bookletDraft, null, 2).slice(0, 2_500),
    },
    config: {
      flow: "booklet_draft_to_epub",
      output_format: "epub",
      execution_mode: "extension_local",
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
      renderer: "browser_epub_writer_v1",
      compression: "stored",
    },
  });

  const chapters = buildChapterFiles(params.bookletDraft);
  const identifier = jobId;
  const entries = [
    { name: "mimetype", data: "application/epub+zip" },
    {
      name: "META-INF/container.xml",
      data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>
`,
    },
    { name: "OEBPS/styles.css", data: buildStyles() },
    { name: "OEBPS/nav.xhtml", data: buildNavXhtml(chapters, params.bookletDraft.title, params.language) },
    { name: "OEBPS/toc.ncx", data: buildTocNcx(chapters, identifier, params.bookletDraft.title) },
    { name: "OEBPS/content.opf", data: buildContentOpf(chapters, identifier, params.bookletDraft.title, params.language) },
    ...chapters.map((chapter) => ({
      name: `OEBPS/${chapter.fileName}`,
      data: buildChapterXhtml(chapter, params.language),
    })),
  ];

  const blob = buildStoredZip(entries);
  const sizeBytes = blob.size;
  const checksum = await sha256Hex(blob);
  const fileName = `${jobId}.epub`;

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
    status: "succeeded",
    created_at: createdAt,
    artifacts: [
      {
        type: "epub",
        file_name: fileName,
        size_bytes: sizeBytes,
        expires_at: null,
        download_url: null,
      },
    ],
    blob,
    stages,
    traceability: {
      source_type: "booklet_draft",
      source_ref: sourceRef ?? "internal://source-ref",
      generated_at: new Date().toISOString(),
    },
  };
}
