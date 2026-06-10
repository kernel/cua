import type { CuaProvider } from "./models.js";
import { getCuaModel, providerForModel } from "./models.js";
import { providerModule as anthropic } from "./providers/anthropic/index.js";
import { providerModule as gemini } from "./providers/gemini/index.js";
import { providerModule as openai } from "./providers/openai/index.js";
import { providerModule as tzafon } from "./providers/tzafon/index.js";
import { providerModule as yutori } from "./providers/yutori/index.js";
import type {
	CuaProviderModule,
	CuaRuntimeSpec,
	CuaRuntimeSpecInput,
} from "./providers/common.js";

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
 * model-provider rules in your application.
 */
export function resolveCuaRuntimeSpec(input: CuaRuntimeSpecInput): CuaRuntimeSpec {
	const model = typeof input === "string" ? getCuaModel(input) : input;
	const provider = providerForModel(model);
	const mod: CuaProviderModule = PROVIDERS[provider];
	return {
		model,
		provider,
		toolDefinitions: mod.toolDefinitions(),
		toolExecutors: mod.toolExecutors(),
		defaultSystemPrompt: mod.buildSystemPrompt(),
		coordinateSystem: mod.coordinateSystem(),
		screenshot: mod.screenshot,
		onPayload: mod.onPayload,
	};
}
