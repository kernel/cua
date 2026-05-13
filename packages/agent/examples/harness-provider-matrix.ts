import Kernel from "@onkernel/sdk";
import { requireCuaEnvApiKeyForModel, type CuaModelRef } from "@onkernel/cua-ai";
import { CuaHarness } from "../src/index";
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
		const harness = new CuaHarness({
			browser,
			client,
			model: modelRef,
		});
		console.log(`model=${modelRef} scenario=${scenario.name}`);
		await harness.prompt(scenario.prompt);
		console.log("transcript messages:", harness.getTranscript().length);
	} finally {
		await client.browsers.deleteByID(browser.session_id);
	}
}

void main();
