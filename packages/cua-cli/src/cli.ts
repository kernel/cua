#!/usr/bin/env node
import { browserSession, type BrowserSession } from "@onkernel/cua-translator";
import { stderr, stdout } from "node:process";
import { parseArgs } from "node:util";
import { type ActionRequest, type ActionType } from "./action/prompts";
import { emitCompact, runAction, type RunActionResult } from "./action/runner";
import { createCuaAgent } from "./agent";
import { promptWithScreenshot } from "./agent-prompt";
import * as configMod from "./config";
import {
	DEFAULT_MODEL_ID,
	SUPPORTED_PROVIDERS,
	type ProviderId,
	listSupportedModels,
	resolveProvider,
} from "./models";
import {
	attachNamedSession,
	formatRelativeAge,
	listNamedSessions,
	type NamedSessionMetadata,
	recordTranscriptPath,
	shortKernelId,
	startNamedSession,
	stopNamedSession,
	validateSlug,
} from "./named-sessions";
import { attachJsonlSink } from "./output/jsonl";
import {
	appendBrowserMetadata,
	findLatestSession,
	listSessions,
	openSession,
	persistAgentEvents,
	resolveSessionPath,
	seedAgentFromSession,
	type SessionInfo,
} from "./sessions";
import { discoverCuaSkills, discoverStartupResources, expandSkillInvocation } from "./skills";
import { runInteractive } from "./tui/main";

const HELP = `cua — Kernel-cloud-browser computer-use agent

Usage:
  cua [options] [prompt...]
  cua --print "go to news.ycombinator.com and summarize"
  cua open <url>
  cua click "<description>"
  cua type "<target>" "<text>"
  cua press <key> [key...]
  cua observe ["<question>"]
  cua url
  cua screenshot [--out file|-]
  cua do "<instruction>"
  cua models [-p provider]
  cua session start [name] | stop <name> | list | show <name>
  cua config init|show

Options:
  -p, --print                    Run a single prompt and exit
  -m, --model <id>               Model id (default: ${DEFAULT_MODEL_ID})
                                 Recommended:
                                   openai:    ${DEFAULT_MODEL_ID}
                                   anthropic: claude-opus-4-7
                                   gemini:    gemini-3-flash-preview
                                   tzafon:    tzafon.northstar-cua-fast
                                   yutori:    n1.5-latest
      --config-profile <p>       Config profile to load (default: from default_profile)
      --profile <name|id>        Kernel browser profile to load
      --profile-no-save-changes  Do not persist changes back to the profile
      --browser-timeout <s>      Browser inactivity timeout in seconds (default 300)
      --max-steps <n>            Max turns for action subcommands (default 3)
      --out <file|->             Output file for screenshot subcommand
  -o, --output <fmt>             Output format for --print: text (default) | jsonl
      --jsonl-include-deltas     Include assistant_text_delta events (default off)
      --jsonl-include-images     Include base64 screenshots (default off, only sizes)
      --image-protocol <p>       Force terminal image protocol: \`kitty\` | \`iterm2\` | \`none\` | \`auto\`
                                 (Ghostty / WezTerm are auto-detected as \`kitty\`.)
                                 Also via CUA_IMAGE_PROTOCOL env var.
  -s, --session-name <name>      Reuse a named browser session (see \`cua session start\`)
  -c, --continue                 Resume the most recent session for cwd (fresh browser)
  -r, --resume                   Pick a previous session to resume from a list
      --session <ref>            Resume a specific session: path | partial id | latest
      --session-dir <dir>        Override the sessions directory
      --no-session               Don't persist this session to disk
      --skill <path>             Load a skill file or directory (repeatable).
                                 Defaults: ~/.agents/skills/, <cwd>/.agents/skills/
  -ns, --no-skills               Disable skill discovery entirely
      --debug-tui                Enable TUI render diagnostics for manual repros
  -v, --verbose                  Verbose progress output to stderr
  -h, --help                     Show this help

Environment:
  OPENAI_API_KEY        Overrides the profile's OpenAI key
  ANTHROPIC_API_KEY     Overrides the profile's Anthropic key
  GOOGLE_API_KEY        Overrides the profile's Google (Gemini) key
  GEMINI_API_KEY        Alias for GOOGLE_API_KEY
  TZAFON_API_KEY        Overrides the profile's Tzafon key
  YUTORI_API_KEY        Overrides the profile's Yutori key
  KERNEL_API_KEY        Overrides the profile's Kernel key
  OPENAI_BASE_URL       Override OpenAI base URL
  ANTHROPIC_BASE_URL    Override Anthropic base URL
  GOOGLE_BASE_URL       Override Google base URL
  YUTORI_BASE_URL       Override Yutori base URL
  KERNEL_BASE_URL       Override Kernel base URL
  XDG_DATA_HOME         Sessions are stored under \$XDG_DATA_HOME/cua/sessions
                        (defaults to ~/.local/share/cua/sessions)
  CUA_IMAGE_PROTOCOL    Force inline image protocol (\`kitty\`|\`iterm2\`|\`none\`|\`auto\`)
`;

