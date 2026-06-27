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

/**
 * Wrap the shared canonical executors with OpenRouter-specific normalization.
 *
 * OpenRouter's GLM-V models can emit tuple-shaped coordinates (`[x, y]`) for
 * scalar fields, so this override unwraps those payloads before browser
 * execution.
 */
export function computerToolExecutors(options: ComputerToolsOptions = {}): CuaToolExecutorSpec[] {
	return createCuaActionToolExecutors(options.actions).map((executor) => ({
		...executor,
		toActions(args: unknown): CuaAction[] {
			return executor.toActions(args).map(normalizeOpenRouterAction);
		},
	}));
}

/**
 * Normalize OpenRouter canonical actions into finite scalar coordinates.
 *
 * Source: OpenRouter exposes Z.AI GLM-V models that can return tuple-like
 * coordinate arguments; see https://openrouter.ai/z-ai/glm-4.6v.
 */
export function normalizeOpenRouterAction(action: CuaAction): CuaAction {
	// GLM-4.6V via OpenRouter can return [x, y] tuples in scalar coordinate
	// fields even when the function schema asks for numbers.
	switch (action.type) {
		case "click":
		case "double_click":
		case "mouse_down":
		case "mouse_up":
		case "move": {
			const x = coordinateNumber(action.x, 0);
			const y = coordinateNumber(action.y, 1) ?? coordinateTupleNumber(action.x, 1);
			return {
				...action,
				x: requiredCoordinate(x, action.type, "x"),
				y: requiredCoordinate(y, action.type, "y"),
			};
		}
		case "scroll": {
			const x = coordinateNumber(action.x, 0);
			const y = coordinateNumber(action.y, 1) ?? coordinateTupleNumber(action.x, 1);
			return {
				...action,
				x,
				y,
			};
		}
		case "drag":
			return {
				...action,
				path: action.path.map((point) => {
					const x = coordinateNumber(point.x, 0);
					const y = coordinateNumber(point.y, 1) ?? coordinateTupleNumber(point.x, 1);
					return {
						x: requiredCoordinate(x, action.type, "x"),
						y: requiredCoordinate(y, action.type, "y"),
					};
				}),
			};
		default:
			return action;
	}
}

function coordinateNumber(value: unknown, index: number): number | undefined {
	return finiteNumber(value) ?? coordinateTupleNumber(value, index);
}

function coordinateTupleNumber(value: unknown, index: number): number | undefined {
	if (!Array.isArray(value)) return undefined;
	const next = value[index] ?? value[0];
	return finiteNumber(next);
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requiredCoordinate(
	value: number | undefined,
	actionType: CuaAction["type"],
	axis: "x" | "y",
): number {
	if (value !== undefined) return value;
	throw new Error(`OpenRouter ${actionType} action is missing a finite ${axis} coordinate`);
}

export const providerModule = {
	toolDefinitions: computerTools,
	toolExecutors: computerToolExecutors,
	coordinateSystem,
	buildSystemPrompt: buildOpenRouterSystemPrompt,
} satisfies CuaProviderModule;
