import { db } from "../db/pool.js";
import { createId } from "../lib/ids.js";

export async function ensureUserByEmail(email: string): Promise<{ id: string; email: string }> {
  const normalized = email.toLowerCase().trim();
  const existing = await db.query<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [normalized],
  );
  if (existing.rowCount && existing.rows[0]) {
    return existing.rows[0];
  }

  const created = await db.query<{ id: string; email: string }>(
    `INSERT INTO users (id, email) VALUES ($1, $2) RETURNING id, email`,
    [createId("usr"), normalized],
  );
  return created.rows[0];
}