interface CliFlags {
	help: boolean;
	print: boolean;
	verbose: boolean;
	profileSaveChanges: boolean;
	continueLatest: boolean;
	resumePicker: boolean;
	noSession: boolean;
	noSkills: boolean;
	debugTui: boolean;
	jsonlIncludeDeltas: boolean;
	jsonlIncludeImages: boolean;
	model?: string;
	configProfile?: string;
	browserProfile?: string;
	browserTimeout?: number;
	maxSteps?: number;
	out?: string;
	output?: string;
	imageProtocol?: string;
	namedSession?: string;
	sessionRef?: string;
	sessionDir?: string;
	skillPaths: string[];
	positionals: string[];
}

function parseCliArgs(argv: string[]): CliFlags {
	// Pre-process: expand `-ns` → `--no-skills` (multi-char short flag pi-coding-agent supports;
	// node:util's parseArgs only allows single-char shorts).
	const preprocessed = argv.map((arg) => (arg === "-ns" ? "--no-skills" : arg));

	let parsed;
	try {
		parsed = parseArgs({
			args: preprocessed,
			options: {
				help: { type: "boolean", short: "h", default: false },
				print: { type: "boolean", short: "p", default: false },
				verbose: { type: "boolean", short: "v", default: false },
				model: { type: "string", short: "m" },
				"config-profile": { type: "string" },
				profile: { type: "string" },
				"profile-no-save-changes": { type: "boolean", default: false },
				"browser-timeout": { type: "string" },
				"max-steps": { type: "string" },
				out: { type: "string" },
				"image-protocol": { type: "string" },
				"session-name": { type: "string", short: "s" },
				continue: { type: "boolean", short: "c", default: false },
				resume: { type: "boolean", short: "r", default: false },
				session: { type: "string" },
				"session-dir": { type: "string" },
				"no-session": { type: "boolean", default: false },
				skill: { type: "string", multiple: true, default: [] },
				"no-skills": { type: "boolean", default: false },
				"debug-tui": { type: "boolean", default: false },
				output: { type: "string", short: "o" },
				"jsonl-include-deltas": { type: "boolean", default: false },
				"jsonl-include-images": { type: "boolean", default: false },
			},
			allowPositionals: true,
			strict: true,
		});
	} catch (err) {
		throw new Error(`invalid arguments: ${(err as Error).message}`);
	}

	const browserTimeoutRaw = parsed.values["browser-timeout"];
	const browserTimeout = browserTimeoutRaw ? Number(browserTimeoutRaw) : undefined;
	const maxStepsRaw = parsed.values["max-steps"];
	const maxSteps = maxStepsRaw ? Number(maxStepsRaw) : undefined;

	return {
		help: !!parsed.values.help,
		print: !!parsed.values.print,
		verbose: !!parsed.values.verbose,
		profileSaveChanges: !parsed.values["profile-no-save-changes"],
		continueLatest: !!parsed.values.continue,
		resumePicker: !!parsed.values.resume,
		noSession: !!parsed.values["no-session"],
		noSkills: !!parsed.values["no-skills"],
		debugTui: !!parsed.values["debug-tui"],
		model: parsed.values.model as string | undefined,
		configProfile: parsed.values["config-profile"] as string | undefined,
		browserProfile: parsed.values.profile as string | undefined,
		browserTimeout: Number.isFinite(browserTimeout) ? browserTimeout : undefined,
		maxSteps: Number.isFinite(maxSteps) ? maxSteps : undefined,
		out: parsed.values.out as string | undefined,
		imageProtocol: parsed.values["image-protocol"] as string | undefined,
		namedSession: parsed.values["session-name"] as string | undefined,
		sessionRef: parsed.values.session as string | undefined,
		sessionDir: parsed.values["session-dir"] as string | undefined,
		skillPaths: ((parsed.values.skill as string[] | undefined) ?? []).filter((p) => p && p.trim().length > 0),
		output: parsed.values.output as string | undefined,
		jsonlIncludeDeltas: !!parsed.values["jsonl-include-deltas"],
		jsonlIncludeImages: !!parsed.values["jsonl-include-images"],
		positionals: parsed.positionals,
	};
}

