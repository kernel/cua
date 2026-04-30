import type { Api, Model } from "@mariozechner/pi-ai";
import { compactAnthropicMessagesForRequest } from "./context.js";
import { anthropicComputerToolForModel } from "./official.js";
import {
	ANTHROPIC_COMPACTION_EDIT_TYPE,
	ANTHROPIC_COMPACTION_MIN_TRIGGER_TOKENS,
	anthropicSupportsCompaction,
} from "./official.js";

/**
 * onPayload hook for Anthropic Messages requests.
 *
 * Replaces the locally registered `computer` function tool entry on the
 * wire with Anthropic's model-compatible built-in computer spec, so the
 * model emits real `tool_use` blocks for the `computer` tool and we get
 * the documented action vocabulary.
 *
 * Returning `undefined` for non-Anthropic providers leaves the payload
 * untouched. For Anthropic, returns a shallow-copied payload with `tools`
 * rewritten so the registered `computer` AgentTool entry is replaced (or
 * appended if missing).
 */
export function anthropicComputerOnPayload(payload: unknown, model: Model<Api>): unknown {
	if (model.api !== "anthropic-messages") return undefined;
	if (!payload || typeof payload !== "object") return undefined;
	const next = { ...(payload as Record<string, unknown>) };
	const computerTool = anthropicComputerToolForModel(model.id);
	const tools = Array.isArray(next.tools) ? [...(next.tools as unknown[])] : [];
	const idx = tools.findIndex((t) => isToolNamed(t, "computer"));
	if (idx >= 0) {
		tools[idx] = computerTool;
	} else {
		tools.push(computerTool);
	}
	next.tools = tools;
	return next;
}

export interface AnthropicContextManagementOptions {
	compactThreshold?: number | false;
}

export function createAnthropicContextManagementOnPayload(
	opts: AnthropicContextManagementOptions = {},
): (payload: unknown, model: Model<Api>) => unknown | undefined {
	return (payload: unknown, model: Model<Api>): unknown | undefined => {
		if (model.api !== "anthropic-messages") return undefined;
		if (!payload || typeof payload !== "object") return undefined;

		const source = payload as Record<string, unknown>;
		const next = { ...source };
		let changed = false;

		if (Array.isArray(source.messages)) {
			const compacted = compactAnthropicMessagesForRequest(source.messages);
			if (compacted.length !== source.messages.length) {
				next.messages = compacted;
				changed = true;
			}
		}

		if (opts.compactThreshold !== false && anthropicSupportsCompaction(model.id)) {
			next.context_management = mergeCompactionContextManagement(source.context_management, opts.compactThreshold);
			changed = true;
		}

		return changed ? next : undefined;
	};
}

function isToolNamed(tool: unknown, name: string): boolean {
	if (!tool || typeof tool !== "object") return false;
	const n = (tool as { name?: unknown }).name;
	return typeof n === "string" && n === name;
}

function mergeCompactionContextManagement(existing: unknown, compactThreshold: number | undefined): Record<string, unknown> {
	const current = existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};
	const edits = Array.isArray(current.edits) ? [...current.edits] : [];
	if (!edits.some(isCompactionEdit)) {
		edits.push(compactionEdit(compactThreshold));
	}
	return {
		...current,
		edits,
	};
}

function isCompactionEdit(edit: unknown): boolean {
	return Boolean(edit && typeof edit === "object" && (edit as { type?: unknown }).type === ANTHROPIC_COMPACTION_EDIT_TYPE);
}

function compactionEdit(compactThreshold: number | undefined): Record<string, unknown> {
	const edit: Record<string, unknown> = { type: ANTHROPIC_COMPACTION_EDIT_TYPE };
	if (typeof compactThreshold === "number" && Number.isFinite(compactThreshold)) {
		edit.trigger = {
			type: "input_tokens",
			value: Math.max(ANTHROPIC_COMPACTION_MIN_TRIGGER_TOKENS, Math.trunc(compactThreshold)),
		};
	}
	return edit;
}

/**
 * Compose multiple onPayload hooks into a single one. Each hook sees the
 * latest payload from previous hooks (or the original if none modified
 * it). Returns `undefined` if no hooks are active or none modified the
 * payload.
 */
export function composeOnPayload(
	...hooks: Array<((payload: unknown, model: Model<Api>) => unknown | undefined | Promise<unknown | undefined>) | undefined>
): ((payload: unknown, model: Model<Api>) => Promise<unknown | undefined>) | undefined {
	const active = hooks.filter((h): h is NonNullable<typeof h> => typeof h === "function");
	if (active.length === 0) return undefined;
	return async (payload: unknown, model: Model<Api>): Promise<unknown | undefined> => {
		let current: unknown = payload;
		let changed = false;
		for (const hook of active) {
			const next = await hook(current, model);
			if (next !== undefined) {
				current = next;
				changed = true;
			}
		}
		return changed ? current : undefined;
	};
}
