import Kernel from "@onkernel/sdk";
import { CuaHarness, type CuaModelRef } from "../src/index.js";
import { SCENARIOS } from "./shared/scenarios.js";
import { requireEnv, resolveApiKey } from "./shared/runtime.js";

const modelRef = (process.env.MODEL_REF as CuaModelRef | undefined) ?? "openai:gpt-5.5";
const scenarioName = process.env.SCENARIO ?? SCENARIOS[0]!.name;

async function main(): Promise<void> {
	const kernelApiKey = requireEnv("KERNEL_API_KEY");
	const client = new Kernel({ apiKey: kernelApiKey });
	const browser = await client.browsers.create({ stealth: true });
	const scenario = SCENARIOS.find((entry) => entry.name === scenarioName) ?? SCENARIOS[0]!;

	try {
		const harness = new CuaHarness({
			browser,
			client,
			model: modelRef,
			getApiKey: () => resolveApiKey(modelRef),
		});
		console.log(`model=${modelRef} scenario=${scenario.name}`);
		await harness.prompt(scenario.prompt);
	} finally {
		await client.browsers.deleteByID(browser.session_id);
	}
}

void main();