/**
 * Load the cua config and verify the keys we need for the requested
 * provider. The provider comes from the supported model table, matching
 * what {@link createCuaAgent} will use at run time.
 */
async function loadConfigOrFail(flags: CliFlags): Promise<configMod.Config> {
	const cfg = await configMod.load(flags.configProfile);
	const modelId = flags.model ?? DEFAULT_MODEL_ID;
	const provider = resolveProvider(modelId);
	if (provider === "openai" && !cfg.openaiApiKey) {
		throw new Error("missing OpenAI API key (set in profile or OPENAI_API_KEY)");
	}
	if (provider === "anthropic" && !cfg.anthropicApiKey) {
		throw new Error("missing Anthropic API key (set in profile or ANTHROPIC_API_KEY)");
	}
	if (provider === "gemini" && !cfg.googleApiKey) {
		throw new Error("missing Google API key (set in profile or GOOGLE_API_KEY / GEMINI_API_KEY)");
	}
	if (provider === "tzafon" && !cfg.tzafonApiKey) {
		throw new Error("missing Tzafon API key (set in profile or TZAFON_API_KEY)");
	}
	if (provider === "yutori" && !cfg.yutoriApiKey) {
		throw new Error("missing Yutori API key (set in profile or YUTORI_API_KEY)");
	}
	if (!cfg.kernelApiKey) {
		throw new Error("missing Kernel API key (set in profile or KERNEL_API_KEY)");
	}
	return cfg;
}

const MODELS_HELP = `cua models — list supported -m/--model values

Usage:
  cua models
  cua models -p openai
  cua models --provider anthropic
  cua models --json

Options:
  -p, --provider <id>  Filter by provider: openai | anthropic | gemini | tzafon | yutori
      --json           Output JSON
  -h, --help           Show this help
`;

interface ModelsFlags {
	provider?: ProviderId;
	json: boolean;
	help: boolean;
}

function parseModelsProvider(value?: string): ProviderId | undefined {
	if (!value) return undefined;
	const v = value.trim().toLowerCase();
	if (SUPPORTED_PROVIDERS.includes(v as ProviderId)) return v as ProviderId;
	throw new Error(`unknown provider "${value}" (expected: ${SUPPORTED_PROVIDERS.join(" | ")})`);
}

function parseModelsArgs(argv: string[]): ModelsFlags {
	const parsed = parseArgs({
		args: argv,
		options: {
			provider: { type: "string", short: "p" },
			json: { type: "boolean", default: false },
			help: { type: "boolean", short: "h", default: false },
		},
		allowPositionals: true,
		strict: true,
	});
	const positionalProvider = parsed.positionals[0];
	if (parsed.positionals.length > 1) {
		throw new Error(`unexpected arguments: ${parsed.positionals.slice(1).join(" ")}`);
	}
	return {
		provider: parseModelsProvider((parsed.values.provider as string | undefined) ?? positionalProvider),
		json: !!parsed.values.json,
		help: !!parsed.values.help,
	};
}

