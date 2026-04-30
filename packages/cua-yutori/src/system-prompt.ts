export interface YutoriSystemPromptOptions {
	toolPreamble?: boolean;
	additionalSystemPrompt?: string;
}

const YUTORI_BROWSER_NOTE = `Use Yutori Navigator's browser actions for web interaction. Coordinates are normalized by the model and executed by the runtime.`;
const TOOL_PREAMBLE_LINE = `Before every tool call, first output a single short sentence describing what you are about to do.`;

export function buildYutoriSystemPrompt(opts: YutoriSystemPromptOptions = {}): string {
	const sections = [YUTORI_BROWSER_NOTE];
	if (opts.toolPreamble !== false) sections.push(TOOL_PREAMBLE_LINE);
	const extra = (opts.additionalSystemPrompt ?? "").trim();
	if (extra) sections.push(extra);
	return sections.join("\n\n");
}
