import { Router } from "express";

const router = Router();

router.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "podcasts-to-ebooks-backend" });
});

export { router as healthRouter };
