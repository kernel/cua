import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Args } from "../src/judge.ts";
import { parseMaxImages, run } from "../src/judge.ts";
import type { GradingDetails, JudgeContent, JudgeModel } from "../src/types.ts";

/** A /logs/agent + /tests layout, plus the verifier output paths run() writes. */
function setup(opts: { answer: string | null; shotIndices: number[] }) {
  const root = mkdtempSync(join(tmpdir(), "wv-judge-"));
  const shotsDir = join(root, "agent", "shots");
  mkdirSync(shotsDir, { recursive: true });
  if (opts.answer !== null) {
    writeFileSync(join(root, "agent", "answer.txt"), opts.answer);
  }
  for (const n of opts.shotIndices) {
    writeFileSync(join(shotsDir, `shot-${n}.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47, n % 256]));
  }
  writeFileSync(join(root, "ground_truth.json"), JSON.stringify({ task: "do a thing" }));
  const args: Args = {
    groundTruth: join(root, "ground_truth.json"),
    answer: join(root, "agent", "answer.txt"),
    shots: shotsDir,
    judgeModel: "claude-sonnet-4-5",
    maxImages: 15,
    rewardOut: join(root, "verifier", "reward.txt"),
    detailsOut: join(root, "verifier", "grading_details.json"),
  };
  return { args };
}

/** A judge that records what it was asked and returns a canned verdict. */
function captureJudge(verdict: string): { make: () => JudgeModel; calls: JudgeContent[] } {
  const calls: JudgeContent[] = [];
  const make = (): JudgeModel => ({
    async complete(_systemPrompt, content) {
      calls.push(content);
      return verdict;
    },
  });
  return { make, calls };
}

function readDetails(args: Args): GradingDetails {
  return JSON.parse(readFileSync(args.detailsOut!, "utf8")) as GradingDetails;
}

describe("run", () => {
  it.each([
    ["The agent did it. SUCCESS", "1"],
    ["It failed. NOT SUCCESS", "0"],
    ["ambiguous waffle", "0"],
    ["clearly NOT SUCCESS even though SUCCESS appears", "0"],
  ])("verdict %s writes reward %s and the raw verdict", async (verdict, expected) => {
    const { args } = setup({ answer: "ans", shotIndices: [1] });
    await run(args, captureJudge(verdict).make);
    expect(readFileSync(args.rewardOut, "utf8")).toBe(expected);
    const details = readDetails(args);
    expect(details.verdict_raw).toBe(verdict);
    expect(details.n_images).toBe(1);
  });

  it("fails closed to 0 with no details when there is no answer and no shots", async () => {
    const { args } = setup({ answer: "", shotIndices: [] });
    let called = false;
    await run(args, () => {
      called = true;
      return { async complete() { return ""; } };
    });
    expect(called).toBe(false);
    expect(readFileSync(args.rewardOut, "utf8")).toBe("0");
    expect(existsSync(args.detailsOut!)).toBe(false);
  });

  it("attaches the last-k images and the task + answer text", async () => {
    const { args } = setup({ answer: "my answer", shotIndices: [1, 2] });
    args.maxImages = 2;
    const { make, calls } = captureJudge("SUCCESS");
    await run(args, make);
    const images = calls[0].filter((c) => c.type === "image");
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({ mimeType: "image/png" });
    const first = calls[0][0];
    expect(first.type === "text" && first.text).toContain("do a thing");
    expect(first.type === "text" && first.text).toContain("my answer");
  });

  it("fails closed to reward 0 and records the error when the judge throws", async () => {
    const { args } = setup({ answer: "ans", shotIndices: [1] });
    await run(args, () => ({
      async complete() {
        throw new Error("API error 529: overloaded");
      },
    }));
    expect(readFileSync(args.rewardOut, "utf8")).toBe("0");
    const details = readDetails(args);
    expect(details.reward).toBe(0);
    expect(details.error).toContain("529");
  });

  it("fails closed when model resolution throws (missing key / bad provider)", async () => {
    const { args } = setup({ answer: "ans", shotIndices: [1] });
    await run(args, () => {
      throw new Error("ANTHROPIC_API_KEY is required");
    });
    expect(readFileSync(args.rewardOut, "utf8")).toBe("0");
    expect(readDetails(args).error).toContain("ANTHROPIC_API_KEY");
  });
});

describe("parseMaxImages", () => {
  it("keeps a valid positive integer", () => {
    expect(parseMaxImages("3")).toBe(3);
    expect(parseMaxImages("15")).toBe(15);
  });

  it("defaults to 15 when unset", () => {
    expect(parseMaxImages(undefined)).toBe(15);
  });

  // A 0/negative/non-numeric last-k makes slice(-k) attach ALL screenshots, so
  // anything that isn't a positive integer must fall back to the default.
  it.each(["0", "-5", "abc", "", "2.5"])("falls back to 15 for invalid %o", (raw) => {
    expect(parseMaxImages(raw)).toBe(15);
  });
});
