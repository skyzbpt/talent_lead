# 健康諮詢表 → Notion 自動上傳（Cloudflare Worker 代理）

讓表單頁尾的「☁️ 上傳到 Notion」按鈕運作的後端。按一下，整筆諮詢
（基本資料、症狀評估、健檢數值、基因建議）就自動寫入 Notion 資料庫
「天領 Talent Lead｜健康諮詢紀錄」，一筆諮詢一頁。

```
瀏覽器表單 ──POST──▶ Cloudflare Worker（保管密鑰）──▶ Notion API ──▶ 資料庫新增一筆
```

**為什麼需要這一層**：Notion API 不允許瀏覽器直接呼叫（CORS 限制），
而且密鑰若寫進 HTML，任何拿到檔案的人都能存取你的 Notion。
Worker 免費、免維護伺服器，密鑰只存在 Cloudflare 的 Secret 裡。

---

## 一次性設定（約 10 分鐘）

### 步驟 1｜建立 Notion 整合，取得密鑰

1. 開啟 <https://www.notion.so/profile/integrations> → **New integration（新整合）**
2. 名稱填 `talent-lead-uploader`，工作區選你自己的，類型 **Internal**
3. 建立後複製 **內部整合密鑰**（`ntn_` 或 `secret_` 開頭）→ 步驟 4 會用到

### 步驟 2｜把資料庫連結給這個整合

1. 在 Notion 開啟資料庫「**天領 Talent Lead｜健康諮詢紀錄**」
2. 右上 **⋯** → **連結（Connections）** → 搜尋並加入 `talent-lead-uploader`

> ⚠️ 漏掉這步，上傳會回報 `Could not find database`。

### 步驟 3｜部署 Worker（用網頁貼上即可，免安裝）

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Worker**
2. 名稱取 `talent-lead-notion` → **Deploy**（先部署預設的 Hello World）
3. 點 **Edit code** → 全選刪除 → 貼上本資料夾 `worker.js` 的全部內容 → **Deploy**
4. 記下你的 Worker 網址：`https://talent-lead-notion.<你的帳號>.workers.dev`

### 步驟 4｜設定密鑰

Worker 頁面 → **Settings → Variables and Secrets** → 新增：

| 名稱 | 類型 | 值 |
|------|------|----|
| `NOTION_TOKEN` | **Secret** | 步驟 1 複製的整合密鑰 |
| `UPLOAD_KEY` | **Secret** | 自訂一組上傳金鑰（建議 20 字以上亂數），表單端要填一樣的 |
| `DATABASE_ID` | Text（選填） | 預設已指向健康諮詢紀錄資料庫，換資料庫才需要填 |

### 步驟 5｜表單端設定（每台填表裝置做一次）

1. 開啟健康諮詢表 → 頁尾 **「⚙ Notion 設定」**
2. 填入 Worker 網址與 `UPLOAD_KEY` → 儲存（只存在該裝置的瀏覽器）
3. 填一筆測試資料（**姓名必填**）→ 按 **「☁️ 上傳到 Notion」**
4. 到 Notion 資料庫看到新紀錄 → 完成 🎉

---

## 疑難排解

| 症狀 | 原因 / 解法 |
|------|-------------|
| 上傳金鑰錯誤（401） | 表單 ⚙ 設定的金鑰與 Worker 的 `UPLOAD_KEY` 不一致 |
| `Could not find database` | 步驟 2 沒把資料庫連結給整合；或 `DATABASE_ID` 打錯 |
| 尚未設定 NOTION_TOKEN（500） | 步驟 4 沒新增 Secret |
| `API token is invalid` | `NOTION_TOKEN` 貼錯或已撤銷，回步驟 1 重新產生 |
| Failed to fetch | Worker 網址打錯（需 `https://` 開頭）或裝置沒有網路 |

上傳失敗時，隨時可改用表單的「📋 複製諮詢資料」按鈕手動備援。

## 進階：用 wrangler CLI 部署

```bash
cd notion-worker
npx wrangler deploy
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put UPLOAD_KEY
```

## 安全性說明

- Notion 密鑰只存在 Cloudflare Secret，不會出現在 HTML、GitHub 或任何裝置上。
- `UPLOAD_KEY` 防止知道 Worker 網址的人任意寫入資料庫；金鑰只存於填表裝置的瀏覽器。
- 全程 HTTPS 傳輸；表單資料只在你主動按「上傳」時才送出。
