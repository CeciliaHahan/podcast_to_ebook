#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";

import { createBookletDraftFromOutline, DEFAULT_LLM_SETTINGS } from "../extension/sidepanel/local-pipeline.js";
import { createEpubFromBookletDraft } from "../extension/sidepanel/local-epub.js";

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/rerun_draft_epub.mjs --root <review-root> <sample> [sample...]",
      "",
      "Example:",
      "  OPENROUTER_API_KEY=... node scripts/rerun_draft_epub.mjs --root /tmp/pte-review-latest-five high-density-iran speaker-shifts-vibe",
      "",
      "API key lookup order:",
      "  1. OPENROUTER_API_KEY",
      "  2. LLM_API_KEY",
      "  3. extension/sidepanel/config.local.js -> LOCAL_API_KEY",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const result = {
    root: "",
    samples: [],
    language: "zh-CN",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      result.root = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--language") {
      result.language = argv[index + 1] || result.language;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    result.samples.push(arg);
  }

  return result;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildSettings() {
  const envApiKey = process.env.OPENROUTER_API_KEY || process.env.LLM_API_KEY || "";
  const llmApiKey = String(envApiKey || DEFAULT_LLM_SETTINGS.llmApiKey || "").trim();
  if (!llmApiKey) {
    throw new Error(
      "Missing API key. Set OPENROUTER_API_KEY / LLM_API_KEY, or add extension/sidepanel/config.local.js with LOCAL_API_KEY.",
    );
  }
  return {
    ...DEFAULT_LLM_SETTINGS,
    llmApiKey,
  };
}

async function rerunSample({ root, sample, settings, language }) {
  const jsonPath = path.join(root, "json", `${sample}.json`);
  const epubPath = path.join(root, "epubs", `${sample}.epub`);
  const payload = await readJson(jsonPath);

  if (!payload.working_notes?.sections?.length) {
    throw new Error(`${sample}: missing working_notes.sections`);
  }
  if (!payload.booklet_outline?.sections?.length) {
    throw new Error(`${sample}: missing booklet_outline.sections`);
  }

  const draftResult = await createBookletDraftFromOutline({
    title: payload.title,
    language,
    workingNotes: payload.working_notes,
    bookletOutline: payload.booklet_outline,
    settings,
    metadata: {},
  });

  payload.booklet_draft = draftResult.booklet_draft;
  payload.generated_at = new Date().toISOString();
  await writeJson(jsonPath, payload);

  const epubResult = await createEpubFromBookletDraft({
    bookletDraft: draftResult.booklet_draft,
    title: payload.title,
    language,
    metadata: {},
  });

  const bytes = Buffer.from(await epubResult.blob.arrayBuffer());
  await fs.writeFile(epubPath, bytes);

  return {
    sample,
    sections: draftResult.booklet_draft.sections.length,
    jsonPath,
    epubPath,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.root || !args.samples.length) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const root = path.resolve(args.root);
  const settings = buildSettings();

  for (const sample of args.samples) {
    const result = await rerunSample({
      root,
      sample,
      settings,
      language: args.language,
    });
    console.log(`updated ${result.sample} (${result.sections} sections)`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
