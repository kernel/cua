import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { Type, complete, getCuaModel, parseCuaModelRef, type CuaModelRef } from "../src/index.js";

type Provider = "openai" | "anthropic" | "gemini" | "tzafon" | "yutori";

interface ProviderConfig {
	apiKey?: string;
	baseUrl?: string;
	models?: string[];
}

const modelDefaults: Record<Provider, string> = {
	openai: "gpt-5.5",
	anthropic: "claude-sonnet-4-20250514",
	gemini: "gemini-2.5-computer-use-preview-10-2025",
	tzafon: "tzafon.northstar-cua-fast",
	yutori: "n1.5-latest",
};

const providerOrder: Provider[] = ["openai", "yutori", "tzafon", "gemini", "anthropic"];

const here = dirname(fileURLToPath(import.meta.url));
const screenshotPath = join(here, "screenshot.png");

const cfg = await loadCuaCliConfig();
const selected = selectModel(cfg);
const model = withBaseUrl(getCuaModel(selected.ref), selected.baseUrl);
const screenshot = await readFile(screenshotPath);

const response = await complete(
	model,
	{
		systemPrompt: [
			"You are controlling a browser from a screenshot.",
			"Call click_mouse with the pixel coordinates of the target. Do not describe the click in prose unless you cannot identify the target.",
		].join("\n"),
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "Click the sign in / up link in this Kernel homepage screenshot." },
					{ type: "image", data: screenshot.toString("base64"), mimeType: "image/png" },
				],
				timestamp: Date.now(),
			},
		],
		tools: [
			{
				name: "click_mouse",
				description: "Click a point on the browser viewport.",
				parameters: Type.Object(
					{
						x: Type.Number({ description: "Pixel x coordinate." }),
						y: Type.Number({ description: "Pixel y coordinate." }),
						button: Type.Optional(Type.String({ description: "Mouse button, usually left." })),
					},
					{ additionalProperties: false },
				),
			},
		],
	},
	{
		apiKey: selected.apiKey,
		maxTokens: 1024,
	},
);

console.log(`model: ${selected.ref}`);
for (const block of response.content) {
	if (block.type === "text") {
		console.log(block.text);
	}
	if (block.type === "toolCall") {
		console.log(`${block.name}: ${JSON.stringify(block.arguments)}`);
	}
}

async function loadCuaCliConfig(): Promise<Record<Provider, ProviderConfig>> {
	const configPath = process.env.CUA_CONFIG_FILE || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "cua", "config.toml");
	const raw = parseToml(await readFile(configPath, "utf8")) as any;
	const profileName = process.env.CUA_PROFILE || raw.default_profile;
	if (!profileName) throw new Error(`No CUA profile selected. Set CUA_PROFILE or default_profile in ${configPath}.`);
	const profile = raw.profiles?.[profileName];
	if (!profile || typeof profile !== "object") throw new Error(`CUA profile "${profileName}" not found in ${configPath}.`);

	return {
		openai: {
			apiKey: firstString(process.env.OPENAI_API_KEY, profile.openai_api_key),
			baseUrl: firstString(process.env.OPENAI_BASE_URL, profile.openai_base_url),
			models: readModels(profile.openai),
		},
		anthropic: {
			apiKey: firstString(process.env.ANTHROPIC_API_KEY, profile.anthropic_api_key),
			baseUrl: firstString(process.env.ANTHROPIC_BASE_URL, profile.anthropic_base_url),
			models: readModels(profile.anthropic),
		},
		gemini: {
			apiKey: firstString(process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY, profile.google_api_key),
			baseUrl: firstString(process.env.GOOGLE_BASE_URL, profile.google_base_url),
			models: readModels(profile.gemini ?? profile.google),
		},
		tzafon: {
			apiKey: firstString(process.env.TZAFON_API_KEY, profile.tzafon_api_key),
			models: readModels(profile.tzafon),
		},
		yutori: {
			apiKey: firstString(process.env.YUTORI_API_KEY, profile.yutori_api_key),
			baseUrl: firstString(process.env.YUTORI_BASE_URL, profile.yutori_base_url),
			models: readModels(profile.yutori),
		},
	};
}

function selectModel(config: Record<Provider, ProviderConfig>): { ref: CuaModelRef; apiKey: string; baseUrl?: string } {
	const explicit = process.env.CUA_MODEL_REF as CuaModelRef | undefined;
	if (explicit) {
		const { provider } = parseCuaModelRef(explicit);
		const apiKey = config[provider].apiKey;
		if (!apiKey) throw new Error(`No API key configured for ${provider}.`);
		return { ref: explicit, apiKey, baseUrl: config[provider].baseUrl };
	}

	for (const provider of providerOrder) {
		const apiKey = config[provider].apiKey;
		if (!apiKey) continue;
		const model = config[provider].models?.[0] || modelDefaults[provider];
		return { ref: `${provider}:${model}` as CuaModelRef, apiKey, baseUrl: config[provider].baseUrl };
	}

	throw new Error("No supported CUA provider API key found in CUA CLI config or environment.");
}

function withBaseUrl<T extends { baseUrl?: string }>(model: T, baseUrl: string | undefined): T {
	return baseUrl ? { ...model, baseUrl } : model;
}

function readModels(raw: any): string[] {
	if (!raw || typeof raw !== "object" || !Array.isArray(raw.models)) return [];
	return raw.models
		.map((entry: any) => (typeof entry?.name === "string" ? entry.name.trim() : ""))
		.filter(Boolean);
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}
