import Kernel from "@onkernel/sdk";
import { requireCuaEnvApiKeyForModel, type CuaModelRef } from "@onkernel/cua-ai";
import { CuaAgent } from "../src/index";
import { SCENARIOS } from "./shared/scenarios";

const modelRef = (process.env.MODEL_REF as CuaModelRef | undefined) ?? "openai:gpt-5.5";

async function main(): Promise<void> {
	const kernelApiKey = process.env.KERNEL_API_KEY;
	if (!kernelApiKey) throw new Error("KERNEL_API_KEY is required");
	requireCuaEnvApiKeyForModel(modelRef);
	const client = new Kernel({ apiKey: kernelApiKey });
	const browser = await client.browsers.create({ stealth: true });

	try {
		const agent = new CuaAgent({
			browser,
			client,
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
