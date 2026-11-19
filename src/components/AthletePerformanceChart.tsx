import { useEffect, useMemo, useState } from "react";
import { formatResult, groupStats } from "../analysis.mjs";
import { loadPredictionModel } from "../data";
import { athletePredictionSeasons, missingSeasonTargets } from "../prediction-history.mjs";
import { maxForecastHorizon, predictPerformance } from "../prediction.mjs";
import type { PredictionArtifact } from "../prediction.mjs";
import type { Athlete, EventInfo, Result } from "../types";
import Chart from "./Chart";
import { Empty, unitName } from "./Shared";

const yearInTaiwan = new Intl.DateTimeFormat("en", { timeZone: "Asia/Taipei", year: "numeric" });

export default function AthletePerformanceChart({
	athlete,
	eventLabel,
	event,
	records,
	history,
	axis,
	dataRulesVersion
}: {
	athlete: Athlete;
	eventLabel: string | undefined;
	event: EventInfo | undefined;
	records: Result[];
	history: Result[];
	axis: "age" | "year";
	dataRulesVersion: number | undefined;
}) {
	const [artifact, setArtifact] = useState<PredictionArtifact | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [retry, setRetry] = useState(0);
	const currentYear = Number(yearInTaiwan.format(new Date()));
	const relay = event?.kind === "relay";
	const isIndividual = Boolean(event?.valid && !relay && !eventLabel?.endsWith("（全能分項）"));
	const seasons = useMemo(
		() => (isIndividual && event ? athletePredictionSeasons(athlete, event.name, event.unit, records).filter(season => season.year <= currentYear) : []),
		[athlete, currentYear, event, isIndividual, records]
	);
	const source = seasons[0];
	const targets = useMemo(
		() =>
			missingSeasonTargets(
				history.map(record => record.year),
				seasons,
				currentYear
			),
		[history, seasons, currentYear]
	);
	const hasTargets = targets.length > 0;
	useEffect(() => {
		if (!hasTargets) return;
		let active = true;
		setLoadFailed(false);
		loadPredictionModel()
			.then(model => {
				if (active) setArtifact(model);
			})
			.catch(() => {
				if (active) setLoadFailed(true);
			});
		return () => {
			active = false;
		};
	}, [hasTargets, retry]);

	const compatible = artifact?.dataset?.dataRulesVersion === dataRulesVersion;
	const outcomes = useMemo(() => {
		if (!artifact || !compatible) return [];
		return targets.map(target => {
			const { year, source } = target;
			const age = source.age + year - source.year;
			const result = predictPerformance(artifact, {
				event: source.event,
				gender: source.gender,
				mark: source.mark,
				athleteId: athlete.id,
				currentYear: source.year,
				currentAge: source.age,
				targetAge: age,
				currentWeightKg: source.weightKg,
				specificationMm: source.specificationMm,
				history: seasons.filter(season => season.year < source.year)
			});
			return { ...target, age, result };
		});
	}, [artifact, athlete.id, compatible, seasons, targets]);
	const stats = useMemo(() => groupStats(history, axis, event?.lowerIsBetter ?? true), [history, axis, event?.lowerIsBetter]);
	const actual = new Map(stats.map(point => [Number(point.key), point.best]));
	const estimates = outcomes.flatMap(outcome => (outcome.result.status === "ok" && !actual.has(outcome[axis]) ? [{ ...outcome, result: outcome.result }] : []));
	const segments = new Map<string, Map<number, number | { name: string; value: number }>>();
	for (const point of estimates) {
		const key = `${point.precedingYear}:${point.source.year}`;
		if (!segments.has(key)) {
			const segment = new Map<number, number | { name: string; value: number }>();
			if (point.precedingYear === point.source.year) segment.set(point.source[axis], { name: "基準賽季中位數", value: point.source.mark });
			segments.set(key, segment);
		}
		segments.get(key)!.set(point[axis], point.result.estimate);
	}
	const start = Math.min(...actual.keys(), ...estimates.map(point => point[axis]));
	const end = Math.max(...actual.keys(), ...estimates.map(point => point[axis]));
	const ticks = Number.isFinite(start) ? Array.from({ length: end - start + 1 }, (_, i) => start + i) : [];
	const unit = unitName(event?.unit ?? "s");
	const historicalName = `${axis === "year" ? "年度" : "各年齡"}最佳${relay ? "隊伍" : ""}成績`;
	const forecastName = "成績推估";
	const chart = {
		grid: { left: 65, right: 28, top: 25, bottom: segments.size ? 62 : 45 },
		...(segments.size ? { legend: { data: [historicalName, forecastName], bottom: 8 } } : {}),
		xAxis: { type: "category", data: ticks.map(tick => `${tick}${axis === "age" ? " 歲" : ""}`), axisLine: { show: false }, axisTick: { show: false } },
		yAxis: { type: "value", scale: true, inverse: event?.lowerIsBetter, axisLabel: { formatter: (value: number) => formatResult(value, event?.unit) }, splitLine: { lineStyle: { color: "#edf0f5" } } },
		tooltip: { trigger: "axis", valueFormatter: (value: unknown) => formatResult(Number(value), event?.unit) },
		series: [
			{
				name: historicalName,
				type: "line",
				data: ticks.map(tick => actual.get(tick) ?? null),
				connectNulls: false,
				symbolSize: 9,
				lineStyle: { width: 3 },
				areaStyle: { color: "#edf2ff", opacity: 1 }
			},
			...[...segments.values()].map(segment => ({
				name: forecastName,
				type: "line",
				connectNulls: true,
				symbolSize: 7,
				itemStyle: { color: "#b96823" },
				lineStyle: { type: "dashed", width: 2, color: "#b96823" },
				data: ticks.map(tick => segment.get(tick) ?? null)
			}))
		]
	};

	let note = "";
	if (isIndividual) {
		if (!source) note = athlete.birthYear ? "缺少可用的賽季成績或來源明載的器材規格，無法推估成績。" : "缺少出生年，無法確認預測所需的當年年齡。";
		else if (!hasTargets) note = `最近可用的賽季是 ${source.year} 年。可推估的空白賽季須落在有效基準賽季後 ${maxForecastHorizon} 年內。`;
		else if (loadFailed) note = "無法載入成績預測模型。";
		else if (!artifact) note = "載入成績預測…";
		else if (!compatible) note = "目前的賽事資料與預測模型版本不一致。";
		else if (!estimates.length)
			note = outcomes.every(({ result }) => result.status === "unavailable" && result.reason === "out-of-range-mark") ? "基準成績超出回測範圍。" : "這個賽季的年齡與器材規格沒有通過回測的成績推估。";
	}

	return (
		<section className="panel">
			<div className="panel-heading">
				<h2>{eventLabel ? `${eventLabel}歷屆成績` : "歷屆成績"}</h2>
				<span>
					每{axis === "age" ? "個年齡" : "年"}最佳{relay ? "隊伍成績" : ""}
				</span>
			</div>
			{stats.length ? (
				<Chart option={chart} height={330} label={`${athlete.name}${eventLabel ?? ""}歷屆成績${estimates.length ? "與虛線推估" : ""}`} />
			) : (
				<Empty>{axis === "age" ? "沒有可確認出生年的成績。" : relay ? "沒有可繪圖的隊伍成績。" : "沒有有效的個人成績。"}</Empty>
			)}
			{estimates.length ? (
				<div className="athlete-forecast-notes">
					<p>虛線顯示沒有實際成績的賽季，依該年前最近的有效賽季中位數推估。</p>
					<ul>
						{estimates.map(({ year, age, source: baseline, result }) => (
							<li key={year}>
								<strong>
									{year} 年（{age} 歲）{year < currentYear ? "缺年推估" : year === currentYear ? "今年預測" : "預測"} {formatResult(result.estimate, result.unit)} {unit}
								</strong>
								<span>
									基準 {baseline.year} 年 · {(100 * result.interval.nominal).toFixed(0)}% 預測區間 {formatResult(result.interval.low, result.unit)}–{formatResult(result.interval.high, result.unit)}{" "}
									{unit} · 回測 {result.validation.testN} 人 · 平均絕對誤差 {formatResult(result.validation.mae, result.unit)} {unit} · 實測覆蓋 {(100 * result.interval.observedCoverage).toFixed(1)}%
								</span>
							</li>
						))}
					</ul>
				</div>
			) : note ? (
				<p className="athlete-forecast-notes">
					{note}
					{loadFailed ? (
						<button type="button" className="btn btn-sm btn-ghost" onClick={() => setRetry(value => value + 1)}>
							重試
						</button>
					) : null}
				</p>
			) : null}
		</section>
	);
}
