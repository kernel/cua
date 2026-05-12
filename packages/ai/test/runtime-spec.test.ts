import { describe, expect, it } from "vitest";
import { CUA_BATCH_TOOL_NAME, CUA_NAVIGATION_TOOL_NAME, CUA_PROVIDERS, listCuaModels, resolveCuaRuntimeSpec } from "../src/index";

describe("resolveCuaRuntimeSpec", () => {
	it("resolves a runtime spec for every CUA provider", () => {
		for (const provider of CUA_PROVIDERS) {
			const model = listCuaModels(provider)[0];
			expect(model, `no CUA model configured for provider ${provider}`).toBeDefined();

			const spec = resolveCuaRuntimeSpec(model!.ref);
			expect(spec.provider).toBe(provider);
			expect(spec.model.id).toBe(model!.model);
			expect(spec.toolDefinitions.length).toBeGreaterThan(0);
			expect(typeof spec.defaultSystemPrompt).toBe("string");
			expect(spec.defaultSystemPrompt.length).toBeGreaterThan(0);
			expect(spec.toolDefinitions.map((tool) => tool.name)).toContain(CUA_BATCH_TOOL_NAME);
			expect(spec.toolDefinitions.map((tool) => tool.name)).toContain(CUA_NAVIGATION_TOOL_NAME);
		}
	});

	it("only sets payload middleware for providers that need it", () => {
		const yutoriSpec = resolveCuaRuntimeSpec("yutori:n1.5-latest");
		const openaiSpec = resolveCuaRuntimeSpec("openai:gpt-5.5");
		expect(yutoriSpec.onPayload).toBeTypeOf("function");
		expect(openaiSpec.onPayload).toBeUndefined();
	});
});
