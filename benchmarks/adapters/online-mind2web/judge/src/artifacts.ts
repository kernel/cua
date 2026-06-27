import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { BenchTask, Trajectory, TrajectoryStep } from "./types.ts";

/** Grader input written by the adapter (tests/task.json). */
interface TaskJson {
  task_id: string;
  instruction: string;
  start_url?: string | null;
  reference_length?: number | null;
  level?: string | null;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  gif: "image/gif",
};

function mimeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "png";
  return MIME_BY_EXT[ext] ?? "image/png";
}

export function loadTask(taskJsonPath: string): BenchTask {
  const raw = JSON.parse(readFileSync(taskJsonPath, "utf8")) as TaskJson;
  return {
    id: raw.task_id,
    instruction: raw.instruction,
    startUrl: raw.start_url ?? undefined,
    metadata:
      raw.reference_length != null ? { referenceLength: raw.reference_length } : undefined,
  };
}

/** A description of one tool call, used as the WebJudge "action" string. */
function actionString(name: string, args: unknown): string {
  if (args && typeof args === "object" && Object.keys(args).length > 0) {
    return `${name} ${JSON.stringify(args)}`;
  }
  return name;
}

/**
 * Reconstruct a WebJudge {@link Trajectory} from the shared-core artifacts.
 *
 * The Node entrypoint (`benchmarks/node/src/sink.ts`) writes `run.jsonl` with
 * `assistant` lines carrying `tool_calls: [{id, name, arguments}]` and
 * `tool_result` lines carrying `{call_id, shots: ["shots/shot-N.png"]}`. Each
 * spilled screenshot becomes one step whose action is the tool call that
 * produced it; the bytes are read from disk into base64 for the judge. The
 * final answer comes from `answer.txt` (the grading channel), falling back to
 * the `final` record.
 */
export function loadTrajectory(opts: {
  runJsonlPath: string;
  answerPath: string;
  shotsBaseDir?: string;
}): Trajectory {
  const baseDir = opts.shotsBaseDir ?? dirname(opts.answerPath);

  let finalAnswer = "";
  if (existsSync(opts.answerPath)) {
    finalAnswer = readFileSync(opts.answerPath, "utf8").trim();
  }

  const steps: TrajectoryStep[] = [];
  if (existsSync(opts.runJsonlPath)) {
    const callActions = new Map<string, string>();
    const lines = readFileSync(opts.runJsonlPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const rec = JSON.parse(trimmed) as Record<string, unknown>;
      if (rec.t === "assistant") {
        for (const tc of (rec.tool_calls as Array<Record<string, unknown>>) ?? []) {
          callActions.set(
            String(tc.id),
            actionString(String(tc.name ?? ""), tc.arguments),
          );
        }
      } else if (rec.t === "tool_result") {
        const action = callActions.get(String(rec.call_id)) ?? "tool_result";
        for (const rel of (rec.shots as string[]) ?? []) {
          const abs = isAbsolute(rel) ? rel : join(baseDir, rel);
          if (!existsSync(abs)) continue;
          steps.push({
            index: steps.length,
            action,
            screenshotBase64: readFileSync(abs).toString("base64"),
            screenshotMimeType: mimeForPath(rel),
          });
        }
      } else if (rec.t === "final" && !finalAnswer) {
        finalAnswer = String(rec.answer ?? "");
      }
    }
  }

  return { steps, finalAnswer };
}
