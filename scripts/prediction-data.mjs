import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { quantile } from "../src/analysis.mjs";
import { dataRulesVersion } from "../src/events.mjs";
import { annualHistory, cleanEvent, groupBy, summarizeDates, throwingEvents } from "../src/prediction-history.mjs";
export { annualHistory, cleanEvent, groupBy, median, summarizeDates, throwingEvents } from "../src/prediction-history.mjs";

export const snapshotRoot = new URL("../public/data/", import.meta.url);
export const seriesKey = (event, gender, mass) => [event, gender, mass ?? ""].join("|");

export function weightPairs(dates, windowDays = 90) {
	const pairs = [];
	for (const rows of groupBy(dates, r => r.athlete).values()) {
		const sorted = [...rows].sort((a, b) => a.day - b.day || a.mass - b.mass);
		const closest = new Map();
		for (let j = 1; j < sorted.length; j++) {
			const end = sorted[j];
			for (let i = j - 1; i >= 0; i--) {
				const start = sorted[i],
					days = end.day - start.day;
				if (days > windowDays) break;
				if (start.mass === end.mass || start.age === null || start.age !== end.age) continue;
				const key = [end.year, start.mass, end.mass].join("|");
				if (!closest.has(key) || days < closest.get(key).days) closest.set(key, { start, end, days, athlete: end.athlete });
			}
		}
		pairs.push(...closest.values());
	}
	return pairs;
}

export function longitudinalPairs(annual) {
	const age = [],
		joint = [];
	for (const rows of groupBy(annual, r => r.athlete).values()) {
		const sorted = [...rows].sort((a, b) => a.year - b.year),
			byMass = groupBy(sorted, r => r.mass);
		for (const [j, end] of sorted.entries())
			for (let i = j - 1; i >= 0; i--) {
				const start = sorted[i];
				const horizon = end.year - start.year;
				if (horizon > 3) break;
				if (horizon < 1 || end.age - start.age !== horizon) continue;
				const history = byMass.get(start.mass).filter(r => r.year <= start.year);
				(start.mass === end.mass ? age : joint).push({ athlete: end.athlete, start, end, horizon, history });
			}
	}
	return { age, joint };
}

export function dataDistribution(records) {
	return [...groupBy(records, r => [r.mass ?? "", r.age ?? ""].join("|")).values()]
		.map(rows => {
			const values = rows.map(r => r.value).sort((a, b) => a - b);
			return {
				mass: rows[0].mass,
				age: rows[0].age,
				n: rows.length,
				athletes: new Set(rows.map(r => r.athlete)).size,
				p10: quantile(values, 0.1),
				median: quantile(values, 0.5),
				p90: quantile(values, 0.9)
			};
		})
		.sort((a, b) => (a.mass ?? 0) - (b.mass ?? 0) || (a.age ?? 0) - (b.age ?? 0));
}

export async function loadPredictionData(root = snapshotRoot) {
	const manifest = JSON.parse(await readFile(new URL("manifest.json", root)));
	if (manifest.dataRulesVersion !== dataRulesVersion) throw new Error("Run pnpm run data:derive to restore the normalized event indexes first.");
	const readGzip = async name => JSON.parse(gunzipSync(await readFile(new URL(name, root))));
	const athletes = await readGzip("athletes.json.gz");
	const identityById = new Map(
		athletes.map(a => {
			const key = [a.name.normalize("NFKC").toLowerCase().replace(/\s/g, ""), a.gender, a.birthYear].join("|");
			const bucket = createHash("sha256").update(key).digest().readUInt32BE() % 100;
			return [a.id, { basis: a.basis, bucket }];
		})
	);
	const events = [];
	const fingerprint = createHash("sha256");
	for (const info of manifest.events) {
		if (!info.valid || info.kind === "relay" || !["M", "F"].includes(info.gender) || !["m", "s"].includes(info.unit)) continue;
		const raw = gunzipSync(await readFile(new URL(`events/${info.id}.json.gz`, root)));
		fingerprint.update(raw);
		const data = JSON.parse(raw);
		const { counts, records } = cleanEvent(data, identityById);
		const dates = summarizeDates(records);
		const annual = annualHistory(dates, false, info.lowerIsBetter);
		const pairs = longitudinalPairs(annual);
		events.push({
			name: info.name,
			gender: info.gender,
			unit: info.unit,
			lowerIsBetter: info.lowerIsBetter,
			counts,
			records,
			dates,
			annual,
			pairs,
			weight: throwingEvents.has(info.name) ? weightPairs(dates) : []
		});
	}
	return { manifest, events, fingerprint: fingerprint.digest("hex"), identityBases: Object.fromEntries([...groupBy(athletes, a => a.basis)].map(([key, rows]) => [key, rows.length])) };
}
