import { ArrowSquareOutIcon, DownloadSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { formatResult } from "../analysis.mjs";
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
	return (
		<>
			<div className="table-scroll">
				<table className="table results-table">
					<thead>
						<tr>
							<th>選手／單位</th>
							<th>比賽日期</th>
							<th>當年年齡</th>
							<th>組別／賽別</th>
							<th className="numeric">成績</th>
							<th>風速</th>
							<th>
								<span className="sr-only">來源</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.slice(current * size, (current + 1) * size).map(r => (
							<tr key={r.id}>
								<td>
									<button className="athlete-link" onClick={() => onAthlete?.(r.athleteId)} disabled={!onAthlete}>
										{r.name}
									</button>
									<div className="table-secondary">{r.team}</div>
								</td>
								<td title={meets.get(r.meetId)?.name}>
									{r.date || r.year}
									<div className="table-secondary truncate-title">{meets.get(r.meetId)?.category || meets.get(r.meetId)?.name}</div>
								</td>
								<td>{r.age !== null ? `${r.age} 歲` : "未提供"}</td>
								<td>
									{r.group}
									<div className="table-secondary">{r.round}</div>
								</td>
								<td className="numeric result-value">{r.performance || "—"}</td>
								<td>{r.wind !== null ? `${r.wind > 0 ? "+" : ""}${r.wind.toFixed(1)}` : "—"}</td>
								<td>
									<a
										aria-label={`查看${r.name}原始成績`}
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
				<p>百分位只代表此資料庫中符合篩選條件的參賽選手，不代表全台灣人口，也不是各年齡「應該達到」的標準。預設每位選手只計最佳一次成績，避免參賽次數影響權重；同成績採相同排名。</p>
				<p>
					當年年齡＝比賽西元年份－公開出生年，實際足歲可能少一歲。未提供出生年的紀錄不納入年齡曲線；沒有年級資料就不推算年級。不同年齡的曲線是不同參賽者的橫斷比較，不能解釋為個人的成長或因果效果。
				</p>
				<p>各器材重量與欄高分開比較。個人項目、接力、全能分項不混算。風速依該組或該次最佳成績記錄；選擇「已知風速 ≤ +2.0」會排除沒有風速的成績。原始手計時／電計時若未明載，無法保證一致。</p>
				<p>相同姓名、性別、出生年歸為同一候選身分；沒有出生年時以姓名、性別、學校分組。這仍可能有同名誤合或轉學拆分，選手頁可核對與勾選候選身分。所有原始欄位與未完賽成績均保留於賽事 JSON。</p>
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
