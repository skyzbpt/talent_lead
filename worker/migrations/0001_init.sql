-- 天領 Talent Lead｜健康諮詢紀錄（Cloudflare D1）
-- 一筆諮詢 = 一列；常查欄位獨立存放，完整表單內容以 JSON 存在 form 欄位。
CREATE TABLE IF NOT EXISTS consults (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  consult_date TEXT,
  gender       TEXT,
  age          INTEGER,
  risk_pct     INTEGER,
  risk_label   TEXT,
  advisor      TEXT,
  form         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consults_updated ON consults (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_consults_name ON consults (name);