async function runModelsSubcommand(args: string[]): Promise<number> {
	let flags: ModelsFlags;
	try {
		flags = parseModelsArgs(args);
	} catch (err) {
		stderr.write(`${(err as Error).message}\n\n${MODELS_HELP}`);
		return 2;
	}
	if (flags.help) {
		stdout.write(MODELS_HELP);
		return 0;
	}

	const models = listSupportedModels(flags.provider);
	if (flags.json) {
		stdout.write(`${JSON.stringify(models, null, 2)}\n`);
		return 0;
	}

	stdout.write(formatModelsTable(models));
	return 0;
}

function formatModelsTable(models: ReturnType<typeof listSupportedModels>): string {
	const rows = models.map((model) => ({
		provider: model.provider,
		model: model.model,
		default: model.default ? "yes" : "",
		name: model.name,
	}));
	const headers = {
		provider: "PROVIDER",
		model: "MODEL",
		default: "DEFAULT",
		name: "NAME",
	};
	const widths = {
		provider: columnWidth(headers.provider, rows.map((row) => row.provider)),
		model: columnWidth(headers.model, rows.map((row) => row.model)),
		default: columnWidth(headers.default, rows.map((row) => row.default)),
		name: columnWidth(headers.name, rows.map((row) => row.name)),
	};
	const lines = [
		[
			headers.provider.padEnd(widths.provider),
			headers.model.padEnd(widths.model),
			headers.default.padEnd(widths.default),
			headers.name,
		].join("  "),
		[
			"-".repeat(widths.provider),
			"-".repeat(widths.model),
			"-".repeat(widths.default),
			"-".repeat(widths.name),
		].join("  "),
	];
	for (const row of rows) {
		lines.push(
			[
				row.provider.padEnd(widths.provider),
				row.model.padEnd(widths.model),
				row.default.padEnd(widths.default),
				row.name,
			].join("  "),
		);
	}
	return `${lines.join("\n")}\n`;
}

function columnWidth(header: string, values: string[]): number {
	return Math.max(header.length, ...values.map((value) => value.length));
}

/**
 * Resolve the session policy from CLI flags. Returns the source of truth
 * for whether to attach to an existing file, create a fresh one, or skip
 * persistence entirely. When `namedMeta` is provided (i.e. `-s <name>`
 * was used), its `transcript_path` becomes the default session path
 * unless an explicit `--session` / `-c` / `-r` flag overrides it.
 */
async function resolveSessionFlags(
	flags: CliFlags,
	cwd: string,
	namedMeta?: NamedSessionMetadata,
): Promise<{ ephemeral: boolean; sessionPath?: string; resumed: boolean }> {
	if (flags.noSession) return { ephemeral: true, resumed: false };
	const dir = flags.sessionDir;

	if (flags.sessionRef) {
		const path = await resolveSessionPath(flags.sessionRef, cwd, dir);
		return { ephemeral: false, sessionPath: path, resumed: true };
	}

	if (flags.continueLatest) {
		const latest = await findLatestSession(cwd, dir);
		if (!latest) {
			stderr.write("[cua] no previous session for this cwd; starting fresh\n");
			return { ephemeral: false, resumed: false };
		}
		return { ephemeral: false, sessionPath: latest.path, resumed: true };
	}

	if (flags.resumePicker) {
		const sessions = await listSessions(cwd, dir);
		if (sessions.length === 0) {
			stderr.write("[cua] no previous sessions for this cwd; starting fresh\n");
			return { ephemeral: false, resumed: false };
		}
		const picked = await pickSession(sessions);
		if (!picked) return { ephemeral: false, resumed: false };
		return { ephemeral: false, sessionPath: picked.path, resumed: true };
	}

	if (namedMeta?.transcript_path) {
		return { ephemeral: false, sessionPath: namedMeta.transcript_path, resumed: true };
	}

	return { ephemeral: false, resumed: false };
}

