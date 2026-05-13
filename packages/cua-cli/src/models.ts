import { type Api, type CuaModelRef, getCuaModel, listCuaModels, type Model } from "@onkernel/cua-ai";

export type ProviderId = "openai" | "anthropic" | "gemini" | "tzafon" | "yutori";
export const SUPPORTED_PROVIDERS: ProviderId[] = ["openai", "anthropic", "gemini", "tzafon", "yutori"];
export const DEFAULT_MODEL_ID = "gpt-5.5";

export interface SupportedModel {
	provider: ProviderId;
	model: string;
	name: string;
	origin: "cua-override" | "cua-ai-registry";
	default?: boolean;
}

const CUA_MODEL_OVERRIDES: Record<ProviderId, SupportedModel[]> = {
	openai: [
		{ provider: "openai", model: "gpt-5.5", name: "GPT-5.5", origin: "cua-override", default: true },
		{ provider: "openai", model: "gpt-5.5-2026-04-23", name: "GPT-5.5 (2026-04-23)", origin: "cua-override" },
	],
	anthropic: [],
	gemini: [
		{ provider: "gemini", model: "gemini-2.5-computer-use-preview-10-2025", name: "Gemini 2.5 Computer Use Preview", origin: "cua-override" },
	],
	tzafon: [
		{ provider: "tzafon", model: "tzafon.northstar-cua-fast", name: "Tzafon Northstar CUA Fast", origin: "cua-override" },
	],
	yutori: [
		{ provider: "yutori", model: "n1.5-latest", name: "Yutori Navigator n1.5", origin: "cua-override" },
		{ provider: "yutori", model: "n1.5-20260428", name: "Yutori Navigator n1.5 (2026-04-28)", origin: "cua-override" },
		{ provider: "yutori", model: "n1-latest", name: "Yutori Navigator n1", origin: "cua-override" },
		{ provider: "yutori", model: "n1-20260203", name: "Yutori Navigator n1 (2026-02-03)", origin: "cua-override" },
	],
};

export function listSupportedModels(provider?: ProviderId): SupportedModel[] {
	const providers = provider ? [provider] : SUPPORTED_PROVIDERS;
	const byKey = new Map<string, SupportedModel>();

	for (const p of providers) {
		for (const entry of CUA_MODEL_OVERRIDES[p]) {
			byKey.set(modelKey(entry.provider, entry.model), entry);
		}

		for (const model of listCuaModels(toCuaProvider(p))) {
			const normalizedProvider = fromCuaProvider(model.provider);
			if (normalizedProvider !== p) continue;
			const key = modelKey(normalizedProvider, model.model);
			if (byKey.has(key)) continue;
			byKey.set(key, {
				provider: normalizedProvider,
				model: model.model,
				name: model.name,
				origin: "cua-ai-registry",
				default: model.model === DEFAULT_MODEL_ID,
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
	const modelRef = `${toCuaProvider(provider)}:${modelId}` as CuaModelRef;
	return { provider, model: getCuaModel(modelRef) };
}

export function toCuaProvider(provider: ProviderId): "openai" | "anthropic" | "google" | "tzafon" | "yutori" {
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

function fromCuaProvider(provider: string): ProviderId {
	switch (provider) {
		case "google":
			return "gemini";
		case "openai":
		case "anthropic":
		case "tzafon":
		case "yutori":
			return provider;
		default:
			throw new Error(`unsupported CUA provider "${provider}"`);
	}
}

function modelKey(provider: ProviderId, model: string): string {
	return `${provider}:${model}`;
}

function compareSupportedModels(a: SupportedModel, b: SupportedModel): number {
	if (a.provider !== b.provider) return SUPPORTED_PROVIDERS.indexOf(a.provider) - SUPPORTED_PROVIDERS.indexOf(b.provider);
	if (a.default !== b.default) return a.default ? -1 : 1;
	return a.model.localeCompare(b.model);
}
