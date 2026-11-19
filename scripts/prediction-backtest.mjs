import { createHash } from "node:crypto";
import { writeFile, rename } from "node:fs/promises";
import { calibratedCellKey, predictPerformance, predictionSchemaVersion } from "../src/prediction.mjs";
import { writeQualityReport } from "./prediction-audit.mjs";
import { groupBy, loadPredictionData } from "./prediction-data.mjs";
import { fitSnapshot, nominalCoverage, splitPairs, thresholds } from "./prediction-fit.mjs";

const reports = new URL("../reports/", import.meta.url);
const artifactPath = new URL("../public/prediction-model.json", import.meta.url);
const percent = n => (Number.isFinite(n) ? `${(100 * n).toFixed(1)}%` : "—");
const mark = n => (Number.isFinite(n) ? n.toFixed(3) : "—");
const showSpec = n => n ?? "—";
const markdown = (columns, rows) => [columns, columns.map(() => "---"), ...rows].map(row => `| ${row.join(" | ")} |`).join("\n");
const csv = (columns, rows) => [columns, ...rows].map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n") + "\n";

const dataset = await loadPredictionData();
await writeQualityReport(dataset);
console.log(`Audited ${dataset.events.length} event/gender groups from ${dataset.manifest.recordCount} snapshot rows.`);
const { calendar, models, cells, coefficients, sensitivity } = fitSnapshot(dataset);
const modelDigest = createHash("sha256")
	.update(JSON.stringify([dataset.fingerprint, calendar, thresholds, models]))
	.digest("hex");
const modelVersion = `tfmeet-p${predictionSchemaVersion}-${modelDigest.slice(0, 16)}`;
const artifact = {
	schemaVersion: predictionSchemaVersion,
	modelVersion,
	dataset: {
		updatedAt: dataset.manifest.updatedAt,
		dataRulesVersion: dataset.manifest.dataRulesVersion,
		fingerprint: dataset.fingerprint,
		yearFrom: Math.min(...dataset.manifest.meets.map(m => m.year)),
		yearThrough: calendar.trainEnd
	},
	calendar,
	thresholds,
	models
};

const accepted = cells.filter(c => c.model);
const summary = ["weight", "age", "joint"].map(mode => [mode, cells.filter(c => c.mode === mode).length, accepted.filter(c => c.mode === mode).length]);
const primary = coefficients.filter(c => c.mode === "weight");
const weights = primary.map(c => {
	const group = cells.filter(r => r.mode === "weight" && r.event === c.event && r.gender === c.gender);
	return [
		c.event,
		c.gender,
		c.pairs,
		c.athletes,
		mark(c.candidates.find(m => m.form === "power")?.k),
		mark(c.candidates.find(m => m.form === "inverse")?.q),
		group.length,
		group.filter(r => r.model).length
	];
});
const ageRows = [
	...groupBy(
		accepted.filter(c => c.mode === "age"),
		c => `${c.event}|${c.gender}|${c.unit}`
	).values()
].map(group => {
	const chosen = [...new Set(group.map(row => row.selected))].join(", ");
	return [
		group[0].event,
		group[0].gender,
		group[0].unit,
		group.length,
		chosen,
		mark(Math.min(...group.map(c => c.test.mae))),
		mark(Math.max(...group.map(c => c.test.mae))),
		percent(Math.min(...group.map(c => c.test.coverage))),
		percent(Math.max(...group.map(c => c.test.coverage)))
	];
});
const examples = accepted
	.filter(c => ["60M", "100M", "鉛球", "鐵餅", "標槍"].includes(c.event))
	.slice(0, 32)
	.map(c => [
		c.mode,
		c.event,
		c.gender,
		showSpec(c.start),
		c.model.ages.join(", "),
		c.horizon,
		c.selected,
		c.test.n,
		mark(c.test.mae),
		mark(c.baseline.mae),
		mark(c.test.rmse),
		percent(c.test.mape),
		percent(c.test.coverage)
	]);
const rejectReasons = [
	...groupBy(
		cells.filter(c => c.reason),
		c => c.reason
	).entries()
].map(([reason, rows]) => [reason, ...["weight", "age", "joint"].map(mode => rows.filter(c => c.mode === mode).length)]);
const total = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0);
const trainingSources = [...groupBy(cells, c => c.mode).entries()].map(([mode, rows]) => [
	mode,
	...["train", "tune", "calibration", "test"].map(split => rows.reduce((sum, c) => sum + c.rawCounts[split], 0))
]);
const sensitivitySummary = sensitivity.length
	? `共 ${sensitivity.length} 個年齡層分組以同一批留出配對重算年度最佳。共 ${total(sensitivity, "multipleMeetDays")} 個分組內配對的兩端都至少有兩個賽會日。年度最佳更受出賽頻率影響，分別列出年度中位數與年度最佳的「沿用成績」MAE 作敏感度檢查。分組可能有同一選手重複出現。`
	: "沒有已通過的年齡模型可進行年度最佳敏感度檢查。";
