import Kernel from "@onkernel/sdk";
import { requireCuaEnvApiKeyForModel, type CuaModelRef } from "@onkernel/cua-ai";
import { CuaAgentHarness, InMemorySessionRepo, NodeExecutionEnv } from "../src/index";
import { SCENARIOS } from "./shared/scenarios";

const modelRef = (process.env.MODEL_REF as CuaModelRef | undefined) ?? "openai:gpt-5.5";
const scenarioName = process.env.SCENARIO ?? SCENARIOS[0]!.name;

async function main(): Promise<void> {
	const kernelApiKey = process.env.KERNEL_API_KEY;
	if (!kernelApiKey) throw new Error("KERNEL_API_KEY is required");
	requireCuaEnvApiKeyForModel(modelRef);
	const client = new Kernel({ apiKey: kernelApiKey });
	const browser = await client.browsers.create({ stealth: true });
	const scenario = SCENARIOS.find((entry) => entry.name === scenarioName) ?? SCENARIOS[0]!;

	try {
		const sessionRepo = new InMemorySessionRepo();
		const session = await sessionRepo.create({ id: `harness-provider-matrix-${scenario.name}` });
		const harness = new CuaAgentHarness({
			browser,
			client,
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			model: modelRef,
			session,
		});
		console.log(`model=${modelRef} scenario=${scenario.name}`);
		const response = await harness.prompt(scenario.prompt);
		const branch = await session.getBranch();
		const lastAssistant = [...branch]
			.reverse()
			.flatMap((entry) =>
				entry.type === "message" && entry.message.role === "assistant" ? [entry.message] : [],
			)[0];
		const assistant = lastAssistant ?? response;
		const assistantText = assistant.content
			.flatMap((block) => (block.type === "text" ? [block.text] : []))
			.join("")
			.trim();
		console.log("assistant stopReason:", assistant.stopReason);
		console.log("assistant text:", assistantText || "(no text)");
	} finally {
		await client.browsers.deleteByID(browser.session_id);
	}
}

void main();
