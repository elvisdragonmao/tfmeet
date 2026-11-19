import { useEffect, useMemo, useState } from "react";
import { formatResult } from "../analysis.mjs";
import { loadPredictionModel } from "../data";
import { specificationLabel } from "../events.mjs";
import { athletePredictionSeasons } from "../prediction-history.mjs";
import type { AthletePredictionSeason } from "../prediction-history.mjs";
import { predictPerformance } from "../prediction.mjs";
import type { PredictionArtifact } from "../prediction.mjs";
import type { Athlete, EventInfo, Result } from "../types";
import { ErrorNotice, Loading, unitName } from "./Shared";

const horizons = [1, 2, 3];
const specification = (season: AthletePredictionSeason) => season.specificationMm ?? (season.weightKg === undefined ? null : Math.round(season.weightKg * 1000));
const seasonKey = (season: AthletePredictionSeason) => `${season.year}:${specification(season) ?? ""}`;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export default function AthleteForecast({
	athlete,
	eventLabel,
	event,
	records,
	dataRulesVersion
}: {
	athlete: Athlete;
	eventLabel: string | undefined;
	event: EventInfo | undefined;
	records: Result[];
	dataRulesVersion: number | undefined;
}) {
	const [selectedSeason, setSelectedSeason] = useState("");
	const [artifact, setArtifact] = useState<PredictionArtifact | null>(null);
	const [error, setError] = useState("");
	const [retry, setRetry] = useState(0);
	const isIndividual = Boolean(event && event.valid && !eventLabel?.endsWith("（全能分項）"));
	const seasons = useMemo(() => (isIndividual && event ? athletePredictionSeasons(athlete, event.name, event.unit, records) : []), [athlete, event, isIndividual, records]);
	const hasSeasons = seasons.length > 0;
	useEffect(() => {
		if (!hasSeasons) return;
		let active = true;
		setError("");
		loadPredictionModel()
			.then(model => {
				if (active) setArtifact(model);
			})
			.catch(() => {
				if (active) setError("無法載入成績預測模型。");
			});
		return () => {
			active = false;
		};
	}, [hasSeasons, retry]);

	const compatible = artifact && artifact.dataset?.dataRulesVersion === dataRulesVersion;
	const forecasts = useMemo(
		() =>
			compatible
				? seasons.map(season => ({
						season,
						outcomes: horizons.map(horizon => {
							const year = season.year + horizon;
							const result = predictPerformance(artifact, {
								event: season.event,
								gender: season.gender,
								mark: season.mark,
								athleteId: athlete.id,
								currentYear: season.year,
								currentAge: season.age,
								targetAge: season.age + horizon,
								currentWeightKg: season.weightKg,
								specificationMm: season.specificationMm,
								history: seasons.filter(candidate => candidate.year < season.year)
							});
							const actual = seasons.find(candidate => candidate.year === year && specification(candidate) === specification(season));
							return { year, age: season.age + horizon, result, actual };
						})
					}))
				: [],
		[compatible, artifact, athlete.id, seasons]
	);
	const selected = forecasts.find(entry => seasonKey(entry.season) === selectedSeason) ?? forecasts.find(entry => entry.outcomes.some(({ result }) => result.status === "ok")) ?? forecasts[0];
	const source = selected?.season;
	const hasForecast = selected?.outcomes.some(({ result }) => result.status === "ok");
	const unit = unitName(event?.unit ?? "s");
	const noSeason = !isIndividual
		? "這個分析項目目前沒有個人成績預測。"
		: !athlete.birthYear
			? "缺少出生年，無法確認基準賽季的當年年齡。"
			: "缺少可用的基準賽季。預測需要能連結到此身分的有效成績、比賽日期和來源明載的器材規格（如適用）。";

	return (
		<section className="panel athlete-forecast" aria-labelledby="athlete-forecast-heading">
			<div className="panel-heading">
				<div>
					<h2 id="athlete-forecast-heading">成績預測</h2>
					{eventLabel ? <p>{eventLabel}</p> : null}
				</div>
			</div>
			<div className="athlete-forecast-body">
				{!hasSeasons ? (
					<p className="forecast-status">{noSeason}</p>
				) : error ? (
					<ErrorNotice error={error} retry={() => setRetry(value => value + 1)} />
				) : !artifact ? (
					<Loading label="載入預測模型…" />
				) : !compatible ? (
					<p className="forecast-status">目前的賽事資料與預測模型版本不一致。</p>
				) : source ? (
					<>
						<label className="forecast-season">
							基準賽季
							<select className="select" value={seasonKey(source)} onChange={e => setSelectedSeason(e.target.value)}>
								{seasons.map(season => {
									const size = specification(season);
									return (
										<option key={seasonKey(season)} value={seasonKey(season)}>
											{season.year} 年 · {season.age} 歲{size !== null ? ` · ${specificationLabel(season.event, size)}` : ""}
										</option>
									);
								})}
							</select>
						</label>
						<p className="forecast-status">
							依所選賽季的成績中位數{" "}
							<strong>
								{formatResult(source.mark, event?.unit)} {unit}
							</strong>
							（{source.meetDays} 個賽會日）推估。年齡按比賽年減出生年，足歲可能少一歲。
						</p>
						{hasForecast ? (
							<ul className="forecast-grid">
								{selected.outcomes.map(({ year, age, result, actual }) => (
									<li key={year} className="forecast-result">
										<h3>
											{year} 年 · {age} 歲
										</h3>
										{result.status === "ok" ? (
											<>
												<p>
													<strong>{formatResult(result.estimate, result.unit)}</strong> {unit}
												</p>
												<p>
													預測區間 {formatResult(result.interval.low, result.unit)}–{formatResult(result.interval.high, result.unit)} {unit}
												</p>
												<p>
													回測 {result.validation.testN} 人 · 覆蓋 {percent(result.interval.observedCoverage)}
												</p>
												{result.applicability.historyMarksUsed > 0 ? <p>使用 {result.applicability.historyMarksUsed} 個較早賽季校正</p> : result.model === "carry" ? <p>沿用基準成績</p> : null}
												{actual ? (
													<p>
														實際賽季中位數 {formatResult(actual.mark, result.unit)} {unit}
													</p>
												) : null}
											</>
										) : (
											<p>{result.reason === "out-of-range-mark" ? "基準成績超出驗證範圍" : "資料不足"}</p>
										)}
									</li>
								))}
							</ul>
						) : (
							<p className="forecast-status">
								{selected.outcomes.every(({ result }) => result.status === "unavailable" && result.reason === "out-of-range-mark")
									? "基準成績超出驗證範圍。"
									: "這個基準賽季的年齡、項目或器材規格沒有可用的預測。"}
								{seasons.length > 1 ? "可切換基準賽季查看。" : ""}
							</p>
						)}
					</>
				) : null}
			</div>
		</section>
	);
}
