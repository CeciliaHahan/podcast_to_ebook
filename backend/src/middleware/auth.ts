import type { NextFunction, Request, Response } from "express";
import { createHash } from "node:crypto";
import { ApiError } from "../lib/errors.js";
import { config } from "../config.js";
import { ensureUserByEmail } from "../repositories/usersRepo.js";

function parseBearerEmail(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return null;
  }

  if (token.startsWith("dev:")) {
    return token.slice("dev:".length).trim() || null;
  }

  // Local fallback token.
  if (token === "dev-token") {
    return "dev@example.com";
  }
  return null;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const email = parseBearerEmail(req.header("authorization"));
    if (!email) {
      throw new ApiError(401, "UNAUTHORIZED", "Missing or invalid bearer token.");
    }
    const isStatelessEpubEndpoint = req.path === "/epub/from-transcript";
    if (!config.databaseEnabled || isStatelessEpubEndpoint) {
      const stableUserId = `usr_${createHash("sha256").update(email).digest("hex").slice(0, 16)}`;
      req.authUser = { id: stableUserId, email };
      next();
      return;
    }
    let user;
    try {
      user = await ensureUserByEmail(email);
    } catch {
      throw new ApiError(503, "DB_UNAVAILABLE", "Database unavailable for DB-backed endpoints.");
    }
    req.authUser = { id: user.id, email: user.email };
    next();
  } catch (error) {
    next(error);
  }
}
