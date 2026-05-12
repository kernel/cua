/**
 * cua-added action helpers.
 *
 * These actions are NOT part of any provider's official computer-use action
 * set. We add them because they're useful enough that every provider
 * adapter wants them — `goto`, `back`, `forward`, `url` (read current page
 * URL) — and because they compile down to keyboard chords plus optional
 * clipboard read against the same Kernel `browsers.computer.*` endpoints.
 *
 * Two flavors:
 *  - `<verb>BatchActions()` returns canonical `BatchAction[]` ready to send
 *    to the Kernel batch endpoint. Use these in provider code that wants
 *    fine-grained control over which actions get batched.
 *  - `<verb>ModelAction()` returns a `ModelAction` you can drop into the
 *    list passed to `ComputerTranslator.executeBatch`. Use these when
 *    talking to the high-level translator API.
 */

import { translateKeys } from "./keysym";
import type { BatchAction, ModelAction } from "./types";

// ─── BatchAction-level builders ────────────────────────────────────────────

/** Address-bar focus → select-all → type URL → Enter. */
export function gotoBatchActions(url: string): BatchAction[] {
	return [
		{ type: "press_key", pressKey: { holdKeys: translateKeys(["CTRL"]), keys: translateKeys(["l"]) } },
		{ type: "press_key", pressKey: { holdKeys: translateKeys(["CTRL"]), keys: translateKeys(["a"]) } },
		{ type: "type_text", typeText: { text: url } },
		{ type: "press_key", pressKey: { keys: translateKeys(["ENTER"]) } },
	];
}

/** Browser back: Alt+Left. */
export function backBatchActions(): BatchAction[] {
	return [{ type: "press_key", pressKey: { holdKeys: translateKeys(["ALT"]), keys: translateKeys(["LEFT"]) } }];
}

/** Browser forward: Alt+Right. */
export function forwardBatchActions(): BatchAction[] {
	return [
		{ type: "press_key", pressKey: { holdKeys: translateKeys(["ALT"]), keys: translateKeys(["RIGHT"]) } },
	];
}

/**
 * Address-bar focus → Ctrl+C. Pair with `client.browsers.computer.readClipboard`
 * to capture the current URL (the `ComputerTranslator.currentUrl()` helper does
 * this for you).
 */
export function currentUrlCopyActions(): BatchAction[] {
	return [
		{ type: "press_key", pressKey: { holdKeys: translateKeys(["CTRL"]), keys: translateKeys(["l"]) } },
		{ type: "press_key", pressKey: { holdKeys: translateKeys(["CTRL"]), keys: translateKeys(["c"]) } },
	];
}

// ─── ModelAction-level constructors ────────────────────────────────────────

export function gotoModelAction(url: string): ModelAction {
	return { type: "goto", url };
}

export function backModelAction(): ModelAction {
	return { type: "back" };
}

export function forwardModelAction(): ModelAction {
	return { type: "forward" };
}

export function urlModelAction(): ModelAction {
	return { type: "url" };
}

export function screenshotModelAction(): ModelAction {
	return { type: "screenshot" };
}
