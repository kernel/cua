/** Run `worker` over `items` with at most `concurrency` in flight at once. */
export async function runPool<T>(
	items: T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
	let next = 0;
	const lanes = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
		while (true) {
			const index = next++;
			if (index >= items.length) return;
			await worker(items[index]!, index);
		}
	});
	await Promise.all(lanes);
}
