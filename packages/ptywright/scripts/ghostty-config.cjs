const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const packageRoot = resolve(__dirname, "..");
const workspaceRoot = resolve(packageRoot, "../..");
const upstreamPath = resolve(packageRoot, "GHOSTTY_UPSTREAM");
const upstream = JSON.parse(readFileSync(upstreamPath, "utf8"));

const cacheRoot = resolve(packageRoot, ".cache");
const downloadDir = resolve(cacheRoot, "downloads");
const sourceDir = resolve(cacheRoot, "ghostty", upstream.commit);
const archivePath = resolve(downloadDir, `ghostty-${upstream.commit}.tar.gz`);
const zigCacheDir = resolve(cacheRoot, "zig-cache");
const zigGlobalCacheDir = resolve(cacheRoot, "zig-global-cache");
const includeDir = resolve(sourceDir, "include");
const libDir = resolve(sourceDir, "zig-out", "lib");

module.exports = {
	upstream,
	upstreamPath,
	packageRoot,
	workspaceRoot,
	cacheRoot,
	downloadDir,
	sourceDir,
	archivePath,
	zigCacheDir,
	zigGlobalCacheDir,
	includeDir,
	libDir,
	dylibPath: resolve(libDir, "libghostty-vt.dylib"),
};
