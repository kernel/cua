import type { Api, Model } from "@mariozechner/pi-ai";
import { ANTHROPIC_COMPUTER_TOOL } from "./official.js";

/**
 * onPayload hook for Anthropic Messages requests.
 *
 * Replaces the locally registered `computer` function tool entry on the
 * wire with Anthropic's built-in `computer_20251124` spec, so the model
 * emits real `tool_use` blocks for the `computer` tool and we get the
 * documented action vocabulary.
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
	const tools = Array.isArray(next.tools) ? [...(next.tools as unknown[])] : [];
	const idx = tools.findIndex((t) => isToolNamed(t, "computer"));
	if (idx >= 0) {
		tools[idx] = ANTHROPIC_COMPUTER_TOOL;
	} else {
		tools.push(ANTHROPIC_COMPUTER_TOOL);
	}
	next.tools = tools;
	return next;
}

function isToolNamed(tool: unknown, name: string): boolean {
	if (!tool || typeof tool !== "object") return false;
	const n = (tool as { name?: unknown }).name;
	return typeof n === "string" && n === name;
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
