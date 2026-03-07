import { Router, type Request } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler.js";
import { ApiError } from "../lib/errors.js";
import { config } from "../config.js";
import { createEpubFromTranscriptInline } from "../services/epubInlineService.js";
import { createBookletOutlineFromWorkingNotes, createWorkingNotesFromTranscript } from "../services/workingNotesService.js";

const router = Router();

const MAX_TRANSCRIPT_CHARS = 120_000;

const epubTranscriptRequestSchema = z.object({
  title: z.string().min(1).max(300),
  language: z.string().min(1),
  transcript_text: z.string().min(10).max(MAX_TRANSCRIPT_CHARS),
  template_id: z.string().default("templateA-v0-book"),
  metadata: z.record(z.unknown()).optional(),
});

const workingNotesTranscriptRequestSchema = z.object({
  title: z.string().trim().min(1).max(300),
  language: z.string().min(1),
  transcript_text: z.string().min(10).max(config.llmInputMaxChars),
  metadata: z.record(z.unknown()).optional(),
});

const workingNotesSchema = z.object({
  title: z.string().min(1),
  summary: z.array(z.string().min(1)).min(1),
  sections: z
    .array(
      z.object({
        heading: z.string().min(1),
        bullets: z.array(z.string().min(1)).min(1),
        excerpts: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
});

const bookletOutlineRequestSchema = z.object({
  title: z.string().trim().min(1).max(300),
  language: z.string().min(1),
  working_notes: workingNotesSchema,
  metadata: z.record(z.unknown()).optional(),
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
  });
  res.status(200).json(response);
});

const createWorkingNotesFromTranscriptRoute = asyncHandler(async (req: Request, res) => {
  getUser(req);
  const parsed = workingNotesTranscriptRequestSchema.parse(req.body);
  const response = await createWorkingNotesFromTranscript({
    title: parsed.title,
    language: parsed.language,
    transcriptText: parsed.transcript_text,
    metadata: parsed.metadata,
  });
  res.status(200).json(response);
});

const createBookletOutlineRoute = asyncHandler(async (req: Request, res) => {
  getUser(req);
  const parsed = bookletOutlineRequestSchema.parse(req.body);
  const response = await createBookletOutlineFromWorkingNotes({
    title: parsed.title,
    language: parsed.language,
    workingNotes: parsed.working_notes,
    metadata: parsed.metadata,
  });
  res.status(200).json(response);
});

router.post("/epub/from-transcript", createEpubFromTranscriptRoute);
router.post("/working-notes/from-transcript", createWorkingNotesFromTranscriptRoute);
router.post("/booklet-outline/from-working-notes", createBookletOutlineRoute);

export { router as v1Router };
