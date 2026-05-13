import Kernel from "@onkernel/sdk";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { CuaAgent, CuaHarness } from "../src/index";

const LIVE = process.env.CUA_E2E_LIVE === "1";
const KERNEL_API_KEY = process.env.KERNEL_API_KEY;

type ProviderCase = {
	name: string;
	apiKeyEnvVar: string;
	modelRef:
		| "openai:gpt-5.5"
		| "anthropic:claude-opus-4-7"
		| "gemini:gemini-3-flash-preview"
		| "tzafon:tzafon.northstar-cua-fast"
		| "yutori:n1.5-latest";
	prompt: string;
	expectToolCalls: boolean;
	timeoutMs: number;
};

const cases: ProviderCase[] = [
	{
		name: "openai",
		apiKeyEnvVar: "OPENAI_API_KEY",
		modelRef: "openai:gpt-5.5",
		prompt: [
			"Call batch_computer_actions exactly once.",
			'Pass this exact arguments JSON: {"actions":[{"type":"screenshot"}]}',
			"Do not call any other tools.",
			"Then provide a one-sentence summary.",
		].join("\n"),
		expectToolCalls: true,
		timeoutMs: 120_000,
	},
	{
		name: "anthropic",
		apiKeyEnvVar: "ANTHROPIC_API_KEY",
		modelRef: "anthropic:claude-opus-4-7",
		prompt: [
			"Call batch_computer_actions exactly once.",
			'Pass this exact arguments JSON: {"actions":[{"type":"screenshot"}]}',
			"Do not call any other tools.",
			"Then provide a one-sentence summary.",
		].join("\n"),
		expectToolCalls: true,
		timeoutMs: 120_000,
	},
	{
		name: "gemini",
		apiKeyEnvVar: "GOOGLE_API_KEY",
		modelRef: "gemini:gemini-3-flash-preview",
		prompt: [
			"Call batch_computer_actions exactly once.",
			'Pass this exact arguments JSON: {"actions":[{"type":"screenshot"}]}',
			"Do not call any other tools.",
			"Then provide a one-sentence summary.",
		].join("\n"),
		expectToolCalls: true,
		timeoutMs: 300_000,
	},
	{
		name: "tzafon",
		apiKeyEnvVar: "TZAFON_API_KEY",
		modelRef: "tzafon:tzafon.northstar-cua-fast",
		prompt: [
			"Call batch_computer_actions exactly once.",
			'Pass this exact arguments JSON: {"actions":[{"type":"screenshot"}]}',
			"Do not call any other tools.",
			"Then provide a one-sentence summary.",
		].join("\n"),
		expectToolCalls: false,
		timeoutMs: 120_000,
	},
	{
		name: "yutori",
		apiKeyEnvVar: "YUTORI_API_KEY",
		modelRef: "yutori:n1.5-latest",
		prompt: [
			"Call batch_computer_actions exactly once.",
			'Pass this exact arguments JSON: {"actions":[{"type":"screenshot"}]}',
			"Do not call any other tools.",
			"Then provide a one-sentence summary.",
		].join("\n"),
		expectToolCalls: false,
		timeoutMs: 180_000,
	},
];

type RunStats = {
	toolCalls: number;
	toolResults: number;
	hasReadArtifact: boolean;
	finalAssistant?: AgentMessage;
	toolErrors: string[];
	assistantErrors: string[];
};

function shouldRunCase(c: ProviderCase): boolean {
	if (!LIVE) return false;
	if (!KERNEL_API_KEY) return false;
	return Boolean(process.env[c.apiKeyEnvVar]);
}

async function withBrowser<T>(run: (client: Kernel, browser: Awaited<ReturnType<Kernel["browsers"]["create"]>>) => Promise<T>): Promise<T> {
	if (!KERNEL_API_KEY) {
		throw new Error("KERNEL_API_KEY is required");
	}
	const client = new Kernel({ apiKey: KERNEL_API_KEY });
	const browser = await client.browsers.create({ stealth: true });
	try {
		return await run(client, browser);
	} finally {
		await client.browsers.deleteByID(browser.session_id).catch(() => {});
	}
}

