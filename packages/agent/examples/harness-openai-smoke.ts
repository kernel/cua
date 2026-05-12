import Kernel from "@onkernel/sdk";
import { CuaHarness, type CuaModelRef } from "../src/index.js";
import { SCENARIOS } from "./shared/scenarios.js";
import { requireEnv, resolveApiKey } from "./shared/runtime.js";

const modelRef = (process.env.MODEL_REF as CuaModelRef | undefined) ?? "openai:gpt-5.5";

async function main(): Promise<void> {
	const kernelApiKey = requireEnv("KERNEL_API_KEY");
	const client = new Kernel({ apiKey: kernelApiKey });
	const browser = await client.browsers.create({ stealth: true });

	try {
		const harness = new CuaHarness({
			browser,
			client,
			model: modelRef,
			getApiKey: () => resolveApiKey(modelRef),
		});

		harness.subscribe((event) => {
			if (event.type === "tool_execution_start") {
				console.log(`[tool:start] ${event.toolName}`);
			}
			if (event.type === "tool_execution_end") {
				console.log(`[tool:end] ${event.toolName} error=${event.isError}`);
			}
		});

		const scenario = SCENARIOS[0]!;
		console.log(`running scenario: ${scenario.name}`);
		const response = await harness.prompt(scenario.prompt);
		console.log("assistant stopReason:", response.stopReason);
	} finally {
		await client.browsers.deleteByID(browser.session_id);
	}
}

void main();
