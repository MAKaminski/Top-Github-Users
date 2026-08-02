import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
export const DATA_DIR = path.join(REPO_ROOT, "data");

/**
 * Deterministic JSON writer.
 *
 * Object keys are emitted in sorted order and numbers are left exact, so a run
 * that discovers nothing new produces a byte-identical file and therefore an
 * empty git diff. Non-determinism here is the difference between a repository
 * that stays reviewable and one that churns megabytes a day.
 */
export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(sortKeys(value), null, 0)}\n`, "utf8");
}

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortKeys(source[key]);
    return out;
  }
  return value;
}
