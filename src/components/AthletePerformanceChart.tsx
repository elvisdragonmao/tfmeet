import { useEffect, useMemo, useState } from "react";
import { formatResult, groupStats } from "../analysis.mjs";
import { loadPredictionModel } from "../data";
import { athletePredictionSeasons } from "../prediction-history.mjs";
import { futureSeasonHorizons, maxForecastHorizon, predictPerformance } from "../prediction.mjs";
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
	const isIndividual = Boolean(event?.valid && !eventLabel?.endsWith("（全能分項）"));
	const seasons = useMemo(
		() => (isIndividual && event ? athletePredictionSeasons(athlete, event.name, event.unit, records).filter(season => season.year <= currentYear) : []),
		[athlete, currentYear, event, isIndividual, records]
	);
	const source = seasons[0];
	const canReachFuture = source && futureSeasonHorizons(source.year, currentYear).length > 0;
	useEffect(() => {
		if (!canReachFuture) return;
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
	}, [canReachFuture, retry]);

	const compatible = artifact?.dataset?.dataRulesVersion === dataRulesVersion;
	const outcomes = useMemo(() => {
		if (!source || !artifact || !compatible) return [];
		const prior = seasons.filter(season => season.year < source.year);
		return futureSeasonHorizons(source.year, currentYear).map(horizon => ({
			year: source.year + horizon,
			age: source.age + horizon,
			result: predictPerformance(artifact, {
				event: source.event,
				gender: source.gender,
				mark: source.mark,
				athleteId: athlete.id,
				currentYear: source.year,
				currentAge: source.age,
				targetAge: source.age + horizon,
				currentWeightKg: source.weightKg,
				specificationMm: source.specificationMm,
				history: prior
			})
		}));
	}, [artifact, athlete.id, compatible, currentYear, seasons, source]);
	const future = outcomes.flatMap(({ year, age, result }) => (result.status === "ok" ? [{ year, age, result }] : []));
	const stats = useMemo(() => groupStats(history, axis, event?.lowerIsBetter ?? true), [history, axis, event?.lowerIsBetter]);
	const actual = new Map(stats.map(point => [Number(point.key), point.best]));
	const forecastStart = source?.[axis];
	const projected = new Map<number, number>();
	if (source && future.length) {
		projected.set(source[axis], source.mark);
		for (const point of future) projected.set(point[axis], point.result.estimate);
	}
	const periods = [...new Set([...actual.keys(), ...projected.keys()])].sort((a, b) => a - b);
	const ticks = projected.size && periods.length ? Array.from({ length: periods.at(-1)! - periods[0] + 1 }, (_, i) => periods[0] + i) : periods;
	const unit = unitName(event?.unit ?? "s");
	const historicalName = axis === "year" ? "年度最佳成績" : "各年齡最佳成績";
	const forecastName = "未來成績預測";
	const chart = {
		grid: { left: 65, right: 28, top: 25, bottom: projected.size ? 62 : 45 },
		...(projected.size ? { legend: { data: [historicalName, forecastName], bottom: 8 } } : {}),
		xAxis: { type: "category", data: ticks.map(tick => `${tick}${axis === "age" ? " 歲" : ""}`), axisLine: { show: false }, axisTick: { show: false } },
		yAxis: { type: "value", scale: true, inverse: event?.lowerIsBetter, axisLabel: { formatter: (value: number) => formatResult(value, event?.unit) }, splitLine: { lineStyle: { color: "#edf0f5" } } },
		tooltip: { trigger: "axis", valueFormatter: (value: unknown) => formatResult(Number(value), event?.unit) },
		series: [
			{
				name: historicalName,
				type: "line",
				data: ticks.map(tick => actual.get(tick) ?? null),
				connectNulls: true,
				symbolSize: 9,
				lineStyle: { width: 3 },
				areaStyle: { color: "#edf2ff", opacity: 1 }
			},
			...(projected.size
				? [
						{
							name: forecastName,
							type: "line",
							connectNulls: true,
							symbolSize: 7,
							lineStyle: { type: "dashed", width: 2 },
							data: ticks.map(tick => {
								const value = projected.get(tick);
								return value === undefined ? null : tick === forecastStart ? { name: "基準賽季中位數", value } : value;
							})
						}
					]
				: [])
		]
	};

	let note = "";
	if (isIndividual) {
		if (!source) note = athlete.birthYear ? "缺少可用的賽季成績或來源明載的器材規格，無法推估未來成績。" : "缺少出生年，無法確認預測所需的當年年齡。";
		else if (!canReachFuture) note = `最近可用的賽季是 ${source.year} 年。模型的 ${maxForecastHorizon} 年跨度無法涵蓋 ${currentYear + 1} 年以後的賽季。`;
		else if (loadFailed) note = "無法載入成績預測模型。";
		else if (!artifact) note = "載入成績預測…";
		else if (!compatible) note = "目前的賽事資料與預測模型版本不一致。";
		else if (!future.length)
			note = outcomes.every(({ result }) => result.status === "unavailable" && result.reason === "out-of-range-mark") ? "基準成績超出回測範圍。" : "這個賽季的年齡與器材規格沒有通過回測的未來預測。";
	}

	return (
		<section className="panel">
			<div className="panel-heading">
				<h2>{eventLabel ? `${eventLabel}歷屆成績` : "歷屆成績"}</h2>
				<span>每{axis === "age" ? "個年齡" : "年"}最佳</span>
			</div>
			{stats.length ? (
				<Chart option={chart} height={330} label={`${athlete.name}${eventLabel ?? ""}歷屆成績${future.length ? "與未來虛線預測" : ""}`} />
			) : (
				<Empty>{axis === "age" ? "沒有可確認出生年的成績。" : "沒有有效的個人成績。"}</Empty>
			)}
			{future.length && source ? (
				<div className="athlete-forecast-notes">
					<p>
						虛線從 {source.year} 年賽季中位數 {formatResult(source.mark, event?.unit)} {unit} 起算。
					</p>
					<ul>
						{future.map(({ year, age, result }) => (
							<li key={year}>
								<strong>
									{year} 年（{age} 歲）預測 {formatResult(result.estimate, result.unit)} {unit}
								</strong>
								<span>
									{(100 * result.interval.nominal).toFixed(0)}% 預測區間 {formatResult(result.interval.low, result.unit)}–{formatResult(result.interval.high, result.unit)} {unit} · 回測{" "}
									{result.validation.testN} 人 · 平均絕對誤差 {formatResult(result.validation.mae, result.unit)} {unit} · 實測覆蓋 {(100 * result.interval.observedCoverage).toFixed(1)}%
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
