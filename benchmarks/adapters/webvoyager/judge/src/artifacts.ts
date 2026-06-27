import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { GroundTruth } from "./types.ts";

/** A screenshot the cua agent spilled: bytes plus the media type the judge needs. */
export interface Shot {
  name: string;
  base64: string;
  mimeType: string;
}

const MEDIA_BY_SUFFIX: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** Numeric sort key. Shots are `shot-<n>.png` (not zero-padded). */
function shotKey(name: string): number {
  const stem = name.slice(0, name.length - extname(name).length);
  const match = stem.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

export function loadGroundTruth(path: string): GroundTruth {
  return JSON.parse(readFileSync(path, "utf8")) as GroundTruth;
}

export function loadAnswer(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
}

/**
 * The last `k` screenshots in numeric order, read into base64.
 *
 * Mirrors upstream `auto_eval.py`: sort the image files by numeric index and
 * take the final `k` (`matches[-img_num:]`). cua spills one screenshot per
 * step, so the last-k window is where the deciding frame can live.
 */
export function lastShots(shotsDir: string, k: number): Shot[] {
  if (!existsSync(shotsDir)) return [];
  const names = readdirSync(shotsDir)
    .filter((name) => extname(name).toLowerCase() in MEDIA_BY_SUFFIX)
    .sort((a, b) => shotKey(a) - shotKey(b));
  return names.slice(-k).map((name) => ({
    name,
    base64: readFileSync(join(shotsDir, name)).toString("base64"),
    mimeType: MEDIA_BY_SUFFIX[extname(name).toLowerCase()],
  }));
}
