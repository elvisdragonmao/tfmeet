import { ageBand, calibratedCellKey, predictFormula } from "../src/prediction.mjs";
import { annualHistory, groupBy, longitudinalPairs, median, seriesKey, throwingEvents } from "./prediction-data.mjs";

export const nominalCoverage = 0.8;
export const thresholds = { train: 25, tune: 12, calibration: 20, test: 20, minimumCoverage: 0.7 };
const carry = { form: "carry" };
const knots = [5, 10, 13, 15, 17, 19, 23, 29, 39, 55, 75, 100];

export function splitOf(bucket, year, calendar) {
	if (year <= calendar.trainEnd && bucket < 50) return "train";
	if (year > calendar.trainEnd && year <= calendar.tuneEnd && bucket >= 50 && bucket < 65) return "tune";
	if (year > calendar.tuneEnd && year <= calendar.calibrationEnd && bucket >= 65 && bucket < 80) return "calibration";
	if (year > calendar.calibrationEnd && year <= calendar.testEnd && bucket >= 80) return "test";
	return null;
}

export function splitPairs(pairs, calendar) {
	const partitions = { train: [], tune: [], calibration: [], test: [] };
	for (const pair of pairs) {
		const split = splitOf(pair.end.bucket, pair.end.year, calendar);
		if (split) partitions[split].push(pair);
	}
	for (const split of ["tune", "calibration", "test"]) {
		// Keep a predetermined, earliest target per person and stratum, independent of performance.
		const rows = partitions[split].sort((a, b) => a.end.year - b.end.year || a.end.day - b.end.day || a.start.day - b.start.day);
		partitions[split] = [...groupBy(rows, p => p.athlete).values()].map(values => values[0]);
	}
	return partitions;
}

function uniqueAthletes(rows) {
	return new Set(rows.map(r => r.athlete)).size;
}

function balanced(rows) {
	const byAthlete = groupBy(rows, r => r.athlete);
	return [...byAthlete.values()].flatMap(pairs => pairs.map(row => [row, 1 / pairs.length]));
}

export function fitWeight(rows) {
	const data = balanced(rows);
	if (uniqueAthletes(rows) < 12) return [carry];
	let logXX = 0,
		logXY = 0,
		inverseXX = 0,
		inverseXY = 0;
	for (const [{ start, end }, weight] of data) {
		const x = Math.log(start.mass / end.mass),
			y = Math.log(end.value / start.value);
		const u = start.mass / end.mass - 1,
			v = end.value / start.value - 1;
		logXX += weight * x * x;
		logXY += weight * x * y;
		inverseXX += weight * u * u;
		inverseXY += weight * u * v;
	}
	const candidates = [carry];
	if (logXX > 0) candidates.push({ form: "power", k: logXY / logXX });
	if (inverseXX > 0) candidates.push({ form: "inverse", q: inverseXY / inverseXX });
	return candidates;
}

function basis(age) {
	const row = knots.map(() => 0);
	const upper = knots.findIndex(knot => knot >= age);
	if (upper === 0) row[0] = 1;
	else {
		const fraction = (age - knots[upper - 1]) / (knots[upper] - knots[upper - 1]);
		row[upper - 1] = 1 - fraction;
		row[upper] = fraction;
	}
	return row;
}

function solve(matrix, rhs) {
	const a = matrix.map((row, i) => [...row, rhs[i]]);
	const n = rhs.length;
	for (let i = 0; i < n; i++) {
		let pivot = i;
		for (let k = i + 1; k < n; k++) if (Math.abs(a[k][i]) > Math.abs(a[pivot][i])) pivot = k;
		[a[i], a[pivot]] = [a[pivot], a[i]];
		const scale = a[i][i];
		for (let j = i; j <= n; j++) a[i][j] /= scale;
		for (let k = 0; k < n; k++) {
			if (k === i) continue;
			const factor = a[k][i];
			for (let j = i; j <= n; j++) a[k][j] -= factor * a[i][j];
		}
	}
	return a.map(row => row[n]);
}

