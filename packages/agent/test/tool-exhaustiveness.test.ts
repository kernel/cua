import { CUA_PROVIDERS, listCuaModels, resolveCuaRuntimeSpec } from "@onkernel/cua-ai";
import type Kernel from "@onkernel/sdk";
import { describe, expect, it } from "vitest";
import { createCuaComputerTools, type KernelBrowser } from "../src/index";

const browser = { session_id: "browser_123" } as KernelBrowser;
const client = {} as Kernel;
const ANTHROPIC_BATCH_TOOL_NAME = "computer_batch";
const tinyPng = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
	"base64",
);

describe("Cua tool executor coverage", () => {
	it("covers every tool executor exported by cua-ai defaults", () => {
		for (const provider of CUA_PROVIDERS) {
			const model = listCuaModels(provider)[0];
			expect(model, `no CUA model for provider ${provider}`).toBeDefined();
			const runtime = resolveCuaRuntimeSpec(model!.ref);
			expect(() => createCuaComputerTools({ browser, client, toolExecutors: runtime.toolExecutors })).not.toThrow();
		}
	});

	it("instantiates one executor per provider execution adapter", () => {
		const toolExecutors = resolveCuaRuntimeSpec("openai:gpt-5.5").toolExecutors;
		const tools = createCuaComputerTools({ browser, client, toolExecutors });
		expect(tools.map((tool) => tool.name).sort()).toEqual(toolExecutors.map((tool) => tool.definition.name).sort());
	});

	it("executes Yutori local canonical action tools", async () => {
		const batches: unknown[] = [];
		const runtime = resolveCuaRuntimeSpec("yutori:n1.5-latest");
		const tools = createCuaComputerTools({
			browser: { ...browser, viewport: { width: 1920, height: 1080 } },
			client: {
				browsers: {
					computer: {
						batch: async (_id: string, body: { actions: unknown[] }) => {
							batches.push(body.actions);
						},
						captureScreenshot: async () => new Response(tinyPng),
					},
				},
			} as unknown as Kernel,
			toolExecutors: runtime.toolExecutors,
			coordinateSystem: runtime.coordinateSystem,
			screenshot: runtime.screenshot,
		});
		const click = tools.find((tool) => tool.name === "click");
		expect(click).toBeDefined();

		const result = await click!.execute("call_1", { x: 500, y: 250 });

		expect(batches).toEqual([
			[{ type: "click_mouse", click_mouse: { x: 960, y: 270, button: "left" } }],
		]);
		expect(result.content.at(-1)).toMatchObject({ type: "image", mimeType: "image/webp" });
	});

	it("executes provider-defined batch tools as canonical CUA batches", async () => {
		const batches: unknown[] = [];
		const runtime = resolveCuaRuntimeSpec("anthropic:claude-opus-4-7");
		const tools = createCuaComputerTools({
			browser,
			client: {
				browsers: {
					computer: {
						batch: async (_id: string, body: { actions: unknown[] }) => {
							batches.push(body.actions);
						},
						captureScreenshot: async () => new Response(tinyPng),
					},
				},
			} as unknown as Kernel,
			toolExecutors: runtime.toolExecutors,
			coordinateSystem: runtime.coordinateSystem,
		});
		const batch = tools.find((tool) => tool.name === ANTHROPIC_BATCH_TOOL_NAME);
		expect(batch).toBeDefined();

		const result = await batch!.execute("call_1", { actions: [{ type: "click", x: 10, y: 20 }] });

		expect(batches).toEqual([
			[{ type: "click_mouse", click_mouse: { x: 10, y: 20, button: "left" } }],
		]);
		expect(result.content.at(-1)).toMatchObject({ type: "image", mimeType: "image/png" });
	});
});
