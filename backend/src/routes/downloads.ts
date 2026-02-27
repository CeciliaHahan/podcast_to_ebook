import { Router } from "express";
import path from "node:path";
import { asyncHandler } from "../lib/asyncHandler.js";
import { ApiError } from "../lib/errors.js";
import { getArtifactForDownload } from "../repositories/jobsRepo.js";

const router = Router();

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

    const artifact = await getArtifactForDownload(jobId, fileName);
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
