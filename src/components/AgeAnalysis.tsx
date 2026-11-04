import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { groupStats, formatResult } from "../analysis.mjs";
import { loadEvent } from "../data";
import type { EventData, Filters, Manifest, Result } from "../types";
import { comparePool } from "../analysis.mjs";
import { Empty, ErrorNotice, Loading, number, unitName } from "./Shared";
const Chart = lazy(() => import("./Chart"));
export default function AgeAnalysis({ rows, data, manifest, filters }: { rows: Result[]; data: EventData; manifest: Manifest; filters: Filters }) {
	const [compare, setCompare] = useState(false);
	const [other, setOther] = useState<EventData | null>(null);
	const [error, setError] = useState("");
	const counterpart = manifest.events.find(e => e.name === data.name && e.gender !== data.gender && ["F", "M"].includes(e.gender));
	useEffect(() => {
		let live = true;
		setOther(null);
		setError("");
		if (compare && counterpart)
			loadEvent(counterpart.id)
				.then(d => {
					if (live) setOther(d);
				})
				.catch(e => {
					if (live) setError(e.message);
				});
		return () => {
			live = false;
		};
	}, [compare, counterpart?.id]);
	const groups = useMemo(() => groupStats(rows, "age", data.lowerIsBetter).filter(g => g.key >= 5 && g.key <= 100), [rows, data.lowerIsBetter]);
	const otherGroups = useMemo(
		() => (other ? groupStats(comparePool(other.records, { ...filters, gender: other.gender, group: "" }), "age", data.lowerIsBetter) : []),
		[other, filters, data.lowerIsBetter]
	);
	const ages = [...new Set([...groups, ...otherGroups].map(g => g.key))].sort((a, b) => a - b);
	const chart = {
		tooltip: { trigger: "axis", valueFormatter: (v: unknown) => formatResult(Number(v), data.unit) },
		legend: { data: ["中位數", "前 10% 門檻", ...(compare && other ? ["另一性別中位數"] : [])], bottom: 0, icon: "circle", itemWidth: 8 },
		grid: { left: 60, right: 25, top: 25, bottom: 65 },
		xAxis: { type: "category", data: ages.map(a => `${a} 歲`), axisLine: { show: false }, axisTick: { show: false } },
		yAxis: {
			type: "value",
			scale: true,
			inverse: data.lowerIsBetter,
			name: unitName(data.unit),
			splitLine: { lineStyle: { color: "#edf0f5" } },
			axisLabel: { formatter: (v: number) => formatResult(v, data.unit) }
		},
		series: [
			{ name: "中位數", type: "line", data: ages.map(a => groups.find(g => g.key === a)?.median ?? null), lineStyle: { width: 3 }, symbolSize: 7 },
			{ name: "前 10% 門檻", type: "line", data: ages.map(a => groups.find(g => g.key === a)?.top10 ?? null), lineStyle: { type: "dashed", width: 2 }, itemStyle: { color: "#8ba6e9" }, symbolSize: 5 },
			...(compare && other
				? [{ name: "另一性別中位數", type: "line", data: ages.map(a => otherGroups.find(g => g.key === a)?.median ?? null), lineStyle: { width: 2 }, itemStyle: { color: "#d28d36" }, symbolSize: 5 }]
				: [])
		]
	};
	const ageRows = rows.filter(r => r.age !== null);
	return (
		<>
			<div className="context-note">年齡以比賽年份減出生年計算，實際足歲可能少一歲。這是各年齡參賽者的比較，不能作為個人的成長預測。</div>
			<section className="panel">
				<div className="panel-heading">
					<div>
						<h2>年齡與成績</h2>
						<p>
							{number(ageRows.length)} / {number(rows.length)} 筆成績有出生年 · 每個年齡各取個人最佳
						</p>
					</div>
					{counterpart ? (
						<label className="check-label">
							<input type="checkbox" className="toggle toggle-sm" checked={compare} onChange={e => setCompare(e.target.checked)} />
							比較男女{filters.group ? "（另一性別含全部組別）" : ""}
						</label>
					) : null}
				</div>
				{error ? <ErrorNotice error={error} /> : null}
				{groups.length ? (
					<Suspense fallback={<Loading />}>
						<Chart option={chart} height={410} label="各年齡的成績中位數與前百分之十門檻" />
					</Suspense>
				) : (
					<Empty>此篩選條件沒有公開出生年的成績。可以使用組別比較，或放寬篩選。</Empty>
				)}
			</section>
			<section className="panel records-panel">
				<div className="panel-heading">
					<h2>各年齡成績門檻</h2>
					<span>{unitName(data.unit)}</span>
				</div>
				<div className="table-scroll">
					<table className="table threshold-table">
						<thead>
							<tr>
								<th>當年年齡</th>
								<th>候選選手數</th>
								<th>前 10%</th>
								<th>前 25%</th>
								<th>中位數</th>
								<th>前 75%</th>
								<th>最佳成績</th>
							</tr>
						</thead>
						<tbody>
							{groups.map(g => (
								<tr key={g.key}>
									<td>
										<strong>{g.key} 歲</strong>
									</td>
									<td>
										{number(g.n)}
										{g.n < 20 ? <span className="badge badge-ghost ml-2">樣本較少</span> : null}
									</td>
									{[g.top10, g.top25, g.median, g.top75, g.best].map((v, i) => (
										<td className="numeric" key={i}>
											{formatResult(v, data.unit)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
			<section className="panel">
				<div className="panel-heading">
					<h2>組別比較</h2>
				</div>
				<div className="group-comparison">
					{[...new Set(rows.map(r => r.group))].map(group => {
						const rs = rows.filter(r => r.group === group);
						const stats = groupStats(rs, "year", data.lowerIsBetter);
						return (
							<div className="group-comparison-row" key={group}>
								<strong>{group}</strong>
								<span>{number(new Set(rs.map(r => r.athleteId)).size)} 位候選選手</span>
								<span>{stats.length} 個年份</span>
								<span>有出生年 {Math.round((rs.filter(r => r.age !== null).length / rs.length) * 100)}%</span>
							</div>
						);
					})}
				</div>
			</section>
		</>
	);
}
