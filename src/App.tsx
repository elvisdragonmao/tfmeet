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
import { normalizeEvent, normalizeGroup, specificationLabel } from "./events.mjs";
import { loadEvent, loadManifest } from "./data";
import type { EventData, Filters, Manifest } from "./types";
import { Empty, ErrorNotice, genderName, Loading, Methodology, number } from "./components/Shared";
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
const eventOrder = new Intl.Collator("zh-TW", { numeric: true });
type EventChoice = { label: string; name: string; size?: number; genders: string[] };
type EventGroup = { name: string; choices: EventChoice[] };

function eventOptions(manifest: Manifest | null) {
	const families = new Map<string, { all: EventChoice; sizes: Map<number, EventChoice> }>();
	for (const event of manifest?.events || []) {
		if (!event.valid || !["M", "F"].includes(event.gender)) continue;
		if (!families.has(event.name)) families.set(event.name, { all: { label: event.name, name: event.name, genders: [] }, sizes: new Map() });
		const family = families.get(event.name)!;
		family.all.genders.push(event.gender);
		for (const { size, valid } of event.specifications || []) {
			if (!valid) continue;
			if (!family.sizes.has(size)) family.sizes.set(size, { label: `${event.name} ${specificationLabel(event.name, size)}`, name: event.name, size, genders: [] });
			family.sizes.get(size)!.genders.push(event.gender);
		}
	}
	const track: EventGroup = { name: "田徑", choices: [] };
	const walks: EventGroup = { name: "競走", choices: [] };
	const equipment: EventGroup[] = [];
	for (const { all, sizes } of [...families.values()].sort((a, b) => eventOrder.compare(a.all.name, b.all.name))) {
		if (all.name.endsWith("競走")) walks.choices.push(all);
		else if (sizes.size === 0) track.choices.push(all);
		else equipment.push({ name: all.name, choices: [all, ...[...sizes.values()].sort((a, b) => a.size! - b.size!)] });
	}
	return [track, ...equipment, walks].filter(group => group.choices.length);
}

function eventOption(choice: EventChoice) {
	return (
		<option key={choice.label} value={choice.label}>
			{choice.label}
			{choice.genders.length === 1 ? `（${genderName(choice.genders[0])}）` : ""}
		</option>
	);
}

