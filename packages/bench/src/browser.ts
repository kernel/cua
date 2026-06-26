import type { KernelBrowser } from "@onkernel/cua-agent";
import Kernel from "@onkernel/sdk";

/** Browser configuration held constant across every model so the only variable is the model. */
export interface BrowserSettings {
	stealth: boolean;
	viewport: { width: number; height: number };
	timeoutSeconds: number;
}

/** Benchmark defaults: stealth on, fresh unauthenticated profile, generous timeout. */
export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
	stealth: true,
	viewport: { width: 1280, height: 800 },
	timeoutSeconds: 600,
};

export interface BrowserHandle {
	client: Kernel;
	browser: KernelBrowser;
	close(): Promise<void>;
}

export function createKernelClient(apiKey?: string): Kernel {
	const key = apiKey ?? process.env.KERNEL_API_KEY;
	if (!key) throw new Error("KERNEL_API_KEY is required");
	return new Kernel({ apiKey: key });
}

/** Provision a fresh Kernel browser under the given settings. */
export async function provisionBrowser(client: Kernel, settings: BrowserSettings): Promise<BrowserHandle> {
	const browser = await client.browsers.create({
		stealth: settings.stealth,
		viewport: settings.viewport,
		timeout_seconds: settings.timeoutSeconds,
	});
	return {
		client,
		browser,
		close: async () => {
			await client.browsers.deleteByID(browser.session_id).catch(() => {});
		},
	};
}

export async function captureScreenshot(client: Kernel, sessionId: string): Promise<Buffer | undefined> {
	try {
		const response = await client.browsers.computer.captureScreenshot(sessionId);
		return Buffer.from(await response.arrayBuffer());
	} catch {
		return undefined;
	}
}
