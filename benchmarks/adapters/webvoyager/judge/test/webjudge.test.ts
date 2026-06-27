import { describe, expect, it } from "vitest";
import type { Shot } from "../src/artifacts.ts";
import { SYSTEM_PROMPT, VERDICT_TEXT } from "../src/prompts.ts";
import type { JudgeContent, JudgeModel } from "../src/types.ts";
import { gradeWithWebJudge } from "../src/webjudge.ts";

interface Call {
  systemPrompt: string;
  content: JudgeContent;
}

function scriptedJudge(verdict: string): { judge: JudgeModel; calls: Call[] } {
  const calls: Call[] = [];
  const judge: JudgeModel = {
    async complete(systemPrompt, content) {
      calls.push({ systemPrompt, content });
      return verdict;
    },
  };
  return { judge, calls };
}

const shots: Shot[] = [
  { name: "shot-1.png", base64: "AAAA", mimeType: "image/png" },
  { name: "shot-2.png", base64: "BBBB", mimeType: "image/png" },
];

describe("gradeWithWebJudge", () => {
  it("sends the system prompt, task+answer text, images, then the verdict block", async () => {
    const { judge, calls } = scriptedJudge("Reasoning. SUCCESS");
    const { verdict, reward } = await gradeWithWebJudge({
      task: "do a thing",
      answer: "my answer",
      shots,
      judge,
    });

    expect(reward).toBe(1);
    expect(verdict).toBe("Reasoning. SUCCESS");
    expect(calls).toHaveLength(1);
    expect(calls[0].systemPrompt).toBe(SYSTEM_PROMPT);

    const content = calls[0].content;
    const images = content.filter((c) => c.type === "image");
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({ data: "AAAA", mimeType: "image/png" });

    const first = content[0];
    expect(first.type === "text" && first.text).toContain("do a thing");
    expect(first.type === "text" && first.text).toContain("my answer");
    expect(first.type === "text" && first.text).toContain("2 screenshot(s) at the end:");

    const last = content.at(-1)!;
    expect(last).toEqual({ type: "text", text: VERDICT_TEXT });
  });

  it("fails closed to 0 on a NOT SUCCESS verdict", async () => {
    const { judge } = scriptedJudge("It did not work. NOT SUCCESS");
    const { reward } = await gradeWithWebJudge({ task: "t", answer: "a", shots, judge });
    expect(reward).toBe(0);
  });
});
