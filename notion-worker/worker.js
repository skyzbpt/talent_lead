/* 天領 Talent Lead ─ 健康諮詢表 → Notion 上傳代理（Cloudflare Worker）
 *
 * 職責：安全保管 Notion 密鑰，接收表單送來的 JSON，寫入 Notion 資料庫
 * 「天領 Talent Lead｜健康諮詢紀錄」，一筆諮詢 = 一頁（欄位＋內文明細）。
 *
 * 環境變數（Worker → Settings → Variables and Secrets）：
 *   NOTION_TOKEN  (Secret)      Notion 內部整合密鑰（ntn_ / secret_ 開頭）
 *   UPLOAD_KEY    (Secret)      自訂上傳金鑰，需與表單「設定 → Notion 上傳」填的一致
 *   DATABASE_ID   (Text, 選填)  目標資料庫 ID，預設為健康諮詢紀錄資料庫
 *
 * 部署與設定步驟詳見同資料夾 README.md
 */

const DEFAULT_DATABASE_ID = "8419bf62-ec81-48b4-8515-86919f543b4a";
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Upload-Key",
  "Access-Control-Max-Age": "86400",
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json;charset=utf-8", ...CORS },
  });

/* Notion rich_text；單段上限 2000 字，超過自動分段 */
function rt(s) {
  s = String(s ?? "");
  const out = [];
  for (let i = 0; i < s.length; i += 2000)
    out.push({ type: "text", text: { content: s.slice(i, i + 2000) } });
  return out.length ? out : [{ type: "text", text: { content: "" } }];
}
const propText  = s => ({ rich_text: rt(s) });
const propNum   = v => { const n = parseFloat(v); return isNaN(n) ? null : { number: n }; };
const propDate  = v => (v ? { date: { start: String(v) } } : null);
const propSel   = v => (v ? { select: { name: String(v).slice(0, 100) } } : null);
const propMulti = a => (Array.isArray(a) && a.length
  ? { multi_select: a.filter(Boolean).map(n => ({ name: String(n).slice(0, 100) })) }
  : null);

/* 表單健檢項目名稱 → 資料庫數值欄位 */
const LAB_COLUMN = {
  "總膽固醇": "總膽固醇", "三酸甘油脂": "三酸甘油脂",
  "低密度脂蛋白 LDL": "LDL", "高密度脂蛋白 HDL": "HDL",
  "收縮壓": "收縮壓", "舒張壓": "舒張壓",
  "空腹血糖": "空腹血糖", "糖化血色素 HbA1c": "HbA1c",
};

function buildProperties(p) {
  const props = { "姓名": { title: rt(String(p.name || "未命名").slice(0, 200)) } };
  const set = (k, v) => { if (v != null) props[k] = v; };
  const setText = (k, s) => { if (s) props[k] = propText(s); };

  set("諮詢日期", propDate(p.date));
  set("初/復次", propNum(p.visit));
  set("性別", propSel(p.gender));
  set("生日", propDate(p.birth));
  set("年紀", propNum(p.age));
  setText("職業", p.job);
  setText("健康顧問", p.advisor);
  setText("目前問題主述", p.chief);
  setText("過去及家族病史", p.history);
  set("慢性指標", propMulti(p.chronic));
  setText("慢性其他", p.chronicOther);
  setText("用藥情況", p.meds);
  set("自評健康分數", propNum(p.selfScore));
  set("諮詢期待", propMulti(p.expects));
  set("身高cm", propNum(p.height));
  set("體重kg", propNum(p.weight));
  set("體脂%", propNum(p.fat));
  set("內臟脂肪", propNum(p.visceral));

  const sections = p.sections || [];
  if (sections.length) {                       // 沒填症狀就不寫風險，避免 0 分誤導
    set("整體風險指數", propNum(p.riskPct));
    set("風險等級", propSel(p.riskLabel));
    setText("各系統風險摘要",
      sections.map(s => `${s.title} 🔴${s.red} 🟡${s.yellow} 🟢${s.green}`).join("；"));
  }

  set("健檢日期", propDate(p.labDate));
  setText("健檢頻率", p.labFreq);
  (p.labs || []).forEach(l => { const col = LAB_COLUMN[l.label]; if (col) set(col, propNum(l.value)); });
  setText("其他健檢項目", (p.labsText || []).map(l => `${l.label}：${l.value}`).join("；"));
  set("促進健康方式", propMulti(p.promote));
  setText("主要問題與改善建議",
    (p.genePairs || []).map(x => `${x.i}. ${x.prob || "—"} → ${x.impr || "—"}`).join("；"));
  return props;
}

