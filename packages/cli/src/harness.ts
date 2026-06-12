import {
	CuaAgentHarness,
	type CuaAgentHarnessOptions,
	formatSkillsForSystemPrompt,
	type KernelBrowser,
	NodeExecutionEnv,
	type Session,
	type Skill,
	type ThinkingLevel,
} from "@onkernel/cua-agent";
import {
	type Api,
	type CuaModelRef,
	type Model,
	getCuaEnvApiKey,
	getCuaModel,
	resolveCuaRuntimeSpec,
} from "@onkernel/cua-ai";
import type Kernel from "@onkernel/sdk";
import { createCodingTools } from "@earendil-works/pi-coding-agent";

/** Options for {@link buildCuaHarness}. */
export interface BuildCuaHarnessOptions {
	cwd: string;
	client: Kernel;
	browser: KernelBrowser;
	session: Session;
	model: CuaModelRef;
	skills?: Skill[];
	thinkingLevel?: ThinkingLevel;
	/** Override the default coding-tools extraTools (bash/read/edit/write/grep/find/ls). */
	extraTools?: CuaAgentHarnessOptions["extraTools"];
	/** Override env-var API-key resolution (mainly for tests). */
	getApiKeyAndHeaders?: CuaAgentHarnessOptions["getApiKeyAndHeaders"];
	/** Override the catalog `baseUrl` on the resolved model (e.g. from `<PROVIDER>_BASE_URL`). */
	modelBaseUrl?: string;
}

/**
 * Build a `CuaAgentHarness` wired with cua-cli's defaults: pi `NodeExecutionEnv`,
 * caller-supplied jsonl `Session`, pi-coding-agent's `createCodingTools` as
 * `extraTools`, env-var API-key resolution (via cua-ai conventions), and a
 * `systemPrompt` that composes the runtime spec's default prompt with the
 * formatted skill block.
 */
export function buildCuaHarness(opts: BuildCuaHarnessOptions): CuaAgentHarness {
	const skills = opts.skills ?? [];
	const extraTools = opts.extraTools ?? createCodingTools(opts.cwd);
	const model: CuaModelRef | Model<Api> = opts.modelBaseUrl
		? { ...getCuaModel(opts.model), baseUrl: opts.modelBaseUrl }
		: opts.model;
	return new CuaAgentHarness({
		env: new NodeExecutionEnv({ cwd: opts.cwd }),
		session: opts.session,
		model,
		browser: opts.browser,
		client: opts.client,
		extraTools,
		resources: { skills },
		thinkingLevel: opts.thinkingLevel,
		systemPrompt: ({ model: activeModel, resources }) => {
			const runtime = resolveCuaRuntimeSpec(activeModel);
			return composeSystemPrompt(runtime.defaultSystemPrompt, resources.skills ?? []);
		},
		getApiKeyAndHeaders:
			opts.getApiKeyAndHeaders ??
			(async (resolvedModel) => {
				const apiKey = getCuaEnvApiKey(resolvedModel.provider);
				return apiKey ? { apiKey } : undefined;
			}),
	});
}

function composeSystemPrompt(base: string, skills: Skill[]): string {
	const skillBlock = formatSkillsForSystemPrompt(skills).trim();
	if (!skillBlock) return base;
	return `${base.trim()}\n\n${skillBlock}\n`;
}
