import { quantile, uniqueStarts } from "./analysis.mjs";
import { maxForecastHorizon } from "./prediction.mjs";

export const throwingEvents = new Set(["鉛球", "鐵餅", "標槍"]);
const needsSpecification = event => throwingEvents.has(event) || /跨欄|障礙|鏈球/.test(event);
export const median = values =>
	quantile(
		[...values].sort((a, b) => a - b),
		0.5
	);
const dayNumber = date => Date.parse(date + "T00:00:00Z") / 86400000;

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

export function athletePredictionSeasons(athlete, event, unit, rows) {
	if (!["M", "F"].includes(athlete.gender) || !["s", "m"].includes(unit)) return [];
	const matching = rows.filter(row => row.athleteId === athlete.id && row.event === event && row.gender === athlete.gender);
	const { records } = cleanEvent({ name: event, unit, records: matching }, new Map([[athlete.id, athlete]]));
	return annualHistory(summarizeDates(records), false, unit === "s")
		.map(row => ({
			athleteId: athlete.id,
			event,
			gender: athlete.gender,
			age: row.age,
			year: row.year,
			mark: row.value,
			meetDays: row.meetDays,
			...(/跨欄|障礙/.test(event) ? { specificationMm: row.mass } : row.mass !== null ? { weightKg: row.mass / 1000 } : {})
		}))
		.sort((a, b) => b.year - a.year || b.meetDays - a.meetDays || (a.weightKg ?? a.specificationMm ?? 0) - (b.weightKg ?? b.specificationMm ?? 0));
}

export function missingSeasonTargets(observedYears, seasons, currentYear) {
	const anchors = seasons.filter(season => season.year <= currentYear).sort((a, b) => b.year - a.year);
	if (!anchors.length) return [];
	const observed = new Set([...observedYears.filter(year => year <= currentYear), ...anchors.map(season => season.year)]);
	const first = Math.min(...observed);
	const last = Math.max(...observed, anchors[0].year + maxForecastHorizon);
	const targets = [];
	let precedingYear = first;
	for (let year = first + 1; year <= last; year++) {
		if (observed.has(year)) {
			precedingYear = year;
			continue;
		}
		const source = anchors.find(season => season.year < year && year - season.year <= maxForecastHorizon);
		if (source) targets.push({ year, precedingYear, source });
	}
	return targets;
}
