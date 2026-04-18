import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

export interface OpenAIModelConfig {
	name?: string;
	reasoningEffort?: string;
	toolPreamble?: boolean;
	compactThreshold?: number;
}

export interface OpenAIConfig {
	default: OpenAIModelConfig;
	models: OpenAIModelConfig[];
}

export interface AnthropicModelConfig {
	name?: string;
	reasoningEffort?: string;
	toolPreamble?: boolean;
}

export interface AnthropicConfig {
	default: AnthropicModelConfig;
	models: AnthropicModelConfig[];
}

export interface GeminiModelConfig {
	name?: string;
	reasoningEffort?: string;
	toolPreamble?: boolean;
}

export interface GeminiConfig {
	default: GeminiModelConfig;
	models: GeminiModelConfig[];
}

export interface Config {
	openaiApiKey: string;
	openaiBaseUrl: string;
	anthropicApiKey: string;
	anthropicBaseUrl: string;
	googleApiKey: string;
	googleBaseUrl: string;
	kernelApiKey: string;
	kernelBaseUrl: string;
	openai: OpenAIConfig;
	anthropic: AnthropicConfig;
	gemini: GeminiConfig;
}

export function configDir(): string {
	const xdg = process.env.XDG_CONFIG_HOME;
	if (xdg) return join(xdg, "cua");
	return join(homedir(), ".config", "cua");
}

export function configFilePath(): string {
	return join(configDir(), "config.toml");
}

const ENV_KEYS: Array<{ env: string; key: keyof Config }> = [
	{ env: "OPENAI_API_KEY", key: "openaiApiKey" },
	{ env: "OPENAI_BASE_URL", key: "openaiBaseUrl" },
	{ env: "ANTHROPIC_API_KEY", key: "anthropicApiKey" },
	{ env: "ANTHROPIC_BASE_URL", key: "anthropicBaseUrl" },
	{ env: "GOOGLE_API_KEY", key: "googleApiKey" },
	{ env: "GEMINI_API_KEY", key: "googleApiKey" },
	{ env: "GOOGLE_BASE_URL", key: "googleBaseUrl" },
	{ env: "KERNEL_API_KEY", key: "kernelApiKey" },
	{ env: "KERNEL_BASE_URL", key: "kernelBaseUrl" },
];

function emptyConfig(): Config {
	return {
		openaiApiKey: "",
		openaiBaseUrl: "",
		anthropicApiKey: "",
		anthropicBaseUrl: "",
		googleApiKey: "",
		googleBaseUrl: "",
		kernelApiKey: "",
		kernelBaseUrl: "",
		openai: { default: {}, models: [] },
		anthropic: { default: {}, models: [] },
		gemini: { default: {}, models: [] },
	};
}

function readModelConfig(raw: any): OpenAIModelConfig {
	const out: OpenAIModelConfig = {};
	if (typeof raw?.name === "string") out.name = raw.name;
	if (typeof raw?.reasoning_effort === "string") out.reasoningEffort = raw.reasoning_effort;
	if (typeof raw?.tool_preamble === "boolean") out.toolPreamble = raw.tool_preamble;
	if (typeof raw?.compact_threshold === "number") out.compactThreshold = raw.compact_threshold;
	return out;
}

function readOpenAIConfig(raw: any): OpenAIConfig {
	const out: OpenAIConfig = { default: {}, models: [] };
	if (raw && typeof raw === "object") {
		if (raw.default) out.default = readModelConfig(raw.default);
		if (Array.isArray(raw.models)) out.models = raw.models.map(readModelConfig);
	}
	return out;
}

function readPlainModelConfig(raw: any): { name?: string; reasoningEffort?: string; toolPreamble?: boolean } {
	const out: { name?: string; reasoningEffort?: string; toolPreamble?: boolean } = {};
	if (typeof raw?.name === "string") out.name = raw.name;
	if (typeof raw?.reasoning_effort === "string") out.reasoningEffort = raw.reasoning_effort;
	if (typeof raw?.tool_preamble === "boolean") out.toolPreamble = raw.tool_preamble;
	return out;
}

