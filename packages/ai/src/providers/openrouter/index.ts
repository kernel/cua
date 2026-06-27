import {
	computerTools,
	createCuaActionToolExecutors,
	type ComputerToolsOptions,
	type CuaAction,
	type CuaToolExecutorSpec,
} from "../common";
import type { ComputerToolCoordinateSystem, CuaProviderModule } from "../common";

export {
	CUA_ACTION_TYPES as OPENROUTER_CUA_ACTION_TYPES,
	computerTools,
	createCuaActionSchema as createActionSchema,
} from "../common";
export type {
	ComputerToolsOptions,
	CuaAction as OpenRouterAction,
} from "../common";

// OpenRouter exposes the GLM V models through its OpenAI-compatible Chat
// Completions API. The model-specific Z.AI docs describe function calling, but
// not a provider-native browser coordinate system, so CUA uses screenshot pixel
// coordinates with the standard canonical action tools.
export function coordinateSystem(): ComputerToolCoordinateSystem {
	return { type: "pixel" };
}

export const OPENROUTER_COMPUTER_INSTRUCTIONS = `You control a Kernel cloud browser through individual browser tools. Use screenshot pixel coordinates for tool calls, and request screenshots or URL reads when state changes.`;

export function buildOpenRouterSystemPrompt(opts: { suffix?: string } = {}): string {
	return [OPENROUTER_COMPUTER_INSTRUCTIONS, opts.suffix].filter(Boolean).join("\n\n");
}

export function computerToolExecutors(options: ComputerToolsOptions = {}): CuaToolExecutorSpec[] {
	return createCuaActionToolExecutors(options.actions).map((executor) => ({
		...executor,
		toActions(args: unknown): CuaAction[] {
			return executor.toActions(args).map(normalizeOpenRouterAction);
		},
	}));
}

export function normalizeOpenRouterAction(action: CuaAction): CuaAction {
	// GLM-4.6V via OpenRouter can return [x, y] tuples in scalar coordinate
	// fields even when the function schema asks for numbers.
	switch (action.type) {
		case "click":
		case "double_click":
		case "mouse_down":
		case "mouse_up":
		case "move":
			return {
				...action,
				x: coordinateNumber(action.x, 0) ?? action.x,
				y: coordinateNumber(action.y, 1) ?? coordinateNumber(action.x, 1) ?? action.y,
			};
		case "scroll":
			return {
				...action,
				x: coordinateNumber(action.x, 0) ?? action.x,
				y: coordinateNumber(action.y, 1) ?? coordinateNumber(action.x, 1) ?? action.y,
			};
		case "drag":
			return {
				...action,
				path: action.path.map((point) => ({
					x: coordinateNumber(point.x, 0) ?? point.x,
					y: coordinateNumber(point.y, 1) ?? coordinateNumber(point.x, 1) ?? point.y,
				})),
			};
		default:
			return action;
	}
}

function coordinateNumber(value: unknown, index: number): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (Array.isArray(value)) {
		const next = value[index] ?? value[0];
		return typeof next === "number" && Number.isFinite(next) ? next : undefined;
	}
	return undefined;
}

export const providerModule = {
	toolDefinitions: computerTools,
	toolExecutors: computerToolExecutors,
	coordinateSystem,
	buildSystemPrompt: buildOpenRouterSystemPrompt,
} satisfies CuaProviderModule;
