import {
	type Api,
	type Model,
	getModel,
	getModels,
} from "@mariozechner/pi-ai";

export type ProviderId = "openai" | "anthropic" | "gemini";
export const SUPPORTED_PROVIDERS: ProviderId[] = ["openai", "anthropic", "gemini"];
export const DEFAULT_MODEL_ID = "gpt-5.5";

export interface SupportedModel {
	provider: ProviderId;
	model: string;
	name: string;
	origin: "cua-override" | "pi-ai-registry";
	default?: boolean;
}

const CUA_MODEL_OVERRIDES: Record<ProviderId, SupportedModel[]> = {
	openai: [
		{ provider: "openai", model: "gpt-5.5", name: "GPT-5.5", origin: "cua-override", default: true },
		{ provider: "openai", model: "gpt-5.5-2026-04-23", name: "GPT-5.5 (2026-04-23)", origin: "cua-override" },
		{ provider: "openai", model: "gpt-5.5-pro", name: "GPT-5.5 Pro", origin: "cua-override" },
		{ provider: "openai", model: "gpt-5.5-pro-2026-04-23", name: "GPT-5.5 Pro (2026-04-23)", origin: "cua-override" },
	],
	anthropic: [],
	gemini: [
		{ provider: "gemini", model: "gemini-2.5-computer-use-preview-10-2025", name: "Gemini 2.5 Computer Use Preview", origin: "cua-override" },
	],
};

export function listSupportedModels(provider?: ProviderId): SupportedModel[] {
	const providers = provider ? [provider] : SUPPORTED_PROVIDERS;
	const byKey = new Map<string, SupportedModel>();

	for (const p of providers) {
		for (const entry of CUA_MODEL_OVERRIDES[p]) {
			byKey.set(modelKey(entry.provider, entry.model), entry);
		}

		for (const model of getModels(piProviderFor(p) as never) as Model<Api>[]) {
			if (!supportsCuaProvider(p, model.id)) continue;
			const key = modelKey(p, model.id);
			if (byKey.has(key)) continue;
			byKey.set(key, {
				provider: p,
				model: model.id,
				name: model.name,
				origin: "pi-ai-registry",
				default: model.id === DEFAULT_MODEL_ID,
			});
		}
	}

	return [...byKey.values()].sort(compareSupportedModels);
}

export function resolveProvider(modelId: string): ProviderId {
	const match = listSupportedModels().find((model) => model.model === modelId);
	if (!match) {
		throw new Error(`unsupported model "${modelId}" (run \`cua models\` to list supported -m/--model values)`);
	}
	return match.provider;
}

export function loadModel(modelId: string): { provider: ProviderId; model: Model<Api> } {
	const provider = resolveProvider(modelId);
	const piProvider = piProviderFor(provider);
	const fromRegistry = getModel(piProvider as never, modelId as never) as Model<Api> | undefined;
	if (fromRegistry) return { provider, model: fromRegistry };

	// Provider model lists can expose working model IDs before pi-ai's generated
	// registry catches up. Use conservative metadata so the request can still
	// reach the provider; cost telemetry stays zero until the registry updates.
	return { provider, model: dynamicModel(provider, modelId) };
}

export function piProviderFor(provider: ProviderId): string {
	switch (provider) {
		case "openai":
			return "openai";
		case "anthropic":
			return "anthropic";
		case "gemini":
			return "google";
	}
}

function supportsCuaProvider(provider: ProviderId, modelId: string): boolean {
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
	}
}

function dynamicModel(provider: ProviderId, modelId: string): Model<Api> {
	const piProvider = piProviderFor(provider);
	switch (provider) {
		case "anthropic":
			return {
				id: modelId,
				name: modelId,
				api: "anthropic-messages",
				provider: piProvider,
				baseUrl: "https://api.anthropic.com",
				reasoning: true,
				input: ["text", "image"],
				cost: zeroCost(),
				contextWindow: 200_000,
				maxTokens: 64_000,
			};
		case "gemini":
			return {
				id: modelId,
				name: modelId,
				api: "google-generative-ai",
				provider: piProvider,
				baseUrl: "https://generativelanguage.googleapis.com/v1beta",
				reasoning: true,
				input: ["text", "image"],
				cost: zeroCost(),
				contextWindow: 1_048_576,
				maxTokens: 65_536,
			};
		case "openai":
		default:
			return {
				id: modelId,
				name: modelId,
				api: "openai-responses",
				provider: piProvider,
				baseUrl: "https://api.openai.com/v1",
				reasoning: true,
				input: ["text", "image"],
				cost: zeroCost(),
				contextWindow: 400_000,
				maxTokens: 32_768,
			};
	}
}

function zeroCost(): Model<Api>["cost"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
	};
}

function modelKey(provider: ProviderId, model: string): string {
	return `${provider}:${model}`;
}

function compareSupportedModels(a: SupportedModel, b: SupportedModel): number {
	if (a.provider !== b.provider) return SUPPORTED_PROVIDERS.indexOf(a.provider) - SUPPORTED_PROVIDERS.indexOf(b.provider);
	if (a.default !== b.default) return a.default ? -1 : 1;
	return a.model.localeCompare(b.model);
}
