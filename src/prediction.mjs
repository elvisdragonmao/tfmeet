import { normalizeEvent } from "./events.mjs";

const massEvents = new Set(["鉛球", "鐵餅", "標槍", "鏈球"]);
const ageBandStarts = [5, 13, 16, 19, 23, 30, 40, 50, 60, 70, 80, 90];

export const predictionSchemaVersion = 1;
export const ageBand = age => ageBandStarts.findLast(start => start <= age);
export const calibratedCellKey = (mode, event, gender, from, to, age, horizon) => [mode, event, gender, from ?? "", to ?? "", ageBand(age), horizon].join("|");

export function curveValue(curve, age) {
	const { knots, levels } = curve;
	if (age < knots[0] || age > knots.at(-1)) return NaN;
	const high = knots.findIndex(knot => knot >= age);
	if (high <= 0) return levels[0];
	const low = high - 1,
		t = (age - knots[low]) / (knots[high] - knots[low]);
	return levels[low] * (1 - t) + levels[high] * t;
}

function personalAdjustment(curve, pair) {
	const previous = pair.history.filter(r => r.age < pair.start.age).sort((a, b) => a.age - b.age);
	if (previous.length < 2) return 0;
	const matches = [...previous, pair.start];
	let residual = 0,
		years = 0;
	for (let i = 1; i < matches.length; i++) {
		const a = matches[i - 1],
			b = matches[i];
		const expected = curveValue(curve, b.age) - curveValue(curve, a.age);
		if (!Number.isFinite(expected)) continue;
		residual += Math.log(b.value / a.value) - expected;
		years += b.age - a.age;
	}
	return (residual / (years + 3)) * (pair.end.age - pair.start.age);
}

export function predictFormula(model, pair) {
	const { start, end } = pair;
	switch (model.form) {
		case "carry":
			return start.value;
		case "power":
			return start.value * (start.mass / end.mass) ** model.k;
		case "inverse":
			return start.value * (1 + model.q * (start.mass / end.mass - 1));
		case "cross-section":
		case "longitudinal":
		case "personal":
			return start.value * Math.exp(curveValue(model, end.age) - curveValue(model, start.age) + (model.form === "personal" ? personalAdjustment(model, pair) : 0));
		case "composition": {
			const intermediate = { ...start, age: end.age, value: predictFormula(model.age, pair) };
			return predictFormula(model.weight, { start: intermediate, end });
		}
		default:
			return NaN;
	}
}

function compatibleHistory(input, event, mass) {
	if (!Array.isArray(input.history)) return [];
	const byAge = new Map();
	for (const row of input.history) {
		if (typeof row?.event !== "string" || row.gender !== input.gender || (input.athleteId && row.athleteId && row.athleteId !== input.athleteId)) continue;
		const { family, specification } = normalizeEvent(row.event);
		if (family !== event) continue;
		if (!Number.isInteger(row.age) || row.age >= input.currentAge || row.age < 5 || !Number.isFinite(row.mark) || row.mark <= 0) continue;
		if (row.year !== undefined && (!Number.isInteger(input.currentYear) || !Number.isInteger(row.year) || input.currentYear - row.year !== input.currentAge - row.age)) continue;
		const rowMass = massEvents.has(event) ? (Number.isFinite(row.weightKg) ? Math.round(row.weightKg * 1000) : specification) : (row.specificationMm ?? specification);
		if (rowMass !== mass || (specification !== null && specification !== rowMass)) continue;
		if (!byAge.has(row.age)) byAge.set(row.age, []);
		byAge.get(row.age).push(row.mark);
	}
	return [...byAge].map(([age, marks]) => {
		marks.sort((a, b) => a - b);
		return { age, value: (marks[Math.floor((marks.length - 1) / 2)] + marks[Math.floor(marks.length / 2)]) / 2 };
	});
}