/** Plain-text session picker. Uses stderr for prompts so stdout stays clean. */
async function pickSession(sessions: SessionInfo[]): Promise<SessionInfo | undefined> {
	const sorted = [...sessions].sort((a, b) => b.modified.getTime() - a.modified.getTime());
	stderr.write("\nResume which session?\n");
	const limit = Math.min(sorted.length, 20);
	for (let i = 0; i < limit; i++) {
		const s = sorted[i]!;
		const name = s.name ?? truncate(s.firstMessage || "(no messages yet)", 60);
		const when = formatRelative(s.modified);
		stderr.write(`  [${i + 1}] ${s.id.slice(0, 8)} · ${when} · ${s.messageCount} msgs · ${name}\n`);
	}
	if (sorted.length > limit) {
		stderr.write(`  (${sorted.length - limit} more not shown; use --session <prefix> to select directly)\n`);
	}
	const { createInterface } = await import("node:readline/promises");
	const rl = createInterface({ input: process.stdin, output: process.stderr });
	try {
		const answer = (await rl.question("Pick a number (or blank to skip): ")).trim();
		if (!answer) return undefined;
		const n = Number(answer);
		if (!Number.isFinite(n) || n < 1 || n > limit) {
			stderr.write("[cua] invalid selection; starting fresh\n");
			return undefined;
		}
		return sorted[n - 1];
	} finally {
		rl.close();
	}
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max - 1) + "…";
}

function formatRelative(date: Date): string {
	const diff = Date.now() - date.getTime();
	const min = Math.floor(diff / 60_000);
	if (min < 1) return "just now";
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const d = Math.floor(hr / 24);
	return `${d}d ago`;
}

interface ProvisionedBrowser {
	browser: BrowserSession;
	/** Named session metadata when `-s <name>` was used; otherwise undefined. */
	named?: NamedSessionMetadata;
}

async function provisionBrowser(cfg: configMod.Config, flags: CliFlags): Promise<ProvisionedBrowser> {
	if (flags.namedSession) {
		const { browser, meta } = await attachNamedSession({ name: flags.namedSession, cfg });
		if (flags.verbose) {
			stderr.write(`[cua] attached named session "${meta.name}" (browser=${browser.sessionId})\n`);
			if (browser.liveUrl) stderr.write(`[cua] live view=${browser.liveUrl}\n`);
		}
		return { browser, named: meta };
	}

	if (flags.verbose) stderr.write("[cua] provisioning Kernel browser...\n");
	const browser = await browserSession.open({
		apiKey: cfg.kernelApiKey,
		baseUrl: cfg.kernelBaseUrl || undefined,
		timeoutSeconds: flags.browserTimeout,
		profileSelector: flags.browserProfile,
		saveChanges: flags.profileSaveChanges,
	});
	if (flags.verbose) {
		stderr.write(`[cua] browser session=${browser.sessionId}\n`);
		if (browser.liveUrl) stderr.write(`[cua] live view=${browser.liveUrl}\n`);
	}
	return { browser };
}

async function runConfigSubcommand(args: string[], profileFlag?: string): Promise<number> {
	const sub = args[0];
	if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
		stdout.write("cua config init|show\n");
		return 0;
	}
	if (sub === "init") {
		await configMod.init();
		return 0;
	}
	if (sub === "show") {
		const text = await configMod.show(profileFlag);
		stdout.write(text);
		return 0;
	}
	stderr.write(`unknown config subcommand: ${sub}\n`);
	return 2;
}

const SESSION_HELP = `cua session start [name]   Start a new named browser session.
cua session stop  <name>   Tear down a named session.
cua session list           List existing named sessions.
cua session show  <name>   Print full metadata for a named session.

Use \`-s <name>\` on any other command to reuse the named session's
browser (e.g. \`cua -s login open https://...\`).`;

function generateSessionSlug(): string {
	const adjectives = ["calm", "brisk", "swift", "quiet", "bright", "sharp"];
	const nouns = ["fox", "owl", "lynx", "hawk", "wolf", "moth"];
	const adj = adjectives[Math.floor(Math.random() * adjectives.length)] ?? "calm";
	const noun = nouns[Math.floor(Math.random() * nouns.length)] ?? "fox";
	const stamp = Date.now().toString(36).slice(-4);
	return `${adj}-${noun}-${stamp}`;
}

