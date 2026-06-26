import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CuaAgentHarness, InMemorySessionRepo, NodeExecutionEnv } from "@onkernel/cua-agent";
import { type CuaModelRef, requireCuaEnvApiKeyForModel } from "@onkernel/cua-ai";
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
  const browser = await client.browsers.retrieve(requireEnv("KERNEL_SESSION_ID"));
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
    await harness.prompt(instruction);
  } finally {
    unsubscribe();
  }

  const branch = await session.getBranch();
  const answer = extractFinalAnswer(branch);
  writeFileSync(join(outDir, "answer.txt"), answer);
  writeFinalLine(outDir, { answer, session_id: taskId, model, agent_version: CUA_AGENT_VERSION });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
