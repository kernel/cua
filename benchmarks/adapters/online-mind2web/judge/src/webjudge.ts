import * as P from "./prompts.ts";
import type { GradeArgs, GradeResult, JudgeContent } from "./types.ts";

/**
 * WebJudge grading pipeline ported from Online-Mind2Web: identify key points,
 * score each screenshot, keep the relevant ones, then ask for a final verdict.
 */
export async function gradeWithWebJudge({
  task,
  trajectory,
  judge,
  scoreThreshold,
}: GradeArgs): Promise<GradeResult> {
  const kpRaw = await judge.complete(P.KEY_POINTS_SYSTEM, [
    { type: "text", text: P.keyPointsUserText(task.instruction) },
  ]);
  const keyPoints = P.extractKeyPoints(kpRaw);

  const shots = trajectory.steps.filter((s) => s.screenshotBase64);
  const scored = await Promise.all(
    shots.map(async (step) => {
      const raw = await judge.complete(P.JUDGE_IMAGE_SYSTEM, [
        { type: "text", text: P.judgeImageUserText(task.instruction, keyPoints) },
        {
          type: "image",
          data: step.screenshotBase64!,
          mimeType: step.screenshotMimeType ?? "image/png",
        },
      ]);
      const { score, thought } = P.parseImageScore(raw);
      return { step, score, thought, raw };
    }),
  );

  const kept = scored.filter((r) => r.score >= scoreThreshold).slice(0, P.MAX_IMAGE);
  const keptThoughts = kept.map((r) => r.thought);
  const actions = trajectory.steps.map((s) => s.action);

  const finalContent: JudgeContent = [
    {
      type: "text",
      text: P.finalUserText({
        task: task.instruction,
        keyPoints,
        actions,
        thoughts: keptThoughts,
        hasImages: kept.length > 0,
      }),
    },
    ...kept.map((r) => ({
      type: "image" as const,
      data: r.step.screenshotBase64!,
      mimeType: r.step.screenshotMimeType ?? "image/png",
    })),
  ];
  const finalRaw = await judge.complete(P.FINAL_JUDGE_SYSTEM, finalContent);

  return {
    success: P.parseVerdict(finalRaw),
    reasoning: finalRaw,
    details: {
      keyPoints,
      imageRecords: scored.map((r) => ({ score: r.score, response: r.raw })),
    },
  };
}
