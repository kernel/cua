import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ComputerTranslator } from "@onkernel/cua-translator";
import { createYutoriPerActionTools } from "../computer-tool";
import type { YutoriComputerToolsOptions } from "../computer";
import { YUTORI_ACTION_TYPES } from "../official";
export {
	YUTORI_CHAT_COMPLETIONS_API,
	registerYutoriProvider,
	streamSimpleYutori,
	streamYutori,
} from "./provider";
export type { YutoriOptions } from "./provider";

const YUTORI_BUILTIN_TOOL_NAMES = new Set<string>(YUTORI_ACTION_TYPES);

export function createYutoriComputerTools(
	translator: ComputerTranslator,
	opts: YutoriComputerToolsOptions = {},
): AgentTool<any, any>[] {
	return createYutoriPerActionTools(translator, opts);
}

/**
 * Yutori provides Navigator browser actions as built-in tools. Keep the local
 * AgentTool definitions so pi-agent-core can execute returned tool calls, but
 * remove those duplicate function definitions from the outbound payload.
 */
export function yutoriBuiltinToolsOnPayload(payload: unknown): unknown | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const current = payload as { tools?: unknown };
	if (!Array.isArray(current.tools)) return undefined;
	const tools = current.tools.filter((tool) => {
		const name = readToolName(tool);
		return !name || !YUTORI_BUILTIN_TOOL_NAMES.has(name);
	});
	return {
		...(payload as Record<string, unknown>),
		...(tools.length > 0 ? { tools } : { tools: undefined }),
	};
}

function readToolName(tool: unknown): string | undefined {
	if (!tool || typeof tool !== "object") return undefined;
	const obj = tool as { function?: { name?: unknown }; name?: unknown };
	if (typeof obj.function?.name === "string") return obj.function.name;
	if (typeof obj.name === "string") return obj.name;
	return undefined;
}

export { createYutoriPerActionTools } from "../computer-tool";
export type { YutoriToolDetails, YutoriComputerToolsOptions } from "../computer";
