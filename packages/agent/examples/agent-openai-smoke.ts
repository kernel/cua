import Kernel from "@onkernel/sdk";
import { CuaAgent, type CuaModelRef } from "../src/index.js";
import { SCENARIOS } from "./shared/scenarios.js";
import { requireEnv, resolveApiKey } from "./shared/runtime.js";

const modelRef = (process.env.MODEL_REF as CuaModelRef | undefined) ?? "openai:gpt-5.5";

async function main(): Promise<void> {
	const kernelApiKey = requireEnv("KERNEL_API_KEY");
	const client = new Kernel({ apiKey: kernelApiKey });
	const browser = await client.browsers.create({ stealth: true });

	try {
		const agent = new CuaAgent({
			browser,
			client,
			getApiKey: () => resolveApiKey(modelRef),
			initialState: { model: modelRef },
		});

		agent.subscribe((event) => {
			if (event.type === "tool_execution_start") {
				console.log(`[tool:start] ${event.toolName}`);
			}
			if (event.type === "tool_execution_end") {
				console.log(`[tool:end] ${event.toolName} error=${event.isError}`);
			}
		});

		const scenario = SCENARIOS[0]!;
		console.log(`running scenario: ${scenario.name}`);
		await agent.prompt(scenario.prompt);
		const assistant = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
		console.log("assistant stopReason:", assistant?.role === "assistant" ? assistant.stopReason : "unknown");
	} finally {
		await client.browsers.deleteByID(browser.session_id);
	}
}

void main();