function buildChildren(p) {
  const b = [];
  const h2 = t => ({ heading_2: { rich_text: rt(t) } });
  const h3 = t => ({ heading_3: { rich_text: rt(t) } });
  const bullet = t => ({ bulleted_list_item: { rich_text: rt(t) } });
  const para = t => ({ paragraph: { rich_text: rt(t) } });
  const MARK = { red: "🔴", yellow: "🟡", green: "🟢" };

  b.push({ callout: { icon: { type: "emoji", emoji: "📋" },
    rich_text: rt(`由健康諮詢表上傳${p.uploadedAt ? " · " + p.uploadedAt : ""}`) } });

  // 只寫進頁面內文（不寫欄位），資料庫不需要新增欄位
  const m = p.metrics || {};
  const vitals = [
    p.bmi && `BMI：${p.bmi}${p.bmiLabel ? `（${p.bmiLabel}）` : ""}`,
    m.sleep && `睡眠時間：${m.sleep} 小時`,
    m.stress && `壓力指數：${m.stress} / 10`,
    m.vitality && `活力指數：${m.vitality} / 10`,
  ].filter(Boolean);
  if (vitals.length) { b.push(h2("體位與生活指標")); vitals.forEach(t => b.push(bullet(t))); }

  const secs = (p.sections || []).filter(s => (s.items || []).length);
  if (secs.length) {
    b.push(h2("各系統症狀評估"));
    secs.forEach(s => {
      b.push(h3(`${s.title}（🔴${s.red} 🟡${s.yellow} 🟢${s.green}）`));
      s.items.forEach(it => {
        const det = [it.state, it.deg && `程度${it.deg}`, it.freq && `${it.freq}次/週`,
          it.dur, it.fix && `改善：${it.fix}`, it.note && `備註：${it.note}`].filter(Boolean).join("，");
        b.push(bullet(`${MARK[it.level] || ""} ${it.name}${det ? `（${det}）` : ""}`));
      });
    });
  }

  const labLines = [
    ...(p.labs || []).map(l =>
      `${l.label}：${l.value} ${l.unit || ""}${l.med ? `（${l.med}）` : ""}${l.abnormal ? " ⚠異常" : ""}`),
    ...(p.labsText || []).map(l => `${l.label}：${l.value}`),
  ];
  if (labLines.length) { b.push(h2("健康檢查明細")); labLines.forEach(t => b.push(bullet(t))); }

  if ((p.genePairs || []).length) {
    b.push(h2("基因建議 — 主要問題與對應改善"));
    p.genePairs.forEach(x => b.push(bullet(`${x.i}. 問題：${x.prob || "—"} → 改善：${x.impr || "—"}`)));
  }

  b.push(para("天領 Talent Lead · 本紀錄僅供健康諮詢參考，不構成醫療診斷"));
  return b;
}

async function notion(env, path, method, body) {
  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Notion API ${res.status}`);
  return data;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "POST") return json({ error: "只接受 POST" }, 405);
    if (!env.NOTION_TOKEN)
      return json({ error: "Worker 尚未設定 NOTION_TOKEN（Settings → Variables and Secrets）" }, 500);
    if (env.UPLOAD_KEY && request.headers.get("X-Upload-Key") !== env.UPLOAD_KEY)
      return json({ error: "上傳金鑰錯誤，請檢查表單「設定 → Notion 上傳」的金鑰" }, 401);

    let p;
    try { p = await request.json(); } catch { return json({ error: "JSON 格式錯誤" }, 400); }
    if (!p || typeof p !== "object") return json({ error: "資料格式錯誤" }, 400);

    try {
      const children = buildChildren(p);
      const page = await notion(env, "/pages", "POST", {
        parent: { database_id: env.DATABASE_ID || DEFAULT_DATABASE_ID },
        icon: { type: "emoji", emoji: "🩺" },
        properties: buildProperties(p),
        children: children.slice(0, 100),      // Notion 建頁上限 100 blocks
      });
      const rest = children.slice(100);        // 超出部分分批追加
      for (let i = 0; i < rest.length; i += 100)
        await notion(env, `/blocks/${page.id}/children`, "PATCH", { children: rest.slice(i, i + 100) });
      return json({ ok: true, url: page.url });
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
  },
};
