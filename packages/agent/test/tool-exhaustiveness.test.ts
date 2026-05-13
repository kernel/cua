import { Type, type Tool } from "@onkernel/cua-ai";
import { CUA_PROVIDERS, listCuaModels, resolveCuaRuntimeSpec } from "@onkernel/cua-ai";
import type Kernel from "@onkernel/sdk";
import { describe, expect, it } from "vitest";
import { SUPPORTED_CUA_EXECUTOR_TOOL_NAMES, createCuaComputerTools, type KernelBrowser } from "../src/index";

const browser = { session_id: "browser_123" } as KernelBrowser;
const client = {} as Kernel;

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
		expect([...names].sort()).toEqual([...SUPPORTED_CUA_EXECUTOR_TOOL_NAMES].sort());
	});

	it("instantiates one executor per canonical definition", () => {
		const toolDefinitions = resolveCuaRuntimeSpec("openai:gpt-5.5").toolDefinitions;
		const tools = createCuaComputerTools({ browser, client, toolDefinitions });
		expect(tools.map((tool) => tool.name).sort()).toEqual(toolDefinitions.map((tool) => tool.name).sort());
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
