import express from "express";
import { ZodError } from "zod";
import { requireAuth } from "./middleware/auth.js";
import { toErrorResponse } from "./lib/errors.js";
import { healthRouter } from "./routes/health.js";
import { downloadsRouter } from "./routes/downloads.js";
import { v1Router } from "./routes/v1.js";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.use("/", healthRouter);
  app.use("/", downloadsRouter);
  app.use("/v1", requireAuth, v1Router);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: "INVALID_INPUT",
          message: err.issues.map((issue) => issue.message).join("; "),
          request_id: "req_validation",
        },
      });
      return;
    }
    const mapped = toErrorResponse(err);
    res.status(mapped.status).json(mapped.body);
  });

  return app;
}
