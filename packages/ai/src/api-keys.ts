import type { Api, Model } from "@earendil-works/pi-ai";
import { parseCuaModelRef, providerForModel, type CuaModelRef, type CuaProvider } from "./models";

/**
 * Environment variables accepted for each CUA provider.
 *
 * This mirrors pi-ai's approach: model lookup is pure, while auth is resolved
 * when streaming. These helpers let callers share one readable convention for
 * explicit `getApiKey` wiring (especially useful for `google` vs `gemini`).
 */
const CUA_PROVIDER_API_KEY_ENV_VARS: Record<CuaProvider | "google", readonly string[]> = {
	openai: ["OPENAI_API_KEY"],
	anthropic: ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
	gemini: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
	google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
	tzafon: ["TZAFON_API_KEY"],
	yutori: ["YUTORI_API_KEY"],
};

export function cuaApiKeyEnvVarsForProvider(provider: string): readonly string[] {
	return CUA_PROVIDER_API_KEY_ENV_VARS[provider as keyof typeof CUA_PROVIDER_API_KEY_ENV_VARS] ?? [];
}

export function getCuaEnvApiKey(provider: string): string | undefined {
	for (const envVar of cuaApiKeyEnvVarsForProvider(provider)) {
		const value = process.env[envVar];
		if (value?.trim()) return value;
	}
	return undefined;
}

export function requireCuaEnvApiKey(provider: string): string {
	const apiKey = getCuaEnvApiKey(provider);
	if (apiKey) return apiKey;
	const envVars = cuaApiKeyEnvVarsForProvider(provider);
	if (envVars.length === 0) {
		throw new Error(`No known API key environment variables for provider "${provider}"`);
	}
	throw new Error(`Missing API key for "${provider}". Set one of: ${envVars.join(", ")}`);
}

export function getCuaEnvApiKeyForModel(input: CuaModelRef | Model<Api>): string | undefined {
	const provider = typeof input === "string" ? parseCuaModelRef(input).provider : providerForModel(input);
	return getCuaEnvApiKey(provider);
}

export function requireCuaEnvApiKeyForModel(input: CuaModelRef | Model<Api>): string {
	const provider = typeof input === "string" ? parseCuaModelRef(input).provider : providerForModel(input);
	return requireCuaEnvApiKey(provider);
}