function smooth(samples) {
	const matrix = knots.map((_, i) => knots.map((_, j) => (i === j ? 1e-6 : 0)));
	const rhs = knots.map(() => 0);
	function add(x, y, weight) {
		for (let i = 0; i < x.length; i++) {
			if (x[i] === 0) continue;
			rhs[i] += weight * x[i] * y;
			for (let j = 0; j < x.length; j++) if (x[j] !== 0) matrix[i][j] += weight * x[i] * x[j];
		}
	}
	for (const [x, y, weight] of samples) add(x, y, weight);
	for (let i = 1; i < knots.length - 1; i++) {
		const left = 1 / (knots[i] - knots[i - 1]),
			right = 1 / (knots[i + 1] - knots[i]);
		const slopes = knots.map(() => 0);
		slopes[i - 1] = left;
		slopes[i] = -left - right;
		slopes[i + 1] = right;
		add(slopes, 0, 25);
	}
	return solve(matrix, rhs);
}

function fitAge(annual, pairs) {
	if (uniqueAthletes(pairs) < 12) return [carry];
	const sections = balanced(annual).map(([r, weight]) => [basis(r.age), Math.log(r.value), weight]);
	const changes = balanced(pairs).map(([p, weight]) => {
		const start = basis(p.start.age),
			end = basis(p.end.age);
		return [end.map((x, i) => x - start[i]), Math.log(p.end.value / p.start.value), weight];
	});
	const levels = smooth(changes);
	return [carry, { form: "cross-section", knots, levels: smooth(sections) }, { form: "longitudinal", knots, levels }, { form: "personal", knots, levels }];
}

export function scores(rows, model, radius = null) {
	let n = 0,
		absolute = 0,
		squared = 0,
		relative = 0,
		covered = 0;
	for (const pair of rows) {
		const predicted = predictFormula(model, pair),
			actual = pair.end.value;
		if (!Number.isFinite(predicted) || predicted <= 0) continue;
		const error = predicted - actual;
		n++;
		absolute += Math.abs(error);
		squared += error ** 2;
		relative += Math.abs(error) / actual;
		if (radius !== null && Math.abs(error) <= radius) covered++;
	}
	if (!n) return { n, mae: null, rmse: null, mape: null, coverage: null };
	return { n, mae: absolute / n, rmse: Math.sqrt(squared / n), mape: relative / n, coverage: radius === null ? null : covered / n };
}

export function calibratedRadius(rows, model, level = nominalCoverage) {
	const residuals = rows
		.map(p => Math.abs(p.end.value - predictFormula(model, p)))
		.filter(Number.isFinite)
		.sort((a, b) => a - b);
	const index = Math.ceil((residuals.length + 1) * level) - 1;
	return index >= 0 && index < residuals.length ? residuals[index] : null;
}

function coverage95(p, n) {
	const z = 1.96;
	const scale = 1 + (z * z) / n;
	const center = (p + (z * z) / (2 * n)) / scale;
	const half = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / scale;
	return [Math.max(0, center - half), Math.min(1, center + half)];
}

function keyFor(mode, event, p) {
	return calibratedCellKey(mode, event.name, event.gender, p.start.mass, p.end.mass, p.start.age, p.horizon ?? 0);
}

function observedAges(partitions) {
	const supports = ["train", "calibration"].map(split => new Set(partitions[split].map(p => p.start.age)));
	return [...supports[0]].filter(age => supports.every(set => set.has(age))).sort((a, b) => a - b);
}

