import { describe, expect, it } from "vitest";
import {
  extractKeyPoints,
  FINAL_JUDGE_SYSTEM,
  JUDGE_IMAGE_SYSTEM,
  KEY_POINTS_SYSTEM,
  parseImageScore,
  parseVerdict,
} from "../src/prompts.ts";
import type { JudgeContent, JudgeModel, Trajectory } from "../src/types.ts";
import { gradeWithWebJudge } from "../src/webjudge.ts";

interface Call {
  systemPrompt: string;
  content: JudgeContent;
}

/** A scripted JudgeModel: returns `responses[i]` for the i-th call and records every call. */
function scriptedJudge(responses: string[]): { judge: JudgeModel; calls: Call[] } {
  const calls: Call[] = [];
  const judge: JudgeModel = {
    async complete(systemPrompt, content) {
      calls.push({ systemPrompt, content });
      return responses[calls.length - 1] ?? "";
    },
  };
  return { judge, calls };
}

function imageBlocks(content: JudgeContent): JudgeContent {
  return content.filter((c) => c.type === "image");
}

function textBlock(content: JudgeContent): string {
  const text = content.find((c) => c.type === "text");
  return text && text.type === "text" ? text.text : "";
}

const task = { id: "t1", instruction: "Find the cheapest flight" };
const trajectory: Trajectory = {
  steps: [
    { index: 0, action: "goto example.com", screenshotBase64: "AAAA", screenshotMimeType: "image/png" },
    { index: 1, action: "click {x:1}", screenshotBase64: "BBBB", screenshotMimeType: "image/png" },
  ],
  finalAnswer: "done",
};

const KEY_POINTS_RESPONSE = "**Key Points**:\n1. Find cheapest flight\n2. Filter by lowest";
const SHOT_PASS = "**Reasoning**: shows the filter applied\n\nScore: 4";
const SHOT_FAIL = "**Reasoning**: irrelevant\nScore: 1";

describe("WebJudge parsers", () => {
  it("extractKeyPoints strips the marker and per-line indentation", () => {
    expect(extractKeyPoints(KEY_POINTS_RESPONSE)).toBe("\n1. Find cheapest flight\n2. Filter by lowest");
  });

  it("parseImageScore reads the score and reasoning", () => {
    expect(parseImageScore(SHOT_PASS)).toEqual({ score: 4, thought: "shows the filter applied" });
    expect(parseImageScore(SHOT_FAIL).score).toBe(1);
  });

  it("parseImageScore returns 0 when no score is present", () => {
    expect(parseImageScore("no score here").score).toBe(0);
  });

  it("parseVerdict reads the status line", () => {
    expect(parseVerdict("Thoughts: ok\nStatus: success")).toBe(true);
    expect(parseVerdict("Thoughts: no\nStatus: failure")).toBe(false);
    expect(parseVerdict("garbage")).toBe(false);
  });
});

describe("gradeWithWebJudge", () => {
  it("scores screenshots, keeps those above the threshold, and returns the verdict", async () => {
    const { judge, calls } = scriptedJudge([
      KEY_POINTS_RESPONSE,
      SHOT_PASS,
      SHOT_FAIL,
      "Thoughts: looks complete\nStatus: success",
    ]);

    const result = await gradeWithWebJudge({ task, trajectory, judge, scoreThreshold: 3 });

    expect(result.success).toBe(true);
    expect(result.reasoning).toContain("Status: success");
    expect(result.details?.keyPoints).toBe("\n1. Find cheapest flight\n2. Filter by lowest");

    expect(calls[0].systemPrompt).toBe(KEY_POINTS_SYSTEM);
    expect(calls[1].systemPrompt).toBe(JUDGE_IMAGE_SYSTEM);
    expect(calls[1].content).toEqual([
      { type: "text", text: expect.stringContaining("**Task**: Find the cheapest flight") },
      { type: "image", data: "AAAA", mimeType: "image/png" },
    ]);

    const finalCall = calls.at(-1)!;
    expect(finalCall.systemPrompt).toBe(FINAL_JUDGE_SYSTEM);
    expect(imageBlocks(finalCall.content)).toHaveLength(1);
    expect(imageBlocks(finalCall.content)[0]).toMatchObject({ data: "AAAA" });
    expect(textBlock(finalCall.content)).toContain("important snapshots");
    expect(textBlock(finalCall.content)).toContain("1. goto example.com");
  });

  it("omits the snapshots section when no screenshot passes the threshold", async () => {
    const { judge, calls } = scriptedJudge([
      KEY_POINTS_RESPONSE,
      SHOT_FAIL,
      SHOT_FAIL,
      "Thoughts: nothing useful\nStatus: failure",
    ]);

    const result = await gradeWithWebJudge({ task, trajectory, judge, scoreThreshold: 5 });

    expect(result.success).toBe(false);
    const finalCall = calls.at(-1)!;
    expect(imageBlocks(finalCall.content)).toHaveLength(0);
    expect(textBlock(finalCall.content)).not.toContain("important snapshots");
    expect(textBlock(finalCall.content)).toContain("Action History:");
  });
});
