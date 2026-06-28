import {
	InMemorySessionRepo,
	type Session,
	type Skill,
} from "@onkernel/cua-agent";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { buildCuaHarness } from "../../src/harness";
import { createFakeKernelEnvironment, type FakeKernelEnvironment } from "./fake-kernel";
import type { ScriptedProviderHandle, ScriptedTurn } from "./scripted-provider";
import { registerScriptedProvider } from "./scripted-provider";

export interface TestHarnessFixture {
	provider: ScriptedProviderHandle;
	kernel: FakeKernelEnvironment;
	session: Session;
	cwd: string;
	harness: ReturnType<typeof buildCuaHarness>;
	dispose(): Promise<void>;
}

export interface BuildTestHarnessOptions {
	turns: ScriptedTurn[];
	skills?: Skill[];
	/** CUA model ref. Defaults to "openai:gpt-5.5". */
	modelRef?: string;
	/** API id the scripted provider serves. Default infers from modelRef. */
	api?: string;
}

const DEFAULT_API_FOR_MODEL: Record<string, string> = {
	"openai:gpt-5.5": "openai-cua-responses",
	"anthropic:claude-opus-4-7": "anthropic-messages",
	"google:gemini-3-flash-preview": "google-generative-ai",
};

export async function buildTestHarness(opts: BuildTestHarnessOptions): Promise<TestHarnessFixture> {
	const modelRef = opts.modelRef ?? "openai:gpt-5.5";
	const api = opts.api ?? DEFAULT_API_FOR_MODEL[modelRef] ?? "openai-responses";
	const provider = registerScriptedProvider(api, opts.turns);

	const kernel = createFakeKernelEnvironment();
	const cwd = mkdtempSync(join(tmpdir(), "cua-cli-test-"));

	const sessionRepo = new InMemorySessionRepo();
	const session = await sessionRepo.create();

	const harness = buildCuaHarness({
		cwd,
		client: kernel.client,
		browser: kernel.browser,
		session,
		model: modelRef as never,
		skills: opts.skills,
		extraTools: [],
		getApiKeyAndHeaders: async () => ({ apiKey: "test-key" }),
	});

	return {
		provider,
		kernel,
		session,
		cwd,
		harness,
		async dispose(): Promise<void> {
			provider.dispose();
		},
	};
}
