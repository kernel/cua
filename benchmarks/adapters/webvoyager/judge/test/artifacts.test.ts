import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lastShots, loadAnswer, loadGroundTruth } from "../src/artifacts.ts";

/** Lay out a shots dir with `shot-<n>.png` files (1x1 PNG bytes). */
function writeShots(indices: number[]): string {
  const dir = mkdtempSync(join(tmpdir(), "wv-shots-"));
  mkdirSync(dir, { recursive: true });
  for (const n of indices) {
    writeFileSync(join(dir, `shot-${n}.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47, n % 256]));
  }
  return dir;
}

describe("lastShots", () => {
  it("orders shots by numeric index, not lexicographically", () => {
    const dir = writeShots([1, 2, 10]);
    expect(lastShots(dir, 10).map((s) => s.name)).toEqual([
      "shot-1.png",
      "shot-2.png",
      "shot-10.png",
    ]);
  });

  it("takes the final k screenshots", () => {
    const dir = writeShots([1, 2, 3, 4, 5]);
    expect(lastShots(dir, 3).map((s) => s.name)).toEqual([
      "shot-3.png",
      "shot-4.png",
      "shot-5.png",
    ]);
  });

  it("reads bytes into base64 with the png media type", () => {
    const dir = writeShots([1]);
    const [shot] = lastShots(dir, 1);
    expect(shot.mimeType).toBe("image/png");
    expect(shot.base64).toBe(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]).toString("base64"));
  });

  it("returns nothing when the shots dir is absent", () => {
    expect(lastShots(join(tmpdir(), "wv-missing-shots-xyz"), 15)).toEqual([]);
  });
});

describe("loadGroundTruth / loadAnswer", () => {
  it("reads the task from ground_truth.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "wv-gt-"));
    const path = join(dir, "ground_truth.json");
    writeFileSync(path, JSON.stringify({ task: "find a recipe", web_name: "Allrecipes" }));
    expect(loadGroundTruth(path).task).toBe("find a recipe");
  });

  it("trims the answer file and returns empty string when absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "wv-ans-"));
    const path = join(dir, "answer.txt");
    writeFileSync(path, "  the answer\n");
    expect(loadAnswer(path)).toBe("the answer");
    expect(loadAnswer(join(dir, "nope.txt"))).toBe("");
  });
});
