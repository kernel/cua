import { parseCuaModelRef, type CuaModelRef } from "@onkernel/cua-ai";

export function resolveApiKey(modelRef: CuaModelRef): string {
	const { provider } = parseCuaModelRef(modelRef);
	switch (provider) {
		case "openai":
			return requireEnv("OPENAI_API_KEY");
		case "anthropic":
			return requireEnv("ANTHROPIC_API_KEY");
		case "gemini":
			return requireEnv("GOOGLE_API_KEY");
		case "tzafon":
			return requireEnv("TZAFON_API_KEY");
		case "yutori":
			return requireEnv("YUTORI_API_KEY");
	}
}

export function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}
