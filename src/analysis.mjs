export function quantile(sorted, p) {
	if (!sorted.length) return null;
	const i = (sorted.length - 1) * p;
	const lo = Math.floor(i),
		hi = Math.ceil(i);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
export function formatResult(value, unit = "s") {
	if (value === null || value === undefined || !Number.isFinite(value)) return "—";
	if (unit === "points") return String(Math.round(value));
	if (unit === "s" && value >= 60) {
		const rounded = Math.round(value * 100);
		const h = Math.floor(rounded / 360000),
			m = Math.floor((rounded % 360000) / 6000),
			s = ((rounded % 6000) / 100).toFixed(2).padStart(5, "0");
		return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
	}
	return value.toFixed(2);
}
export function bestPerAthlete(records, lower = true) {
	const map = new Map();
	for (const r of records) {
		const prev = map.get(r.athleteId);
		if (!prev || (lower ? r.value < prev.value : r.value > prev.value)) map.set(r.athleteId, r);
	}
	return [...map.values()];
}
export function uniqueStarts(records) {
	const seen = new Set();
	return records.filter(r => {
		const key = JSON.stringify([r.meetId, r.item, r.date || r.year, r.heat || "", r.bib || r.athleteId, r.value === null ? r.performance : r.value, r.wind]);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
export function comparePool(records, filters) {
	const { gender, group, from, to, age, wind, round, team } = filters;
	return uniqueStarts(
		records.filter(
			r =>
				r.value !== null &&
				r.kind === "individual" &&
				(!gender || r.gender === gender) &&
				(!group || r.group === group) &&
				r.year >= from &&
				r.year <= to &&
				(!age || r.age === Number(age)) &&
				(!team || r.team.includes(team)) &&
				(!round || r.round === round) &&
				(wind !== "legal" || (r.wind !== null && r.wind <= 2))
		)
	);
}
// Rank uses competition ranking: tied performances have the same top percentage.
export function standing(records, value, lower = true) {
	const n = records.length;
	if (!n) return null;
	const better = records.reduce((n, r) => n + Number(lower ? r.value < value : r.value > value), 0);
	return { rank: better + 1, n, topPercent: Math.min(100, ((better + 1) / n) * 100), beatsPercent: (records.filter(r => (lower ? r.value > value : r.value < value)).length / n) * 100 };
}
export function threshold(records, topPercent, lower = true) {
	const values = records.map(r => r.value).sort((a, b) => a - b);
	return quantile(values, lower ? topPercent / 100 : 1 - topPercent / 100);
}
export function groupStats(records, key, lower = true) {
	const groups = new Map();
	for (const r of records) {
		const k = r[key];
		if (k === null || k === undefined) continue;
		if (!groups.has(k)) groups.set(k, []);
		groups.get(k).push(r);
	}
	return [...groups]
		.sort(([a], [b]) => Number(a) - Number(b))
		.map(([key, rs]) => {
			const best = bestPerAthlete(rs, lower);
			const values = best.map(r => r.value).sort((a, b) => (lower ? a - b : b - a));
			return {
				key,
				n: best.length,
				median: quantile(values, 0.5),
				top10: quantile(values, 0.1),
				top25: quantile(values, 0.25),
				top75: quantile(values, 0.75),
				best: quantile(values, 0)
			};
		});
}
export function parseInput(text, unit = "s") {
	const s = text.trim();
	if (!s) return null;
	if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(s)) return null;
	const parts = s.split(":").map(Number);
	if (unit !== "s" && parts.length > 1) return null;
	if (parts.slice(1).some(n => n >= 60)) return null;
	const value = parts.reduce((a, n) => a * 60 + n, 0);
	return Number.isFinite(value) && value > 0 ? Math.round(value * 1e6) / 1e6 : null;
}
