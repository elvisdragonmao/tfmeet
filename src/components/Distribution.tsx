import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ArrowUpRightIcon, TargetIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { bestPerAthlete, formatResult, groupStats, parseInput, standing, quantile } from "../analysis.mjs";
import type { EventData, Manifest, Result } from "../types";
import { Loading, NoResults, number, ResultsTable, Stat, unitName } from "./Shared";
const Chart = lazy(() => import("./Chart"));
export default function Distribution({ rows, data, manifest, onAthlete }: { rows: Result[]; data: EventData; manifest: Manifest; onAthlete: (id: string) => void }) {
	const [score, setScore] = useState(new URLSearchParams(location.search).get("score") || "");
	const [allAttempts, setAllAttempts] = useState(new URLSearchParams(location.search).get("attempts") === "all");
	useEffect(() => {
		const q = new URLSearchParams(location.search);
		if (score) q.set("score", score);
		else q.delete("score");
		if (allAttempts) q.set("attempts", "all");
		else q.delete("attempts");
		history.replaceState(null, "", `?${q}`);
	}, [score, allAttempts]);
	const cohort = useMemo(() => (allAttempts ? rows : bestPerAthlete(rows, data.lowerIsBetter)), [rows, allAttempts, data.lowerIsBetter]);
	const sorted = useMemo(() => [...cohort].sort((a, b) => (data.lowerIsBetter ? a.value! - b.value! : b.value! - a.value!)), [cohort, data.lowerIsBetter]);
	const values = cohort.map(r => r.value!);
	let min = Infinity,
		max = -Infinity;
	for (const value of values) {
		if (value < min) min = value;
		if (value > max) max = value;
	}
	const marks = useMemo(() => sorted.map(r => r.value!), [sorted]);
	const percentiles = useMemo(() => Object.fromEntries([1, 10, 25, 50].map(p => [p, quantile(marks, p / 100)])), [marks]);
	const med = percentiles[50],
		top10 = percentiles[10];
	const input = parseInput(score, data.unit);
	const validInput = input !== null && Number.isFinite(input) && input > 0;
	const rank = validInput ? standing(cohort, input, data.lowerIsBetter) : null;
	const bins = 24;
	const step = (max - min || 1) / bins;
	const counts = Array.from({ length: bins }, () => 0);
	if (cohort.length) for (const v of values) counts[Math.min(bins - 1, Math.floor((v - min) / step))]++;
	const histogram = useMemo(
		() => ({
			xAxis: {
				type: "category",
				data: counts.map((_, i) => formatResult(min + (i + 0.5) * step, data.unit)),
				axisLabel: { interval: Math.max(1, Math.floor(bins / 6)), color: "#7b8496" },
				axisTick: { show: false },
				axisLine: { lineStyle: { color: "#e3e7ef" } },
				name: unitName(data.unit),
				nameLocation: "end"
			},
			yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: "#edf0f5" } }, name: allAttempts ? "出賽次數" : "選手人數", nameTextStyle: { align: "left" } },
			tooltip: { trigger: "axis", valueFormatter: (n: unknown) => `${n} ${allAttempts ? "次" : "人"}` },
			series: [
				{
					type: "bar",
					data: counts.map((n, i) => ({
						value: n,
						itemStyle: { color: top10 !== null && (data.lowerIsBetter ? min + i * step <= top10 : min + (i + 1) * step >= top10) ? "#315fdf" : "#b7c9fa", borderRadius: [4, 4, 0, 0] }
					})),
					barCategoryGap: "12%",
					emphasis: { itemStyle: { color: "#315fdf" } }
				}
			]
		}),
		[cohort, allAttempts, data.unit, data.lowerIsBetter, top10, min, max]
	);
	const years = useMemo(() => groupStats(rows, "year", data.lowerIsBetter), [rows, data.lowerIsBetter]);
	const yearly = useMemo(
		() => ({
			tooltip: { trigger: "axis", valueFormatter: (v: unknown) => formatResult(Number(v), data.unit) },
			grid: { left: 55, right: 20, top: 35, bottom: 42 },
			legend: { data: ["中位數", "前 10% 門檻"], right: 0, top: 0, icon: "circle", itemWidth: 8 },
			xAxis: { type: "category", data: years.map(g => String(g.key)), axisLine: { show: false }, axisTick: { show: false } },
			yAxis: { type: "value", scale: true, inverse: data.lowerIsBetter, axisLabel: { formatter: (v: number) => formatResult(v, data.unit) }, splitLine: { lineStyle: { color: "#edf0f5" } } },
			series: [
				{ name: "中位數", type: "line", data: years.map(g => g.median), smooth: false, symbolSize: 6, lineStyle: { width: 3 } },
				{ name: "前 10% 門檻", type: "line", data: years.map(g => g.top10), symbolSize: 5, lineStyle: { width: 2, type: "dashed" }, itemStyle: { color: "#7995c9" } }
			]
		}),
		[years, data.unit, data.lowerIsBetter]
	);
	if (!cohort.length) return <NoResults />;
	return (
		<>
			{cohort.length < 20 ? <div className="context-note">目前只有 {cohort.length} 個比較樣本，百分位容易受到單一成績影響。</div> : null}
			<div className="stats-grid">
				<Stat label="比較樣本" value={number(cohort.length)} unit={allAttempts ? "次" : "人"} detail={allAttempts ? "每次出賽各計一次" : "每位候選選手取最佳成績"} />
				<Stat label="中位數" value={formatResult(med, data.unit)} unit={unitName(data.unit)} detail="50% 選手的成績門檻" />
				<Stat label="前 10% 門檻" value={formatResult(top10, data.unit)} unit={unitName(data.unit)} detail="依目前篩選條件計算" />
				<Stat label="最佳成績" value={formatResult(sorted[0]?.value, data.unit)} unit={unitName(data.unit)} detail={`${sorted[0]?.name} · ${sorted[0]?.year}`} />
			</div>
			<div className="distribution-grid">
				<section className="panel distribution-panel">
					<div className="panel-heading">
						<div>
							<h2>成績分布</h2>
							<p>
								{data.name} · {allAttempts ? "所有出賽" : "選手最佳成績"}
							</p>
						</div>
						<label className="check-label">
							<input className="checkbox checkbox-xs" type="checkbox" checked={allAttempts} onChange={e => setAllAttempts(e.target.checked)} />
							計入重複出賽
						</label>
					</div>
					<Suspense fallback={<Loading />}>
						<Chart option={histogram} label={`${data.name}成績分布直方圖，${cohort.length}個樣本`} />
					</Suspense>
					<div className="chart-caption">
						<span>
							<i className="legend-dot" />前 10% 成績區間
						</span>
						<span>
							{formatResult(min, data.unit)} — {formatResult(max, data.unit)} {unitName(data.unit)}
						</span>
					</div>
				</section>
				<section className="panel score-panel">
					<div className="panel-heading">
						<h2>
							<TargetIcon size={21} />
							我的成績在哪裡
						</h2>
					</div>
					<label className="score-label" htmlFor="score">
						輸入成績{data.unit === "s" ? "（秒或 分:秒）" : `（${unitName(data.unit)}）`}
					</label>
					<div className="score-input">
						<input id="score" inputMode={data.unit === "s" ? "text" : "decimal"} autoComplete="off" placeholder={formatResult(med, data.unit)} value={score} onChange={e => setScore(e.target.value)} />
						<span>{unitName(data.unit)}</span>
					</div>
					{score.trim() && !validInput ? <p className="field-error">請輸入有效的正數成績。</p> : null}
					<div className="rank-display">
						{rank ? (
							<>
								<span>在目前樣本中約為</span>
								<strong>
									前 {rank.topPercent < 0.1 ? "< 0.1" : rank.topPercent.toFixed(1)}
									<em>%</em>
								</strong>
								<span>
									優於 {rank.beatsPercent.toFixed(1)}% 的{allAttempts ? "出賽成績" : "選手"}
								</span>
							</>
						) : (
							<>
								<UsersThreeIcon size={30} weight="light" />
								<span>
									與 {number(cohort.length)} {allAttempts ? "筆成績" : "位選手"}比較
								</span>
							</>
						)}
					</div>
					<div className="percentile-list">
						{[1, 10, 25, 50].map(p => (
							<div key={p}>
								<span>前 {p}%</span>
								<strong>
									{formatResult(percentiles[p], data.unit)} <em>{unitName(data.unit)}</em>
								</strong>
							</div>
						))}
					</div>
					<div className="score-note">同成績採同排名；此比較不代表全人口常模。</div>
				</section>
			</div>
			<div className="secondary-grid">
				<section className="panel">
					<div className="panel-heading">
						<h2>歷年成績趨勢</h2>
						<span className="badge badge-ghost">每年各取個人最佳</span>
					</div>
					{years.length > 1 ? (
						<Suspense fallback={<Loading />}>
							<Chart option={yearly} height={260} label="歷年成績中位數及前百分之十門檻" />
						</Suspense>
					) : (
						<div className="empty">目前條件只有一個年份，請擴大年份範圍。</div>
					)}
				</section>
				<section className="panel leaderboard">
					<div className="panel-heading">
						<h2>最佳成績</h2>
						<ArrowUpRightIcon size={20} />
					</div>
					{sorted.slice(0, 5).map((r, i) => (
						<button className="leaderboard-row" key={r.id} onClick={() => onAthlete(r.athleteId)}>
							<span className={`rank-number ${i < 3 ? "podium" : ""}`}>{String(i + 1).padStart(2, "0")}</span>
							<span className="leader-name">
								{r.name}
								<span>{r.team}</span>
							</span>
							<strong>
								{formatResult(r.value, data.unit)}
								<span>{r.year}</span>
							</strong>
						</button>
					))}
				</section>
			</div>
			<section className="panel records-panel">
				<div className="panel-heading">
					<h2>{allAttempts ? "出賽成績" : "選手最佳成績"}</h2>
					<span>{number(sorted.length)} 筆</span>
				</div>
				<ResultsTable rows={sorted} data={data} manifest={manifest} onAthlete={onAthlete} />
			</section>
		</>
	);
}
