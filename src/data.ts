import type { Athlete, EventData, Manifest, Result } from "./types";
let version = "";
const cache = new Map<string, Promise<unknown>>();
export function fetchData<T>(path: string): Promise<T> {
	const key = path === "manifest.json" ? path : `${path}:${version}`;
	if (!cache.has(key))
		cache.set(
			key,
			fetch(
				`/data/${path === "manifest.json" ? path : path + ".gz"}${version && path !== "manifest.json" ? `?v=${encodeURIComponent(version)}` : ""}`,
				path === "manifest.json" ? { cache: "no-cache" } : undefined
			)
				.then(async r => {
					if (!r.ok) throw new Error(`資料下載失敗（${r.status}）`);
					if (path === "manifest.json") return r.json();
					const bytes = await r.arrayBuffer();
					if (new Uint8Array(bytes)[0] !== 31) return JSON.parse(new TextDecoder().decode(bytes));
					const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
					return new Response(stream).json();
				})
				.catch(e => {
					cache.delete(key);
					throw e;
				})
		);
	return cache.get(key) as Promise<T>;
}
export const loadManifest = () =>
	fetchData<Manifest>("manifest.json").then(m => {
		version = m.updatedAt;
		return m;
	});
export const loadEvent = (id: string) => fetchData<EventData>(`events/${id}.json`);
export const loadAthletes = () => fetchData<Athlete[]>("athletes.json");
export async function loadAthlete(id: string) {
	const shard = await fetchData<Record<string, Result[]>>(`athletes/${id.slice(0, 2)}.json`);
	return shard[id] || [];
}
