import { computerToolExecutors, computerTools, type ComputerToolCoordinateSystem, type CuaProviderModule } from "../common.js";
import { tzafonComputerUseOnPayload } from "./provider.js";

export {
	CUA_ACTION_TYPES as TZAFON_ACTION_TYPES,
	computerToolExecutors,
	computerTools,
	createCuaActionSchema as createActionSchema,
} from "../common.js";
export type {
	CuaAction as TzafonAction,
	ComputerToolsOptions,
} from "../common.js";
export {
	TZAFON_RESPONSES_API,
	streamSimpleTzafonResponses,
	streamTzafonResponses,
	tzafonComputerUseOnPayload,
	tzafonToolCallId,
} from "./provider.js";

// Provider-native action vocabulary. The model card lists supported actions;
// the Responses API loop dispatches on `action.type` and adds terminal control
// types (`answer`, `done`).
//   Model actions: click, double_click, triple_click, right_click, drag, type,
//                  key, scroll, hscroll, navigate, wait, terminate
//   Responses API `action.type` also includes: keypress, answer, done
// Sources:
//   https://huggingface.co/Tzafon/Northstar-CUA-Fast
//   https://docs.lightcone.ai/guides/cua-protocol/
//   https://docs.lightcone.ai/guides/coordinates/
export function coordinateSystem(): ComputerToolCoordinateSystem {
	return { type: "normalized", range: [0, 999] };
}

export const TZAFON_INSTRUCTIONS_RAW = `You control a Kernel cloud browser through individual browser tools. Include screenshot or URL reads when you need updated state.`;

/** Build the default system prompt used with Tzafon CUA models. */
export function buildTzafonSystemPrompt(opts: { suffix?: string } = {}): string {
	return [TZAFON_INSTRUCTIONS_RAW, opts.suffix].filter(Boolean).join("\n\n");
}

export const providerModule = {
	toolDefinitions: computerTools,
	toolExecutors: computerToolExecutors,
	coordinateSystem,
	buildSystemPrompt: buildTzafonSystemPrompt,
	onPayload: tzafonComputerUseOnPayload,
} satisfies CuaProviderModule;
