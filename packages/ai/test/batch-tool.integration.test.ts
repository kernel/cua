import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	CUA_ACTION_TYPES,
	CUA_BATCH_TOOL_NAME,
	type Context,
	type CuaActionType,
	type CuaProvider,
	anthropic,
	complete,
	gemini,
	getCuaModel,
	openai,
	tzafon,
	yutori,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const screenshotPath = join(here, "..", "examples", "screenshot.png");

interface ProviderCase {
	provider: CuaProvider;
	envVar: string;
	modelRef: string;
	tools: () => ReturnType<typeof openai.createComputerToolDefinitions>;
	coordinateRange: readonly [number, number];
	extraOptions?: Record<string, unknown>;
}

const cases: ProviderCase[] = [
	{
		provider: "openai",
		envVar: "OPENAI_API_KEY",
		modelRef: "openai:gpt-5.5",
		tools: () => openai.createComputerToolDefinitions({ actions: ["click"] }),
		coordinateRange: [0, 1920],
	},
	{
		provider: "anthropic",
		envVar: "ANTHROPIC_API_KEY",
		modelRef: "anthropic:claude-opus-4-7",
		tools: () => anthropic.createComputerToolDefinitions({ actions: ["click"] }),
		coordinateRange: [0, 1920],
	},
	{
		provider: "gemini",
		envVar: "GOOGLE_API_KEY",
		modelRef: "gemini:gemini-3-flash-preview",
		tools: () => gemini.createComputerToolDefinitions({ actions: ["click"] }),
		coordinateRange: [0, 999],
	},
	{
		provider: "tzafon",
		envVar: "TZAFON_API_KEY",
		modelRef: "tzafon:tzafon.northstar-cua-fast",
		tools: () => tzafon.createComputerToolDefinitions({ actions: ["click"] }),
		coordinateRange: [0, 999],
	},
	{
		provider: "yutori",
		envVar: "YUTORI_API_KEY",
		modelRef: "yutori:n1.5-latest",
		tools: () => yutori.createComputerToolDefinitions({ actions: ["click"] }),
		coordinateRange: [0, 1000],
	},
];

async function buildContext(tools: ProviderCase["tools"]): Promise<Context> {
	const screenshot = await readFile(screenshotPath);
	return {
		systemPrompt: [
			"You are controlling a browser from a screenshot.",
			"Call batch_computer_actions with one action that clicks the sign in / up link.",
		].join("\n"),
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "Click the sign in / up link in this Kernel homepage screenshot." },
					{ type: "image", data: screenshot.toString("base64"), mimeType: "image/png" },
				],
				timestamp: Date.now(),
			},
		],
		tools: tools(),
	};
}

describe("batch_computer_actions integration", () => {
	for (const c of cases) {
		const hasKey = !!process.env[c.envVar];
		const test = hasKey ? it : it.skip;

		test(`${c.provider} returns a batch_computer_actions tool call with parsed actions`, async () => {
			const model = getCuaModel(c.modelRef as never);
			const context = await buildContext(c.tools);
			const response = await complete(model, context, {
				apiKey: process.env[c.envVar],
				maxTokens: 1024,
				...c.extraOptions,
			});

			const toolCalls = response.content.filter((part) => part.type === "toolCall");
			expect(toolCalls.length, `${c.provider} returned no tool calls`).toBeGreaterThan(0);

			const batch = toolCalls.find((call) => call.name === CUA_BATCH_TOOL_NAME);
			expect(batch, `${c.provider} did not return ${CUA_BATCH_TOOL_NAME}; got [${toolCalls.map((c) => c.name).join(", ")}]`).toBeDefined();

			const args = batch!.arguments as { actions?: unknown };
			expect(Array.isArray(args.actions), `${c.provider} .arguments.actions is ${typeof args.actions}, expected array`).toBe(true);

			const actions = args.actions as Array<Record<string, unknown>>;
			expect(actions.length).toBeGreaterThan(0);

			const click = actions.find((a) => a.type === "click");
			expect(click, `${c.provider} batch had no click action; got: ${JSON.stringify(actions)}`).toBeDefined();
			expect(typeof click!.x).toBe("number");
			expect(typeof click!.y).toBe("number");
			const [min, max] = c.coordinateRange;
			expect(click!.x as number, `${c.provider} x out of range`).toBeGreaterThanOrEqual(min);
			expect(click!.x as number).toBeLessThanOrEqual(max);
			expect(click!.y as number, `${c.provider} y out of range`).toBeGreaterThanOrEqual(min);
			expect(click!.y as number).toBeLessThanOrEqual(max);

			expect(response.usage.totalTokens, `${c.provider} usage tokens not reported`).toBeGreaterThan(0);

			for (const action of actions) {
				expect(CUA_ACTION_TYPES).toContain(action.type as CuaActionType);
			}
		}, 60_000);
	}

	const yutoriHasKey = !!process.env.YUTORI_API_KEY;
	(yutoriHasKey ? it : it.skip)(
		"yutori translates native left_click into a batch_computer_actions call",
		async () => {
			const model = getCuaModel("yutori:n1.5-latest");
			const context = await buildContext(() => yutori.createComputerToolDefinitions());
			const response = await complete(model, context, {
				apiKey: process.env.YUTORI_API_KEY,
				maxTokens: 1024,
			});

			const batchCalls = response.content.filter((part) => part.type === "toolCall" && part.name === CUA_BATCH_TOOL_NAME);
			expect(batchCalls.length, "yutori did not emit a translated batch call").toBeGreaterThan(0);
			const args = batchCalls[0]!.arguments as { actions: Array<Record<string, unknown>> };
			expect(Array.isArray(args.actions)).toBe(true);
			expect(args.actions.length).toBeGreaterThan(0);
			expect(args.actions[0]!.type).toBe("click");
		},
		60_000,
	);
});
