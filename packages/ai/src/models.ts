import {
	type Api,
	type Model,
	getModel,
	getModels,
} from "@earendil-works/pi-ai";

export type CuaProvider = "openai" | "anthropic" | "gemini" | "tzafon" | "yutori";
export type CuaModelRef = `${CuaProvider}:${string}`;

export interface CuaModelInfo {
	ref: CuaModelRef;
	provider: CuaProvider;
	model: string;
	name: string;
}

export const CUA_PROVIDERS: readonly CuaProvider[] = ["openai", "anthropic", "gemini", "tzafon", "yutori"];

const CUA_MODEL_OVERRIDES: Record<CuaProvider, CuaModelInfo[]> = {
	openai: [
		cuaModel("openai", "gpt-5.5", "GPT-5.5"),
		cuaModel("openai", "gpt-5.5-2026-04-23", "GPT-5.5 (2026-04-23)"),
	],
	anthropic: [],
	gemini: [
		cuaModel("gemini", "gemini-2.5-computer-use-preview-10-2025", "Gemini 2.5 Computer Use Preview"),
	],
	tzafon: [
		cuaModel("tzafon", "tzafon.northstar-cua-fast", "Tzafon Northstar CUA Fast"),
	],
	yutori: [
		cuaModel("yutori", "n1.5-latest", "Yutori Navigator n1.5"),
		cuaModel("yutori", "n1.5-20260428", "Yutori Navigator n1.5 (2026-04-28)"),
		cuaModel("yutori", "n1-latest", "Yutori Navigator n1"),
		cuaModel("yutori", "n1-20260203", "Yutori Navigator n1 (2026-02-03)"),
	],
};

export function parseCuaModelRef(ref: string): { provider: CuaProvider; model: string } {
	const idx = ref.indexOf(":");
	if (idx <= 0 || idx === ref.length - 1) {
		throw new Error(`CUA model ref must be provider-qualified as "<provider>:<model>"; got "${ref}"`);
	}
	const provider = ref.slice(0, idx);
	const model = ref.slice(idx + 1);
	if (!isCuaProvider(provider)) {
		throw new Error(`unsupported CUA provider "${provider}"`);
	}
	return { provider, model };
}

export function formatCuaModelRef(provider: CuaProvider, model: string): CuaModelRef {
	if (!model.trim()) throw new Error("model id is empty");
	return `${provider}:${model}` as CuaModelRef;
}

export function listCuaModels(provider?: CuaProvider): CuaModelInfo[] {
	const providers = provider ? [provider] : [...CUA_PROVIDERS];
	const byRef = new Map<CuaModelRef, CuaModelInfo>();

	for (const p of providers) {
		for (const entry of CUA_MODEL_OVERRIDES[p]) byRef.set(entry.ref, entry);
		for (const model of getModels(piProviderFor(p) as never) as Model<Api>[]) {
			if (!supportsCuaProvider(p, model.id)) continue;
			const ref = formatCuaModelRef(p, model.id);
			if (byRef.has(ref)) continue;
			byRef.set(ref, {
				ref,
				provider: p,
				model: model.id,
				name: model.name,
			});
		}
	}

	return [...byRef.values()].sort(compareCuaModels);
}

export function getCuaModel(ref: CuaModelRef): Model<Api> {
	const { provider, model: modelId } = parseCuaModelRef(ref);
	if (!supportsCuaProvider(provider, modelId)) {
		throw new Error(`unsupported CUA model "${ref}"`);
	}
	const fromRegistry = getModel(piProviderFor(provider) as never, modelId as never) as Model<Api> | undefined;
	return fromRegistry ?? dynamicModel(provider, modelId);
}

export function providerForModel(model: Model<Api>): CuaProvider {
	switch (model.provider) {
		case "openai":
			return "openai";
		case "anthropic":
			return "anthropic";
		case "google":
			return "gemini";
		case "tzafon":
			return "tzafon";
		case "yutori":
			return "yutori";
		default:
			throw new Error(`unsupported CUA model provider "${model.provider}"`);
	}
}

export function isCuaProvider(value: string): value is CuaProvider {
	return (CUA_PROVIDERS as readonly string[]).includes(value);
}

function piProviderFor(provider: CuaProvider): string {
	switch (provider) {
		case "openai":
			return "openai";
		case "anthropic":
			return "anthropic";
		case "gemini":
			return "google";
		case "tzafon":
			return "tzafon";
		case "yutori":
			return "yutori";
	}
}

function supportsCuaProvider(provider: CuaProvider, modelId: string): boolean {
	const id = modelId.toLowerCase();
	switch (provider) {
		case "openai":
			return /^gpt-5\.(4|5)(?:-|$)/.test(id);
		case "anthropic":
			return (
				id.startsWith("claude-3-7-sonnet") ||
				id.startsWith("claude-opus-4") ||
				id.startsWith("claude-sonnet-4") ||
				id.startsWith("claude-haiku-4")
			);
		case "gemini":
			return id === "gemini-3-flash-preview" || id === "gemini-2.5-computer-use-preview-10-2025";
		case "tzafon":
			return id === "tzafon.northstar-cua-fast";
		case "yutori":
			return id === "n1-latest" || id === "n1-20260203" || id === "n1.5-latest" || id === "n1.5-20260428";
	}
}

function dynamicModel(provider: CuaProvider, modelId: string): Model<Api> {
	const base = {
		id: modelId,
		name: modelId,
		provider: piProviderFor(provider),
		reasoning: provider === "openai" || provider === "anthropic" || provider === "gemini",
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	} satisfies Partial<Model<Api>>;

	switch (provider) {
		case "openai":
			return { ...base, api: "openai-responses", baseUrl: "https://api.openai.com/v1", contextWindow: 400_000, maxTokens: 32_768 } as Model<Api>;
		case "anthropic":
			return { ...base, api: "anthropic-messages", baseUrl: "https://api.anthropic.com", contextWindow: 200_000, maxTokens: 64_000 } as Model<Api>;
		case "gemini":
			return { ...base, api: "google-generative-ai", baseUrl: "https://generativelanguage.googleapis.com/v1beta", contextWindow: 1_048_576, maxTokens: 65_536 } as Model<Api>;
		case "tzafon":
			return { ...base, api: "tzafon-responses", baseUrl: "https://api.lightcone.ai", contextWindow: 128_000, maxTokens: 4_096 } as Model<Api>;
		case "yutori":
			return { ...base, api: "yutori-chat-completions", baseUrl: "https://api.yutori.com/v1", contextWindow: 128_000, maxTokens: 4_096 } as Model<Api>;
	}
}

function cuaModel(
	provider: CuaProvider,
	model: string,
	name: string,
): CuaModelInfo {
	return { ref: formatCuaModelRef(provider, model), provider, model, name };
}

function compareCuaModels(a: CuaModelInfo, b: CuaModelInfo): number {
	if (a.provider !== b.provider) return CUA_PROVIDERS.indexOf(a.provider) - CUA_PROVIDERS.indexOf(b.provider);
	return a.model.localeCompare(b.model);
}
