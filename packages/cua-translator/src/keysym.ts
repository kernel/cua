/**
 * X11 keysym mapping shared by all provider adapters.
 *
 * Models emit human-friendly key names like `ENTER`, `Ctrl`, `META`, `cmd`,
 * `PageUp`, etc. The Kernel computer API expects xdotool keysyms (`Return`,
 * `Control_L`, `Super_L`, `Prior`, ...). This module is the single source of
 * truth for that mapping.
 */

export const KEYSYM_MAP: Record<string, string> = {
	ENTER: "Return",
	Enter: "Return",
	RETURN: "Return",
	BACKSPACE: "BackSpace",
	Backspace: "BackSpace",
	DELETE: "Delete",
	TAB: "Tab",
	ESCAPE: "Escape",
	Escape: "Escape",
	ESC: "Escape",
	SPACE: "space",
	Space: "space",
	UP: "Up",
	DOWN: "Down",
	LEFT: "Left",
	RIGHT: "Right",
	HOME: "Home",
	END: "End",
	PAGEUP: "Prior",
	PAGE_UP: "Prior",
	PageUp: "Prior",
	PAGEDOWN: "Next",
	PAGE_DOWN: "Next",
	PageDown: "Next",
	CAPS_LOCK: "Caps_Lock",
	CapsLock: "Caps_Lock",
	CTRL: "Control_L",
	Ctrl: "Control_L",
	CONTROL: "Control_L",
	Control: "Control_L",
	ALT: "Alt_L",
	Alt: "Alt_L",
	SHIFT: "Shift_L",
	Shift: "Shift_L",
	META: "Super_L",
	Meta: "Super_L",
	SUPER: "Super_L",
	Super: "Super_L",
	CMD: "Super_L",
	COMMAND: "Super_L",
	F1: "F1",
	F2: "F2",
	F3: "F3",
	F4: "F4",
	F5: "F5",
	F6: "F6",
	F7: "F7",
	F8: "F8",
	F9: "F9",
	F10: "F10",
	F11: "F11",
	F12: "F12",
	INSERT: "Insert",
	Insert: "Insert",
	PRINT: "Print",
	SCROLLLOCK: "Scroll_Lock",
	PAUSE: "Pause",
	NUMLOCK: "Num_Lock",
};

export const PRINTABLE_KEYSYM_MAP: Record<string, string> = {
	"!": "exclam",
	'"': "quotedbl",
	"#": "numbersign",
	$: "dollar",
	"%": "percent",
	"&": "ampersand",
	"'": "apostrophe",
	"(": "parenleft",
	")": "parenright",
	"*": "asterisk",
	"+": "plus",
	",": "comma",
	"-": "minus",
	".": "period",
	"/": "slash",
	":": "colon",
	";": "semicolon",
	"<": "less",
	"=": "equal",
	">": "greater",
	"?": "question",
	"@": "at",
	"[": "bracketleft",
	"\\": "backslash",
	"]": "bracketright",
	"^": "asciicircum",
	_: "underscore",
	"`": "grave",
	"{": "braceleft",
	"|": "bar",
	"}": "braceright",
	"~": "asciitilde",
};

/** Translate human key names to xdotool keysyms. Pass-through if unknown. */
export function translateKeys(keys: string[]): string[] {
	return keys.map((k) => {
		if (KEYSYM_MAP[k]) return KEYSYM_MAP[k];
		const upper = k.toUpperCase();
		if (KEYSYM_MAP[upper]) return KEYSYM_MAP[upper];
		if (PRINTABLE_KEYSYM_MAP[k]) return PRINTABLE_KEYSYM_MAP[k];
		// Single uppercase letters implicitly trigger Shift in xdotool.
		// Use lowercase unless Shift is explicitly held.
		if (k.length === 1 && k >= "A" && k <= "Z") return k.toLowerCase();
		return k;
	});
}

export const MODIFIER_KEYS: ReadonlySet<string> = new Set([
	"Control_L",
	"Control_R",
	"Ctrl",
	"Alt_L",
	"Alt_R",
	"Alt",
	"Shift_L",
	"Shift_R",
	"Shift",
	"Super_L",
	"Super_R",
	"Meta",
]);

export function isModifierKey(key: string): boolean {
	return MODIFIER_KEYS.has(key);
}

/**
 * Take a flat array of keys and split it into (modifiers held during, primary
 * tapped) for the Kernel `pressKey` API. The "primary" key is the
 * right-most non-modifier; everything else becomes a hold key.
 */
export function splitKeypress(keys: string[]): { holdKeys: string[]; primaryKeys: string[] } {
	const translated = translateKeys(keys);
	if (translated.length === 0) return { holdKeys: [], primaryKeys: [] };
	if (translated.length === 1) return { holdKeys: [], primaryKeys: translated };

	let lastNonModifier = -1;
	for (let i = translated.length - 1; i >= 0; i--) {
		if (!isModifierKey(translated[i]!)) {
			lastNonModifier = i;
			break;
		}
	}

	if (lastNonModifier === -1) {
		return {
			holdKeys: translated.slice(0, -1),
			primaryKeys: translated.slice(-1),
		};
	}

	const hold: string[] = [];
	for (let i = 0; i < translated.length; i++) {
		if (i !== lastNonModifier) hold.push(translated[i]!);
	}
	return { holdKeys: hold, primaryKeys: [translated[lastNonModifier]!] };
}