function readAnthropicConfig(raw: any): AnthropicConfig {
	const out: AnthropicConfig = { default: {}, models: [] };
	if (raw && typeof raw === "object") {
		if (raw.default) out.default = readPlainModelConfig(raw.default);
		if (Array.isArray(raw.models)) out.models = raw.models.map(readPlainModelConfig);
	}
	return out;
}

function readGeminiConfig(raw: any): GeminiConfig {
	const out: GeminiConfig = { default: {}, models: [] };
	if (raw && typeof raw === "object") {
		if (raw.default) out.default = readPlainModelConfig(raw.default);
		if (Array.isArray(raw.models)) out.models = raw.models.map(readPlainModelConfig);
	}
	return out;
}

function readProfile(profile: any): { cfg: Config; explicit: Set<keyof Config> } {
	const cfg = emptyConfig();
	const explicit = new Set<keyof Config>();
	if (typeof profile?.openai_api_key === "string") {
		cfg.openaiApiKey = profile.openai_api_key;
		explicit.add("openaiApiKey");
	}
	if (typeof profile?.openai_base_url === "string") {
		cfg.openaiBaseUrl = profile.openai_base_url;
		explicit.add("openaiBaseUrl");
	}
	if (typeof profile?.anthropic_api_key === "string") {
		cfg.anthropicApiKey = profile.anthropic_api_key;
		explicit.add("anthropicApiKey");
	}
	if (typeof profile?.anthropic_base_url === "string") {
		cfg.anthropicBaseUrl = profile.anthropic_base_url;
		explicit.add("anthropicBaseUrl");
	}
	if (typeof profile?.google_api_key === "string") {
		cfg.googleApiKey = profile.google_api_key;
		explicit.add("googleApiKey");
	}
	if (typeof profile?.google_base_url === "string") {
		cfg.googleBaseUrl = profile.google_base_url;
		explicit.add("googleBaseUrl");
	}
	if (typeof profile?.kernel_api_key === "string") {
		cfg.kernelApiKey = profile.kernel_api_key;
		explicit.add("kernelApiKey");
	}
	if (typeof profile?.kernel_base_url === "string") {
		cfg.kernelBaseUrl = profile.kernel_base_url;
		explicit.add("kernelBaseUrl");
	}
	if (profile?.openai) cfg.openai = readOpenAIConfig(profile.openai);
	if (profile?.anthropic) cfg.anthropic = readAnthropicConfig(profile.anthropic);
	if (profile?.gemini) cfg.gemini = readGeminiConfig(profile.gemini);
	if (profile?.google) cfg.gemini = readGeminiConfig(profile.google);
	return { cfg, explicit };
}

