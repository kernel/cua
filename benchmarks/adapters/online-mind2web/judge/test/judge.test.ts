import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs, writeOutcome } from "../src/judge.ts";
import type { GradeResult } from "../src/types.ts";

const BASE = [
  "--task",
  "/t/task.json",
  "--run",
  "/t/run.jsonl",
  "--answer",
  "/t/answer.txt",
  "--reward-out",
  "/t/reward.txt",
];

describe("parseArgs score-threshold", () => {
  it("parses a numeric threshold", () => {
    expect(parseArgs([...BASE, "--score-threshold", "4"]).scoreThreshold).toBe(4);
  });

  it("defaults to 3 when the flag is absent", () => {
    expect(parseArgs(BASE).scoreThreshold).toBe(3);
  });

  it("falls back to 3 for a non-numeric threshold instead of NaN", () => {
    expect(parseArgs([...BASE, "--score-threshold", "three"]).scoreThreshold).toBe(3);
  });

  it("keeps an explicit 0 threshold", () => {
    expect(parseArgs([...BASE, "--score-threshold", "0"]).scoreThreshold).toBe(0);
  });
});

describe("writeOutcome", () => {
  afterEach(() => vi.restoreAllMocks());

  const pass: GradeResult = { success: true, reasoning: "Status: success", details: {} };

  it("writes the decided reward", () => {
    const dir = mkdtempSync(join(tmpdir(), "om2w-outcome-"));
    const rewardOut = join(dir, "reward.txt");
    writeOutcome({ ...argsFor(rewardOut), detailsOut: join(dir, "details.json") }, pass);
    expect(readFileSync(rewardOut, "utf8")).toBe("1\n");
    expect(JSON.parse(readFileSync(join(dir, "details.json"), "utf8")).success).toBe(true);
  });

  it("keeps the reward when the details write fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "om2w-outcome-"));
    const rewardOut = join(dir, "reward.txt");
    // Make the details dir un-creatable: its parent is a regular file, so
    // mkdirSync throws ENOTDIR. The reward must survive.
    const fileAsDir = join(dir, "afile");
    writeFileSync(fileAsDir, "");
    vi.spyOn(console, "error").mockImplementation(() => {});

    writeOutcome({ ...argsFor(rewardOut), detailsOut: join(fileAsDir, "details.json") }, pass);

    expect(readFileSync(rewardOut, "utf8")).toBe("1\n");
  });
});

function argsFor(rewardOut: string) {
  return {
    task: "/t/task.json",
    run: "/t/run.jsonl",
    answer: "/t/answer.txt",
    judgeModel: "openai:o4-mini",
    scoreThreshold: 3,
    rewardOut,
  };
}