async function runSessionSubcommand(args: string[], flags: CliFlags): Promise<number> {
	const sub = args[0];
	if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
		stdout.write(`${SESSION_HELP}\n`);
		return 0;
	}

	switch (sub) {
		case "start": {
			const name = (args[1] ?? "").trim() || generateSessionSlug();
			validateSlug(name);
			const cfg = await loadConfigOrFail(flags);
			const { meta, metadataPath, browser } = await startNamedSession({
				name,
				cfg,
				configProfile: flags.configProfile,
				browserProfile: flags.browserProfile,
				browserTimeoutSeconds: flags.browserTimeout,
				saveProfileChanges: flags.profileSaveChanges,
			});
			stdout.write(`name=${meta.name}\n`);
			stdout.write(`kernel_session_id=${browser.sessionId}\n`);
			if (browser.liveUrl) stdout.write(`live_url=${browser.liveUrl}\n`);
			stdout.write(`metadata=${metadataPath}\n`);
			stdout.write(`\nUse: cua -s ${meta.name} <subcommand>...\n`);
			return 0;
		}
		case "stop": {
			const name = (args[1] ?? "").trim();
			if (!name) {
				stderr.write("usage: cua session stop <name>\n");
				return 2;
			}
			validateSlug(name);
			const cfg = await loadConfigOrFail(flags);
			const result = await stopNamedSession({ name, cfg });
			if (!result.existed) {
				stderr.write(`no named session "${name}"\n`);
				return 1;
			}
			stdout.write(
				result.kernelDeleted
					? `stopped ${name} (kernel browser deleted)\n`
					: `stopped ${name} (kernel browser was already gone)\n`,
			);
			return 0;
		}
		case "list": {
			const sessions = await listNamedSessions();
			if (sessions.length === 0) {
				stdout.write("(no named sessions; run `cua session start [name]`)\n");
				return 0;
			}
			const header = ["NAME", "KERNEL_ID", "AGE", "LIVE_URL"].join("\t");
			stdout.write(`${header}\n`);
			for (const s of sessions) {
				stdout.write(
					[s.name, shortKernelId(s.kernel_session_id), formatRelativeAge(s.created_at), s.live_url ?? "-"].join("\t") +
						"\n",
				);
			}
			return 0;
		}
		case "show": {
			const name = (args[1] ?? "").trim();
			if (!name) {
				stderr.write("usage: cua session show <name>\n");
				return 2;
			}
			validateSlug(name);
			const sessions = await listNamedSessions();
			const meta = sessions.find((s) => s.name === name);
			if (!meta) {
				stderr.write(`no named session "${name}"\n`);
				return 1;
			}
			stdout.write(`${JSON.stringify(meta, null, 2)}\n`);
			return 0;
		}
		default:
			stderr.write(`unknown session subcommand: ${sub}\n${SESSION_HELP}\n`);
			return 2;
	}
}

