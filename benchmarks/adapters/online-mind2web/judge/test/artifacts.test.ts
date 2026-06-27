import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTask, loadTrajectory } from "../src/artifacts.ts";
import { anthropicJudgeModel, parseModelRef } from "../src/model.ts";

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

  it("defaults provider to anthropic when no colon", () => {
    expect(parseModelRef("claude-sonnet-4-6")).toEqual({
      provider: "anthropic",
      name: "claude-sonnet-4-6",
    });
  });
});

describe("anthropicJudgeModel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function okResponse(text: string): Response {
    return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });
  }

  it("retries without temperature when the model rejects it (400)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      if (bodies.length === 1) {
        return new Response(
          JSON.stringify({ error: { message: "`temperature` is deprecated for this model." } }),
          { status: 400 },
        );
      }
      return okResponse("verdict");
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await anthropicJudgeModel("anthropic:claude-opus-4-8").complete("sys", [
      { type: "text", text: "hi" },
    ]);

    expect(out).toBe("verdict");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodies[0].temperature).toBe(0);
    expect(bodies[1]).not.toHaveProperty("temperature");
  });

  it("throws on a 400 unrelated to temperature", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 })),
    );

    await expect(
      anthropicJudgeModel("anthropic:claude-opus-4-8").complete("sys", [{ type: "text", text: "hi" }]),
    ).rejects.toThrow("Anthropic API error 400");
  });
});
