/* 天領 Talent Lead ─ 健康諮詢表 API（Cloudflare Worker + D1）
 *
 * 職責：把表單的諮詢紀錄存進 D1 資料庫 talent-lead-db，並提供查詢、讀取、刪除。
 *
 * 綁定與變數（Worker → Settings）：
 *   DB       (D1 binding)  指向資料庫 talent-lead-db（wrangler.toml 已設定）
 *   API_KEY  (Secret)      存取金鑰，需與表單「設定 → 雲端資料庫」填的一致。
 *                          未設定時，所有請求一律拒絕（資料是個案健康資料，不開放匿名存取）。
 *
 * API（皆需帶 X-Upload-Key 標頭）：
 *   GET    /consults?q=姓名&limit=50   列表（不含表單內容）
 *   GET    /consults/:id               讀取單筆（含完整表單內容）
 *   PUT    /consults/:id               新增或更新（同一 id 重複儲存只會更新，不會多一筆）
 *   DELETE /consults/:id               刪除
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Upload-Key",
  "Access-Control-Max-Age": "86400",
};
const MAX_BODY = 1024 * 1024;           // 單筆上限 1 MB
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json;charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });

/* 以雜湊後逐位元比對，避免金鑰長度與比對時間洩漏資訊 */
async function keyMatches(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given || "")),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const str = (v, max) => (v == null ? "" : String(v).trim().slice(0, max));
const int = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

async function listConsults(env, url) {
  const q = str(url.searchParams.get("q"), 50);
  const limit = Math.min(Math.max(int(url.searchParams.get("limit")) || 50, 1), 200);
  const like = "%" + q.replace(/[\\%_]/g, c => "\\" + c) + "%";
  const stmt = q
    ? env.DB.prepare(`SELECT id,name,consult_date,gender,age,risk_pct,risk_label,advisor,updated_at
        FROM consults WHERE name LIKE ?1 ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?2`).bind(like, limit)
    : env.DB.prepare(`SELECT id,name,consult_date,gender,age,risk_pct,risk_label,advisor,updated_at
        FROM consults ORDER BY updated_at DESC LIMIT ?1`).bind(limit);
  const { results } = await stmt.all();
  return json({ ok: true, items: results });
}

async function getConsult(env, id) {
  const row = await env.DB.prepare(
    `SELECT id,name,consult_date,gender,age,risk_pct,risk_label,advisor,form,created_at,updated_at
     FROM consults WHERE id = ?1`).bind(id).first();
  if (!row) return json({ error: "找不到這筆紀錄" }, 404);
  let form;
  try { form = JSON.parse(row.form); } catch { return json({ error: "這筆紀錄的內容已損毀" }, 500); }
  return json({ ok: true, item: { ...row, form } });
}

async function putConsult(env, request, id) {
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) return json({ error: "資料太大" }, 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: "資料太大" }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "JSON 格式錯誤" }, 400); }
  const s = body && body.summary, form = body && body.form;
  if (!s || typeof s !== "object" || !form || typeof form !== "object" || Array.isArray(form))
    return json({ error: "資料格式錯誤" }, 400);
  const name = str(s.name, 100);
  if (!name) return json({ error: "請先填寫個案姓名" }, 400);

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO consults (id,name,consult_date,gender,age,risk_pct,risk_label,advisor,form,created_at,updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)
     ON CONFLICT(id) DO UPDATE SET name=?2,consult_date=?3,gender=?4,age=?5,risk_pct=?6,risk_label=?7,
       advisor=?8,form=?9,updated_at=?10`
  ).bind(id, name, str(s.date, 10) || null, str(s.gender, 10) || null, int(s.age), int(s.riskPct),
         str(s.riskLabel, 20) || null, str(s.advisor, 50) || null, JSON.stringify(form), now).run();
  return json({ ok: true, id, updatedAt: now });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (!env.DB) return json({ error: "Worker 尚未綁定 D1 資料庫（綁定名稱需為 DB）" }, 500);
    if (!env.API_KEY) return json({ error: "Worker 尚未設定 API_KEY（Settings → Variables and Secrets）" }, 500);
    if (!(await keyMatches(request.headers.get("X-Upload-Key"), env.API_KEY)))
      return json({ error: "金鑰錯誤，請檢查表單「設定 → 雲端資料庫」的金鑰" }, 401);

    const url = new URL(request.url);
    const m = /^\/consults(?:\/([^/]+))?\/?$/.exec(url.pathname);
    if (!m) return json({ error: "找不到這個路徑" }, 404);
    const id = m[1];
    if (id && !ID_RE.test(id)) return json({ error: "紀錄編號格式錯誤" }, 400);

    try {
      if (!id && request.method === "GET") return await listConsults(env, url);
      if (id && request.method === "GET") return await getConsult(env, id);
      if (id && request.method === "PUT") return await putConsult(env, request, id);
      if (id && request.method === "DELETE") {
        await env.DB.prepare("DELETE FROM consults WHERE id = ?1").bind(id).run();
        return json({ ok: true });
      }
      return json({ error: "不支援這個操作" }, 405);
    } catch (e) {
      return json({ error: "資料庫錯誤：" + String(e.message || e) }, 500);
    }
  },
};