const exampleKey = calibratedCellKey("age", "100M", "M", null, null, 15, 1);
const exampleModel = models[exampleKey];
const exampleEvent = dataset.events.find(event => event.name === "100M" && event.gender === "M");
const exampleRows = exampleEvent?.pairs.age.filter(p => calibratedCellKey("age", "100M", "M", null, null, p.start.age, p.horizon) === exampleKey) ?? [];
const observed = exampleModel && splitPairs(exampleRows, calendar).test.find(p => p.start.age === 15 && p.start.value >= exampleModel.anchorRange[0] && p.start.value <= exampleModel.anchorRange[1]);
const exampleResult = observed && predictPerformance(artifact, { event: "100M", gender: "M", mark: observed.start.value, currentAge: 15, targetAge: 16 });
const heldOutExample =
	exampleResult?.status === "ok"
		? `留出集的匿名實例為男子 100M，${observed.start.year} 年當年 15 歲，賽季中位數 ${mark(observed.start.value)} 秒。僅給模型這筆已知成績，預測 ${observed.end.year} 年當年 16 歲為 ${mark(exampleResult.estimate)} 秒，區間 ${mark(exampleResult.interval.low)}–${mark(exampleResult.interval.high)} 秒。實際留出成績為 ${mark(observed.end.value)} 秒。`
		: "";

const report = `# 田徑成績預測回測

模型版本 \`${modelVersion}\`。資料及排除條件見[品質報告](prediction-data.md)。完整分層、基準與候選模型見[回測 CSV](prediction-backtest.csv)，其單位是秒或公尺。各候選的擬合係數、樣條節點與對數曲線值見[係數 JSON](prediction-coefficients.json)，實際可用的模型見[模型檔](../public/prediction-model.json)。

${markdown(["預測類型", "回測分組", "通過分組"], summary)}

## 切分與評估

- 以目標年度分割時間，訓練至 ${calendar.trainEnd}，選模為 ${calendar.trainEnd + 1}，區間校準為 ${calendar.calibrationEnd}，最終測試為 ${calendar.calibrationEnd + 1}–${calendar.testEnd}。最後有資料的年度排除，避免不完整賽季。
- 額外依正規化姓名、性別、出生年的雜湊桶切分，同一候選選手的標籤只會在一個切分中使用。選模、校準、測試各分組每人只取最早一個目標；擬合中每人總權重一致。個人歷史只用基準年度之前的同規格成績。現有選手 ID 是整份快照回溯推導，仍有誤合或漏合的可能。
- 選模依選模集 MAE。正式分組至少需要訓練 ${thresholds.train} 人、選模 ${thresholds.tune} 人、校準 ${thresholds.calibration} 人、測試 ${thresholds.test} 人。起始成績限制在訓練與校準觀測共同範圍，年齡須在訓練、校準與留出資料有紀錄。分組需在測試集不劣於沿用成績，且名目 ${percent(nominalCoverage)} 區間的實測覆蓋率至少 ${percent(thresholds.minimumCoverage)}。這是公開模型的最低門檻；整個資料庫的選樣與制度差異仍然存在。
- 區間以獨立校準組的絕對誤差次序統計量為半寬，使用原成績單位。較長年齡跨度另採同組短期校準半寬乘以跨度比的平方根作保守下限，再在留出集檢查覆蓋率。跨年度分布可能改變，覆蓋率是留出集的經驗估計。模型檔另保留覆蓋率的 Wilson 95% 區間。[Lei 等人的 split conformal regression](https://arxiv.org/abs/1604.04173)
- MAE/RMSE 是原成績單位；MAPE 為絕對誤差除以實際成績的均值。各分組的筆數不可相加當成唯一選手。未達門檻的候選比較屬探索性，不能當作可使用的換算係數。

${markdown(["類型", "訓練人次", "選模人次", "校準人次", "測試人次"], trainingSources)}

${markdown(["未通過原因", "重量", "年齡", "聯合"], rejectReasons)}

## 重量模型

每項目／性別以同一人在 90 日內同一當年年齡的代表成績擬合，並依公克方向及起始年齡層驗證。每個賽會日取中位數。比較沿用成績、對數無截距冪次迴歸及相對反比迴歸。反比式固定通過已知成績，\`D₂ = D₁ × [1 + q(m₁/m₂ − 1)]\` 對應 \`a = qD₁m₁\`、\`b = (1−q)D₁\`。5% 以下重量差列在品質報告，排除於跨重量擬合，避免 2.72/2.73 kg 的來源寫法主導模型。

${markdown(["項目", "性別", "擬合配對", "擬合人數", "冪次 k", "反比 q", "回測分組", "通過"], weights)}

重量與年齡組常一起變，切分後同齡重疊不足時會拒絕。即使有同齡配對，競賽選擇和訓練變化仍可能改變觀察到的關係。

## 年齡模型

比較沿用成績、橫斷面參考曲線比例、同一人在不同年度的對數差值樣條，以及樣條加個人趨勢回縮。曲線是固定節點的線性樣條，對相鄰斜率變化加懲罰，可容許停滯或退步。個人模型至少需要基準年以前的兩筆同規格年度成績，對歷史殘差加上三年等效權重回縮。以一到三個當年年齡為跨度，規格、性別和起始年齡層各自驗證。

${markdown(["項目", "性別", "單位", "通過分組", "選擇的方法", "MAE 最小", "MAE 最大", "覆蓋率最低", "覆蓋率最高"], ageRows)}

以下列出部分關注項目，所有分組可在 CSV 查閱。

${markdown(["模式", "項目", "性別", "規格", "起始當年年齡", "跨度", "模型", "測試人數", "MAE", "基準 MAE", "RMSE", "MAPE", "覆蓋率"], examples)}

${heldOutExample}

${sensitivitySummary} [年度最佳敏感度 CSV](prediction-season-sensitivity.csv)。

## 聯合預測

使用同選手跨年且換重量的配對。比較沿用成績、只套用年齡曲線、只套用重量曲線與先年齡後重量的組合。兩個子模型及組合都須通過回測才會開放。組合以較晚年齡的同齡重量轉換為參照，另用聯合配對校準區間。即使配對多也只能觀察同時變動，無法直接從它們拆出重量和成長各自的影響。
`;