function evaluate(mode, event, key, rows, candidates, calendar, intervalFloor = null) {
	const all = splitPairs(rows, calendar);
	const input = {
		mode,
		event: event.name,
		gender: event.gender,
		unit: event.unit,
		start: rows[0].start.mass,
		end: rows[0].end.mass,
		ageBand: ageBand(rows[0].start.age),
		horizon: rows[0].horizon ?? 0
	};
	const rawCounts = Object.fromEntries(Object.entries(all).map(([split, values]) => [split, uniqueAthletes(values)]));
	const ages = observedAges(all);
	const limited = Object.fromEntries(Object.entries(all).map(([split, values]) => [split, values.filter(p => ages.includes(p.start.age))]));
	const fitMarks = limited.train.map(p => p.start.value);
	const calibrationMarks = limited.calibration.map(p => p.start.value);
	const range = fitMarks.length && calibrationMarks.length ? [Math.max(Math.min(...fitMarks), Math.min(...calibrationMarks)), Math.min(Math.max(...fitMarks), Math.max(...calibrationMarks))] : null;
	const within = p => !range || (p.start.value >= range[0] && p.start.value <= range[1]);
	const supported = Object.fromEntries(Object.entries(limited).map(([split, values]) => [split, values.filter(within)]));
	const counts = Object.fromEntries(Object.entries(supported).map(([split, values]) => [split, uniqueAthletes(values)]));
	const readyData = Object.keys(rawCounts).every(name => counts[name] >= thresholds[name]);
	const diagnostic = !readyData;
	const partitions = diagnostic ? all : supported;
	const results = candidates.map(model => {
		const tune = scores(partitions.tune, model);
		const validCalibration = partitions.calibration.every(p => {
			const estimate = predictFormula(model, p);
			return Number.isFinite(estimate) && estimate > 0;
		});
		const q = validCalibration ? calibratedRadius(partitions.calibration, model) : null;
		const radius = q === null ? null : Math.max(intervalFloor ?? 0, q);
		return { model, tune, radius, test: scores(partitions.test, model, radius) };
	});
	const comparable = results.filter(candidate => candidate.tune.n === partitions.tune.length && candidate.tune.n > 0);
	const best = [...comparable].sort((a, b) => a.tune.mae - b.tune.mae)[0] ?? results[0];
	const baseline = results[0].test;
	const test = best.test,
		radius = best.radius;
	const reason = !readyData
		? "insufficient-split-support"
		: test.n !== counts.test || radius === null
			? "incomplete-predictions"
			: test.mae > baseline.mae
				? "worse-than-baseline"
				: test.coverage < thresholds.minimumCoverage
					? "low-test-coverage"
					: null;
	const model = reason
		? null
		: {
				model: best.model,
				unit: event.unit,
				ages: ages.filter(age => supported.test.some(p => p.start.age === age)),
				anchorRange: range,
				interval: { radius, nominal: nominalCoverage, observedCoverage: test.coverage, coverage95: coverage95(test.coverage, test.n), calibrationN: counts.calibration },
				validation: { ...test, baselineMae: baseline.mae, ...counts, testN: test.n }
			};
	return { key, ...input, reason, selected: best.model.form, metrics: results, rawCounts, counts, ages, range, model, baseline, test, radius, diagnostic };
}