async function runPrint(prompt: string, flags: CliFlags): Promise<number> {
	const cfg = await loadConfigOrFail(flags);
	const cwd = process.cwd();
	const provision = await provisionBrowser(cfg, flags);
	const browser = provision.browser;
	const sessionPolicy = await resolveSessionFlags(flags, cwd, provision.named);
	const sm = openSession({
		cwd,
		sessionDir: flags.sessionDir,
		sessionPath: sessionPolicy.sessionPath,
		ephemeral: sessionPolicy.ephemeral,
	});
	const { skills } = discoverCuaSkills({ cwd, extraPaths: flags.skillPaths, disabled: flags.noSkills });
	const { expanded, skill: invokedSkill } = expandSkillInvocation(prompt, skills);
	if (invokedSkill && flags.verbose) stderr.write(`[cua] expanded /skill:${invokedSkill.name}\n`);
	const handle = createCuaAgent({
		cwd,
		browser,
		config: cfg,
		modelId: flags.model,
		sessionId: browser.sessionId,
		skills,
	});
	if (sessionPolicy.resumed) seedAgentFromSession(handle.agent, sm);
	appendBrowserMetadata(sm, browser);
	const unsubscribePersist = persistAgentEvents(handle.agent, sm);
	const transcriptPath = sm.getSessionFile();
	if (provision.named && transcriptPath) {
		await recordTranscriptPath(provision.named.name, transcriptPath);
	}
	if (flags.verbose) {
		if (transcriptPath) stderr.write(`[cua] session=${transcriptPath}\n`);
		if (sessionPolicy.resumed) stderr.write("[cua] resumed prior session into fresh browser\n");
	}

	const jsonlMode = (flags.output ?? "text").toLowerCase() === "jsonl";
	let unsubscribeJsonl: (() => void) | undefined;
	if (jsonlMode) {
		unsubscribeJsonl = attachJsonlSink(handle.agent, {
			browser,
			modelId: handle.model.id,
			provider: handle.provider,
			includeDeltas: flags.jsonlIncludeDeltas,
			includeImages: flags.jsonlIncludeImages,
		});
	}

	const unsubscribe = handle.agent.subscribe((event) => {
		if (jsonlMode) return;
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			stdout.write(event.assistantMessageEvent.delta);
			return;
		}
		if (flags.verbose && event.type === "tool_execution_start") {
			stderr.write(`\n[cua] tool ${event.toolName} ${JSON.stringify(event.args)}\n`);
		}
		if (flags.verbose && event.type === "tool_execution_end") {
			stderr.write(`[cua] tool ${event.toolName} done\n`);
		}
	});

	let exitCode = 0;
	try {
		await promptWithScreenshot({
			agent: handle.agent,
			translator: handle.translator,
			prompt: expanded,
			options: { skipInitialScreenshot: sessionPolicy.resumed },
		});
		const agentError = (handle.agent.state as { errorMessage?: string }).errorMessage;
		if (agentError) {
			throw new Error(agentError);
		}
		if (!jsonlMode) stdout.write("\n");
	} catch (err) {
		if (jsonlMode) {
			stdout.write(
				JSON.stringify({
					type: "error",
					code: "run_failed",
					message: (err as Error).message,
					ts: Date.now(),
				}) + "\n",
			);
		} else {
			stderr.write(`\n[cua] error: ${(err as Error).message}\n`);
		}
		exitCode = 1;
	} finally {
		unsubscribe();
		unsubscribeJsonl?.();
		unsubscribePersist();
		try {
			await handle.dispose();
		} catch (err) {
			stderr.write(`[cua] cleanup warning: ${(err as Error).message}\n`);
		}
	}
	return exitCode;
}

async function runActionSub(action: ActionType, rest: string[], flags: CliFlags): Promise<number> {
	const cfg = await loadConfigOrFail(flags);
	const cwd = process.cwd();
	const provision = await provisionBrowser(cfg, flags);
	const browser = provision.browser;

	const req: ActionRequest = buildActionRequest(action, rest);
	if (flags.maxSteps !== undefined) req.maxTurns = flags.maxSteps;

	const screenshotOut = flags.out
		? { out: flags.out }
		: action === "screenshot"
			? { out: "screenshot.png" }
			: undefined;

	// For named sessions the transcript should persist across action calls so
	// external analysis can correlate them. For one-shot subcommand calls
	// without a named session we skip the SessionManager entirely.
	let sm: ReturnType<typeof openSession> | undefined;
	if (provision.named) {
		const sessionPolicy = await resolveSessionFlags(flags, cwd, provision.named);
		sm = openSession({
			cwd,
			sessionDir: flags.sessionDir,
			sessionPath: sessionPolicy.sessionPath,
			ephemeral: sessionPolicy.ephemeral,
		});
		appendBrowserMetadata(sm, browser);
		const transcriptPath = sm.getSessionFile();
		if (transcriptPath) await recordTranscriptPath(provision.named.name, transcriptPath);
		if (flags.verbose && transcriptPath) stderr.write(`[cua] session=${transcriptPath}\n`);
	}

	let res: RunActionResult;
	try {
		res = await runAction(
			req,
			{
				cwd,
				browser,
				config: cfg,
				modelId: flags.model,
				verbose: flags.verbose,
				sessionManager: sm,
			},
			screenshotOut,
		);
	} finally {
		try {
			await browser.close();
		} catch (err) {
			stderr.write(`[cua] cleanup warning: ${(err as Error).message}\n`);
		}
	}
	return emitCompact(res);
}

