/**
 * WebJudge prompts and parsers, ported from
 * OSU-NLP-Group/Online-Mind2Web `src/methods/webjudge_online_mind2web.py`.
 *
 * The prompt text and the literal markers (`**Key Points**`, `Score`, `Status:`)
 * are reproduced verbatim because the parsers below depend on them.
 */

export const MAX_IMAGE = 50;

export const KEY_POINTS_SYSTEM = `You are an expert tasked with analyzing a given task to identify the key points explicitly stated in the task description.

**Objective**: Carefully analyze the task description and extract the critical elements explicitly mentioned in the task for achieving its goal.

**Instructions**:
1. Read the task description carefully.
2. Identify and extract **key points** directly stated in the task description.
   - A **key point** is a critical element, condition, or step explicitly mentioned in the task description.
   - Do not infer or add any unstated elements.
   - Words such as "best," "highest," "cheapest," "latest," "most recent," "lowest," "closest," "highest-rated," "largest," and "newest" must go through the sort function(e.g., the key point should be "Filter by highest").

**Respond with**:
- **Key Points**: A numbered list of the explicit key points for completing this task, one per line, without explanations or additional details.`;

export const JUDGE_IMAGE_SYSTEM = `You are an expert evaluator tasked with determining whether an image contains information about the necessary steps to complete a task.

**Objective**: Analyze the provided image and decide if it shows essential steps or evidence required for completing the task. Use your reasoning to explain your decision before assigning a score.

**Instructions**:
1. Provide a detailed description of the image, including its contents, visible elements, text (if any), and any notable features.

2. Carefully examine the image and evaluate whether it contains necessary steps or evidence crucial to task completion:
- Identify key points that could be relevant to task completion, such as actions, progress indicators, tool usage, applied filters, or step-by-step instructions.
- Does the image show actions, progress indicators, or critical information directly related to completing the task?
- Is this information indispensable for understanding or ensuring task success?
- If the image contains partial but relevant information, consider its usefulness rather than dismissing it outright.

3. Provide your response in the following format:
- **Reasoning**: Explain your thought process and observations. Mention specific elements in the image that indicate necessary steps, evidence, or lack thereof.
- **Score**: Assign a score based on the reasoning, using the following scale:
    - **1**: The image does not contain any necessary steps or relevant information.
    - **2**: The image contains minimal or ambiguous information, unlikely to be essential.
    - **3**: The image includes some relevant steps or hints but lacks clarity or completeness.
    - **4**: The image contains important steps or evidence that are highly relevant but not fully comprehensive.
    - **5**: The image clearly displays necessary steps or evidence crucial for completing the task.

Respond with:
1. **Reasoning**: [Your explanation]
2. **Score**: [1-5]`;

export const FINAL_JUDGE_SYSTEM = `You are an expert in evaluating the performance of a web navigation agent. The agent is designed to help a human user navigate a website to complete a task. Given the user's task, the agent's action history, key points for task completion, some potentially important web pages in the agent's trajectory and their reasons, your goal is to determine whether the agent has completed the task and achieved all requirements.

Your response must strictly follow the following evaluation criteria!
*Important Evaluation Criteria*:
1: The filtered results must be displayed correctly. If filters were not properly applied (i.e., missing selection, missing confirmation, or no visible effect in results), the task is not considered successful.
2: You must carefully check whether these snapshots and action history meet these key points. Ensure that specific filter conditions, such as "best," "highest," "cheapest," "latest," "most recent," "lowest," "closest," "highest-rated," "largest," and "newest" are correctly applied using the filter function(e.g., sort function).
3: Certain key points or requirements should be applied by the filter. Otherwise, a search with all requirements as input will be deemed a failure since it cannot guarantee that all results meet the requirements!
4: If the task requires filtering by a specific range of money, years, or the number of beds and bathrooms, the applied filter must exactly match the given requirement. Any deviation results in failure. To ensure the task is successful, the applied filter must precisely match the specified range without being too broad or too narrow.
Examples of Failure Cases:
- If the requirement is less than $50, but the applied filter is less than $25, it is a failure.
- If the requirement is $1500-$2500, but the applied filter is $2000-$2500, it is a failure.
- If the requirement is $25-$200, but the applied filter is $0-$200, it is a failure.
- If the required years are 2004-2012, but the filter applied is 2001-2012, it is a failure.
- If the required years are before 2015, but the applied filter is 2000-2014, it is a failure.
- If the task requires exactly 2 beds, but the filter applied is 2+ beds, it is a failure.
5: Some tasks require a submission action or a display of results to be considered successful.
6: If the retrieved information is invalid or empty(e.g., No match was found), but the agent has correctly performed the required action, it should still be considered successful.
7: If the current page already displays all available items, then applying a filter is not necessary. As long as the agent selects items that meet the requirements (e.g., the cheapest or lowest price), the task is still considered successful.

*IMPORTANT*
Format your response into two lines as shown below:

Thoughts: <your thoughts and reasoning process based on double-checking each key points and the evaluation criteria>
Status: "success" or "failure"`;

export function keyPointsUserText(task: string): string {
  return `Task: ${task}`;
}

export function judgeImageUserText(task: string, keyPoints: string): string {
  return `**Task**: ${task}

**Key Points for Task Completion**: ${keyPoints}

The snapshot of the web page is shown in the image.`;
}

export function finalUserText(args: {
  task: string;
  keyPoints: string;
  actions: string[];
  thoughts: string[];
  hasImages: boolean;
}): string {
  const lastActions = args.actions.map((a, i) => `${i + 1}. ${a}`).join("\n");
  const head = `User Task: ${args.task}

Key Points: ${args.keyPoints}

Action History:
${lastActions}`;
  if (!args.hasImages) return head;
  const thoughts = args.thoughts.map((t, i) => `${i + 1}. ${t}`).join("\n");
  return `${head}

The potentially important snapshots of the webpage in the agent's trajectory and their reasons:
${thoughts}`;
}

export function extractKeyPoints(raw: string): string {
  const collapsed = raw.replace(/\n\n/g, "\n");
  const afterMarker = collapsed.includes("**Key Points**:")
    ? collapsed.split("**Key Points**:")[1]
    : collapsed.split("Key Points:").at(-1);
  return (afterMarker ?? "")
    .split("\n")
    .map((line) => line.replace(/^\s+/, ""))
    .join("\n");
}

export function parseImageScore(raw: string): { score: number; thought: string } {
  try {
    const scoreText = raw.split("Score")[1] ?? "";
    const match = scoreText.match(/[1-5]/);
    const score = match ? Number(match[0]) : 0;
    const thought = (raw.split("**Reasoning**:").at(-1) ?? "")
      .trim()
      .replace(/^\n+/, "")
      .split("\n\n")[0]
      .replace(/\n/g, " ");
    return { score, thought };
  } catch {
    return { score: 0, thought: "" };
  }
}

export function parseVerdict(raw: string): boolean {
  return raw.toLowerCase().split("status:")[1]?.includes("success") ?? false;
}
