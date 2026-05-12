import type { BrowserSession } from "./browser-session";
import { ComputerTranslator, type ComputerLogger } from "./translator";

export interface ComputerUseTextPart {
	type: "text";
	text: string;
}

export interface ComputerUseImagePart {
	type: "image";
	data: string;
	mimeType: string;
}

export type ComputerUseContentPart = ComputerUseTextPart | ComputerUseImagePart;

export interface ComputerUseToolResult<TDetails = unknown> {
	content: ComputerUseContentPart[];
	details: TDetails;
	isError?: boolean;
}

export interface ComputerUseRunResult<TDetails = unknown> {
	text: string;
	provider: string;
	modelId: string;
	details?: TDetails;
	turns?: number;
}

export interface ComputerUseModel<TDetails = unknown> {
	readonly provider: string;
	readonly modelId: string;
	run(args: {
		prompt: string;
		translator: ComputerTranslator;
		maxTurns?: number;
		signal?: AbortSignal;
	}): Promise<ComputerUseRunResult<TDetails>>;
}

export interface RunComputerUseOptions<TDetails = unknown> {
	model: ComputerUseModel<TDetails>;
	prompt: string;
	maxTurns?: number;
	signal?: AbortSignal;
	translator?: ComputerTranslator;
	browser?: Pick<BrowserSession, "client" | "sessionId">;
	logger?: ComputerLogger;
}

/**
 * Single-invocation helper similar in spirit to AI SDK's `generateText()`.
 *
 * It does NOT manage a long-lived agent/session runtime. It only wires a
 * provider-specific ComputerUseModel to a Kernel browser session (or an
 * existing ComputerTranslator) for one prompt invocation.
 */
export async function runComputerUse<TDetails = unknown>(
	opts: RunComputerUseOptions<TDetails>,
): Promise<ComputerUseRunResult<TDetails>> {
	const translator =
		opts.translator ??
		(opts.browser
			? new ComputerTranslator({
					client: opts.browser.client,
					sessionId: opts.browser.sessionId,
					logger: opts.logger,
				})
			: undefined);
	if (!translator) {
		throw new Error("runComputerUse requires either `translator` or `browser`");
	}
	return opts.model.run({
		prompt: opts.prompt,
		translator,
		maxTurns: opts.maxTurns,
		signal: opts.signal,
	});
}
