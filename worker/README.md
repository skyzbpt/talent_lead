# 健康諮詢表 → Cloudflare 雲端資料庫（Worker + D1）

讓表單的「儲存到雲端」與「歷史紀錄」運作的後端。每筆諮詢存成資料庫的一列，
同一位個案重複儲存只會更新同一筆；也可以在任何裝置搜尋姓名、載入、刪除舊紀錄。

```
瀏覽器表單 ──HTTPS + 金鑰──▶ Cloudflare Worker ──▶ D1 資料庫 talent-lead-db
```

資料庫已建立：`talent-lead-db`（ID `9278bc12-7a5b-4542-a434-ce582b6ef0ee`，亞太區），
資料表 `consults` 的結構在 `migrations/0001_init.sql`。

---

## 部署（一次性，約 5 分鐘）

需要 Node.js 與 Cloudflare 帳號（登入同一個放有 `talent-lead-db` 的帳號）。

```bash
cd worker
npx wrangler login
npx wrangler d1 migrations apply talent-lead-db --remote   # 建立資料表（已建過也安全）
npx wrangler deploy                                         # 部署，會印出 Worker 網址
npx wrangler secret put API_KEY                             # 輸入自訂存取金鑰（建議 20 字以上亂數）
```

部署完會得到網址 `https://talent-lead-api.<你的帳號>.workers.dev`。

### 表單端設定（每台填表裝置做一次）

1. 開啟表單 → **設定 → 雲端資料庫**
2. 填入 Worker 網址與 `API_KEY` → 按 **測試連線**，出現「連線成功」→ 儲存
3. 填一筆測試資料（**姓名必填**）→ **儲存到雲端** → 到 **歷史紀錄** 看得到即完成

---

## 使用方式

| 操作 | 說明 |
|------|------|
| 儲存到雲端 | 第一次新增、之後同一筆諮詢會更新，不會重複 |
| 歷史紀錄 | 用姓名搜尋，點名稱載入回表單繼續編輯，垃圾桶可刪除 |
| 開始新諮詢 | 會產生新的紀錄編號，不會覆蓋舊紀錄 |

## API

所有請求都需要標頭 `X-Upload-Key: <API_KEY>`；沒有設定 `API_KEY` 時，Worker 會拒絕所有請求。

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/consults?q=姓名&limit=50` | 列表（不含表單內容） |
| GET | `/consults/:id` | 讀取單筆（含完整表單內容） |
| PUT | `/consults/:id` | 新增或更新，body：`{summary, form}` |
| DELETE | `/consults/:id` | 刪除 |

## 疑難排解

| 症狀 | 原因 / 解法 |
|------|-------------|
| 金鑰錯誤（401） | 表單「設定」的金鑰與 Worker 的 `API_KEY` 不一致 |
| 尚未設定 API_KEY（500） | 還沒執行 `wrangler secret put API_KEY` |
| 尚未綁定 D1（500） | 用 `wrangler deploy` 部署（會讀取 `wrangler.toml` 的綁定）；若在網頁貼程式碼，需在 Settings → Bindings 新增 D1，綁定名稱 `DB` |
| `no such table: consults` | 沒執行 migrations，回到部署步驟第 2 行 |
| Failed to fetch | Worker 網址打錯（需 `https://` 開頭）或裝置沒有網路 |

儲存失敗時，隨時可改用表單的「複製文字」按鈕手動備援。

## 安全性說明

- 內容是個案健康資料：存取金鑰只放在 Cloudflare Secret 與填表裝置的瀏覽器，不會出現在 HTML 或 GitHub。
- 金鑰以雜湊後比對；沒有金鑰一律拒絕，沒有匿名讀取。
- 全程 HTTPS；表單資料只在你按「儲存到雲端」時才送出。
- 建議定期更換 `API_KEY`（重新執行 `wrangler secret put API_KEY`，並更新各裝置的設定）。
