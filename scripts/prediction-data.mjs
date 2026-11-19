import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { quantile, uniqueStarts } from "../src/analysis.mjs";
import { dataRulesVersion } from "../src/events.mjs";

export const snapshotRoot = new URL("../public/data/", import.meta.url);
export const throwingEvents = new Set(["鉛球", "鐵餅", "標槍"]);
export const needsSpecification = event => throwingEvents.has(event) || /跨欄|障礙|鏈球/.test(event);
export const seriesKey = (event, gender, mass) => [event, gender, mass ?? ""].join("|");
export const median = values =>
	quantile(
		[...values].sort((a, b) => a - b),
		0.5
	);
export const dayNumber = date => Date.parse(date + "T00:00:00Z") / 86400000;

const acceptedIdentities = new Set(["name-gender-birth-year", "name-gender-birth-team", "verified-source-alias", "verified-override", "verified-separation"]);
const numberMark = /^\d+(?::\d{1,2}){0,2}(?:\.\d+)?(?=$|\s|\()/;
const positiveInteger = n => Number.isInteger(n) && n > 0;
const dateMatchesYear = r =>
	/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "") &&
	Number.isFinite(dayNumber(r.date)) &&
	new Date(dayNumber(r.date) * 86400000).toISOString().slice(0, 10) === r.date &&
	Number(r.date.slice(0, 4)) === r.year;

function sourceValue(mark) {
	const match = (mark ?? "").match(numberMark);
	return match ? match[0].split(":").reduce((value, part) => value * 60 + Number(part), 0) : NaN;
}

export function cleanEvent(data, identityById) {
	const counts = {
		rows: data.records.length,
		individual: 0,
		invalidMark: 0,
		malformedMark: 0,
		dubiousScale: 0,
		missingDate: 0,
		missingAge: 0,
		statedSpec: 0,
		inferredSpec: 0,
		missingSpec: 0,
		excludedIdentity: 0,
		duplicates: 0
	};
	const valid = [];
	for (const r of data.records) {
		if (r.kind !== "individual") continue;
		counts.individual++;
		if (r.value == null || !Number.isFinite(r.value) || r.value <= 0) {
			counts.invalidMark++;
			continue;
		}
		const original = sourceValue(r.performance);
		if (Math.abs(original - r.value) > 1e-5 || !Number.isFinite(original) || (data.unit === "m" && r.performance.includes(":"))) {
			counts.malformedMark++;
			continue;
		}
		// Broad unit checks, not competition records or limits on normal improvement.
		if ((throwingEvents.has(data.name) && (r.value < 0.5 || r.value > 120)) || (/跳|撐竿/.test(data.name) && data.unit === "m" && r.value > 20) || (data.unit === "s" && r.value < 1)) {
			counts.dubiousScale++;
			continue;
		}
		if (!dateMatchesYear(r)) counts.missingDate++;
		if (!positiveInteger(r.birthYear) || r.age !== r.year - r.birthYear || !(r.age >= 5 && r.age <= 100)) counts.missingAge++;
		if (needsSpecification(data.name)) {
			if (!positiveInteger(r.specification)) counts.missingSpec++;
			else if (r.specificationInferred) counts.inferredSpec++;
			else counts.statedSpec++;
		}
		if (!acceptedIdentities.has(identityById.get(r.athleteId)?.basis)) counts.excludedIdentity++;
		valid.push(r);
	}
	const deduped = uniqueStarts(valid);
	counts.duplicates = valid.length - deduped.length;
	const records = deduped
		.filter(
			r =>
				dateMatchesYear(r) &&
				r.nameProvided !== false &&
				acceptedIdentities.has(identityById.get(r.athleteId)?.basis) &&
				(!needsSpecification(data.name) || (positiveInteger(r.specification) && !r.specificationInferred))
		)
		.map(r => ({
			athlete: r.athleteId,
			bucket: identityById.get(r.athleteId).bucket,
			meet: r.meetId,
			day: dayNumber(r.date),
			year: r.year,
			age: positiveInteger(r.birthYear) && r.age === r.year - r.birthYear && r.age >= 5 && r.age <= 100 ? r.age : null,
			mass: needsSpecification(data.name) ? r.specification : null,
			value: r.value
		}));
	const ranks = deduped.map(r => Number.parseInt(r.rank, 10)).filter(Number.isFinite);
	return { counts: { ...counts, validUnique: deduped.length, usable: records.length, ranksOverEight: ranks.filter(rank => rank > 8).length }, records };
}

export function groupBy(rows, key) {
	const groups = new Map();
	for (const row of rows) {
		const id = key(row);
		if (!groups.has(id)) groups.set(id, []);
		groups.get(id).push(row);
	}
	return groups;
}

export function summarizeDates(records) {
	return [...groupBy(records, r => [r.athlete, r.meet, r.day, r.mass].join("|")).values()].map(rows => {
		const marks = rows.map(r => r.value);
		return { ...rows[0], value: median(marks), min: Math.min(...marks), max: Math.max(...marks) };
	});
}

export function annualHistory(dates, best, lowerIsBetter) {
	return [
		...groupBy(
			dates.filter(r => r.age !== null),
			r => [r.athlete, r.year, r.mass].join("|")
		).values()
	].map(rows => {
		const marks = rows.map(r => r.value);
		const value = best ? (lowerIsBetter ? Math.min(...rows.map(r => r.min)) : Math.max(...rows.map(r => r.max))) : median(marks);
		return { ...rows[0], value, meetDays: rows.length };
	});
}

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
		if (!info.valid || !["M", "F"].includes(info.gender) || !["m", "s"].includes(info.unit)) continue;
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
