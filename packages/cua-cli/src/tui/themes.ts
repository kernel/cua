import type { EditorTheme, ImageTheme, SelectListTheme } from "@mariozechner/pi-tui";

const RESET = "\x1b[0m";

const ansi = {
	dim: (text: string) => `\x1b[2m${text}${RESET}`,
	bold: (text: string) => `\x1b[1m${text}${RESET}`,
	cyan: (text: string) => `\x1b[36m${text}${RESET}`,
	green: (text: string) => `\x1b[32m${text}${RESET}`,
	yellow: (text: string) => `\x1b[33m${text}${RESET}`,
	red: (text: string) => `\x1b[31m${text}${RESET}`,
	gray: (text: string) => `\x1b[90m${text}${RESET}`,
	blue: (text: string) => `\x1b[34m${text}${RESET}`,
	lightBlue: (text: string) => `\x1b[38;2;129;162;190m${text}${RESET}`,
	magenta: (text: string) => `\x1b[35m${text}${RESET}`,
};

export const colors = ansi;

export const selectListTheme: SelectListTheme = {
	selectedPrefix: (text) => ansi.cyan(text),
	selectedText: (text) => ansi.cyan(text),
	description: (text) => ansi.dim(text),
	scrollInfo: (text) => ansi.dim(text),
	noMatch: (text) => ansi.dim(text),
};

export const editorTheme: EditorTheme = {
	borderColor: (text) => ansi.lightBlue(text),
	selectList: selectListTheme,
};

export const imageTheme: ImageTheme = {
	fallbackColor: (text) => ansi.dim(text),
};
