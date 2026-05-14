import { Type, type Tool } from "@onkernel/cua-ai";
import { CUA_PROVIDERS, listCuaModels, resolveCuaRuntimeSpec } from "@onkernel/cua-ai";
import type Kernel from "@onkernel/sdk";
import { describe, expect, it } from "vitest";
import { SUPPORTED_CUA_EXECUTOR_TOOL_NAMES, createCuaComputerTools, type KernelBrowser } from "../src/index";

const browser = { session_id: "browser_123" } as KernelBrowser;
const client = {} as Kernel;
const tinyPng = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
	"base64",
);

describe("Cua tool executor coverage", () => {
	it("covers every canonical tool name exported by cua-ai defaults", () => {
		const names = new Set<string>();
		for (const provider of CUA_PROVIDERS) {
			const model = listCuaModels(provider)[0];
			expect(model, `no CUA model for provider ${provider}`).toBeDefined();
			for (const definition of resolveCuaRuntimeSpec(model!.ref).toolDefinitions) {
				names.add(definition.name);
			}
		}
		const supported = new Set<string>(SUPPORTED_CUA_EXECUTOR_TOOL_NAMES);
		for (const name of names) expect(supported.has(name)).toBe(true);
	});

	it("instantiates one executor per canonical definition", () => {
		const toolDefinitions = resolveCuaRuntimeSpec("openai:gpt-5.5").toolDefinitions;
		const tools = createCuaComputerTools({ browser, client, toolDefinitions });
		expect(tools.map((tool) => tool.name).sort()).toEqual(toolDefinitions.map((tool) => tool.name).sort());
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
			toolDefinitions: runtime.toolDefinitions,
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

	it("fails fast on unsupported tool names", () => {
		const unsupportedDefinitions: Tool[] = [
			{
				name: "unknown_tool",
				description: "unsupported",
				parameters: Type.Object({}),
			},
		];
		expect(() =>
			createCuaComputerTools({
				browser,
				client,
				toolDefinitions: unsupportedDefinitions,
			}),
		).toThrow(/unsupported CUA computer tool definition/);
	});
});
