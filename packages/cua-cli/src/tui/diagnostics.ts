import {
	type ImageProtocol,
	type TerminalCapabilities,
	detectCapabilities,
	getCapabilities,
	setCapabilities,
} from "@mariozechner/pi-tui";

export type ImageProtocolOverride = "kitty" | "iterm2" | "none" | "auto";

/**
 * Resolve image protocol with explicit override > env var > pi-tui detection.
 * Mutates pi-tui's cached capabilities so the {@link Image} component uses
 * our resolved value on render.
 */
export function resolveImageProtocol(flag?: string): TerminalCapabilities {
	const override = normalize(flag) ?? normalize(process.env.CUA_IMAGE_PROTOCOL);
	const detected = detectCapabilities();

	let images: ImageProtocol;
	if (override === "auto" || override === undefined) {
		images = detected.images;
	} else if (override === "none") {
		images = null;
	} else {
		images = override;
	}

	const caps: TerminalCapabilities = {
		images,
		trueColor: detected.trueColor,
		hyperlinks: detected.hyperlinks,
	};
	setCapabilities(caps);
	return caps;
}

function normalize(value?: string): ImageProtocolOverride | undefined {
	if (!value) return undefined;
	const v = value.trim().toLowerCase();
	if (v === "kitty" || v === "iterm2" || v === "none" || v === "auto") return v;
	return undefined;
}

/**
 * One-line summary of the resolved terminal capabilities, suitable for
 * the TUI header so users can see at a glance whether inline images will
 * work and how to override.
 */
export function summarizeCapabilities(applied: TerminalCapabilities, source: "auto" | "override"): string {
	const parts: string[] = [];
	const tag = source === "override" ? " (override)" : "";
	parts.push(`images=${applied.images ?? "none"}${tag}`);
	if (applied.trueColor) parts.push("trueColor");
	if (applied.hyperlinks) parts.push("hyperlinks");
	return parts.join(" · ");
}

export function applyAndSummarizeImageProtocol(flag?: string): {
	caps: TerminalCapabilities;
	summary: string;
	overridden: boolean;
} {
	const overridden = !!normalize(flag) || !!normalize(process.env.CUA_IMAGE_PROTOCOL);
	const caps = resolveImageProtocol(flag);
	return {
		caps,
		summary: summarizeCapabilities(caps, overridden ? "override" : "auto"),
		overridden,
	};
}

export function currentCapabilities(): TerminalCapabilities {
	return getCapabilities();
}