export default function App() {
	const reduceMotion = useReducedMotion();
	const [manifest, setManifest] = useState<Manifest | null>(null);
	const [data, setData] = useState<EventData | null>(null);
	const [error, setError] = useState("");
	const [eventError, setEventError] = useState("");
	const [retry, setRetry] = useState(0);
	const [page, setPage] = useState(pages.some(p => p.id === initial.get("view")) ? initial.get("view")! : "distribution");
	const [eventName, setEventName] = useState(initial.get("event") || "100M");
	const [gender, setGender] = useState(initial.get("gender") || "M");
	const [group, setGroup] = useState(() => normalizeGroup(initial.get("group") || "", initial.get("gender") || "M"));
	const [age, setAge] = useState(initial.get("age") || "");
	const [wind, setWind] = useState(initial.get("wind") || "all");
	const [round, setRound] = useState(initial.get("round") || "");
	const [from, setFrom] = useState(Number(initial.get("from")) || 2010);
	const [to, setTo] = useState(Number(initial.get("to")) || new Date().getFullYear());
	const [team, setTeam] = useState(initial.get("team") || "");
	const [selectedAthlete, setSelectedAthlete] = useState(initial.get("athlete") || "");
	const canonicalAthlete = manifest?.athleteRedirects?.[selectedAthlete] ?? selectedAthlete;
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
	const options = useMemo(() => eventOptions(manifest), [manifest]);
	const choices = useMemo(() => options.flatMap(group => group.choices), [options]);
	const legacy = normalizeEvent(eventName);
	const chosen =
		choices.find(choice => choice.label === eventName) ||
		choices.find(choice => choice.name === legacy.family && (choice.size ?? null) === legacy.specification) ||
		choices.find(choice => choice.label === legacy.family) ||
		choices.find(choice => choice.label === "100M") ||
		choices[0];
	const selected = chosen?.genders.includes(gender) ? manifest?.events.find(e => e.name === chosen.name && e.gender === gender) : undefined;
	const selectedId = selected?.id;
	const currentData = data?.id === selectedId ? data : null;
	useEffect(() => {
		let live = true;
		setData(null);
		setEventError("");
		if (!selectedId || page === "athletes" || page === "archive") return;
		loadEvent(selectedId)
			.then(d => {
				if (live) setData(d);
			})
			.catch(e => {
				if (live) setEventError(e.message);
			});
		return () => {
			live = false;
		};
	}, [selectedId, page, retry]);
	const filters = useMemo<Filters>(() => ({ gender, group, age, wind, round, from, to, team }), [gender, group, age, wind, round, from, to, team]);
	const size = chosen?.size;
	const records = useMemo(() => (size === undefined ? currentData?.records || [] : currentData?.records.filter(r => r.specification === size) || []), [currentData, size]);
	const rows = useMemo(() => comparePool(records, filters), [records, filters]);
	useEffect(() => {
		const q = new URLSearchParams();
		for (const name of ["score", "attempts"]) {
			const value = new URLSearchParams(location.search).get(name);
			if (value) q.set(name, value);
		}
		if (page !== "distribution") q.set("view", page);
		q.set("event", chosen?.label || eventName);
		q.set("gender", gender);
		if (group) q.set("group", group);
		if (team) q.set("team", team);
		if (age) q.set("age", age);
		if (wind !== "all") q.set("wind", wind);
		if (round) q.set("round", round);
		q.set("from", String(from));
		q.set("to", String(to));
		if (page === "athletes" && canonicalAthlete) q.set("athlete", canonicalAthlete);
		history.replaceState(null, "", `?${q}`);
	}, [page, chosen?.label, eventName, gender, group, age, wind, round, from, to, team, canonicalAthlete]);
	const openAthlete = (id: string) => {
		setSelectedAthlete(id);
		setPage("athletes");
		window.scrollTo({ top: 0, behavior: "instant" });
	};
	function changePage(id: string) {
		setPage(id);
		window.scrollTo({ top: 0, behavior: "instant" });
	}
	const groups = useMemo(() => [...new Set(records.filter(r => r.kind === "individual" && r.group).map(r => r.group))].sort((a, b) => eventOrder.compare(a, b)), [records]);
	const allYears = [...new Set(manifest?.meets.map(m => m.year))].sort((a, b) => a - b);
	const years = [...new Set([...allYears, from, to])].sort((a, b) => a - b);
	const ages = useMemo(() => [...new Set(records.map(r => r.age).filter((a): a is number => a !== null))].sort((a, b) => a - b), [records]);
	const rounds = useMemo(() => [...new Set(records.filter(r => r.kind === "individual").map(r => r.round))], [records]);
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
														value={chosen?.label || ""}
														onChange={e => {
															setEventName(e.target.value);
															if (choices.find(choice => choice.label === e.target.value)?.name !== chosen?.name) setGroup("");
															setAge("");
															setRound("");
														}}
													>
														{options.map(group => (
															<optgroup key={group.name} label={group.name}>
																{group.choices.map(eventOption)}
															</optgroup>
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
																aria-pressed={gender === g}
																onClick={() => {
																	if (g === gender) return;
																	setGender(g);
																	setGroup(current => normalizeGroup(current.replace(/男子|女子/g, genderName(g)), g));
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
														{group && !groups.includes(group) ? <option value={group}>{group}（沒有資料）</option> : null}
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
										{!selected ? (
											<Empty>
												沒有資料。{genderName(gender)}在「{chosen?.label || eventName}」沒有可分析的成績。
											</Empty>
										) : eventError ? (
											<ErrorNotice error={eventError} retry={() => setRetry(retry + 1)} />
										) : !currentData ? (
											<Loading />
										) : !rows.length ? (
											<Empty>
												沒有資料。{group || genderName(gender)}在「{chosen?.label}」沒有符合目前篩選條件的成績。
											</Empty>
										) : (
											<Suspense fallback={<Loading />}>
												<motion.div key={page} initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.2 }}>
													{page === "distribution" ? (
														<Distribution rows={rows} data={currentData} eventLabel={chosen?.label || currentData.name} manifest={manifest} onAthlete={openAthlete} />
													) : (
														<AgeAnalysis rows={rows} data={currentData} specification={size} manifest={manifest} filters={filters} />
													)}
												</motion.div>
											</Suspense>
										)}
									</>
								) : (
									<Suspense fallback={<Loading />}>
										{page === "athletes" ? <Athletes manifest={manifest} selectedId={canonicalAthlete} onSelect={setSelectedAthlete} /> : <Archive manifest={manifest} />}
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
