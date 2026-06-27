import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTask, loadTrajectory } from "../src/artifacts.ts";
import type { JudgeContent } from "../src/types.ts";

// Stub pi-ai so the judge tests stay offline: `getModel`/`getEnvApiKey` own the
// provider+key resolution and `completeSimple` owns the network call, all of
// which pi-ai covers and the judge just wires together.
const { completeSimple, getModel, getEnvApiKey } = vi.hoisted(() => ({
  completeSimple: vi.fn(),
  getModel: vi.fn(),
  getEnvApiKey: vi.fn(),
}));
vi.mock("@earendil-works/pi-ai", () => ({ completeSimple, getModel, getEnvApiKey }));

const { judgeModel, parseModelRef } = await import("../src/model.ts");

/** A pi-ai AssistantMessage carrying a single text block. */
function assistantText(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    stopReason: "stop" as const,
  };
}

// 1x1 transparent PNG, the same fixture the shared-core sink test uses.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Lay out a /logs/agent dir exactly as benchmarks/node/src/sink.ts writes it. */
function writeAgentDir(records: Array<Record<string, unknown>>, answer: string): string {
  const dir = mkdtempSync(join(tmpdir(), "om2w-judge-"));
  mkdirSync(join(dir, "shots"), { recursive: true });
  writeFileSync(join(dir, "shots", "shot-1.png"), Buffer.from(PNG_B64, "base64"));
  writeFileSync(
    join(dir, "run.jsonl"),
    `${records.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
  writeFileSync(join(dir, "answer.txt"), answer);
  return dir;
}

describe("loadTask", () => {
  it("maps task.json into a BenchTask", () => {
    const path = join(mkdtempSync(join(tmpdir(), "om2w-task-")), "task.json");
    writeFileSync(
      path,
      JSON.stringify({
        task_id: "abc_123",
        instruction: "Find the cheapest flight",
        start_url: "https://example.com",
        reference_length: 6,
      }),
    );
    expect(loadTask(path)).toEqual({
      id: "abc_123",
      instruction: "Find the cheapest flight",
      startUrl: "https://example.com",
      metadata: { referenceLength: 6 },
    });
  });

  it("omits startUrl when start_url is null", () => {
    const path = join(mkdtempSync(join(tmpdir(), "om2w-task-")), "task.json");
    writeFileSync(
      path,
      JSON.stringify({ task_id: "t", instruction: "do it", start_url: null, reference_length: null }),
    );
    const task = loadTask(path);
    expect(task.startUrl).toBeUndefined();
    expect(task.metadata).toBeUndefined();
  });
});

describe("loadTrajectory", () => {
  it("pairs each spilled screenshot with the tool call that produced it", () => {
    const dir = writeAgentDir(
      [
        { t: "user", text: "go to example.com" },
        {
          t: "assistant",
          tool_calls: [{ id: "call_1", name: "click", arguments: { x: 1, y: 2 } }],
        },
        { t: "tool_result", call_id: "call_1", shots: ["shots/shot-1.png"] },
        { t: "final", answer: "ignored because answer.txt wins" },
      ],
      "Example Domain",
    );

    const trajectory = loadTrajectory({
      runJsonlPath: join(dir, "run.jsonl"),
      answerPath: join(dir, "answer.txt"),
    });

    expect(trajectory.finalAnswer).toBe("Example Domain");
    expect(trajectory.steps).toHaveLength(1);
    expect(trajectory.steps[0]).toMatchObject({
      index: 0,
      action: 'click {"x":1,"y":2}',
      screenshotBase64: PNG_B64,
      screenshotMimeType: "image/png",
    });
  });

  it("falls back to the final record when answer.txt is empty", () => {
    const dir = writeAgentDir(
      [
        { t: "assistant", tool_calls: [{ id: "c", name: "screenshot", arguments: {} }] },
        { t: "tool_result", call_id: "c", shots: ["shots/shot-1.png"] },
        { t: "final", answer: "from final line" },
      ],
      "",
    );

    const trajectory = loadTrajectory({
      runJsonlPath: join(dir, "run.jsonl"),
      answerPath: join(dir, "answer.txt"),
    });

    expect(trajectory.finalAnswer).toBe("from final line");
    expect(trajectory.steps[0].action).toBe("screenshot");
  });

  it("returns an empty trajectory when run.jsonl is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "om2w-empty-"));
    const trajectory = loadTrajectory({
      runJsonlPath: join(dir, "run.jsonl"),
      answerPath: join(dir, "answer.txt"),
    });
    expect(trajectory.steps).toEqual([]);
    expect(trajectory.finalAnswer).toBe("");
  });
});

describe("parseModelRef", () => {
  it("splits provider:name", () => {
    expect(parseModelRef("anthropic:claude-sonnet-4-6")).toEqual({
      provider: "anthropic",
      name: "claude-sonnet-4-6",
    });
  });

  it("defaults provider to openai when no colon", () => {
    expect(parseModelRef("o4-mini")).toEqual({
      provider: "openai",
      name: "o4-mini",
    });
  });
});

describe("judgeModel", () => {
  afterEach(() => {
    completeSimple.mockReset();
    getModel.mockReset();
    getEnvApiKey.mockReset();
  });

  const vision: JudgeContent = [
    { type: "text", text: "score this" },
    { type: "image", data: "AAAA", mimeType: "image/png" },
  ];

  it("resolves the ref through pi-ai and passes the prompt, content, and deterministic options", async () => {
    const model = { id: "o4-mini", provider: "openai" };
    getModel.mockReturnValue(model);
    getEnvApiKey.mockReturnValue("sk-test");
    completeSimple.mockResolvedValue(assistantText("Status: success"));

    const out = await judgeModel("openai:o4-mini").complete("sys", vision);

    expect(out).toBe("Status: success");
    expect(getModel).toHaveBeenCalledWith("openai", "o4-mini");
    expect(getEnvApiKey).toHaveBeenCalledWith("openai");

    const [calledModel, context, options] = completeSimple.mock.calls[0];
    expect(calledModel).toBe(model);
    expect(context.systemPrompt).toBe("sys");
    expect(context.messages[0].role).toBe("user");
    expect(context.messages[0].content).toBe(vision);
    expect(options).toMatchObject({ apiKey: "sk-test", temperature: 0, maxTokens: 1024 });
  });

  it("defaults a bare ref to the openai provider", async () => {
    getModel.mockReturnValue({ id: "o4-mini" });
    getEnvApiKey.mockReturnValue("sk-test");
    completeSimple.mockResolvedValue(assistantText("ok"));

    await judgeModel("o4-mini").complete("sys", [{ type: "text", text: "hi" }]);

    expect(getModel).toHaveBeenCalledWith("openai", "o4-mini");
  });

  it("routes an anthropic ref to the anthropic provider", async () => {
    getModel.mockReturnValue({ id: "claude-opus-4-8" });
    getEnvApiKey.mockReturnValue("sk-ant");
    completeSimple.mockResolvedValue(assistantText("ok"));

    await judgeModel("anthropic:claude-opus-4-8").complete("sys", [{ type: "text", text: "hi" }]);

    expect(getModel).toHaveBeenCalledWith("anthropic", "claude-opus-4-8");
    expect(getEnvApiKey).toHaveBeenCalledWith("anthropic");
    expect(completeSimple.mock.calls[0][2]).toMatchObject({ apiKey: "sk-ant" });
  });

  it("concatenates the text blocks of the assistant message", async () => {
    getModel.mockReturnValue({ id: "o4-mini" });
    getEnvApiKey.mockReturnValue("sk-test");
    completeSimple.mockResolvedValue({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "reasoning..." },
        { type: "text", text: "Status: " },
        { type: "text", text: "success" },
      ],
      stopReason: "stop",
    });

    const out = await judgeModel("openai:o4-mini").complete("sys", vision);
    expect(out).toBe("Status: success");
  });

  it("throws when pi-ai returns a provider error instead of throwing", async () => {
    getModel.mockReturnValue({ id: "o4-mini" });
    getEnvApiKey.mockReturnValue("sk-test");
    completeSimple.mockResolvedValue({
      role: "assistant",
      content: [],
      stopReason: "error",
      errorMessage: "OpenAI API error (401): Incorrect API key",
    });

    await expect(judgeModel("openai:o4-mini").complete("sys", vision)).rejects.toThrow(
      "judge model error: OpenAI API error (401): Incorrect API key",
    );
  });

  it("throws when the model ref is unknown to pi-ai", () => {
    getModel.mockReturnValue(undefined);
    expect(() => judgeModel("gemini:flash")).toThrow('unknown judge model "gemini:flash"');
  });

  it("throws when no API key is configured for the provider", () => {
    getModel.mockReturnValue({ id: "o4-mini" });
    getEnvApiKey.mockReturnValue(undefined);
    expect(() => judgeModel("openai:o4-mini")).toThrow(
      'no API key in the environment for judge provider "openai"',
    );
  });
});
