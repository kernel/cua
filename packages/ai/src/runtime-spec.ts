import type { CuaProvider } from "./models";
import { getCuaModel, providerForModel } from "./models";
import { providerModule as anthropic } from "./providers/anthropic/index";
import { providerModule as gemini } from "./providers/gemini/index";
import { providerModule as openai } from "./providers/openai/index";
import { providerModule as tzafon } from "./providers/tzafon/index";
import { providerModule as yutori } from "./providers/yutori/index";
import type {
	ComputerToolsOptions,
	CuaProviderModule,
	CuaRuntimeSpec,
	CuaRuntimeSpecInput,
} from "./providers/common";

const PROVIDERS = {
	openai,
	anthropic,
	google: gemini,
	tzafon,
	yutori,
} satisfies Record<CuaProvider, CuaProviderModule>;

/**
 * Resolve provider defaults from either a CUA model ref or a concrete model.
 *
 * Use the returned spec to build computer-use requests without hard-coding
 * model-provider rules in your application. Pass `options` (e.g.
 * `{ actions: ["click"] }`) to narrow the resolved tool definitions and
 * executors to a supported subset.
 */
export function resolveCuaRuntimeSpec(input: CuaRuntimeSpecInput, options?: ComputerToolsOptions): CuaRuntimeSpec {
	const model = typeof input === "string" ? getCuaModel(input) : input;
	const provider = providerForModel(model);
	const mod: CuaProviderModule = PROVIDERS[provider];
	return {
		model,
		provider,
		toolDefinitions: mod.toolDefinitions(options),
		toolExecutors: mod.toolExecutors(options),
		defaultSystemPrompt: mod.buildSystemPrompt(),
		coordinateSystem: mod.coordinateSystem(),
		screenshot: mod.screenshot,
		onPayload: mod.onPayload,
	};
}
