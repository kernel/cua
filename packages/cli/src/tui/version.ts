/**
 * cua's version, inlined by tsdown's `define` (see tsdown.config.ts) so the
 * bundled bin never reads package.json from disk at runtime. When the source
 * runs unbundled (e.g. tests via tsx), the define isn't applied and this falls
 * back to "dev".
 */
declare const __CUA_VERSION__: string | undefined;

export function cuaVersion(): string {
	return typeof __CUA_VERSION__ === "string" ? __CUA_VERSION__ : "dev";
}