function assertStats(stats: RunStats, expectToolCalls: boolean, providerName: string, runtimeName: "agent" | "harness"): void {
	if (expectToolCalls) {
		expect(stats.toolCalls).toBeGreaterThan(0);
		expect(stats.toolResults).toBeGreaterThan(0);
		expect(stats.hasReadArtifact).toBe(true);
	}
	expect(stats.toolErrors, `${providerName}/${runtimeName} emitted tool errors: ${stats.toolErrors.join(" | ")}`).toHaveLength(0);
	expect(stats.assistantErrors, `${providerName}/${runtimeName} emitted assistant errors: ${stats.assistantErrors.join(" | ")}`).toHaveLength(0);
	expect(stats.finalAssistant).toBeDefined();
	if (stats.finalAssistant?.role === "assistant") {
		expect(stats.finalAssistant.stopReason, `${providerName}/${runtimeName} ended in assistant error`).not.toBe("error");
		expect(stats.finalAssistant.stopReason, `${providerName}/${runtimeName} ended in assistant abort`).not.toBe("aborted");
	}
}

describe("Cua live e2e", () => {
	for (const c of cases) {
		const test = shouldRunCase(c) ? it : it.skip;

		test(
			`${c.name}: CuaAgent executes browser steps`,
			async () => {
				await withBrowser(async (client, browser) => {
					const stats: RunStats = { toolCalls: 0, toolResults: 0, hasReadArtifact: false, toolErrors: [], assistantErrors: [] };
					const agent = new CuaAgent({
						browser,
						client,
						getApiKey: () => process.env[c.apiKeyEnvVar],
						initialState: {
							model: c.modelRef,
						},
					});
					agent.subscribe((event) => {
						if (event.type === "tool_execution_start") stats.toolCalls += 1;
						if (event.type === "tool_execution_end" && event.isError) {
							stats.toolErrors.push(`${event.toolName}: failed`);
						}
						if (event.type === "message_end" && event.message.role === "toolResult") {
							stats.toolResults += 1;
							if (
								event.message.content.some(
									(block) => block.type === "image" || (block.type === "text" && /url\(\)|Current URL:/.test(block.text)),
								)
							) {
								stats.hasReadArtifact = true;
							}
						}
						if (event.type === "message_end" && event.message.role === "assistant") {
							stats.finalAssistant = event.message;
							if (event.message.errorMessage) {
								stats.assistantErrors.push(event.message.errorMessage);
							}
						}
					});

					await agent.prompt(c.prompt);
					assertStats(stats, c.expectToolCalls, c.name, "agent");
				});
			},
			c.timeoutMs,
		);

		test(
			`${c.name}: CuaHarness executes browser steps`,
			async () => {
				await withBrowser(async (client, browser) => {
					const stats: RunStats = { toolCalls: 0, toolResults: 0, hasReadArtifact: false, toolErrors: [], assistantErrors: [] };
					const harness = new CuaHarness({
						browser,
						client,
						model: c.modelRef,
						getApiKey: () => process.env[c.apiKeyEnvVar],
					});

					harness.subscribe((event) => {
						if (event.type === "tool_execution_start") stats.toolCalls += 1;
						if (event.type === "tool_execution_end" && event.isError) {
							stats.toolErrors.push(`${event.toolName}: failed`);
						}
						if (event.type === "message_end" && event.message.role === "toolResult") {
							stats.toolResults += 1;
							if (
								event.message.content.some(
									(block) => block.type === "image" || (block.type === "text" && /url\(\)|Current URL:/.test(block.text)),
								)
							) {
								stats.hasReadArtifact = true;
							}
						}
						if (event.type === "message_end" && event.message.role === "assistant") {
							stats.finalAssistant = event.message;
							if (event.message.errorMessage) {
								stats.assistantErrors.push(event.message.errorMessage);
							}
						}
					});

					await harness.prompt(c.prompt);
					assertStats(stats, c.expectToolCalls, c.name, "harness");
				});
			},
			c.timeoutMs,
		);
	}
});
