# 田徑成績室

台灣歷史田徑成績查詢與分析。資料來源為[中華民國田徑協會歷史成績查詢](https://w3.athletics.org.tw/tfmeet/list_menu.php)，網站部署於 **https://tfmeet.emtech.cc**。

React、TypeScript、Vite、Tailwind CSS、daisyUI、Apache ECharts、Motion 與 `@phosphor-icons/react`。查詢狀態使用 React hooks；靜態檔案以 `fetch` 和 Promise cache 載入，無須 React Query、Zustand 或後端資料庫。

## 使用功能

- 依項目、性別、組別、年份、當年年齡、賽別、風速與學校篩選。
- 成績直方圖、個人最佳排名、前 1%／10%／25%／50% 門檻，以及輸入成績計算相對排名。
- 年齡曲線、男女比較、各年齡門檻與歷年趨勢；每個年齡或年份分別取個人最佳。
- 選手搜尋、年度／當年年齡成績曲線、單位沿革與原始成績連結；全能分項與依組別區分的全能總分也可查閱。
- 同名候選身分核對，手動勾選確認為同一人的紀錄；這次選擇只影響目前檢視。
- 全部賽事壓縮 JSON、單場賽事 JSON.gz，以及目前表格的 JSON 匯出。
- 可分享的分析篩選網址、資料擷取日期與逐賽事完整度。

## 本機開發

使用 Node.js 24 以上與專案指定的 pnpm 版本。

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run data:update
pnpm dev
```

第一次完整擷取需要持續連線，終端會顯示目前賽事、完成場次、請求數與經過時間。可以中斷後重新執行：完成的賽事與成功的來源 HTML 都會重用。`public/data/`、`.cache/`、`dist/` 與 `node_modules/` 均不進 Git。

已有完整資料時可直接執行 `pnpm dev`。若從本專案的公開 Release 下載快照，也可省略首次擷取：

```sh
mkdir -p .cache public/data
gh release download dataset --repo elvisdragonmao/tfmeet --pattern tfmeet-data.tar.gz --dir .cache
tar -xzf .cache/tfmeet-data.tar.gz -C public/data
pnpm dev
```

```sh
pnpm test                 # 解析器、去重、排名、年齡與身分例外測試
pnpm run check           # TypeScript
pnpm run data:validate   # 全量資料一致性與完整度檢查
pnpm run build           # 沒有資料時先下載 Release 快照；缺少分析索引時先產生索引
pnpm run preview
pnpm run format:check
```

## 擷取與資料流程

```text
歷史成績清單（完整展開）
  → 每場賽事的所有日期賽程
  → 每個項目的所有組次、預賽、複賽與決賽成績
  → 原始欄位與試跳／試擲表格
  → 比較用成績、項目／性別分檔、選手索引
  → 壓縮靜態檔與完整 JSON 下載
```

入口目前列出 153 場賽事；爬蟲每次從入口重新探索，不把賽事 ID 清單寫死，也不把「前八名總表」當成所有參賽者。

舊系統使用 Big5，新系統使用 UTF-8。網站有 PHP session 與賽事參數狀態；每個下載 worker 都先開啟該賽事建立獨立 session，並帶齊賽事參數，再抓取成績。每個回應都核對賽事標題，賽程連結與所有成績的賽事 ID 也必須一致，以防來源系統傳回其他賽事。預設最多四個同時請求，包含請求間隔、逾時、重試及壓縮來源快取。

`scripts/source.mjs` 負責解碼、賽程探索、跨列／跨欄表頭與成績解析。田賽會保留來源可提供的每次試跳／試擲原始欄位；徑賽會把整組共用的風速帶到同組每位選手。`DNS`、`DNF`、`DQ`、`NM` 等原始紀錄保留，但不當作有效數值。

部分舊賽事的新版成績頁因來源資料庫缺少 `GRIndex` 欄位而故障，舊版田賽詳細頁也可能因 PHP 相容性錯誤而無法顯示。爬蟲會核對同一賽事的舊版賽程，改以舊版完整輪次成績或 `rank_stat.php` 逐組成績取回全部選手成績。原始故障頁、替代來源、各組連結與詳細欄位限制會寫入 JSON 和網站；失效的逐次試跳／試擲檔案不會補成推測資料。

```sh
pnpm run data:update     # 可續傳的全量擷取 → 重新解析 → 索引 → 驗證
pnpm run data:refresh    # 重新請求每一頁 → 重新解析 → 索引 → 驗證
pnpm run data:derive     # 從既有賽事 JSON 重新產生分析索引
pnpm run data:package    # 產生 .cache/tfmeet-data.tar.gz，供 Release／build 使用
```

資料格式如下：

| 路徑                        | 內容                                                   |
| --------------------------- | ------------------------------------------------------ |
| `manifest.json`             | 擷取時間、賽事索引、完整度、失敗清單、樣本數與項目索引 |
| `meets/{id}.json.gz`        | 單場所有成績、逐場來源、原始欄位與試跳／試擲表格       |
| `events/{id}.json.gz`       | 一個項目與性別的比較資料；來源連結依場次去重           |
| `athletes.json.gz`          | 姓名、出生年、單位、年份、項目與候選身分索引           |
| `athletes/{prefix}.json.gz` | 依身分雜湊前兩碼分片的歷屆成績                         |
| `archive.json.gz`           | 解壓後為所有賽事的 JSON 陣列，包含全部原始資料         |

開發與擷取時同時保留未壓縮 JSON；正式 build 只發布壓縮檔與小型 manifest。網頁使用瀏覽器的 `DecompressionStream` 在本機解壓、計算統計與搜尋選手；分享網址會包含篩選條件與輸入成績。程式碼公開授權不代表取得來源資料的授權；使用資料時請保留來源、擷取日期與原始賽事更正資訊。

## 統計與身分判斷

百分位的母體是**此資料庫中符合條件的參賽選手**，不是全台人口常模，也不是各年齡應達成的標準。預設每位候選選手只取一次最佳成績；可改為每次出賽各計一次。以比自己更好的樣本數加一計算競賽排名，因此同成績有相同排名；門檻使用線性插值分位數。

- 徑賽時間越低越好，田賽距離／高度越高越好。
- 當年年齡＝比賽西元年份－來源出生年，實際足歲可能少一歲。
- 未提供出生年不推測年齡；沒有明確年級資料就不由年齡換算年級。
- 年齡曲線是不同參賽者的橫斷比較，不代表同一個人的成長或因果效果。
- 個人項目、接力、全能與全能分項分開，分析頁只計個人項目。
- 器材重量與欄高分開；`m` 與 `公尺` 等可確認為同單位的寫法會統一，未記載規格的資料獨立保留。
- 已知風速 ≤ +2.0 的選項會排除風速未提供的成績；不宣稱完成所有計時方式或競賽規則的合法性認證。
- 同名、同性別、同出生年是候選身分；若同場賽事出現不同編號與不同單位，會依單位拆成待核對候選身分；沒有出生年時，以同名、同性別、同學校分組。轉學、學校改名、同名同出生年與中英文姓名都可能導致誤合或拆分。

`scripts/identity.mjs` 只接受附公開證據與理由的身分例外。例如林昱堂／YU TANG LIN 的例外，同時要求男性與出生年 2000，並附田協原始中英文成績與 World Athletics 檔案；不因姓名相似就補造出生年。

## 更新與部署

`.github/workflows/deploy.yml` 使用 GitHub Actions 部署 GitHub Pages。推送 `main`、手動執行及每月排程都會執行檢查與 build。

- 每月臺灣時間 **2 日 03:17** 重新擷取全部來源。GitHub 排程可能延後執行。
- 一般 build 下載 GitHub Release `dataset` 的 `tfmeet-data.tar.gz`，資料不進 Git history。
- 手動執行可勾選 `refresh` 強制更新來源；快照不存在時也會完整擷取。
- 更新完成後驗證賽事 ID、場次數、每一列解析、總筆數與分析索引一致性，再更新 Release 快照。
- 總筆數或任一賽事比上一版少超過 10% 成績，或賽事清單縮減時，工作會失敗，保留目前已部署的網站，供人工檢查。
- 原始 HTML 快取留在 Actions cache；資料完整度與失敗清單留在網站及 workflow artifact，JSON 不回寫 branch。
- 網站的「資料更新」是來源擷取完成日期，不是單純 build 日期。

GitHub Pages 設定為 Actions (`build_type: workflow`)，`public/CNAME` 指向 `tfmeet.emtech.cc`。Cloudflare DNS 使用 **DNS only** 的 CNAME `tfmeet → elvisdragonmao.github.io`，由 GitHub Pages 供應 TLS。

## 可延伸的分析

現有資料還適合做同項目同組別的歷年決賽／頒獎門檻、同一批選手跨年度留存與進步率、預賽到決賽的穩定度、學校的人才培育與轉銜，以及已知風速條件下的成績差異。這些分析須控制賽事層級、年齡、規格、有效樣本與候選身分，不能把參賽者更換直接解讀為訓練效果。
