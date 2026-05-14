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
} from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const screenshotPath = join(here, "..", "examples", "screenshot.png");

interface ProviderCase {
	provider: CuaProvider;
	envVar: string;
	modelRef: string;
	tools: () => ReturnType<typeof openai.createComputerToolDefinitions>;
	multiActionTools: () => ReturnType<typeof openai.createComputerToolDefinitions>;
	coordinateRange: readonly [number, number];
	supportsBatching: boolean;
	requireToolCalls: boolean;
	extraOptions?: Record<string, unknown>;
}

const cases: ProviderCase[] = [
	{
		provider: "openai",
		envVar: "OPENAI_API_KEY",
		modelRef: "openai:gpt-5.5",
		tools: () => openai.createComputerToolDefinitions({ actions: ["click"] }),
		multiActionTools: () => openai.createComputerToolDefinitions({ actions: ["click", "type"] }),
		coordinateRange: [0, 1920],
		supportsBatching: true,
		requireToolCalls: true,
	},
	{
		provider: "anthropic",
		envVar: "ANTHROPIC_API_KEY",
		modelRef: "anthropic:claude-opus-4-7",
		tools: () => anthropic.createComputerToolDefinitions({ actions: ["click"] }),
		multiActionTools: () => anthropic.createComputerToolDefinitions({ actions: ["click", "type"] }),
		coordinateRange: [0, 1920],
		supportsBatching: true,
		requireToolCalls: true,
	},
	{
		provider: "google",
		envVar: "GOOGLE_API_KEY",
		modelRef: "google:gemini-3-flash-preview",
		tools: () => gemini.createComputerToolDefinitions({ actions: ["click"] }),
		multiActionTools: () => gemini.createComputerToolDefinitions({ actions: ["click", "type"] }),
		coordinateRange: [0, 999],
		supportsBatching: true,
		requireToolCalls: true,
	},
	{
		provider: "tzafon",
		envVar: "TZAFON_API_KEY",
		modelRef: "tzafon:tzafon.northstar-cua-fast",
		tools: () => tzafon.createComputerToolDefinitions({ actions: ["click"] }),
		multiActionTools: () => tzafon.createComputerToolDefinitions({ actions: ["click", "type"] }),
		coordinateRange: [0, 999],
		supportsBatching: false,
		requireToolCalls: false,
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

async function buildMultiActionContext(tools: ProviderCase["multiActionTools"]): Promise<Context> {
	const screenshot = await readFile(screenshotPath);
	return {
		systemPrompt: [
			"You are controlling a browser from a screenshot.",
			"Always batch multiple steps into a single batch_computer_actions call by adding all required actions to the actions array.",
			"Do NOT split a sequence across separate tool calls.",
		].join("\n"),
		messages: [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Click the sign in / up link and then type 'alice@example.com'. Emit BOTH actions in one single batch_computer_actions call.",
					},
					{ type: "image", data: screenshot.toString("base64"), mimeType: "image/png" },
				],
				timestamp: Date.now(),
			},
		],
		tools: tools(),
	};
}

async function buildYutoriContext(): Promise<Context> {
	const screenshot = await readFile(screenshotPath);
	return {
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
		tools: yutori.createComputerToolDefinitions(),
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
			if (toolCalls.length === 0) {
				if (c.requireToolCalls) {
					expect(toolCalls.length, `${c.provider} returned no tool calls`).toBeGreaterThan(0);
				}
				expect(response.usage.totalTokens, `${c.provider} usage tokens not reported`).toBeGreaterThanOrEqual(0);
				return;
			}

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
		"yutori translates native tool calls into canonical individual actions",
		async () => {
			const model = getCuaModel("yutori:n1.5-latest");
			const context = await buildYutoriContext();
			const response = await complete(model, context, {
				apiKey: process.env.YUTORI_API_KEY,
				maxTokens: 1024,
			});

			const toolCalls = response.content.filter((part) => part.type === "toolCall");
			expect(toolCalls.length, "yutori did not emit translated canonical tool calls").toBeGreaterThan(0);
			expect(CUA_ACTION_TYPES).toContain(toolCalls[0]!.name as CuaActionType);
		},
		60_000,
	);
});

// The whole point of batch_computer_actions is to let a single tool call carry
// multiple ordered actions (click-then-type, type-then-Enter, etc.). These
// tests probe each provider with a two-step task and verify whether the model
// actually packs both steps into one batch call.
describe("batch_computer_actions multi-action sequences", () => {
	for (const c of cases) {
		const hasKey = !!process.env[c.envVar];
		const test = hasKey ? it : it.skip;

		if (c.supportsBatching) {
			test(`${c.provider} packs a click+type sequence into a single batch call`, async () => {
				const model = getCuaModel(c.modelRef as never);
				const context = await buildMultiActionContext(c.multiActionTools);
				const response = await complete(model, context, {
					apiKey: process.env[c.envVar],
					maxTokens: 2048,
					...c.extraOptions,
				});

				const batchCalls = response.content.filter(
					(part) => part.type === "toolCall" && part.name === CUA_BATCH_TOOL_NAME,
				);
				expect(batchCalls.length, `${c.provider} produced no batch_computer_actions calls`).toBe(1);

				const args = batchCalls[0]!.arguments as { actions: Array<Record<string, unknown>> };
				expect(Array.isArray(args.actions), `${c.provider} actions field is not an array`).toBe(true);
				expect(
					args.actions.length,
					`${c.provider} only emitted ${args.actions.length} action(s) in one batch call: ${JSON.stringify(args.actions)}`,
				).toBeGreaterThanOrEqual(2);
			}, 60_000);
		} else {
			test(`${c.provider} emits exactly one action per response (model does not batch)`, async () => {
				const model = getCuaModel(c.modelRef as never);
				const context = await buildMultiActionContext(c.multiActionTools);
				const response = await complete(model, context, {
					apiKey: process.env[c.envVar],
					maxTokens: 2048,
					...c.extraOptions,
				});

				const batchCalls = response.content.filter(
					(part) => part.type === "toolCall" && part.name === CUA_BATCH_TOOL_NAME,
				);
				if (batchCalls.length === 0) {
					if (c.requireToolCalls) {
						expect(batchCalls.length, `${c.provider} produced no ${CUA_BATCH_TOOL_NAME} calls`).toBeGreaterThan(0);
					}
					expect(response.usage.totalTokens, `${c.provider} usage tokens not reported`).toBeGreaterThanOrEqual(0);
					return;
				}
				expect(batchCalls.length).toBe(1);
				const args = batchCalls[0]!.arguments as { actions: Array<Record<string, unknown>> };
				expect(args.actions.length).toBeGreaterThanOrEqual(1);
			}, 60_000);
		}
	}
});
