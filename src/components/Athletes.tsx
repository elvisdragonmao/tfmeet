import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import { MagnifyingGlassIcon, ArrowRightIcon, CheckIcon } from "@phosphor-icons/react";
import { loadAthletes, loadAthlete } from "../data";
import { bestPerAthlete, canReviewAthletesTogether, formatResult, uniqueStarts } from "../analysis.mjs";
import type { Athlete, Manifest, Result } from "../types";
import { Empty, ErrorNotice, genderName, Loading, number, ResultsTable, Stat, unitName } from "./Shared";
const AthletePerformanceChart = lazy(() => import("./AthletePerformanceChart"));
const identityNotes: Record<string, string> = {
	"verified-override": "已依公開資料核對身分與姓名。",
	"verified-source-alias": "以來源成績列的中英文對照與出生年核對。國際賽紀錄另核對代表隊及比賽項目。",
	"verified-separation": "公開資料已確認為不同選手，成績分開計算。",
	"distinct-start-registrations": "同名選手在同場次有不同參賽編號和成績，已按報名紀錄拆開。",
	"name-gender-birth-team": "同名、同出生年在同一賽會有不同編號與單位，已依單位拆分。",
	"name-gender-birth-year": "以同名、同性別、同出生年連結，仍可核對學校與賽事。",
	"name-gender-team": "以同名、同性別、同一單位連結；轉學可能分成多筆。"
};
export default function Athletes({ manifest, selectedId, onSelect }: { manifest: Manifest; selectedId: string; onSelect: (id: string) => void }) {
	const [index, setIndex] = useState<Athlete[] | null>(null);
	const [query, setQuery] = useState("");
	const search = useDeferredValue(query.trim());
	const [selected, setSelected] = useState<string[]>(selectedId ? [selectedId] : []);
	const [records, setRecords] = useState<Result[]>([]);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [event, setEvent] = useState("");
	const [axis, setAxis] = useState<"year" | "age">("year");
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
	const candidates = useMemo(() => (index && athlete ? index.filter(a => canReviewAthletesTogether(athlete, a)) : []), [index, athlete]);
	const selectedCandidates = candidates.filter(a => selected.includes(a.id));
	const found = useMemo(
		() => index?.filter(a => !search || `${a.name} ${(a.aliases || []).join(" ")} ${a.teams.join(" ")} ${a.birthYear || ""}`.toLowerCase().includes(search.toLowerCase())) || [],
		[index, search]
	);
	const eventLabel = (r: Result) => (r.kind === "combined" ? `${r.event} · ${r.group}` : r.kind === "combined-component" ? `${r.event}（全能分項）` : r.event);
	const available = [...new Set(records.filter(r => r.kind !== "relay").map(eventLabel))].sort();
	const currentEvent = available.includes(event) ? event : available.includes("100M") ? "100M" : available[0];
	const filtered = useMemo(
		() => uniqueStarts(records.filter(r => eventLabel(r) === currentEvent && r.kind !== "relay")).sort((a, b) => (a.date || String(a.year)).localeCompare(b.date || String(b.year))),
		[records, currentEvent]
	);
	const info = manifest.events.find(e => e.name === filtered[0]?.event && e.gender === athlete?.gender);
	const valid = filtered.filter(r => r.value !== null);
	const best = bestPerAthlete(valid, info?.lowerIsBetter ?? true).sort((a, b) => ((info?.lowerIsBetter ?? true) ? a.value! - b.value! : b.value! - a.value!))[0];
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
							<div className="identity-note">{identityNotes[athlete.basis]}</div>
							{athlete.evidence?.length ? (
								<div className="identity-evidence">
									{athlete.evidence.map((url, i) => (
										<a key={url} href={url} target="_blank" rel="noreferrer">
											{url.includes("worldathletics.org") ? "國際田總檔案" : url.includes("athletics.org.tw") ? "田協原始紀錄" : `來源 ${i + 1}`} ↗
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
												disabled={(selected.length === 1 && selected.includes(a.id)) || (!selected.includes(a.id) && selectedCandidates.some(candidate => !canReviewAthletesTogether(candidate, a)))}
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
						<Suspense fallback={<Loading label="載入歷屆成績圖表…" />}>
							<AthletePerformanceChart
								key={`${athlete.id}:${currentEvent}`}
								athlete={athlete}
								eventLabel={currentEvent}
								event={info}
								records={records}
								history={valid}
								axis={axis}
								dataRulesVersion={manifest.dataRulesVersion}
							/>
						</Suspense>
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
