import { ArrowSquareOutIcon, DownloadSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { formatResult } from "../analysis.mjs";
import { specificationLabel } from "../events.mjs";
import type { EventData, Manifest, Result } from "../types";
export const number = (n: number) => new Intl.NumberFormat("zh-TW").format(n);
export const genderName = (s: string) => ({ M: "男子", F: "女子", X: "混合", U: "未註明" })[s] || s;
export function Stat({ label, value, unit, detail }: { label: string; value: string; unit?: string; detail?: string }) {
	return (
		<div className="stat-card">
			<div className="stat-label">{label}</div>
			<div className={`stat-value ${value.length >= 7 ? "long-value" : ""}`}>
				{value}
				{unit ? <span>{unit}</span> : null}
			</div>
			{detail ? <div className="stat-detail">{detail}</div> : null}
		</div>
	);
}
export function Empty({ children }: { children: React.ReactNode }) {
	return (
		<div className="empty">
			<WarningCircleIcon size={28} />
			<p>{children}</p>
		</div>
	);
}
export function ErrorNotice({ error, retry }: { error: string; retry?: () => void }) {
	return (
		<div className="alert alert-error" role="alert">
			<WarningCircleIcon size={22} />
			<span>{error}</span>
			{retry ? (
				<button className="btn btn-sm" onClick={retry}>
					重試
				</button>
			) : null}
		</div>
	);
}
export function Loading({ label = "載入成績資料…" }: { label?: string }) {
	return (
		<div className="loading-state" role="status">
			<span className="loading loading-spinner loading-sm" />
			{label}
		</div>
	);
}
export function downloadRows(rows: Result[]) {
	const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), records: rows }, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = "tfmeet-results.json";
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ResultsTable({ rows, data, manifest, onAthlete }: { rows: Result[]; data?: EventData; manifest: Manifest; onAthlete?: (id: string) => void }) {
	const [page, setPage] = useState(0);
	const size = 15;
	const current = Math.min(page, Math.max(0, Math.ceil(rows.length / size) - 1));
	const meets = new Map(manifest.meets.map(m => [m.id, m]));
	const relay = data?.kind === "relay" || rows[0]?.kind === "relay";
	return (
		<>
			<div className="table-scroll">
				<table className="table results-table">
					<thead>
						<tr>
							<th>{relay ? "隊伍" : "選手／單位"}</th>
							<th>比賽日期</th>
							{data?.kind !== "relay" ? <th className="result-age">當年年齡</th> : null}
							<th className="result-group">組別／賽別</th>
							<th className="numeric">{relay ? "隊伍成績" : "成績"}</th>
							{!relay ? <th className="result-wind">風速</th> : null}
							<th>
								<span className="sr-only">來源</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.slice(current * size, (current + 1) * size).map(r => (
							<tr key={r.id}>
								<td>
									{relay ? (
										<>
											<strong>{r.team || "未提供隊伍"}</strong>
											{r.relayMembers?.length ? (
												<div className="table-secondary relay-roster">
													{r.relayMembers.map((member, i) => (
														<span key={i}>
															{i > 0 ? "、" : ""}
															{onAthlete && member.athleteId ? (
																<button className="athlete-link" onClick={() => onAthlete(member.athleteId!)}>
																	{member.name}
																</button>
															) : (
																member.name
															)}
														</span>
													))}
												</div>
											) : null}
										</>
									) : (
										<>
											<button className="athlete-link" onClick={() => onAthlete?.(r.athleteId)} disabled={!onAthlete}>
												{r.name}
											</button>
											<div className="table-secondary">{r.team}</div>
										</>
									)}
								</td>
								<td title={meets.get(r.meetId)?.name}>
									{r.date || r.year}
									<div className="table-secondary truncate-title">{meets.get(r.meetId)?.category || meets.get(r.meetId)?.name}</div>
								</td>
								{data?.kind !== "relay" ? <td className="result-age">{r.age !== null ? `${r.age} 歲` : "未提供"}</td> : null}
								<td className="result-group">
									{r.group}
									<div className="table-secondary">{r.round}</div>
									{r.specification !== undefined ? (
										<div className="table-secondary">
											{specificationLabel(r.event, r.specification)}
											{r.specificationInferred ? "（推估）" : ""}
										</div>
									) : null}
								</td>
								<td className="numeric result-value">
									{r.performance || "—"}
									{r.timeSuspect ? <div className="table-secondary">計時待核對</div> : null}
								</td>
								{!relay ? <td className="result-wind">{r.wind !== null ? `${r.wind > 0 ? "+" : ""}${r.wind.toFixed(1)}` : "—"}</td> : null}
								<td>
									<a
										aria-label={`查看${relay ? r.team || "隊伍" : r.name}原始成績`}
										title="原始成績"
										href={r.source || data?.sources[`${r.meetId}:${r.item}:${r.heat || ""}`] || meets.get(r.meetId)?.url}
										target="_blank"
										rel="noreferrer"
									>
										<ArrowSquareOutIcon size={18} />
									</a>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="table-footer">
				<span>{number(rows.length)} 筆成績</span>
				<div className="pagination">
					<button className="btn btn-sm btn-ghost" disabled={current === 0} onClick={() => setPage(current - 1)}>
						上一頁
					</button>
					<span>
						{current + 1} / {Math.max(1, Math.ceil(rows.length / size))}
					</span>
					<button className="btn btn-sm btn-ghost" disabled={(current + 1) * size >= rows.length} onClick={() => setPage(current + 1)}>
						下一頁
					</button>
				</div>
				<button
					className="btn btn-sm btn-ghost"
					disabled={!rows.length}
					onClick={() => downloadRows(rows.map(r => ({ ...r, source: r.source || data?.sources[`${r.meetId}:${r.item}:${r.heat || ""}`] })))}
				>
					<DownloadSimpleIcon size={16} />
					匯出 JSON
				</button>
			</div>
		</>
	);
}
export function Methodology() {
	return (
		<details className="methodology">
			<summary>如何解讀這些數據</summary>
			<div>
				<p>
					百分位只代表此資料庫中符合篩選條件的參賽選手，不代表全台灣人口，也不是各年齡「應該達到」的標準。同場次、組次與編號的相同成績重複列會先去除。預設每位選手只計最佳一次成績，避免參賽次數影響權重；同成績採相同排名。
				</p>
				<p>
					當年年齡＝比賽西元年份－公開出生年，實際足歲可能少一歲。未提供出生年的紀錄不納入年齡曲線；沒有年級資料就不推算年級。不同年齡的曲線是不同參賽者的橫斷比較，不能解釋為個人的成長或因果效果。
				</p>
				<p>
					未選規格的項目包含各種欄高、器材重量及規格不明的成績。可選單一規格比較。來源未標明的規格依組別或當年年齡推估，並在成績列標示。個人項目、接力、全能分項不混算。選擇「已知風速 ≤
					+2.0」會排除沒有風速的成績。
				</p>
				<p>選手索引依姓名、性別、出生年與單位核對。來源有中英文對照時可合併；出生年不同或來源已區分的同名選手會分開。仍待核對的候選身分可以在選手頁合併檢視。原始欄位與未完賽成績保留於賽事 JSON。</p>
				<p>接力分布按隊伍出賽計算，預賽與決賽各計一筆。能核對名單的紀錄會列入選手歷程，顯示隊伍完賽時間。來源計時有疑義的紀錄保留原值，暫不納入分布或歷屆成績圖。</p>
			</div>
		</details>
	);
}
export function NoResults() {
	return <Empty>此條件沒有可分析的個人成績。請放寬年份、組別或風速條件。</Empty>;
}
export function unitName(unit: string) {
	return unit === "s" ? "秒" : unit === "m" ? "公尺" : "分";
}
export function Performance({ value, unit }: { value: number | null; unit: string }) {
	return (
		<>
			{formatResult(value, unit)} <span className="unit">{unitName(unit)}</span>
		</>
	);
}