export function fitSnapshot(dataset) {
	const newest = Math.max(...dataset.manifest.meets.map(m => m.year));
	const calendar = { trainEnd: newest - 5, tuneEnd: newest - 4, calibrationEnd: newest - 3, testEnd: newest - 1 };
	const models = {},
		cells = [],
		coefficients = [],
		sensitivity = [];
	const ageCandidates = new Map(),
		weightCandidates = new Map();
	const record = cell => {
		cells.push(cell);
		if (cell.model) models[cell.key] = cell.model;
	};
	for (const event of dataset.events) {
		const { name, gender } = event;
		for (const [mass, pairs] of groupBy(event.pairs.age, p => p.start.mass)) {
			const training = splitPairs(pairs, calendar).train;
			const observations = event.annual.filter(r => r.mass === mass && splitOf(r.bucket, r.year, calendar) === "train");
			const candidates = fitAge(observations, training);
			ageCandidates.set(seriesKey(name, gender, mass), candidates);
			coefficients.push({ mode: "age", event: name, gender, specification: mass, pairs: training.length, athletes: uniqueAthletes(training), candidates });
			const floors = new Map();
			const cohorts = [...groupBy(pairs, p => keyFor("age", event, p))].sort((a, b) => a[1][0].horizon - b[1][0].horizon);
			for (const [key, rows] of cohorts) {
				const floorKey = ageBand(rows[0].start.age);
				const shorter = floors.get(floorKey);
				const horizon = rows[0].horizon;
				const floor = shorter ? shorter.radius * Math.sqrt(horizon / shorter.horizon) : null;
				const cell = evaluate("age", event, key, rows, candidates, calendar, floor);
				if (cell.model) floors.set(floorKey, { horizon, radius: cell.model.interval.radius });
				record(cell);
			}
		}
		if (!throwingEvents.has(name)) continue;
		// Ignore 10 g notation/implement differences when estimating the general load response.
		const meaningful = event.weight.filter(p => Math.max(p.start.mass, p.end.mass) / Math.min(p.start.mass, p.end.mass) >= 1.05);
		const training = splitPairs(meaningful, calendar).train;
		const candidates = fitWeight(training);
		weightCandidates.set(seriesKey(name, gender, null), candidates);
		coefficients.push({ mode: "weight", event: name, gender, pairs: training.length, athletes: uniqueAthletes(training), candidates });
		for (const [key, rows] of groupBy(meaningful, p => keyFor("weight", event, p))) record(evaluate("weight", event, key, rows, candidates, calendar));
	}
	for (const event of dataset.events) {
		const { name, gender } = event;
		if (throwingEvents.has(name)) {
			for (const [key, rows] of groupBy(event.pairs.joint, p => keyFor("joint", event, p))) {
				const p = rows[0];
				const ageKey = calibratedCellKey("age", name, gender, p.start.mass, p.start.mass, p.start.age, p.horizon);
				const age = ageCandidates.get(seriesKey(name, gender, p.start.mass))?.find(m => m.form === "longitudinal");
				const weight = weightCandidates.get(seriesKey(name, gender, null))?.find(m => m.form === "power");
				const parentsValidated = row => {
					const k = calibratedCellKey("weight", name, gender, row.start.mass, row.end.mass, row.end.age, 0);
					const a = models[ageKey],
						w = models[k];
					return a?.model.form === age?.form && w?.model.form === weight?.form && a?.ages.includes(row.start.age) && w?.ages.includes(row.end.age);
				};
				const candidates = age && weight ? [carry, age, weight, { form: "composition", age, weight }] : [carry, ...(age ? [age] : []), ...(weight ? [weight] : [])];
				const cell = evaluate("joint", event, key, rows, candidates, calendar);
				if (!age || !weight || !rows.filter(row => cell.model?.ages.includes(row.start.age)).every(parentsValidated) || !rows.some(parentsValidated)) {
					cell.reason = "component-not-validated";
					cell.model = null;
				} else if (cell.selected !== "composition") {
					cell.reason = "composition-not-selected";
					cell.model = null;
				}
				record(cell);
			}
		}
		const best = longitudinalPairs(annualHistory(event.dates, true, event.lowerIsBetter)).age;
		const bestByPair = new Map(best.map(p => [[p.athlete, p.start.year, p.end.year, p.start.mass].join("|"), p]));
		for (const cell of cells.filter(row => row.mode === "age" && row.event === name && row.gender === gender && row.model)) {
			const within = p => keyFor("age", event, p) === cell.key && cell.ages.includes(p.start.age) && p.start.value >= cell.range[0] && p.start.value <= cell.range[1];
			const observed = splitPairs(event.pairs.age.filter(within), calendar).test;
			const matching = observed.map(p => [p, bestByPair.get([p.athlete, p.start.year, p.end.year, p.start.mass].join("|"))]).filter(([, best]) => best);
			const active = matching.filter(([p]) => p.start.meetDays >= 2 && p.end.meetDays >= 2);
			sensitivity.push({
				key: cell.key,
				n: matching.length,
				multipleMeetDays: active.length,
				changeInTarget: median(active.map(([normal, best]) => (best.end.value / normal.end.value - 1) * 100)),
				medianCarryMae: scores(
					matching.map(([p]) => p),
					carry
				).mae,
				bestCarryMae: scores(
					matching.map(([, p]) => p),
					carry
				).mae
			});
		}
	}
	return { calendar, models, cells, coefficients, sensitivity };
}
