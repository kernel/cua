import type { ComputerToolCoordinateSystem, CuaProviderModule } from "../common";
import { computerToolExecutors, computerTools } from "../common";

export {
	CUA_ACTION_TYPES as OPENAI_CUA_ACTION_TYPES,
	CUA_NAVIGATION_TOOL_DESCRIPTION as OPENAI_EXTRA_TOOL_DESCRIPTION,
	CUA_NAVIGATION_TOOL_NAME as OPENAI_EXTRA_TOOL_NAME,
	computerToolExecutors,
	computerTools,
	createCuaActionSchema as createActionSchema,
	CuaNavigationSchema as OpenAIExtraSchema,
} from "../common";
export type {
	CuaAction as OpenAIAction,
	ComputerToolsOptions,
	CuaNavigationInput as OpenAIExtraInput,
} from "../common";

// Provider-native action vocabulary emitted on `computer_call.action.type`:
//   click, double_click, drag, move, scroll, type, keypress, wait, screenshot
// Source: https://github.com/openai/openai-cua-sample-app/blob/main/packages/runner-core/src/responses-loop.ts
export function coordinateSystem(): ComputerToolCoordinateSystem {
	return { type: "pixel" };
}

export const OPENAI_COMPUTER_INSTRUCTIONS = `You control a Kernel cloud browser through individual browser tools. Use the available tools for browser interaction and request explicit url, cursor_position, or screenshot reads when you need updated state.`;

export function buildOpenAISystemPrompt(opts: { suffix?: string } = {}): string {
	return [OPENAI_COMPUTER_INSTRUCTIONS, opts.suffix].filter(Boolean).join("\n\n");
}

export function openaiResponsesStoreOnPayload(payload: unknown): unknown | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const current = payload as Record<string, unknown>;
	if (current.store === true) return undefined;
	return {
		...current,
		store: true,
	};
}

export const providerModule = {
	toolDefinitions: computerTools,
	toolExecutors: computerToolExecutors,
	coordinateSystem,
	buildSystemPrompt: buildOpenAISystemPrompt,
	onPayload: openaiResponsesStoreOnPayload,
} satisfies CuaProviderModule;
