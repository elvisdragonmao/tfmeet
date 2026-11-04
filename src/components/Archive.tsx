import DownloadFile from "./DownloadFile";
import { useMemo, useState } from "react";
import { ArrowSquareOutIcon, CheckCircleIcon, DownloadSimpleIcon, MagnifyingGlassIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { Manifest } from "../types";
import { number } from "./Shared";
export default function Archive({ manifest }: { manifest: Manifest }) {
	const [query, setQuery] = useState("");
	const [year, setYear] = useState("");
	const [status, setStatus] = useState("");
	const [page, setPage] = useState(0);
	const filtered = useMemo(
		() =>
			manifest.meets
				.filter(m => (!query || `${m.name} ${m.category}`.includes(query)) && (!year || m.year === Number(year)) && (!status || m.status === status))
				.sort((a, b) => b.year - a.year || (a.name || "").localeCompare(b.name || "", "zh-TW")),
		[manifest, query, year, status]
	);
	const years = [...new Set(manifest.meets.map(m => m.year))].sort((a, b) => b - a);
	const size = 20;
	const current = Math.min(page, Math.max(0, Math.ceil(filtered.length / size) - 1));
	return (
		<>
			<div className="archive-overview">
				<div>
					<h2>{number(manifest.discovered)} 場歷史賽事</h2>
					<p>
						{manifest.complete} 場完整擷取 · {manifest.partial} 場有來源或解析問題{manifest.restricted ? ` · ${manifest.restricted} 場詳細來源受限` : ""}
						{manifest.discovered > manifest.meets.length ? ` · ${manifest.discovered - manifest.meets.length} 場尚未完成` : ""}
					</p>
				</div>
				<DownloadFile className="btn btn-primary" href={`/data/${manifest.archiveUrl}?v=${encodeURIComponent(manifest.updatedAt)}`}>
					下載全部 JSON.gz
				</DownloadFile>
			</div>
			<div className="context-note">
				壓縮檔解壓後為 JSON 陣列，包含每場賽事的所有原始欄位、各輪次成績、來源有提供的逐次試跳／試擲資料與來源限制清單。資料下載日期為{" "}
				{new Date(manifest.updatedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })}。
			</div>
			<section className="panel records-panel">
				<div className="archive-filters">
					<label className="search-box">
						<MagnifyingGlassIcon size={19} />
						<input
							aria-label="搜尋賽事"
							placeholder="搜尋賽事名稱"
							value={query}
							onChange={e => {
								setQuery(e.target.value);
								setPage(0);
							}}
						/>
					</label>
					<select
						className="select"
						aria-label="賽事年份"
						value={year}
						onChange={e => {
							setYear(e.target.value);
							setPage(0);
						}}
					>
						<option value="">所有年份</option>
						{years.map(y => (
							<option key={y}>{y}</option>
						))}
					</select>
					<select
						className="select"
						aria-label="資料完整度"
						value={status}
						onChange={e => {
							setStatus(e.target.value);
							setPage(0);
						}}
					>
						<option value="">所有完整度</option>
						<option value="complete">完整擷取</option>
						<option value="partial">有缺漏</option>
					</select>
				</div>
				<div className="table-scroll">
					<table className="table archive-table">
						<thead>
							<tr>
								<th>賽事</th>
								<th>成績數</th>
								<th>場次</th>
								<th>完整度</th>
								<th>資料下載</th>
							</tr>
						</thead>
						<tbody>
							{filtered.slice(current * size, (current + 1) * size).map(m => (
								<tr key={m.id}>
									<td>
										<a href={m.url} target="_blank" rel="noreferrer">
											<strong>{m.name || `${m.year} ${m.category}`}</strong>
											<ArrowSquareOutIcon size={14} />
										</a>
										<div className="table-secondary">
											{m.category} · {m.year}
										</div>
									</td>
									<td className="numeric">{number(m.records)}</td>
									<td>
										{m.pages} / {m.sessionCount}
									</td>
									<td>
										{m.status === "complete" ? (
											<span className="status-ok">
												<CheckCircleIcon size={17} />
												完整
											</span>
										) : (
											<details className="status-detail">
												<summary>
													<WarningCircleIcon size={17} />
													{m.errors.length} 項問題
												</summary>
												<ul>
													{m.errors.map((e, i) => (
														<li key={i}>
															場次 {e.item || "索引"}：{e.message}
															<a href={e.url} target="_blank" rel="noreferrer">
																檢查來源
															</a>
														</li>
													))}
												</ul>
											</details>
										)}
										{m.warnings?.length ? (
											<details className="status-detail source-warning">
												<summary>詳細來源受限</summary>
												<ul>
													{m.warnings.map((w, i) => (
														<li key={i}>
															{w.message}
															<a href={w.url} target="_blank" rel="noreferrer">
																原始故障頁
															</a>
														</li>
													))}
												</ul>
											</details>
										) : null}
									</td>
									<td>
										<DownloadFile className="btn btn-sm btn-ghost" href={`/data/meets/${m.id}.json.gz?v=${encodeURIComponent(manifest.updatedAt)}`}>
											JSON.gz
										</DownloadFile>
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{!filtered.length ? <div className="empty">沒有符合條件的賽事。</div> : null}
				</div>
				<div className="table-footer">
					<span>{filtered.length} 場賽事</span>
					<div className="pagination">
						<button className="btn btn-sm btn-ghost" disabled={!current} onClick={() => setPage(current - 1)}>
							上一頁
						</button>
						<span>
							{current + 1} / {Math.max(1, Math.ceil(filtered.length / size))}
						</span>
						<button className="btn btn-sm btn-ghost" disabled={(current + 1) * size >= filtered.length} onClick={() => setPage(current + 1)}>
							下一頁
						</button>
					</div>
				</div>
			</section>
		</>
	);
}
