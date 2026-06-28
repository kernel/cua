/**
 * Child-process entry point for ptywright-driven TUI tests. Spawned via
 * `tsx` so the same source file the vitest harness imports gets type-checked
 * and exercised. Receives a JSON fixture path on argv[2], registers the
 * scripted provider, assembles the real {@link buildCuaHarness}, and starts
 * the interactive TUI.
 */
import { InMemorySessionRepo, type Skill } from "@onkernel/cua-agent";
import type { CuaModelRef } from "@onkernel/cua-ai";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildCuaHarness } from "../../src/harness";
import type { ContextFile } from "../../src/harness-skills";
import { runInteractive } from "../../src/tui/main";
import { createFakeKernelEnvironment } from "./fake-kernel";
import { registerScriptedProvider, type ScriptedTurn } from "./scripted-provider";

interface TuiFixture {
	modelRef?: string;
	api?: string;
	turns: ScriptedTurn[];
	skills?: Skill[];
	contextFiles?: ContextFile[];
}

const DEFAULT_API_FOR_MODEL: Record<string, string> = {
	"openai:gpt-5.5": "openai-cua-responses",
	"anthropic:claude-opus-4-7": "anthropic-messages",
	"google:gemini-3-flash-preview": "google-generative-ai",
};

async function main(): Promise<void> {
	const fixtureArg = process.argv[2];
	if (!fixtureArg) {
		throw new Error("usage: tui-fixture-runner <fixture.json>");
	}
	const fixturePath = resolve(process.cwd(), fixtureArg);
	const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as TuiFixture;

	const modelRef = fixture.modelRef ?? "openai:gpt-5.5";
	const api = fixture.api ?? DEFAULT_API_FOR_MODEL[modelRef] ?? "openai-responses";
	registerScriptedProvider(api, fixture.turns);

	const kernel = createFakeKernelEnvironment();
	const sessionRepo = new InMemorySessionRepo();
	const session = await sessionRepo.create();
	const cwd = process.cwd();
	const skills = fixture.skills ?? [];
	const contextFiles = fixture.contextFiles ?? [];
	const harness = buildCuaHarness({
		cwd,
		client: kernel.client,
		browser: kernel.browser,
		session,
		model: modelRef as CuaModelRef,
		skills,
		contextFiles,
		extraTools: [],
		getApiKeyAndHeaders: async () => ({ apiKey: "fixture-key" }),
	});

	const code = await runInteractive({
		cwd,
		harness,
		browserHandle: {
			client: kernel.client,
			browser: kernel.browser,
			async close(): Promise<void> {},
		},
		session,
		skills,
		contextFiles,
		modelRef,
		provider: modelRef.split(":", 1)[0] ?? "openai",
		skipInitialScreenshot: true,
	});
	process.exit(code);
}

main().catch((err) => {
	process.stderr.write(`fixture error: ${(err as Error).message}\n`);
	process.exit(1);
});
