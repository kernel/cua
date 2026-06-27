import { describe, expect, it } from "vitest";
import { parseReward, SYSTEM_PROMPT, userText } from "../src/prompts.ts";

describe("WebVoyager prompts", () => {
  it("SYSTEM_PROMPT is the verbatim WebVoyager evaluator prompt", () => {
    expect(SYSTEM_PROMPT.startsWith("As an evaluator")).toBe(true);
    expect(SYSTEM_PROMPT).toContain("'SUCCESS' or 'NOT SUCCESS'");
  });

  it("userText fills task, answer, and screenshot count", () => {
    expect(userText("do a thing", "my answer", 2)).toBe(
      "TASK: do a thing\nResult Response: my answer\n2 screenshot(s) at the end:",
    );
  });

  it("userText keeps $-sequences literal (prices, regex specials)", () => {
    expect(userText("hotels $1500-$2500", "cheapest $2,499", 3)).toBe(
      "TASK: hotels $1500-$2500\nResult Response: cheapest $2,499\n3 screenshot(s) at the end:",
    );
    // `$&`/`$'` are special in string-replacement values; they must survive verbatim.
    expect(userText("price $& and $' end", "x", 1)).toBe(
      "TASK: price $& and $' end\nResult Response: x\n1 screenshot(s) at the end:",
    );
  });
});

describe("parseReward", () => {
  // Mirrors the Python webjudge verdict cases verbatim.
  it.each([
    ["The agent did it. SUCCESS", 1],
    ["It failed. NOT SUCCESS", 0],
    ["ambiguous waffle", 0], // neither marker -> fail-closed
    ["clearly NOT SUCCESS even though SUCCESS appears", 0], // NOT SUCCESS wins
  ])("%s -> %d", (verdict, expected) => {
    expect(parseReward(verdict)).toBe(expected);
  });
});
