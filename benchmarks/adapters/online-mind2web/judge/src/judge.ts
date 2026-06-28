/**
 * WebJudge verifier entrypoint for the Online-Mind2Web Harbor adapter.
 *
 * Runs inside the Kernel browser VM (which ships `node` + global `fetch`) as a
 * self-contained bundle — no `npm install` at verify time. Reads the agent's
 * artifacts under `/logs/agent` (answer.txt + run.jsonl + shots/), reconstructs
 * the WebJudge trajectory, grades it with the configured judge backbone
 * (default OpenAI o4-mini, the published WebJudge model), and writes a single
 * reward float to `/logs/verifier/reward.txt`.
 *
 * A missing/empty trajectory or any failure writes reward `0` rather than
 * leaving the reward file empty (an empty reward is a Harbor verifier error).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { loadTask, loadTrajectory } from "./artifacts.ts";
import { judgeModel } from "./model.ts";
import type { GradeResult } from "./types.ts";
import { gradeWithWebJudge } from "./webjudge.ts";

interface Args {
  task: string;
  run: string;
  answer: string;
  shots?: string;
  judgeModel: string;
  scoreThreshold: number;
  rewardOut: string;
  detailsOut?: string;
}

export function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      flags.set(arg.slice(2), argv[i + 1] ?? "");
      i += 1;
    }
  }
  const require = (name: string): string => {
    const value = flags.get(name);
    if (!value) throw new Error(`missing required --${name}`);
    return value;
  };
  // A non-numeric --score-threshold (NaN) would fail every `score >= threshold`
  // comparison and silently grade zero snapshots, so fall back to the default 3.
  const threshold = Number(flags.get("score-threshold") ?? "3");
  return {
    task: require("task"),
    run: require("run"),
    answer: require("answer"),
    shots: flags.get("shots"),
    judgeModel: flags.get("judge-model") ?? "openai:o4-mini",
    scoreThreshold: Number.isFinite(threshold) ? threshold : 3,
    rewardOut: require("reward-out"),
    detailsOut: flags.get("details-out"),
  };
}

function writeReward(path: string, reward: 0 | 1): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${reward}\n`);
}

/**
 * Write the grading outcome. The reward is the authoritative output and is
 * written first; the `grading_details.json` artifact is best-effort, so a
 * failure writing it logs to stderr but never flips the decided reward.
 */
export function writeOutcome(args: Args, result: GradeResult): void {
  writeReward(args.rewardOut, result.success ? 1 : 0);
  if (!args.detailsOut) return;
  try {
    mkdirSync(dirname(args.detailsOut), { recursive: true });
    writeFileSync(
      args.detailsOut,
      JSON.stringify(
        { success: result.success, reasoning: result.reasoning, details: result.details },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  }
}

async function main(): Promise<void> {
  const args = parseArgs(argv.slice(2));
  try {
    const task = loadTask(args.task);
    const trajectory = loadTrajectory({
      runJsonlPath: args.run,
      answerPath: args.answer,
      shotsBaseDir: args.shots,
    });
    const judge = judgeModel(args.judgeModel);
    const result = await gradeWithWebJudge({
      task,
      trajectory,
      judge,
      scoreThreshold: args.scoreThreshold,
    });
    writeOutcome(args, result);
  } catch (err) {
    // Never leave the reward file empty: a grading failure is a 0, and the
    // error is surfaced on stderr for the verifier log.
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    writeReward(args.rewardOut, 0);
  }
}

// Run only as the CLI entrypoint, so importing this module from a test does not
// fire grading against vitest's argv.
if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  main();
}
