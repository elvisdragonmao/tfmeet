import DownloadFile from "./components/DownloadFile";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { motion, MotionConfig, useReducedMotion } from "motion/react";
import {
	ArrowSquareOutIcon,
	ChartBarIcon,
	ChartLineUpIcon,
	CheckIcon,
	DatabaseIcon,
	DownloadSimpleIcon,
	FunnelSimpleIcon,
	GithubLogoIcon,
	ShareNetworkIcon,
	TimerIcon,
	UsersThreeIcon
} from "@phosphor-icons/react";
import { comparePool } from "./analysis.mjs";
import { loadEvent, loadManifest } from "./data";
import type { EventData, Filters, Manifest } from "./types";
import { ErrorNotice, genderName, Loading, Methodology, number } from "./components/Shared";
const Distribution = lazy(() => import("./components/Distribution"));
const AgeAnalysis = lazy(() => import("./components/AgeAnalysis"));
const Athletes = lazy(() => import("./components/Athletes"));
const Archive = lazy(() => import("./components/Archive"));
const pages = [
	{ id: "distribution", label: "成績分布", icon: ChartBarIcon },
	{ id: "age", label: "年齡與性別", icon: ChartLineUpIcon },
	{ id: "athletes", label: "選手歷程", icon: UsersThreeIcon },
	{ id: "archive", label: "賽事資料庫", icon: DatabaseIcon }
];
const initial = new URLSearchParams(location.search);
export default function App() {
	const reduceMotion = useReducedMotion();
	const [manifest, setManifest] = useState<Manifest | null>(null);
	const [data, setData] = useState<EventData | null>(null);
	const [error, setError] = useState("");
	const [eventError, setEventError] = useState("");
	const [retry, setRetry] = useState(0);
	const [page, setPage] = useState(pages.some(p => p.id === initial.get("view")) ? initial.get("view")! : "distribution");
	const [eventName, setEventName] = useState(initial.get("event") || "100公尺");
	const [gender, setGender] = useState(initial.get("gender") || "M");
	const [group, setGroup] = useState(initial.get("group") || "");
	const [age, setAge] = useState(initial.get("age") || "");
	const [wind, setWind] = useState(initial.get("wind") || "all");
	const [round, setRound] = useState(initial.get("round") || "");
	const [from, setFrom] = useState(Number(initial.get("from")) || 2010);
	const [to, setTo] = useState(Number(initial.get("to")) || new Date().getFullYear());
	const [team, setTeam] = useState(initial.get("team") || "");
	const [selectedAthlete, setSelectedAthlete] = useState(initial.get("athlete") || "");
	const [copied, setCopied] = useState(false);
	const [advanced, setAdvanced] = useState(Boolean(age || round || wind !== "all"));
	useEffect(() => {
		let live = true;
		setError("");
		loadManifest()
			.then(d => {
				if (live) {
					setManifest(d);
					if (!initial.has("from")) setFrom(Math.min(...d.meets.map(m => m.year)));
					if (!initial.has("to")) setTo(Math.max(...d.meets.map(m => m.year)));
				}
			})
			.catch(e => {
				if (live) setError(e.message);
			});
		return () => {
			live = false;
		};
	}, [retry]);
	const eventOptions = useMemo(
		() =>
			[...new Set(manifest?.events.filter(e => e.gender === gender && e.valid > 0).map(e => e.name))].sort((a, b) => {
				const av = Number(a.match(/^\d+/)?.[0] || 999999),
					bv = Number(b.match(/^\d+/)?.[0] || 999999);
				return av - bv || a.localeCompare(b, "zh-TW");
			}),
		[manifest, gender]
	);
	const chosenName = eventOptions.includes(eventName) ? eventName : eventOptions[0];
	const selected = manifest?.events.find(e => e.name === chosenName && e.gender === gender);
	useEffect(() => {
		let live = true;
		setData(null);
		setEventError("");
		if (!selected || page === "athletes" || page === "archive") return;
		loadEvent(selected.id)
			.then(d => {
				if (live) setData(d);
			})
			.catch(e => {
				if (live) setEventError(e.message);
			});
		return () => {
			live = false;
		};
	}, [selected?.id, page, retry]);
	const filters = useMemo<Filters>(() => ({ gender, group, age, wind, round, from, to, team }), [gender, group, age, wind, round, from, to, team]);
	const rows = useMemo(() => (data ? comparePool(data.records, filters) : []), [data, filters]);
	useEffect(() => {
		const q = new URLSearchParams();
		for (const name of ["score", "attempts"]) {
			const value = new URLSearchParams(location.search).get(name);
			if (value) q.set(name, value);
		}
		if (page !== "distribution") q.set("view", page);
		q.set("event", chosenName || eventName);
		q.set("gender", gender);
		if (group) q.set("group", group);
		if (team) q.set("team", team);
		if (age) q.set("age", age);
		if (wind !== "all") q.set("wind", wind);
		if (round) q.set("round", round);
		q.set("from", String(from));
		q.set("to", String(to));
		if (page === "athletes" && selectedAthlete) q.set("athlete", selectedAthlete);
		history.replaceState(null, "", `?${q}`);
	}, [page, chosenName, eventName, gender, group, age, wind, round, from, to, team, selectedAthlete]);
	const openAthlete = (id: string) => {
		setSelectedAthlete(id);
		setPage("athletes");
		window.scrollTo({ top: 0, behavior: "instant" });
	};
	function changePage(id: string) {
		setPage(id);
		window.scrollTo({ top: 0, behavior: "instant" });
	}
	const groups = useMemo(() => [...new Set(data?.records.filter(r => r.kind === "individual").map(r => r.group))].sort((a, b) => a.localeCompare(b, "zh-TW")), [data]);
	const allYears = [...new Set(manifest?.meets.map(m => m.year))].sort((a, b) => a - b);
	const years = [...new Set([...allYears, from, to])].sort((a, b) => a - b);
	const ages = [...new Set(data?.records.map(r => r.age).filter((a): a is number => a !== null))].sort((a, b) => a - b);
	const rounds = [...new Set(data?.records.filter(r => r.kind === "individual").map(r => r.round))];
	async function share() {
		try {
			await navigator.clipboard.writeText(location.href);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			setCopied(false);
		}
	}
	return (
		<MotionConfig reducedMotion="user">
			<div className="app-shell">
				<aside className="sidebar">
					<a className="brand" href="/">
						<span className="brand-mark">
							<i />
							<i />
							<i />
						</span>
						<span>田徑成績室</span>
					</a>
					<nav aria-label="主要導覽">
						{pages.map(p => (
							<button key={p.id} className={`nav-item ${page === p.id ? "active" : ""}`} onClick={() => changePage(p.id)} aria-current={page === p.id ? "page" : undefined}>
								<p.icon size={21} weight={page === p.id ? "fill" : "regular"} />
								<span>{p.label}</span>
							</button>
						))}
					</nav>
					<div className="sidebar-bottom">
						{manifest ? (
							<>
								<div className="update-label">
									<span className="status-dot" />
									資料更新
								</div>
								<time dateTime={manifest.updatedAt}>{new Date(manifest.updatedAt).toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Taipei" })}</time>
								<p>每月自動更新</p>
								<DownloadFile className="sidebar-download" href={`/data/${manifest.archiveUrl}?v=${encodeURIComponent(manifest.updatedAt)}`}>
									下載完整資料
								</DownloadFile>
							</>
						) : null}
						<a className="github-link" href="https://github.com/elvisdragonmao/tfmeet" target="_blank" rel="noreferrer">
							<GithubLogoIcon size={18} />
							原始碼
							<ArrowSquareOutIcon size={14} />
						</a>
					</div>
				</aside>
				<div className="workspace">
					<header className="topbar">
						<div className="breadcrumb">
							田徑成績分析<span>/</span>
							<strong>{pages.find(p => p.id === page)?.label}</strong>
						</div>
						<a href="https://w3.athletics.org.tw/tfmeet/list_menu.php" target="_blank" rel="noreferrer">
							資料來源
							<ArrowSquareOutIcon size={16} />
						</a>
					</header>
					<main id="main">
						<div className="page-heading">
							<div>
								<h1>{pages.find(p => p.id === page)?.label}</h1>
								{manifest ? (
									<p>
										{page === "archive"
											? `${Math.min(...allYears)}–${Math.max(...allYears)} 年歷史賽事`
											: page === "athletes"
												? `${number(manifest.athleteCount)} 個候選選手身分`
												: `${number(manifest.recordCount)} 筆原始成績 · ${manifest.meets.length} 場賽事`}
									</p>
								) : null}
							</div>
							<button className="btn btn-outline share-button" onClick={share}>
								{copied ? <CheckIcon size={18} /> : <ShareNetworkIcon size={18} />}
								<span>{copied ? "已複製連結" : "分享分析"}</span>
							</button>
						</div>
						{error ? (
							<ErrorNotice error={error} retry={() => setRetry(retry + 1)} />
						) : !manifest ? (
							<Loading label="載入賽事索引…" />
						) : (
							<>
								{manifest.partial > 0 || (manifest.restricted || 0) > 0 || manifest.discovered > manifest.meets.length ? (
									<div className="coverage-notice">
										{manifest.partial > 0 ? `${manifest.partial} 場賽事有資料缺漏。` : ""}
										{manifest.restricted ? `${manifest.restricted} 場賽事使用替代成績來源，部分詳細欄位不可取得。` : ""}
										{manifest.discovered > manifest.meets.length ? `${manifest.discovered - manifest.meets.length} 場賽事尚未完成擷取。` : ""}
										<button onClick={() => changePage("archive")}>
											查看完整度 <ArrowSquareOutIcon size={14} />
										</button>
									</div>
								) : null}
								{page === "distribution" || page === "age" ? (
									<>
										<section className="filter-panel">
											<div className="primary-filters">
												<label className="event-field">
													比賽項目
													<select
														className="select"
														value={chosenName || ""}
														onChange={e => {
															setEventName(e.target.value);
															setGroup("");
															setAge("");
															setRound("");
														}}
													>
														{eventOptions.map(e => (
															<option key={e}>{e}</option>
														))}
													</select>
												</label>
												<fieldset className="gender-field">
													<legend>性別</legend>
													<div className="segmented">
														{["M", "F"].map(g => (
															<button
																key={g}
																className={gender === g ? "active" : ""}
																onClick={() => {
																	setGender(g);
																	setGroup("");
																	setAge("");
																	setRound("");
																}}
															>
																{genderName(g)}
															</button>
														))}
													</div>
												</fieldset>
												<label>
													組別
													<select className="select" value={group} onChange={e => setGroup(e.target.value)}>
														<option value="">所有組別</option>
														{groups.map(g => (
															<option key={g}>{g}</option>
														))}
													</select>
												</label>
												<div className="year-field">
													<span className="filter-label">比賽年份</span>
													<div className="year-inputs">
														<select
															className="select"
															aria-label="起始年份"
															value={from}
															onChange={e => {
																setFrom(Number(e.target.value));
																if (Number(e.target.value) > to) setTo(Number(e.target.value));
															}}
														>
															{years.map(y => (
																<option key={y}>{y}</option>
															))}
														</select>
														<span>—</span>
														<select
															className="select"
															aria-label="結束年份"
															value={to}
															onChange={e => {
																setTo(Number(e.target.value));
																if (Number(e.target.value) < from) setFrom(Number(e.target.value));
															}}
														>
															{years.map(y => (
																<option key={y}>{y}</option>
															))}
														</select>
													</div>
												</div>
												<button className={`btn advanced-button ${advanced ? "is-active" : ""}`} onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
													<FunnelSimpleIcon size={19} />
													篩選{age || round || wind !== "all" || team ? <span className="filter-count">{[age, round, wind !== "all", team].filter(Boolean).length}</span> : null}
												</button>
											</div>
											{advanced ? (
												<div className="advanced-filters">
													<label>
														當年年齡
														<select className="select" value={age} onChange={e => setAge(e.target.value)}>
															<option value="">所有年齡（含未知）</option>
															{ages.map(a => (
																<option key={a} value={a}>
																	{a} 歲
																</option>
															))}
														</select>
													</label>
													<label>
														賽別
														<select className="select" value={round} onChange={e => setRound(e.target.value)}>
															<option value="">所有賽別</option>
															{rounds.map(r => (
																<option key={r}>{r}</option>
															))}
														</select>
													</label>
													<label>
														風速
														<select className="select" value={wind} onChange={e => setWind(e.target.value)}>
															<option value="all">全部（含未知）</option>
															<option value="legal">已知風速 ≤ +2.0</option>
														</select>
													</label>
													<label>
														學校／單位
														<input className="input" value={team} placeholder="輸入名稱" onChange={e => setTeam(e.target.value)} />
													</label>
													<button
														className="btn btn-ghost"
														onClick={() => {
															setAge("");
															setRound("");
															setWind("all");
															setTeam("");
															setGroup("");
														}}
													>
														清除篩選
													</button>
												</div>
											) : null}
										</section>
										{eventError ? (
											<ErrorNotice error={eventError} retry={() => setRetry(retry + 1)} />
										) : !selected ? (
											<div className="empty">沒有此性別的可分析項目。</div>
										) : !data ? (
											<Loading />
										) : (
											<Suspense fallback={<Loading />}>
												<motion.div key={page} initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.2 }}>
													{page === "distribution" ? (
														<Distribution rows={rows} data={data} manifest={manifest} onAthlete={openAthlete} />
													) : (
														<AgeAnalysis rows={rows} data={data} manifest={manifest} filters={filters} />
													)}
												</motion.div>
											</Suspense>
										)}
									</>
								) : (
									<Suspense fallback={<Loading />}>
										{page === "athletes" ? <Athletes manifest={manifest} selectedId={selectedAthlete} onSelect={setSelectedAthlete} /> : <Archive manifest={manifest} />}
									</Suspense>
								)}
								<Methodology />
								<footer>
									<span>田徑成績室</span>
									<span>來源：中華民國田徑協會公開成績</span>
									<a href="https://github.com/elvisdragonmao/tfmeet/issues" target="_blank" rel="noreferrer">
										回報資料問題
										<ArrowSquareOutIcon size={13} />
									</a>
								</footer>
							</>
						)}
					</main>
				</div>
			</div>
		</MotionConfig>
	);
}