await writeFile(new URL("prediction-backtest.md", reports), report);
await writeFile(
	new URL("prediction-backtest.csv", reports),
	csv(
		[
			"mode",
			"event",
			"gender",
			"unit",
			"spec_from",
			"spec_to",
			"age_band_start",
			"horizon",
			"candidate",
			"selected",
			"status",
			"diagnostic_unrestricted",
			"training_athletes",
			"tune_athletes",
			"calibration_athletes",
			"test_athletes",
			"tested_ages",
			"tune_mae",
			"test_n",
			"mae",
			"rmse",
			"mape",
			"coverage",
			"interval_half_width"
		],
		cells.flatMap(c =>
			c.metrics.map(result => {
				const n = c.diagnostic ? c.rawCounts : c.counts;
				return [
					c.mode,
					c.event,
					c.gender,
					c.unit,
					c.start,
					c.end,
					c.ageBand,
					c.horizon,
					result.model.form,
					result.model.form === c.selected,
					c.reason ?? "validated",
					c.diagnostic,
					n.train,
					n.tune,
					n.calibration,
					n.test,
					(c.model?.ages ?? c.ages).join(";"),
					result.tune.mae,
					result.test.n,
					result.test.mae,
					result.test.rmse,
					result.test.mape,
					result.test.coverage,
					result.radius
				];
			})
		)
	)
);
await writeFile(new URL("prediction-coefficients.json", reports), JSON.stringify({ modelVersion, calendar, coefficients }, null, 2) + "\n");
await writeFile(
	new URL("prediction-season-sensitivity.csv", reports),
	csv(
		["cell", "n", "multiple_meet_days", "median_target_shift_percent", "median_carry_mae", "best_carry_mae"],
		sensitivity.map(r => [r.key, r.n, r.multipleMeetDays, r.changeInTarget, r.medianCarryMae, r.bestCarryMae])
	)
);
const temporary = new URL(artifactPath.href + ".tmp");
await writeFile(temporary, JSON.stringify(artifact) + "\n");
await rename(temporary, artifactPath);
console.log(`Wrote ${modelVersion}. Validated groups: ${summary.map(([mode, , n]) => `${mode}=${n}`).join(", ")}.`);
