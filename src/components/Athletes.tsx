import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import { MagnifyingGlassIcon, ArrowRightIcon, CheckIcon } from "@phosphor-icons/react";
import { loadAthletes, loadAthlete } from "../data";
import { bestPerAthlete, formatResult, groupStats } from "../analysis.mjs";
import type { Athlete, Manifest, Result } from "../types";
import { Empty, ErrorNotice, genderName, Loading, number, ResultsTable, Stat, unitName } from "./Shared";
const Chart = lazy(() => import("./Chart"));
export default function Athletes({ manifest, selectedId, onSelect }: { manifest: Manifest; selectedId: string; onSelect: (id: string) => void }) {
	const [index, setIndex] = useState<Athlete[] | null>(null);
	const [query, setQuery] = useState("");
	const search = useDeferredValue(query.trim());
	const [selected, setSelected] = useState<string[]>(selectedId ? [selectedId] : []);
	const [records, setRecords] = useState<Result[]>([]);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [event, setEvent] = useState("");
	const [axis, setAxis] = useState("year");
	useEffect(() => {
		let live = true;
		loadAthletes()
			.then(d => {
				if (live) setIndex(d);
			})
			.catch(e => {
				if (live) setError(e.message);
			});
		return () => {
			live = false;
		};
	}, []);
	useEffect(() => {
		if (selectedId) setSelected([selectedId]);
	}, [selectedId]);
	useEffect(() => {
		let live = true;
		setRecords([]);
		setError("");
		if (!selected.length) return;
		setBusy(true);
		Promise.all(selected.map(loadAthlete))
			.then(data => {
				if (live) {
					setRecords(data.flat());
					setBusy(false);
				}
			})
			.catch(e => {
				if (live) {
					setError(e.message);
					setBusy(false);
				}
			});
		return () => {
			live = false;
		};
	}, [selected]);
	const athlete = index?.find(a => a.id === selected[0]);
	const candidates = useMemo(() => (index && athlete ? index.filter(a => a.name === athlete.name) : []), [index, athlete]);
	const found = useMemo(
		() => index?.filter(a => !search || `${a.name} ${(a.aliases || []).join(" ")} ${a.teams.join(" ")} ${a.birthYear || ""}`.toLowerCase().includes(search.toLowerCase())) || [],
		[index, search]
	);
	const eventLabel = (r: Result) => (r.kind === "combined" ? `${r.event} · ${r.group}` : r.event);
	const available = [...new Set(records.filter(r => r.kind !== "relay").map(eventLabel))].sort();
	const currentEvent = available.includes(event) ? event : available.includes("100公尺") ? "100公尺" : available[0];
	const filtered = useMemo(
		() => records.filter(r => eventLabel(r) === currentEvent && r.kind !== "relay").sort((a, b) => (a.date || String(a.year)).localeCompare(b.date || String(b.year))),
		[records, currentEvent]
	);
	const info = manifest.events.find(e => e.name === filtered[0]?.event && e.gender === athlete?.gender);
	const valid = filtered.filter(r => r.value !== null);
	const stats = groupStats(valid, axis === "age" ? "age" : "year", info?.lowerIsBetter ?? true);
	const best = bestPerAthlete(valid, info?.lowerIsBetter ?? true).sort((a, b) => ((info?.lowerIsBetter ?? true) ? a.value! - b.value! : b.value! - a.value!))[0];
	const chart = {
		grid: { left: 65, right: 28, top: 25, bottom: 45 },
		xAxis: { type: "category", data: stats.map(s => `${s.key}${axis === "age" ? " 歲" : ""}`), axisLine: { show: false }, axisTick: { show: false } },
		yAxis: { type: "value", scale: true, inverse: info?.lowerIsBetter, axisLabel: { formatter: (v: number) => formatResult(v, info?.unit) }, splitLine: { lineStyle: { color: "#edf0f5" } } },
		tooltip: { trigger: "axis", valueFormatter: (v: unknown) => formatResult(Number(v), info?.unit) },
		series: [
			{
				name: "年度最佳成績",
				type: "line",
				data: stats.map(s => s.best),
				symbolSize: 9,
				lineStyle: { width: 3 },
				itemStyle: { borderColor: "#fff", borderWidth: 3 },
				areaStyle: { color: "#edf2ff", opacity: 1 }
			}
		]
	};
	return (
		<div className="athlete-layout">
			<section className="panel athlete-search">
				<div className="panel-heading">
					<h2>尋找選手</h2>
				</div>
				<label className="search-box">
					<MagnifyingGlassIcon size={19} />
					<input aria-label="搜尋選手姓名、學校或出生年" placeholder="姓名、學校或出生年" value={query} onChange={e => setQuery(e.target.value)} />
				</label>
				{!index ? (
					<Loading label="載入選手索引…" />
				) : (
					<>
						<div className="search-count">
							{number(found.length)} 個候選身分{found.length > 60 ? " · 顯示前 60 筆" : ""}
						</div>
						<div className="athlete-search-list">
							{found.slice(0, 60).map(a => (
								<button
									className={`search-result ${selected.includes(a.id) ? "selected" : ""}`}
									key={a.id}
									onClick={() => {
										setSelected([a.id]);
										onSelect(a.id);
									}}
								>
									<span className="athlete-avatar">{a.name.slice(0, 1)}</span>
									<span>
										<strong>{a.name}</strong>
										<span>
											{genderName(a.gender)} · {a.birthYear ? `${a.birthYear} 年生` : "出生年未提供"}
										</span>
										<span>{a.teams.slice(0, 2).join("、")}</span>
									</span>
									{selected.includes(a.id) ? <CheckIcon size={18} /> : <ArrowRightIcon size={17} />}
								</button>
							))}
							{!found.length ? <Empty>找不到相符選手，請改用姓名的一部分或學校名稱。</Empty> : null}
						</div>
					</>
				)}
			</section>
			<div className="athlete-detail">
				{error ? <ErrorNotice error={error} /> : null}
				{index && selected.length > 0 && !athlete && !busy ? <ErrorNotice error="此身分索引已變更，請重新搜尋姓名。" /> : null}
				{!selected.length ? (
					<section className="panel">
						<Empty>搜尋並選擇一位選手，查看歷屆成績與年齡變化。</Empty>
					</section>
				) : busy ? (
					<Loading label="載入選手歷屆成績…" />
				) : athlete ? (
					<>
						<section className="panel athlete-profile">
							<div className="profile-heading">
								<span className="profile-avatar">{athlete.name.slice(0, 1)}</span>
								<div>
									<h2>{athlete.name}</h2>
									<p>
										{genderName(athlete.gender)} · {athlete.birthYear ? `${athlete.birthYear} 年出生` : "來源未提供出生年"}
									</p>
								</div>
								<span className="badge badge-ghost">候選身分</span>
							</div>
							<div className="identity-note">
								{athlete.basis === "verified-override"
									? "已核對公開來源中的中英文姓名與出生年。"
									: athlete.basis === "name-gender-birth-team"
										? "同名、同出生年在同場賽事出現不同編號與單位，已依單位拆分，請核對後再合併檢視。"
										: athlete.basis === "name-gender-birth-year"
											? "以同名、同性別、同出生年連結，仍需核對學校與賽事。"
											: "以同名、同性別、同學校連結；轉學可能分成多個候選身分。"}
							</div>
							{athlete.evidence?.length ? (
								<div className="identity-evidence">
									{athlete.evidence.map((url, i) => (
										<a key={url} href={url} target="_blank" rel="noreferrer">
											{i === 0 ? "國際田總檔案" : "田協原始紀錄"} ↗
										</a>
									))}
								</div>
							) : null}
							{candidates.length > 1 ? (
								<details className="identity-candidates">
									<summary>有 {candidates.length} 個同名候選身分，核對與合併檢視</summary>
									<p>僅勾選你確認為同一人的身分。這次選擇只影響目前圖表。</p>
									{candidates.map(a => (
										<label key={a.id}>
											<input
												type="checkbox"
												className="checkbox checkbox-sm"
												checked={selected.includes(a.id)}
												disabled={selected.length === 1 && selected.includes(a.id)}
												onChange={e => setSelected(e.target.checked ? [...selected, a.id] : selected.filter(id => id !== a.id))}
											/>
											<span>
												{genderName(a.gender)} · {a.birthYear ? `${a.birthYear} 年生` : "出生年未知"} · {a.teams.join("、")} · {a.years[0]}–{a.years.at(-1)}
											</span>
										</label>
									))}
								</details>
							) : null}
						</section>
						<div className="athlete-controls">
							<label>
								分析項目
								<select className="select" value={currentEvent || ""} onChange={e => setEvent(e.target.value)}>
									{available.map(e => (
										<option key={e}>{e}</option>
									))}
								</select>
							</label>
							<div className="segmented">
								<button className={axis === "year" ? "active" : ""} onClick={() => setAxis("year")}>
									依年份
								</button>
								<button className={axis === "age" ? "active" : ""} onClick={() => setAxis("age")}>
									依當年年齡
								</button>
							</div>
						</div>
						{filtered[0]?.kind === "combined" ? (
							<div className="context-note">全能總分依組別分開顯示，不同組別可能使用不同分項與計分方式。</div>
						) : filtered[0]?.kind === "combined-component" ? (
							<div className="context-note">目前顯示全能運動的分項成績，不併入一般單項的百分位。</div>
						) : null}
						<div className="stats-grid athlete-stats">
							<Stat label="個人最佳" value={formatResult(best?.value, info?.unit)} unit={unitName(info?.unit || "s")} detail={best?.date || "尚無有效成績"} />
							<Stat label="出賽紀錄" value={number(filtered.length)} unit="筆" detail={`${new Set(filtered.map(r => r.meetId)).size} 場賽事`} />
							<Stat label="紀錄年份" value={filtered.length ? `${filtered[0].year}–${filtered.at(-1)!.year}` : "—"} detail="僅代表資料庫可查期間" />
						</div>
						<section className="panel">
							<div className="panel-heading">
								<h2>{currentEvent}成績變化</h2>
								<span>每{axis === "age" ? "個年齡" : "年"}最佳</span>
							</div>
							{stats.length ? (
								<Suspense fallback={<Loading />}>
									<Chart option={chart} height={330} label={`${athlete.name}歷年最佳成績曲線`} />
								</Suspense>
							) : (
								<Empty>{axis === "age" ? "沒有可確認出生年的成績。" : "沒有有效的個人成績。"}</Empty>
							)}
						</section>
						<section className="panel">
							<div className="panel-heading">
								<h2>學校與單位紀錄</h2>
							</div>
							<div className="team-timeline">
								{[...new Set(records.map(r => r.team))].map(team => {
									const rs = records.filter(r => r.team === team);
									const years = rs.map(r => r.year).sort();
									return (
										<div key={team}>
											<span className="timeline-dot" />
											<strong>{team}</strong>
											<span>
												{years[0]}–{years.at(-1)} · {number(rs.length)} 筆
											</span>
										</div>
									);
								})}
							</div>
							<p className="identity-note">公開紀錄未必包含年級；圖表只呈現有來源依據的年份與當年年齡。</p>
						</section>
						<section className="panel records-panel">
							<div className="panel-heading">
								<h2>逐場成績</h2>
							</div>
							<ResultsTable rows={filtered} manifest={manifest} />
						</section>
					</>
				) : null}
			</div>
		</div>
	);
}
