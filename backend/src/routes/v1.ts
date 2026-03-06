import { Router, type Request } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler.js";
import { ApiError } from "../lib/errors.js";
import { createEpubFromTranscriptInline } from "../services/epubInlineService.js";

const router = Router();

const MAX_TRANSCRIPT_CHARS = 120_000;
const complianceSchema = z.object({
  for_personal_or_authorized_use_only: z.literal(true),
  no_commercial_use: z.literal(true),
});

const epubTranscriptRequestSchema = z.object({
  title: z.string().min(1).max(300),
  language: z.string().min(1),
  transcript_text: z.string().min(10).max(MAX_TRANSCRIPT_CHARS),
  template_id: z.string().default("templateA-v0-book"),
  metadata: z.record(z.unknown()).optional(),
  compliance_declaration: complianceSchema,
});

function getUser(req: Request): { id: string; email: string } {
  const user = req.authUser;
  if (!user) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication required.");
  }
  return user;
}

const createEpubFromTranscriptRoute = asyncHandler(async (req: Request, res) => {
  getUser(req);
  const parsed = epubTranscriptRequestSchema.parse(req.body);
  const response = await createEpubFromTranscriptInline({
    title: parsed.title,
    language: parsed.language,
    transcriptText: parsed.transcript_text,
    templateId: parsed.template_id,
    metadata: parsed.metadata,
    compliance: parsed.compliance_declaration,
  });
  res.status(200).json(response);
});

router.post("/epub/from-transcript", createEpubFromTranscriptRoute);

export { router as v1Router };
