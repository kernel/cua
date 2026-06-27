/**
 * WebVoyager judge prompts and verdict parse, ported verbatim from
 * MinorJerry/WebVoyager `evaluation/auto_eval.py` (the single-call GPT-4V judge).
 *
 * SYSTEM_PROMPT is byte-for-byte from upstream; the `SUCCESS` / `NOT SUCCESS`
 * markers the verdict parse keys on are reproduced exactly. This is the
 * parity-load-bearing part — do not reword.
 */

// Verbatim from MinorJerry/WebVoyager evaluation/auto_eval.py SYSTEM_PROMPT.
export const SYSTEM_PROMPT = `As an evaluator, you will be presented with three primary components to assist you in your role:

1. Web Task Instruction: This is a clear and specific directive provided in natural language, detailing the online activity to be carried out. These requirements may include conducting searches, verifying information, comparing prices, checking availability, or any other action relevant to the specified web service (such as Amazon, Apple, ArXiv, BBC News, Booking etc).

2. Result Screenshots: This is a visual representation of the screen showing the result or intermediate state of performing a web task. It serves as visual proof of the actions taken in response to the instruction.

3. Result Response: This is a textual response obtained after the execution of the web task. It serves as textual result in response to the instruction.

-- You DO NOT NEED to interact with web pages or perform actions such as booking flights or conducting searches on websites.
-- You SHOULD NOT make assumptions based on information not presented in the screenshot when comparing it to the instructions.
-- Your primary responsibility is to conduct a thorough assessment of the web task instruction against the outcome depicted in the screenshot and in the response, evaluating whether the actions taken align with the given instructions.
-- NOTE that the instruction may involve more than one task, for example, locating the garage and summarizing the review. Failing to complete either task, such as not providing a summary, should be considered unsuccessful.
-- NOTE that the screenshot is authentic, but the response provided by LLM is generated at the end of web browsing, and there may be discrepancies between the text and the screenshots.
-- Note the difference: 1) Result response may contradict the screenshot, then the content of the screenshot prevails, 2) The content in the Result response is not mentioned on the screenshot, choose to believe the content.

You should elaborate on how you arrived at your final evaluation and then provide a definitive verdict on whether the task has been successfully accomplished, either as 'SUCCESS' or 'NOT SUCCESS'.`;

export const USER_TMPL = "TASK: {task}\nResult Response: {answer}\n{n} screenshot(s) at the end:";

export const VERDICT_TEXT = "Your verdict:\n";

export function userText(task: string, answer: string, n: number): string {
  // Use replacer functions: a string replacement would interpret `$&`, `$'`,
  // etc. in the task/answer (WebVoyager instructions are free-form and contain
  // `$`), corrupting the prompt. The function form returns the value literally.
  return USER_TMPL.replace("{task}", () => task)
    .replace("{answer}", () => answer)
    .replace("{n}", () => String(n));
}

/**
 * Upstream `auto_eval.py`: `0 if 'NOT SUCCESS' in res else (1 if 'SUCCESS' in res
 * else None)`, with `None` folded to 0 (fail-closed) for Harbor's single-float
 * reward. `NOT SUCCESS` wins over `SUCCESS` (checked first).
 */
export function parseReward(verdict: string): 0 | 1 {
  if (verdict.includes("NOT SUCCESS")) return 0;
  if (verdict.includes("SUCCESS")) return 1;
  return 0;
}
