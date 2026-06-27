import { describe, expect, it } from "vitest";
import { CUA_NAVIGATION_TOOL_NAME, CUA_PROVIDERS, listCuaModels, resolveCuaRuntimeSpec } from "../src/index";

describe("resolveCuaRuntimeSpec", () => {
	it("resolves a runtime spec for every CUA provider", () => {
		for (const provider of CUA_PROVIDERS) {
			const model = listCuaModels(provider)[0];
			expect(model, `no CUA model configured for provider ${provider}`).toBeDefined();

			const spec = resolveCuaRuntimeSpec(model!.ref);
			expect(spec.provider).toBe(provider);
			expect(spec.model.id).toBe(model!.model);
			expect(typeof spec.defaultSystemPrompt).toBe("string");
			expect(spec.coordinateSystem).toBeDefined();
			expect(spec.toolExecutors.length).toBeGreaterThan(0);
			expect(spec.toolDefinitions.map((tool) => tool.name)).not.toContain(CUA_NAVIGATION_TOOL_NAME);
			if (provider === "anthropic") {
				expect(spec.toolDefinitions.map((tool) => tool.name)).toContain("computer_batch");
				expect(spec.toolExecutors.map((executor) => executor.definition.name)).toContain("computer_batch");
			}
			if (provider === "yutori") {
				expect(spec.toolDefinitions).toEqual([]);
				expect(spec.defaultSystemPrompt).toBe("");
				expect(spec.screenshot).toEqual({
					appendToLatestMessage: true,
					transform: { width: 1280, height: 800, format: "webp", quality: 90 },
				});
			} else {
				expect(spec.defaultSystemPrompt.length).toBeGreaterThan(0);
			}
		}
	});

	it("only sets payload middleware for providers that need it", () => {
		const yutoriSpec = resolveCuaRuntimeSpec("yutori:n1.5-latest");
		const openaiSpec = resolveCuaRuntimeSpec("openai:gpt-5.5");
		const tzafonSpec = resolveCuaRuntimeSpec("tzafon:tzafon.northstar-cua-fast");
		const anthropicSpec = resolveCuaRuntimeSpec("anthropic:claude-opus-4-7");
		expect(yutoriSpec.onPayload).toBeTypeOf("function");
		expect(tzafonSpec.onPayload).toBeTypeOf("function");
		// OpenAI and Anthropic need no payload middleware: openai-cua-responses
		// sets store:true in its own request builder.
		expect(openaiSpec.onPayload).toBeUndefined();
		expect(anthropicSpec.onPayload).toBeUndefined();
	});

	it("threads tool options through to the provider module", () => {
		const openaiSpec = resolveCuaRuntimeSpec("openai:gpt-5.5", { actions: ["click"] });
		expect(openaiSpec.toolDefinitions.map((tool) => tool.name)).toEqual(["click"]);
		expect(openaiSpec.toolExecutors.map((executor) => executor.definition.name)).toEqual(["click"]);

		const anthropicSpec = resolveCuaRuntimeSpec("anthropic:claude-opus-4-7", { actions: ["click"] });
		expect(anthropicSpec.toolDefinitions.map((tool) => tool.name)).toEqual(["click", "computer_batch"]);

		const yutoriSpec = resolveCuaRuntimeSpec("yutori:n1.5-latest", { actions: ["click"] });
		expect(yutoriSpec.toolDefinitions).toEqual([]);
		expect(yutoriSpec.toolExecutors.map((executor) => executor.definition.name)).toEqual(["click"]);
	});
});