export function predictPerformance(artifact, input) {
	const version = artifact?.modelVersion ?? null;
	const reject = (reason, detail) => ({ status: "unavailable", reason, detail, modelVersion: version });
	if (artifact?.schemaVersion !== predictionSchemaVersion || !artifact.models || typeof artifact.models !== "object") return reject("artifact-version", "模型檔不存在或版本不相容。");
	if (typeof input?.event !== "string" || !["M", "F"].includes(input.gender) || !Number.isFinite(input.mark) || input.mark <= 0) return reject("invalid-input", "需要項目、性別及大於零的已知成績。");
	if (input.ageBasis && input.ageBasis !== "calendar-year") return reject("age-basis", "模型使用比賽年份減出生年。");
	const { family: event, specification: labelSpec } = normalizeEvent(input.event);
	const a = input.currentAge,
		b = input.targetAge ?? a;
	if (![a, b].every(age => Number.isInteger(age) && age >= 5 && age <= 100) || b < a) return reject("invalid-age", "需要有效的當年年齡，且目標年齡不得早於目前年齡。");
	const hasMass = input.currentWeightKg != null || input.targetWeightKg != null;
	let from = null,
		to = null;
	if (massEvents.has(event)) {
		if (input.specificationMm != null) return reject("equipment-not-applicable", "此投擲項目請使用器材重量，單位 kg。");
		const kg = input.currentWeightKg ?? (labelSpec == null ? null : labelSpec / 1000);
		const target = input.targetWeightKg ?? kg;
		if (![kg, target].every(value => Number.isFinite(value) && value > 0 && Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6))
			return reject("equipment-required", "請提供實際的目前器材重量，單位 kg。");
		from = Math.round(kg * 1000);
		to = Math.round(target * 1000);
		if (labelSpec !== null && from !== labelSpec) return reject("equipment-conflict", "項目名稱與輸入的目前重量互相矛盾。");
	} else {
		if (hasMass) return reject("weight-not-applicable", "這個項目沒有可用的重量換算模型。");
		from = to = input.specificationMm ?? labelSpec;
		if (/跨欄|障礙/.test(event) && !(Number.isInteger(from) && from > 0)) return reject("equipment-required", "請提供來源明載的欄高，單位 mm。");
		if (!/跨欄|障礙/.test(event) && input.specificationMm != null) return reject("equipment-not-applicable", "這個項目不使用欄高。");
		if (input.specificationMm != null && labelSpec != null && from !== labelSpec) return reject("equipment-conflict", "項目名稱與輸入的欄高互相矛盾。");
	}
	const horizon = b - a;
	const mode = from !== to ? (horizon ? "joint" : "weight") : "age";
	if (mode === "age" && horizon === 0) return reject("no-change", "請指定未來年齡或不同的器材重量。");
	if (horizon > 3) return reject("horizon", "回測最長跨度為三個當年年齡。");
	const key = calibratedCellKey(mode, event, input.gender, from, to, a, horizon);
	const cell = artifact.models[key];
	if (!cell || !cell.ages.includes(a)) return reject("insufficient-evidence", "此項目、性別、規格、當年年齡及跨度沒有通過獨立回測。");
	if (input.mark < cell.anchorRange[0] || input.mark > cell.anchorRange[1]) return reject("out-of-range-mark", "已知成績超出該類別的訓練與區間校準成績共同範圍。");
	const start = { age: a, mass: from, value: input.mark };
	const end = { age: b, mass: to };
	const history = compatibleHistory(input, event, from);
	const estimate = predictFormula(cell.model, { start, end, history });
	if (!(estimate > 0) || !Number.isFinite(estimate)) return reject("out-of-range", "輸入超出模型能計算的範圍。");
	const { radius, nominal, observedCoverage, coverage95, calibrationN } = cell.interval;
	return {
		status: "ok",
		mode,
		event,
		unit: cell.unit,
		model: cell.model.form,
		modelVersion: version,
		estimate,
		interval: { low: Math.max(0, estimate - radius), high: estimate + radius, nominal, observedCoverage, coverage95, calibrationN },
		validation: cell.validation,
		applicability: {
			fromSpecification: from,
			toSpecification: to,
			ageBasis: "calendar-year",
			validatedStartAges: cell.ages,
			anchorRange: cell.anchorRange,
			currentCompletedAgeRange: [a - 1, a],
			targetCompletedAgeRange: [b - 1, b],
			horizon,
			historyMarksUsed: cell.model.form === "personal" && history.length >= 2 ? history.length : 0,
			anchorStatistic: mode === "weight" ? "賽會日中位數" : "全年賽會日成績的中位數",
			limitations: ["代表有公開、可連結的比賽紀錄之選手。", "跨年份測試覆蓋率是群體經驗值，個人預測仍有變異。"]
		}
	};
}
