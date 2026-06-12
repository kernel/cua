#!/usr/bin/env node
import { stderr, stdout } from "node:process";
import { parseArgs } from "node:util";
import { type ActionType } from "./action/prompts";
import {
	runActionCommand,
	runInteractiveCommand,
	runModelsSubcommand as runModelsSubcommandHarness,
	runPrintCommand,
	runSessionSubcommand as runSessionSubcommandHarness,
	type HarnessCliFlags,
} from "./cli-harness";
import * as configMod from "./config";
import { DEFAULT_CUA_MODEL_REF } from "./harness-models";

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
  -m, --model <ref>              Model ref (default: ${DEFAULT_CUA_MODEL_REF})
                                 Accepts \`provider:model\` refs or bare ids that
                                 match exactly one entry in \`cua models\`.
                                 Recommended:
                                   openai:    openai:gpt-5.5
                                   anthropic: anthropic:claude-opus-4-7
                                   google:    google:gemini-3-flash-preview
                                   tzafon:    tzafon:tzafon.northstar-cua-fast
                                   yutori:    yutori:n1.5-latest
      --thinking <level>         Thinking level: off | minimal | low | medium | high | xhigh
                                 (default: low; applies to providers that support it)
      --config-profile <p>       Legacy TOML config profile to load (only used by \`cua config show\`)
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
	thinking?: string;
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
				thinking: { type: "string" },
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
	const thinkingRaw = parsed.values.thinking as string | undefined;
	if (thinkingRaw !== undefined) {
		const allowed = new Set(["off", "none", "minimal", "low", "medium", "high", "xhigh"]);
		if (!allowed.has(thinkingRaw.trim().toLowerCase())) {
			throw new Error(
				`invalid --thinking value "${thinkingRaw}"; expected one of: off | minimal | low | medium | high | xhigh`,
			);
		}
	}

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
		thinking: parsed.values.thinking as string | undefined,
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

function toHarnessFlags(flags: CliFlags): HarnessCliFlags {
	return {
		verbose: flags.verbose,
		profileSaveChanges: flags.profileSaveChanges,
		continueLatest: flags.continueLatest,
		resumePicker: flags.resumePicker,
		noSession: flags.noSession,
		noSkills: flags.noSkills,
		debugTui: flags.debugTui,
		jsonlIncludeDeltas: flags.jsonlIncludeDeltas,
		jsonlIncludeImages: flags.jsonlIncludeImages,
		model: flags.model,
		thinking: flags.thinking,
		browserProfile: flags.browserProfile,
		browserTimeout: flags.browserTimeout,
		maxSteps: flags.maxSteps,
		out: flags.out,
		output: flags.output,
		imageProtocol: flags.imageProtocol,
		namedSession: flags.namedSession,
		sessionRef: flags.sessionRef,
		sessionDir: flags.sessionDir,
		skillPaths: flags.skillPaths,
	};
}

async function runConfigSubcommand(args: string[], profile?: string): Promise<number> {
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
		const text = await configMod.show(profile);
		stdout.write(text);
		return 0;
	}
	stderr.write(`unknown config subcommand: ${sub}\n`);
	return 2;
}

const SUBCOMMANDS = new Set(["open", "click", "type", "press", "observe", "url", "screenshot", "do"]);

export async function main(argv: string[]): Promise<number> {
	if (argv[0] === "models") {
		return await runModelsSubcommandHarness(argv.slice(1));
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
			return await runSessionSubcommandHarness(positionals.slice(1), toHarnessFlags(flags));
		} catch (err) {
			stderr.write(`session error: ${(err as Error).message}\n`);
			return 2;
		}
	}

	if (first && SUBCOMMANDS.has(first)) {
		try {
			return await runActionCommand(first as ActionType, positionals.slice(1), toHarnessFlags(flags));
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
			return await runPrintCommand(prompt, toHarnessFlags(flags));
		} catch (err) {
			stderr.write(`error: ${(err as Error).message}\n`);
			return 1;
		}
	}

	try {
		return await runInteractiveCommand(prompt, toHarnessFlags(flags));
	} catch (err) {
		stderr.write(`error: ${(err as Error).message}\n`);
		return 1;
	}
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
