#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const [, , targetArg] = process.argv;

const STATIC_IMPORT_RE = /(from\s*["'])(\.\.?\/[^"']+)(["'])/g;
const DYNAMIC_IMPORT_RE = /(import\s*\(\s*["'])(\.\.?\/[^"']+)(["']\s*\))/g;
const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".json", ".node", ".wasm"]);

async function main() {
	const targets = targetArg ? [path.resolve(process.cwd(), targetArg)] : await collectWorkspaceDistDirs();
	for (const target of targets) {
		const files = await collectFiles(target);
		for (const filePath of files) {
			let content = await fs.readFile(filePath, "utf8");
			content = rewrite(content, STATIC_IMPORT_RE);
			content = rewrite(content, DYNAMIC_IMPORT_RE);
			await fs.writeFile(filePath, content);
		}
	}
}

function rewrite(content, re) {
	return content.replace(re, (_, prefix, specifier, suffix) => {
		const ext = path.extname(specifier);
		if (ext && JS_EXTENSIONS.has(ext)) return `${prefix}${specifier}${suffix}`;
		if (ext && !JS_EXTENSIONS.has(ext)) return `${prefix}${specifier}${suffix}`;
		return `${prefix}${specifier}.js${suffix}`;
	});
}

async function collectFiles(dir) {
	const output = [];
	let entries = [];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return output;
	}
	for (const entry of entries) {
		const absolute = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			output.push(...(await collectFiles(absolute)));
			continue;
		}
		if (absolute.endsWith(".js") || absolute.endsWith(".d.ts")) {
			output.push(absolute);
		}
	}
	return output;
}

async function collectWorkspaceDistDirs() {
	const packagesDir = path.resolve(process.cwd(), "packages");
	const out = [];
	let entries = [];
	try {
		entries = await fs.readdir(packagesDir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const distPath = path.join(packagesDir, entry.name, "dist");
		try {
			const stat = await fs.stat(distPath);
			if (stat.isDirectory()) out.push(distPath);
		} catch {
			// Dist directory absent for this package.
		}
	}
	return out;
}

await main();
