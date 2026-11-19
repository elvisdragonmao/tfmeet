import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calibratedCellKey, futureSeasonHorizons, predictFormula, predictPerformance } from "../src/prediction.mjs";
import { athletePredictionSeasons } from "../src/prediction-history.mjs";
import { cleanEvent, longitudinalPairs, weightPairs } from "./prediction-data.mjs";
import { calibratedRadius, splitOf, splitPairs } from "./prediction-fit.mjs";

const calendar = { trainEnd: 2021, tuneEnd: 2022, calibrationEnd: 2023, testEnd: 2025 };
const artifact = JSON.parse(readFileSync(new URL("../public/prediction-model.json", import.meta.url)));
const row = (athlete, year, age, mass, value, day, bucket = 10) => ({ athlete, year, age, mass, value, day, bucket });

test("time cutoffs and athlete buckets separate outcomes across all folds", () => {
	assert.equal(splitOf(10, 2021, calendar), "train");
	assert.equal(splitOf(10, 2025, calendar), null);
	assert.equal(splitOf(52, 2022, calendar), "tune");
	assert.equal(splitOf(72, 2023, calendar), "calibration");
	assert.equal(splitOf(85, 2024, calendar), "test");
	assert.equal(splitOf(85, 2021, calendar), null);
	const start = row("held-out", 2023, 15, null, 13, 10, 90);
	const later = row("held-out", 2025, 17, null, 12, 800, 90);
	const earliest = row("held-out", 2024, 16, null, 12.4, 400, 90);
	const data = splitPairs(
		[later, earliest].map(end => ({ athlete: start.athlete, start, end })),
		calendar
	);
	assert.deepEqual(
		data.test.map(p => p.end),
		[earliest]
	);
	assert.equal(data.train.length, 0);
});

test("weight pairs require a known same calendar age, a valid window, and matching athlete IDs", () => {
	const first = row("one", 2020, 15, 5000, 13, 10);
	const other = row("other", 2020, 15, 6000, 10, 11);
	const same = row("one", 2020, 15, 6000, 11, 12);
	const far = row("one", 2020, 15, 7260, 9, 103);
	const unknown = row("one", 2020, null, 7000, 10, 11);
	const pairs = weightPairs([first, other, same, far, unknown]);
	assert.deepEqual(
		pairs.map(p => [p.start.mass, p.end.mass, p.days]),
		[[5000, 6000, 2]]
	);
});

test("longitudinal fitting pairs exclude future history and keep changed gear separate", () => {
	const first = row("one", 2021, 14, 5000, 11, 1);
	const anchor = row("one", 2022, 15, 5000, 12, 400);
	const same = row("one", 2023, 16, 5000, 13, 800);
	const different = row("one", 2023, 16, 6000, 11, 801);
	const pairs = longitudinalPairs([first, anchor, same, different]);
	const fromAnchor = pairs.age.find(p => p.start === anchor && p.end === same);
	assert.deepEqual(fromAnchor.history, [first, anchor]);
	assert.ok(pairs.joint.some(p => p.start === anchor && p.end === different));
});

test("cleaning keeps explicit specifications and removes invalid, duplicate, and inferred records", () => {
	const valid = {
		athleteId: "one",
		meetId: "m",
		item: "1",
		bib: "1",
		date: "2024-03-19",
		year: 2024,
		birthYear: 2009,
		age: 15,
		kind: "individual",
		value: 12.34,
		performance: "12.34",
		specification: 5000
	};
	const identity = new Map([["one", { basis: "name-gender-birth-year", bucket: 91 }]]);
	const records = [
		valid,
		{ ...valid },
		{ ...valid, item: "2", specificationInferred: true },
		{ ...valid, item: "3", value: null, performance: "DNS" },
		{ ...valid, item: "4", date: "2024-02-30" },
		{ ...valid, item: "5", date: "2024-02-29", birthYear: null, age: null }
	];
	const cleaned = cleanEvent({ name: "鉛球", unit: "m", records }, identity);
	assert.equal(cleaned.counts.duplicates, 1);
	assert.equal(cleaned.counts.missingDate, 1);
	assert.equal(cleaned.counts.invalidMark, 1);
	assert.equal(cleaned.counts.inferredSpec, 1);
	assert.deepEqual(
		cleaned.records.map(r => [r.age, r.mass]),
		[
			[15, 5000],
			[null, 5000]
		]
	);
});

test("athlete forecasts derive separate seasonal baselines from the chosen candidate only", () => {
	const athlete = { id: "one", gender: "M", basis: "name-gender-birth-year" };
	const valid = {
		athleteId: "one",
		event: "鉛球",
		gender: "M",
		meetId: "m",
		item: "1",
		bib: "1",
		date: "2024-03-19",
		year: 2024,
		birthYear: 2009,
		age: 15,
		kind: "individual",
		value: 12,
		performance: "12",
		specification: 5000
	};
	const rows = [
		valid,
		{ ...valid, date: "2024-04-19", value: 14, performance: "14" },
		{ ...valid, specification: 6000, item: "2", value: 10, performance: "10" },
		{ ...valid, athleteId: "different", item: "3", value: 16, performance: "16" },
		{ ...valid, date: "2024-06-19", specificationInferred: true, value: 16, performance: "16" }
	];
	assert.deepEqual(
		athletePredictionSeasons(athlete, "鉛球", "m", rows).map(({ year, age, mark, weightKg, meetDays }) => [year, age, mark, weightKg, meetDays]),
		[
			[2024, 15, 13, 5, 2],
			[2024, 15, 10, 6, 1]
		]
	);
});

