/** Multimodal content passed to a {@link JudgeModel}: text and image blocks. */
export type JudgeContent = Array<
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
>;

/** A model used by the judge. Implemented by a pi-ai call; mocked in tests. */
export interface JudgeModel {
  complete(systemPrompt: string, content: JudgeContent): Promise<string>;
}

/** Grader input read from tests/ground_truth.json. */
export interface GroundTruth {
  task: string;
}

/** What the judge writes to grading_details.json alongside the reward. */
export interface GradingDetails {
  verdict_raw: string;
  reward: 0 | 1;
  n_images: number;
  answer: string;
  model: string;
  error: string | null;
}
