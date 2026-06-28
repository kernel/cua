import * as P from "./prompts.ts";
import type { Shot } from "./artifacts.ts";
import type { JudgeContent, JudgeModel } from "./types.ts";

/**
 * WebVoyager's single-call multimodal judge: one message with the task + answer
 * text, the last-k screenshots, and a trailing "Your verdict:" block, scored
 * against the verbatim SYSTEM_PROMPT. Block order (text -> images -> verdict)
 * matches upstream `auto_eval.py`.
 */
export async function gradeWithWebJudge(args: {
  task: string;
  answer: string;
  shots: Shot[];
  judge: JudgeModel;
}): Promise<{ verdict: string; reward: 0 | 1 }> {
  const content: JudgeContent = [
    { type: "text", text: P.userText(args.task, args.answer, args.shots.length) },
    ...args.shots.map((shot) => ({
      type: "image" as const,
      data: shot.base64,
      mimeType: shot.mimeType,
    })),
    { type: "text", text: P.VERDICT_TEXT },
  ];
  const verdict = await args.judge.complete(P.SYSTEM_PROMPT, content);
  return { verdict, reward: P.parseReward(verdict) };
}