function applyEnvFallback(cfg: Config, explicit: Set<keyof Config>): void {
	for (const { env, key } of ENV_KEYS) {
		if (explicit.has(key)) continue;
		const value = process.env[env];
		if (value && value.trim().length > 0) {
			(cfg[key] as string) = value;
		}
	}
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve configuration from a selected profile plus environment fallbacks.
 * Explicit values in the selected profile win. Environment variables only fill
 * in fields the profile does not define. A profile must be resolved either via
 * the explicit argument or via default_profile in the config file.
 */
export async function load(profileArg?: string): Promise<Config> {
	const cfgPath = configFilePath();
	const exists = await fileExists(cfgPath);
	if (!exists) {
		if (profileArg) {
			throw new Error(`config file not found at ${cfgPath} (run \`cua config init\`)`);
		}
		throw new Error(`no config file found at ${cfgPath} and no profile specified (run \`cua config init\`)`);
	}

	const raw = parseToml(await readFile(cfgPath, "utf8")) as any;
	let resolvedProfile = profileArg;
	if (!resolvedProfile && typeof raw?.default_profile === "string") {
		resolvedProfile = raw.default_profile;
	}
	if (!resolvedProfile) {
		throw new Error(
			`no profile specified and no default_profile set in ${cfgPath} (use -c <profile> or run \`cua config init\`)`,
		);
	}

	const profileBlock = raw?.profiles?.[resolvedProfile];
	if (!profileBlock || typeof profileBlock !== "object") {
		throw new Error(`profile "${resolvedProfile}" not found in ${cfgPath}`);
	}

	const { cfg, explicit } = readProfile(profileBlock);
	applyEnvFallback(cfg, explicit);
	return cfg;
}

export function loadFromEnv(): Config {
	const cfg = emptyConfig();
	applyEnvFallback(cfg, new Set());
	return cfg;
}

/**
 * Resolve per-model OpenAI settings.
 *
 * Resolution order:
 *   1. Exact model key match
 *   2. Longest prefix match (for snapshot-style names)
 *   3. The "default" block
 */
export function resolveOpenAIModelConfig(cfg: Config, model: string): OpenAIModelConfig {
	const trimmed = model.trim();
	const resolved: OpenAIModelConfig = { ...cfg.openai.default };
	if (cfg.openai.models.length === 0) return resolved;

	for (const entry of cfg.openai.models) {
		if ((entry.name ?? "").trim() === trimmed) {
			return mergeOpenAIModelConfig(resolved, entry);
		}
	}

	let longestPrefix = "";
	let prefixCfg: OpenAIModelConfig | undefined;
	for (const entry of cfg.openai.models) {
		const key = (entry.name ?? "").trim();
		if (!key) continue;
		if (trimmed.startsWith(key) && key.length > longestPrefix.length) {
			longestPrefix = key;
			prefixCfg = entry;
		}
	}
	if (prefixCfg) return mergeOpenAIModelConfig(resolved, prefixCfg);
	return resolved;
}

function mergeOpenAIModelConfig(base: OpenAIModelConfig, override: OpenAIModelConfig): OpenAIModelConfig {
	const out: OpenAIModelConfig = { ...base };
	if ((override.reasoningEffort ?? "").trim().length > 0) out.reasoningEffort = override.reasoningEffort;
	if (override.toolPreamble !== undefined) out.toolPreamble = override.toolPreamble;
	if (override.compactThreshold !== undefined) out.compactThreshold = override.compactThreshold;
	return out;
}

export function resolveAnthropicModelConfig(cfg: Config, model: string): AnthropicModelConfig {
	const trimmed = model.trim();
	const resolved: AnthropicModelConfig = { ...cfg.anthropic.default };
	if (cfg.anthropic.models.length === 0) return resolved;

	for (const entry of cfg.anthropic.models) {
		if ((entry.name ?? "").trim() === trimmed) {
			return mergePlainModelConfig(resolved, entry);
		}
	}

	let longestPrefix = "";
	let prefixCfg: AnthropicModelConfig | undefined;
	for (const entry of cfg.anthropic.models) {
		const key = (entry.name ?? "").trim();
		if (!key) continue;
		if (trimmed.startsWith(key) && key.length > longestPrefix.length) {
			longestPrefix = key;
			prefixCfg = entry;
		}
	}
	if (prefixCfg) return mergePlainModelConfig(resolved, prefixCfg);
	return resolved;
}

export function resolveGeminiModelConfig(cfg: Config, model: string): GeminiModelConfig {
	const trimmed = model.trim();
	const resolved: GeminiModelConfig = { ...cfg.gemini.default };
	if (cfg.gemini.models.length === 0) return resolved;

	for (const entry of cfg.gemini.models) {
		if ((entry.name ?? "").trim() === trimmed) {
			return mergePlainModelConfig(resolved, entry);
		}
	}

	let longestPrefix = "";
	let prefixCfg: GeminiModelConfig | undefined;
	for (const entry of cfg.gemini.models) {
		const key = (entry.name ?? "").trim();
		if (!key) continue;
		if (trimmed.startsWith(key) && key.length > longestPrefix.length) {
			longestPrefix = key;
			prefixCfg = entry;
		}
	}
	if (prefixCfg) return mergePlainModelConfig(resolved, prefixCfg);
	return resolved;
}

function mergePlainModelConfig<T extends { reasoningEffort?: string; toolPreamble?: boolean }>(
	base: T,
	override: T,
): T {
	const out: T = { ...base };
	if ((override.reasoningEffort ?? "").trim().length > 0) out.reasoningEffort = override.reasoningEffort;
	if (override.toolPreamble !== undefined) out.toolPreamble = override.toolPreamble;
	return out;
}

function maskSecret(value: string): string {
	if (!value) return "(not set)";
	if (value.length <= 8) return "****";
	return value.slice(0, 4) + "..." + value.slice(-4);
}

function maskRecord(node: any): any {
	if (!node || typeof node !== "object") return node;
	if (Array.isArray(node)) return node.map(maskRecord);
	const out: Record<string, any> = {};
	for (const [key, value] of Object.entries(node)) {
		if (typeof value === "string" && key.endsWith("_api_key")) {
			out[key] = maskSecret(value);
		} else if (value && typeof value === "object") {
			out[key] = maskRecord(value);
		} else {
			out[key] = value;
		}
	}
	return out;
}

/** Return a human-readable representation of the masked config file. */
export async function show(profile?: string): Promise<string> {
	await load(profile);
	const cfgPath = configFilePath();
	const text = await readFile(cfgPath, "utf8");
	const parsed = parseToml(text);
	const masked = maskRecord(parsed);
	return `Config file: ${cfgPath}\n\nMasked config file:\n${stringifyToml(masked as any)}\n`;
}

async function prompt(rl: ReturnType<typeof createInterface>, label: string): Promise<string> {
	const answer = await rl.question(label);
	return answer.trim();
}

/** Interactively create or update a config file with a named profile. */
export async function init(): Promise<void> {
	const cfgPath = configFilePath();
	const rl = createInterface({ input: stdin, output: stdout });
	try {
		let tree: Record<string, any> = {};
		if (await fileExists(cfgPath)) {
			tree = parseToml(await readFile(cfgPath, "utf8")) as Record<string, any>;
		}

		const profileName = await prompt(rl, 'Profile name, e.g. "default": ');
		if (!profileName) throw new Error("profile name is required");

		tree.profiles ??= {};
		if (tree.profiles[profileName]) {
			const overwrite = await prompt(rl, `Profile "${profileName}" already exists. Overwrite? [y/N] `);
			if (overwrite.toLowerCase() !== "y") {
				console.log("Aborted.");
				return;
			}
		}

		const openaiKey = await prompt(rl, "OpenAI API key (leave blank to skip): ");
		const anthropicKey = await prompt(rl, "Anthropic API key (leave blank to skip): ");
		const googleKey = await prompt(rl, "Google API key (leave blank to skip): ");
		const kernelKey = await prompt(rl, "Kernel API key: ");
		if (!openaiKey && !anthropicKey && !googleKey) {
			throw new Error("at least one of OpenAI, Anthropic, or Google API key is required");
		}
		if (!kernelKey) {
			throw new Error("Kernel API key is required");
		}

		const profileBlock: Record<string, any> = {
			kernel_api_key: kernelKey,
		};
		if (openaiKey) {
			profileBlock.openai_api_key = openaiKey;
			profileBlock.openai = {
				default: {
					reasoning_effort: "low",
					tool_preamble: true,
				},
			};
		}
		if (anthropicKey) {
			profileBlock.anthropic_api_key = anthropicKey;
			profileBlock.anthropic = {
				default: {
					reasoning_effort: "low",
					tool_preamble: true,
				},
			};
		}
		if (googleKey) {
			profileBlock.google_api_key = googleKey;
			profileBlock.gemini = {
				default: {
					reasoning_effort: "low",
					tool_preamble: true,
				},
			};
		}
		tree.profiles[profileName] = profileBlock;

		const setDefault = await prompt(rl, `Set "${profileName}" as the default profile? [Y/n] `);
		if (setDefault === "" || setDefault.toLowerCase() === "y" || setDefault.toLowerCase() === "yes") {
			tree.default_profile = profileName;
		}

		await mkdir(dirname(cfgPath), { recursive: true });
		await writeFile(cfgPath, stringifyToml(tree as any), { mode: 0o600 });
		console.log(`\nProfile "${profileName}" written to ${cfgPath}`);
	} finally {
		rl.close();
	}
}
