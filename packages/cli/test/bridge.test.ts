import type { AgentHarness } from "@onkernel/cua-agent";
import type { ExtensionRunner } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { installBridge, type BridgeState } from "../src/extensions/bridge";

type HarnessListener = (event: { type: string; [key: string]: unknown }) => Promise<void> | void;

class FakeHarness {
	private listener: HarnessListener | undefined;

	subscribe(next: HarnessListener): () => void {
		this.listener = next;
		return () => {
			if (this.listener === next) this.listener = undefined;
		};
	}

	on(_type: string, _next: (...args: unknown[]) => unknown): () => void {
		return () => {};
	}

	async emit(event: { type: string; [key: string]: unknown }): Promise<void> {
		if (!this.listener) return;
		await this.listener(event);
	}
}

describe("installBridge", () => {
	it("still schedules queued reload drain when agent_end emit throws", async () => {
		const harness = new FakeHarness();
		const runner = {
			emit: vi.fn(async (event: { type: string }) => {
				if (event.type === "agent_end") throw new Error("agent_end failed");
			}),
		} as unknown as ExtensionRunner;
		const state: BridgeState = { turnIndex: 0, isIdle: false };
		const drainPendingReload = vi.fn();
		const reapplyTools = vi.fn(async () => {});

		installBridge(
			harness as unknown as AgentHarness,
			runner,
			state,
			reapplyTools,
			drainPendingReload,
		);

		await expect(harness.emit({ type: "agent_end", messages: [] })).rejects.toThrow(/agent_end failed/);
		await Promise.resolve();
		expect(drainPendingReload).toHaveBeenCalledTimes(1);
	});
});