function buildActionRequest(action: ActionType, rest: string[]): ActionRequest {
	switch (action) {
		case "open":
			return { action, text: rest[0] };
		case "click":
			return { action, target: rest.join(" ") };
		case "type":
			return { action, target: rest[0], text: rest[1] };
		case "press":
			return { action, keys: rest };
		case "observe":
			return { action, text: rest.join(" ") };
		case "url":
			return { action };
		case "screenshot":
			return { action };
		case "do":
			return { action, text: rest.join(" ") };
	}
}

const SUBCOMMANDS = new Set(["open", "click", "type", "press", "observe", "url", "screenshot", "do"]);

export async function main(argv: string[]): Promise<number> {
	if (argv[0] === "models") {
		return await runModelsSubcommand(argv.slice(1));
	}

	let flags: CliFlags;
	try {
		flags = parseCliArgs(argv);
	} catch (err) {
		stderr.write(`${(err as Error).message}\n\n${HELP}`);
		return 2;
	}

	if (flags.help) {
		stdout.write(HELP);
		return 0;
	}

	const positionals = flags.positionals;
	const first = positionals[0];

	if (first === "config") {
		try {
			return await runConfigSubcommand(positionals.slice(1), flags.configProfile);
		} catch (err) {
			stderr.write(`config error: ${(err as Error).message}\n`);
			return 2;
		}
	}

	if (first === "session") {
		try {
			return await runSessionSubcommand(positionals.slice(1), flags);
		} catch (err) {
			stderr.write(`session error: ${(err as Error).message}\n`);
			return 2;
		}
	}

	if (first && SUBCOMMANDS.has(first)) {
		try {
			return await runActionSub(first as ActionType, positionals.slice(1), flags);
		} catch (err) {
			stderr.write(`error: ${(err as Error).message}\n`);
			return 2;
		}
	}

	const prompt = positionals.join(" ").trim();

	if (flags.print) {
		if (!prompt) {
			stderr.write("error: --print requires a prompt\n");
			return 2;
		}
		try {
			return await runPrint(prompt, flags);
		} catch (err) {
			stderr.write(`error: ${(err as Error).message}\n`);
			return 1;
		}
	}

	try {
		return await runInteractiveCli(prompt, flags);
	} catch (err) {
		stderr.write(`error: ${(err as Error).message}\n`);
		return 1;
	}
}

async function runInteractiveCli(initialPrompt: string, flags: CliFlags): Promise<number> {
	const cfg = await loadConfigOrFail(flags);
	const cwd = process.cwd();
	const provision = await provisionBrowser(cfg, flags);
	const browser = provision.browser;
	const sessionPolicy = await resolveSessionFlags(flags, cwd, provision.named);
	const sm = openSession({
		cwd,
		sessionDir: flags.sessionDir,
		sessionPath: sessionPolicy.sessionPath,
		ephemeral: sessionPolicy.ephemeral,
	});
	const transcriptPath = sm.getSessionFile();
	if (provision.named && transcriptPath) {
		await recordTranscriptPath(provision.named.name, transcriptPath);
	}
	const startupResources = discoverStartupResources({
		cwd,
		extraPaths: flags.skillPaths,
		disabled: flags.noSkills,
	});
	return await runInteractive({
		cwd,
		browser,
		config: cfg,
		modelId: flags.model,
		initialPrompt: initialPrompt || undefined,
		verbose: flags.verbose,
		debugTui: flags.debugTui,
		imageProtocol: flags.imageProtocol,
		sessionManager: sm,
		resumed: sessionPolicy.resumed,
		skills: startupResources.skills,
		startupResources,
	});
}

main(process.argv.slice(2)).then(
	(code) => {
		process.exit(code);
	},
	(err) => {
		stderr.write(`fatal: ${(err as Error).message}\n`);
		process.exit(1);
	},
);
