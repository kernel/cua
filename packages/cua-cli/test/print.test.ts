import { afterEach, describe, expect, it } from "vitest";
import type { Skill } from "@onkernel/cua-agent";
import { runPrint } from "../src/print";
import { buildTestHarness, type TestHarnessFixture } from "./fixtures/harness";

let fixture: TestHarnessFixture | undefined;

afterEach(async () => {
	await fixture?.dispose();
	fixture = undefined;
});

describe("runPrint", () => {
	it("streams assistant text in plain text mode", async () => {
		fixture = await buildTestHarness({
			turns: [
				{
					steps: [{ type: "text", text: "Hello, world." }],
				},
			],
		});
		const lines: string[] = [];
		const exitCode = await runPrintIntoBuffer(fixture, "say hi", lines);
		expect(exitCode).toBe(0);
		expect(lines.join("\n")).toContain("Hello, world.");
	});

	it("emits jsonl with the documented session_created and run_complete envelope", async () => {
		fixture = await buildTestHarness({
			turns: [
				{
					steps: [{ type: "text", text: "ok" }],
				},
			],
		});
		const events = await runPrintAsJsonl(fixture, "go");
		const types = events.map((e) => e.type);
		expect(types[0]).toBe("session_created");
		expect(types).toContain("browser_created");
		expect(types).toContain("assistant_text_done");
		expect(types).toContain("turn_done");
		expect(types).toContain("run_complete");
		expect((events[0] as { schema_version: number }).schema_version).toBe(1);
	});

	it("returns exit code 1 when the provider emits an error", async () => {
		fixture = await buildTestHarness({
			turns: [
				{ steps: [{ type: "error", message: "boom" }] },
			],
		});
		const lines: string[] = [];
		const exitCode = await runPrintIntoBuffer(fixture, "fail", lines);
		expect(exitCode).toBe(1);
	});

	it("captures the initial screenshot for /skill prompts on a fresh session", async () => {
		const skill: Skill = {
			name: "demo-skill",
			description: "demo skill for tests",
			content: "Do the thing.",
			filePath: "/tmp/demo-skill/SKILL.md",
		};
		fixture = await buildTestHarness({
			turns: [
				{
					steps: [{ type: "text", text: "ok" }],
				},
			],
			skills: [skill],
		});
		const lines: string[] = [];
		const exitCode = await runPrintIntoBuffer(fixture, "/skill:demo-skill check the page", lines, [skill]);
		expect(exitCode).toBe(0);
		expect(fixture.kernel.screenshots).toBe(1);
	});

	it("expands unknown /skill commands into a missing-skill prompt", async () => {
		fixture = await buildTestHarness({
			turns: [
				{
					steps: [{ type: "text", text: "ok" }],
				},
			],
		});
		const lines: string[] = [];
		const exitCode = await runPrintIntoBuffer(fixture, "/skill:missing do thing", lines);
		expect(exitCode).toBe(0);
		const context = fixture.provider.lastContext();
		const promptText = lastUserPromptText(context);
		expect(promptText).toContain('(no skill named "missing" was found; pretending the user typed: do thing)');
		expect(promptText).toContain("\n\ndo thing");
		expect(promptText).not.toContain("/skill:missing");
	});

	it("emits tool_call and tool_result envelopes for tool turns in jsonl mode", async () => {
		fixture = await buildTestHarness({
			turns: [
				{
					steps: [
						{
							type: "tool_call",
							toolName: "click",
							args: { x: 12, y: 34 },
						},
					],
				},
				{ steps: [{ type: "text", text: "done" }] },
			],
		});
		const events = await runPrintAsJsonl(fixture, "click button");
		const types = events.map((e) => e.type);
		expect(types).toContain("tool_call");
		expect(types).toContain("tool_result");
		const call = events.find((e) => e.type === "tool_call") as Record<string, unknown>;
		expect(call.tool_name).toBe("click");
		const result = events.find((e) => e.type === "tool_result") as Record<string, unknown>;
		expect(result.tool_name).toBe("click");
		// ok / call_id present on the result envelope, mirroring the documented schema.
		expect(typeof result.ok).toBe("boolean");
		expect(typeof result.call_id).toBe("string");
	});
});

async function runPrintIntoBuffer(
	fixture: TestHarnessFixture,
	prompt: string,
	out: string[],
	skills?: Skill[],
): Promise<number> {
	const stdoutWrite = process.stdout.write.bind(process.stdout);
	const stderrWrite = process.stderr.write.bind(process.stderr);
	const stdoutChunks: string[] = [];
	process.stdout.write = ((chunk: string | Uint8Array): boolean => {
		stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
		return true;
	}) as typeof process.stdout.write;
	process.stderr.write = ((_chunk: string | Uint8Array): boolean => true) as typeof process.stderr.write;
	try {
		const code = await runPrint({
			harness: fixture.harness,
			browserHandle: {
				client: fixture.kernel.client,
				browser: fixture.kernel.browser,
				async close(): Promise<void> {},
			},
			session: fixture.session,
			modelRef: "openai:gpt-5.5",
			provider: "openai",
			prompt,
			skills,
		});
		out.push(...stdoutChunks);
		return code;
	} finally {
		process.stdout.write = stdoutWrite;
		process.stderr.write = stderrWrite;
	}
}

function lastUserPromptText(context: unknown): string {
	if (!context || typeof context !== "object") return "";
	const messages = (context as { messages?: unknown }).messages;
	if (!Array.isArray(messages)) return "";
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (!message || typeof message !== "object") continue;
		if ((message as { role?: unknown }).role !== "user") continue;
		const content = (message as { content?: unknown }).content;
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return "";
		for (const block of content) {
			if (!block || typeof block !== "object") continue;
			if ((block as { type?: unknown }).type !== "text") continue;
			const text = (block as { text?: unknown }).text;
			if (typeof text === "string") return text;
		}
	}
	return "";
}

async function runPrintAsJsonl(
	fixture: TestHarnessFixture,
	prompt: string,
): Promise<Array<Record<string, unknown>>> {
	const lines: string[] = [];
	const stdoutWrite = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: string | Uint8Array): boolean => {
		const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
		for (const line of text.split("\n")) {
			if (line.trim()) lines.push(line);
		}
		return true;
	}) as typeof process.stdout.write;
	try {
		await runPrint({
			harness: fixture.harness,
			browserHandle: {
				client: fixture.kernel.client,
				browser: fixture.kernel.browser,
				async close(): Promise<void> {},
			},
			session: fixture.session,
			modelRef: "openai:gpt-5.5",
			provider: "openai",
			prompt,
			jsonlMode: true,
		});
	} finally {
		process.stdout.write = stdoutWrite;
	}
	return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}
