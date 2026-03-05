import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { asyncHandler } from "../lib/asyncHandler.js";
import { ApiError } from "../lib/errors.js";
import type { OutputFormat } from "../types/domain.js";

const router = Router();

function inferTypeFromFileName(fileName: string): OutputFormat | null {
  if (fileName.endsWith(".epub")) {
    return "epub";
  }
  if (fileName.endsWith(".pdf")) {
    return "pdf";
  }
  if (fileName.endsWith(".md")) {
    return "md";
  }
  return null;
}

async function resolveArtifactFromFilesystem(jobId: string, fileName: string) {
  const type = inferTypeFromFileName(fileName);
  if (!type) {
    return null;
  }
  const storageUri = path.resolve(process.cwd(), ".dev-artifacts", jobId, fileName);
  try {
    const stat = await fs.stat(storageUri);
    if (!stat.isFile()) {
      return null;
    }
    return {
      fileName,
      storageUri,
      expiresAt: null,
      type,
    };
  } catch {
    return null;
  }
}

router.get(
  "/downloads/:job_id/:file_name",
  asyncHandler(async (req, res) => {
    const token = req.query.token;
    if (token !== "dev") {
      throw new ApiError(403, "FORBIDDEN", "Invalid download token.");
    }

    const jobId = req.params.job_id;
    const fileName = path.basename(req.params.file_name);
    if (!jobId || !fileName) {
      throw new ApiError(400, "INVALID_INPUT", "Invalid download path.");
    }

    const artifact = await resolveArtifactFromFilesystem(jobId, fileName);
    if (!artifact) {
      throw new ApiError(404, "NOT_FOUND", "Artifact not found.");
    }

    if (artifact.expiresAt && new Date(artifact.expiresAt).getTime() < Date.now()) {
      throw new ApiError(410, "ARTIFACT_EXPIRED", "Artifact link expired.");
    }

    const contentType =
      artifact.type === "epub"
        ? "application/epub+zip"
        : artifact.type === "pdf"
          ? "application/pdf"
          : "text/markdown; charset=utf-8";
    res.setHeader("Content-Type", contentType);
    res.download(artifact.storageUri, artifact.fileName);
  }),
);

export { router as downloadsRouter };
