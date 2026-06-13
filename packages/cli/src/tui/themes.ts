import type { EditorTheme, ImageTheme } from "@earendil-works/pi-tui";
import { getMarkdownTheme, getSelectListTheme, Theme } from "@earendil-works/pi-coding-agent";

/**
 * cua's TUI styling rides on pi's theme system so it matches pi's own TUI.
 * `initTheme()` must run once at TUI startup (see `tui/main.ts`) before any of
 * these helpers are used.
 *
 * pi exports the `Theme` class and the markdown/select-list theme getters, but
 * not the live theme instance behind `theme.fg(...)`. That instance is published
 * on a `Symbol.for` global key (pi's cross-realm contract for its own `theme`
 * proxy), so we read it back here to colorize text with the active palette.
 */
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");

function activeTheme(): Theme {
	const instance = (globalThis as Record<symbol, unknown>)[THEME_KEY];
	if (!(instance instanceof Theme)) {
		throw new Error("pi theme not initialized; call initTheme() before rendering the TUI");
	}
	return instance;
}

/**
 * The small palette cua's components reach for, mapped onto pi theme colors so
 * existing call sites keep working while picking up pi's palette.
 */
export const colors = {
	dim: (text: string) => activeTheme().fg("dim", text),
	bold: (text: string) => activeTheme().bold(text),
	accent: (text: string) => activeTheme().fg("accent", text),
	muted: (text: string) => activeTheme().fg("muted", text),
	heading: (text: string) => activeTheme().fg("mdHeading", text),
	success: (text: string) => activeTheme().fg("success", text),
	error: (text: string) => activeTheme().fg("error", text),
	warning: (text: string) => activeTheme().fg("warning", text),
};

export { getMarkdownTheme };

/** pi has no exported editor theme; compose one from its select-list theme. */
export function getEditorTheme(): EditorTheme {
	return {
		borderColor: (text) => activeTheme().fg("borderAccent", text),
		selectList: getSelectListTheme(),
	};
}

/** pi has no image theme; only the text fallback color is cua-specific. */
export const imageTheme: ImageTheme = {
	fallbackColor: (text) => activeTheme().fg("dim", text),
};
