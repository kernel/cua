import type Kernel from "@onkernel/sdk";
import type { KernelBrowser } from "@onkernel/cua-agent";

const TINY_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
	"base64",
);

export interface FakeBatchCall {
	id: string;
	body: unknown;
}

/** Minimal Kernel client + browser pair sufficient to run the CUA harness. */
export interface FakeKernelEnvironment {
	client: Kernel;
	browser: KernelBrowser;
	batchCalls: FakeBatchCall[];
	screenshots: number;
	deleted: string[];
}

export function createFakeKernelEnvironment(overrides: Partial<KernelBrowser> = {}): FakeKernelEnvironment {
	const browser = {
		session_id: overrides.session_id ?? "browser_test_123",
		browser_live_view_url: overrides.browser_live_view_url ?? "https://example.test/live",
		cdp_ws_url: overrides.cdp_ws_url ?? "wss://example.test/cdp",
		created_at: overrides.created_at ?? new Date().toISOString(),
		viewport: overrides.viewport ?? { width: 1024, height: 768 },
	} as KernelBrowser;

	const env: FakeKernelEnvironment = {
		client: undefined as unknown as Kernel,
		browser,
		batchCalls: [],
		screenshots: 0,
		deleted: [],
	};

	env.client = {
		browsers: {
			create: async () => browser,
			retrieve: async () => browser,
			deleteByID: async (id: string) => {
				env.deleted.push(id);
			},
			computer: {
				batch: async (sessionId: string, body: unknown) => {
					env.batchCalls.push({ id: sessionId, body });
				},
				captureScreenshot: async () => {
					env.screenshots += 1;
					return new Response(new Uint8Array(TINY_PNG));
				},
				getMousePosition: async () => ({ x: 0, y: 0 }),
				readClipboard: async () => ({ text: "" }),
			},
		},
		profiles: {
			retrieve: async () => ({ id: "profile_test", name: "test" }),
			create: async ({ name }: { name: string }) => ({ id: "profile_test", name }),
		},
	} as unknown as Kernel;

	return env;
}
