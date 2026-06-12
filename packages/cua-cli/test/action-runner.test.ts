import { afterEach, describe, expect, it } from "vitest";
import { runAction } from "../src/action/harness-runner";
import { buildTestHarness, type TestHarnessFixture } from "./fixtures/harness";

let fixture: TestHarnessFixture | undefined;

afterEach(async () => {
	await fixture?.dispose();
	fixture = undefined;
});

describe("action harness-runner", () => {
	it("exits 0 with formatted result when a click action succeeds", async () => {
		fixture = await buildTestHarness({
			turns: [
				{
					steps: [
						{
							type: "tool_call",
							toolName: "click",
							args: { x: 123, y: 45 },
						},
					],
				},
				{
					steps: [{ type: "text", text: "clicked" }],
				},
			],
		});
		const res = await runAction(
			{ action: "click", target: "the button" },
			{ harness: fixture.harness, browserHandle: handleFor(fixture), session: fixture.session, maxTurns: 5 },
		);
		expect(res.exitCode).toBe(0);
		expect(res.result.coordinates).toEqual([123, 45]);
		expect(res.result.action).toBe("click");
	});

	it("exits 1 when the model says NOT_FOUND", async () => {
		fixture = await buildTestHarness({
			turns: [
				{
					steps: [{ type: "text", text: "NOT_FOUND: no match" }],
				},
			],
		});
		const res = await runAction(
			{ action: "click", target: "missing" },
			{ harness: fixture.harness, browserHandle: handleFor(fixture), session: fixture.session, maxTurns: 5 },
		);
		expect(res.exitCode).toBe(1);
		expect(res.result.status).toBe("not_found");
		expect(res.result.text).toBe("no match");
	});

	it("captures a screenshot via the SDK without invoking the harness", async () => {
		fixture = await buildTestHarness({ turns: [] });
		const originalWrite = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((_chunk: string | Uint8Array): boolean => true) as typeof process.stdout.write;
		try {
			const res = await runAction(
				{ action: "screenshot" },
				{ harness: fixture.harness, browserHandle: handleFor(fixture), session: fixture.session },
				{ out: "-" },
			);
			expect(res.exitCode).toBe(0);
			expect(fixture.provider.callCount()).toBe(0);
			expect(fixture.kernel.screenshots).toBe(1);
		} finally {
			process.stdout.write = originalWrite;
		}
	});
});

function handleFor(fixture: TestHarnessFixture) {
	return {
		client: fixture.kernel.client,
		browser: fixture.kernel.browser,
		async close(): Promise<void> {},
	};
}
