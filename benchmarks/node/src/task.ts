import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CuaAgentHarness, InMemorySessionRepo, NodeExecutionEnv } from "@onkernel/cua-agent";
import { type CuaModelRef, type ImageContent, requireCuaEnvApiKeyForModel } from "@onkernel/cua-ai";
import Kernel from "@onkernel/sdk";
import { extractFinalAnswer } from "./answer.ts";
import { attachAtifSink, writeFinalLine, writeUserLine } from "./sink.ts";

/** Pinned @onkernel/cua-agent version; surfaced in the run.jsonl `final` line. */
const CUA_AGENT_VERSION = "0.3.5";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readInstruction(): string {
  const fromEnv = process.env.AGENT_INSTRUCTION;
  if (fromEnv) return fromEnv;
  const fromArg = process.argv[2];
  if (fromArg) return fromArg;
  throw new Error("instruction is required (set AGENT_INSTRUCTION or pass it as the first argument)");
}

async function main(): Promise<void> {
  // The Python agent maps Harbor's `provider/name` to cua's `provider:name`;
  // requireCuaEnvApiKeyForModel validates the ref at runtime below.
  const model = requireEnv("CUA_MODEL") as CuaModelRef;
  const outDir = requireEnv("AGENT_OUT_DIR");
  const taskId = process.env.TASK_ID ?? "cua-task";
  const instruction = readInstruction();

  requireCuaEnvApiKeyForModel(model);

  const client = new Kernel({ apiKey: requireEnv("KERNEL_API_KEY") });
  const kernelSessionId = requireEnv("KERNEL_SESSION_ID");
  const browser = await client.browsers.retrieve(kernelSessionId);
  const session = await new InMemorySessionRepo().create({ id: taskId });
  const harness = new CuaAgentHarness({
    browser,
    client,
    env: new NodeExecutionEnv({ cwd: process.cwd() }),
    model,
    session,
    computerUseExtra: true,
  });

  writeUserLine(outDir, instruction);
  const unsubscribe = attachAtifSink({ harness, outDir });
  try {
    const images = await captureInitialScreenshot(client, kernelSessionId);
    const assistant = await harness.prompt(instruction, images ? { images } : undefined);
    if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
      throw new Error(assistant.errorMessage ?? `agent stopped with ${assistant.stopReason}`);
    }
  } finally {
    unsubscribe();
  }

  const branch = await session.getBranch();
  const answer = extractFinalAnswer(branch);
  writeFileSync(join(outDir, "answer.txt"), answer);
  writeFinalLine(outDir, { answer, session_id: taskId, model, agent_version: CUA_AGENT_VERSION });
}

async function captureInitialScreenshot(client: Kernel, sessionId: string): Promise<ImageContent[] | undefined> {
  try {
    const screenshot = await client.browsers.computer.captureScreenshot(sessionId);
    const image = Buffer.from(await screenshot.arrayBuffer()).toString("base64");
    return [{ type: "image", data: image, mimeType: "image/png" }];
  } catch {
    return undefined;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