test("power and anchored reciprocal are independently callable and preserve natural units", () => {
	const p = { start: { value: 12, mass: 5000 }, end: { mass: 6000 } };
	assert.ok(Math.abs(predictFormula({ form: "power", k: 1 }, p) - 10) < 1e-12);
	assert.ok(Math.abs(predictFormula({ form: "inverse", q: 0.5 }, p) - 11) < 1e-12);
	assert.equal(predictFormula({ form: "carry" }, p), 12);
});

test("historical shot put aliases do not request a weight conversion", () => {
	const result = predictPerformance(artifact, { event: "鉛球 2.73 kg", gender: "M", currentAge: 12, currentWeightKg: 2.73, targetWeightKg: 2.72, mark: 10 });
	assert.equal(result.reason, "no-change");
});

test("calibration uses the finite sample rank and fails when the rank is unsupported", () => {
	const model = { form: "carry" };
	const values = [0.1, 0.2, 0.3, 0.4, 0.5].map(error => ({ start: { value: 1 }, end: { value: 1 + error } }));
	assert.ok(Math.abs(calibratedRadius(values, model, 0.8) - 0.5) < 1e-12);
	assert.equal(calibratedRadius(values.slice(0, 2), model), null);
});

test("the fitted snapshot artifact supplies intervals and enforces equipment, ages and marks", () => {
	const ready = Object.entries(artifact.models).find(([key, cell]) => key.startsWith("age|") && key.split("|")[3] === "" && cell.unit === "s");
	if (!ready) {
		assert.equal(predictPerformance(artifact, { event: "100M", gender: "M", currentAge: 15, targetAge: 16, mark: 12 }).reason, "insufficient-evidence");
		return;
	}
	const [key, cell] = ready;
	const [, event, gender, , , , horizon] = key.split("|");
	const currentAge = cell.ages[0];
	const mark = (cell.anchorRange[0] + cell.anchorRange[1]) / 2;
	const request = { event, gender, currentAge, targetAge: currentAge + Number(horizon), mark };
	const result = predictPerformance(artifact, request);
	assert.equal(result.status, "ok");
	assert.equal(result.unit, "s");
	assert.equal(result.modelVersion, artifact.modelVersion);
	assert.ok(result.interval.low <= result.estimate && result.estimate <= result.interval.high);
	assert.deepEqual(result.applicability.currentCompletedAgeRange, [currentAge - 1, currentAge]);
	assert.ok(result.validation.testN >= artifact.thresholds.test);
	assert.equal(predictPerformance(artifact, { ...request, targetAge: currentAge + 4 }).reason, "horizon");
	assert.equal(predictPerformance(artifact, { ...request, currentWeightKg: 5 }).reason, "weight-not-applicable");
	assert.equal(predictPerformance(artifact, { ...request, mark: cell.anchorRange[1] + 1 }).reason, "out-of-range-mark");
	assert.equal(predictPerformance(artifact, { ...request, event: "鉛球", currentWeightKg: 5, targetWeightKg: 7.123 }).reason, "insufficient-evidence");
});

test("longer published age forecasts have at least the shorter calibrated interval width", () => {
	const previous = new Map();
	const entries = Object.entries(artifact.models).sort(([a], [b]) => Number(a.split("|").at(-1)) - Number(b.split("|").at(-1)));
	for (const [key, model] of entries) {
		if (!key.startsWith("age|")) continue;
		const series = key.slice(0, key.lastIndexOf("|"));
		assert.ok(model.interval.radius >= (previous.get(series) ?? 0));
		previous.set(series, model.interval.radius);
	}
});

test("individual adjustment consumes matching past seasons only", () => {
	const input = { event: "100M", gender: "F", currentAge: 15, targetAge: 16, currentYear: 2024, athleteId: "one" };
	const key = calibratedCellKey("age", input.event, input.gender, null, null, input.currentAge, 1);
	const sampleModel = {
		...artifact,
		models: {
			[key]: {
				model: { form: "personal", knots: [10, 15, 20], levels: [0.1, 0, -0.05] },
				unit: "s",
				ages: [15],
				anchorRange: [12, 15],
				interval: { radius: 0.05 }
			}
		}
	};
	input.mark = 13;
	const baseline = predictPerformance(sampleModel, input);
	const history = [
		{ ...input, event: "100 Meters", age: 13, year: 2022, mark: input.mark + 1.9 },
		{ ...input, age: 14, year: 2023, mark: input.mark + 0.5 }
	];
	const revised = predictPerformance(sampleModel, { ...input, history });
	const attemptedLeak = predictPerformance(sampleModel, { ...input, history: [...history, { ...input, age: 16, year: 2025, mark: 1 }, { ...input, age: 12, year: 2026, mark: 1 }] });
	assert.equal(revised.applicability.historyMarksUsed, 2);
	assert.notEqual(revised.estimate, baseline.estimate);
	assert.deepEqual(attemptedLeak, revised);
});
test("future forecast horizons already elapsed are removed without extending the model's range", () => {
	assert.deepEqual(futureSeasonHorizons(2026, 2026), [1, 2, 3]);
	assert.deepEqual(futureSeasonHorizons(2025, 2026), [2, 3]);
	assert.deepEqual(futureSeasonHorizons(2024, 2026), [3]);
	assert.deepEqual(futureSeasonHorizons(2023, 2026), []);
	assert.deepEqual(futureSeasonHorizons(2027, 2026), []);
});
