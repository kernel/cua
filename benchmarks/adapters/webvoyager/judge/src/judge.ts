/**
 * WebVoyager single-call multimodal judge, verifier entrypoint for the Harbor
 * adapter.
 *
 * Runs inside the Kernel browser VM (which ships `node` + global `fetch`) as a
 * self-contained bundle — no `npm install` at verify time. Reads the agent's
 * final answer (`/logs/agent/answer.txt`) and the last `MAX_IMAGES` screenshots
 * it spilled (`/logs/agent/shots/shot-<n>.png`), sends them to a vision model
 * with WebVoyager's verbatim SYSTEM_PROMPT via pi-ai, and writes a single 0/1
 * reward to `/logs/verifier/reward.txt` (`NOT SUCCESS` -> 0, `SUCCESS` -> 1,
 * ambiguous -> fail-closed 0).
 *
 * Any failure the bin owns — a missing/corrupt artifact, model resolution, or
 * the judge call — fails closed to 0 (recorded in grading_details), so a missing
 * ground_truth.json or a transient API hiccup never crashes the verifier into a
 * missing-reward trial.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";
import { lastShots, loadAnswer, loadGroundTruth } from "./artifacts.ts";
import { judgeModel } from "./model.ts";
import type { GradingDetails, JudgeModel } from "./types.ts";
import { gradeWithWebJudge } from "./webjudge.ts";

export interface Args {
  groundTruth: string;
  answer: string;
  shots: string;
  judgeModel: string;
  maxImages: number;
  rewardOut: string;
  detailsOut?: string;
}

const DEFAULT_MAX_IMAGES = 15;

/**
 * Parse `--max-images` into a positive integer last-k window. A 0, negative, or
 * non-numeric value (e.g. a bad `WEBVOYAGER_MAX_IMAGES` env override) would make
 * `lastShots`' `slice(-k)` attach *all* screenshots — blowing the judge's token
 * budget — so anything that isn't a positive integer falls back to the default.
 */
export function parseMaxImages(raw: string | undefined): number {
  const value = Number(raw ?? DEFAULT_MAX_IMAGES);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_IMAGES;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      flags.set(arg.slice(2), argv[i + 1] ?? "");
      i += 1;
    }
  }
  const required = (name: string): string => {
    const value = flags.get(name);
    if (!value) throw new Error(`missing required --${name}`);
    return value;
  };
  return {
    groundTruth: flags.get("ground-truth") ?? "/tests/ground_truth.json",
    answer: flags.get("answer") ?? "/logs/agent/answer.txt",
    shots: flags.get("shots") ?? "/logs/agent/shots",
    judgeModel: flags.get("judge-model") ?? "claude-sonnet-4-5",
    maxImages: parseMaxImages(flags.get("max-images")),
    rewardOut: required("reward-out"),
    detailsOut: flags.get("details-out"),
  };
}

function writeReward(path: string, reward: 0 | 1): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, String(reward));
}

function formatError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function writeDetails(args: Args, details: GradingDetails): void {
  if (!args.detailsOut) return;
  mkdirSync(dirname(args.detailsOut), { recursive: true });
  writeFileSync(args.detailsOut, JSON.stringify(details, null, 2));
}

/**
 * Read the artifacts, grade through `makeJudge()`, and write reward.txt (+
 * optional grading_details.json). Every step the bin owns — reading
 * ground_truth.json / answer.txt / the screenshots, model resolution, and the
 * judge call — runs inside the try, so a missing/corrupt artifact, a missing
 * key, or a transient API error fails closed to reward 0 with the error recorded
 * in the details rather than throwing out of the bin and leaving the reward file
 * empty. Takes a factory so the file contract is testable without a live
 * provider call.
 */
export async function run(args: Args, makeJudge: () => JudgeModel): Promise<void> {
  let answer = "";
  let nImages = 0;
  let verdict = "";
  let reward: 0 | 1 = 0;
  try {
    const task = loadGroundTruth(args.groundTruth).task;
    answer = loadAnswer(args.answer);
    const shots = lastShots(args.shots, args.maxImages);
    nImages = shots.length;

    // No answer and no screenshots: nothing to judge, fail closed without details.
    if (!answer && shots.length === 0) {
      writeReward(args.rewardOut, 0);
      return;
    }

    ({ verdict, reward } = await gradeWithWebJudge({ task, answer, shots, judge: makeJudge() }));
  } catch (err) {
    writeReward(args.rewardOut, 0);
    writeDetails(args, {
      verdict_raw: verdict,
      reward: 0,
      n_images: nImages,
      answer,
      model: args.judgeModel,
      error: formatError(err),
    });
    return;
  }

  writeReward(args.rewardOut, reward);
  writeDetails(args, {
    verdict_raw: verdict,
    reward,
    n_images: nImages,
    answer,
    model: args.judgeModel,
    error: null,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(argv.slice(2));
  await run(args, () => judgeModel(args.judgeModel));
}

// Run only when invoked as the bin (`node judge.js`), not when imported by tests.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
}
