// Meta webhook: verification (GET) + signed events (POST).
// Comment -> rule match -> private reply (optionally follow-first, then link button).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const env = (k: string) => Deno.env.get(k) ?? "";
const GV = env("META_GRAPH_VERSION") || "v21.0";
const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const enc = new TextEncoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const httpsOk = (u?: string | null) => !!u && /^https:\/\//i.test(u);
const DEFAULT_FOLLOW = 'Hi {{username}}! 👋 Please follow @{{account}} first, then tap "I\'ve followed" below to get your link.';
// deno-lint-ignore no-explicit-any
type Btn = Record<string, any>;

async function validSig(raw: string, header: string | null) {
  if (!header?.startsWith("sha256=") || !env("META_APP_SECRET")) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(env("META_APP_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hex = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(raw)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const a = enc.encode("sha256=" + hex), b = enc.encode(header);
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    if (url.searchParams.get("hub.mode") === "subscribe" && env("META_WEBHOOK_VERIFY_TOKEN") && url.searchParams.get("hub.verify_token") === env("META_WEBHOOK_VERIFY_TOKEN"))
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("", { status: 405 });
  const raw = await req.text();
  if (!(await validSig(raw, req.headers.get("x-hub-signature-256")))) return new Response("Invalid signature", { status: 401 });
  let body; try { body = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
  // @ts-ignore EdgeRuntime is provided by Supabase
  EdgeRuntime.waitUntil(processBody(body).catch((e) => console.error("process error:", e?.message)));
  return new Response("ok", { status: 200 });
});

// deno-lint-ignore no-explicit-any
async function processBody(body: any) {
  for (const entry of body.entry ?? []) {
    const { data: acct } = await sb.from("connected_instagram_accounts").select("*").eq("ig_user_id", String(entry.id)).eq("status", "connected").maybeSingle();
    if (!acct) continue;
    for (const ch of entry.changes ?? []) if (ch.field === "comments") await onComment(acct, ch.value ?? {});
    for (const m of entry.messaging ?? []) await onMessage(acct, m);
  }
}

const fill = (t: string, m: Record<string, string>) => String(t).replace(/\{\{\s*(username|keyword|post_url|account)\s*\}\}/g, (_: string, k: string) => m[k] ?? "");
// deno-lint-ignore no-explicit-any
const matches = (r: any, text: string, media?: string) => {
  const n = (s: string) => s.trim().toLowerCase();
  if (r.media_id && r.media_id !== media) return false;
  return r.match_type === "exact" ? n(text) === n(r.keyword) : n(text).includes(n(r.keyword));
};

// Sends a DM. With buttons it uses a button template (links are always tappable); if Instagram rejects that,
// it falls back to plain text with the links written out. Retries once on transient errors.
async function sendDM(token: string, recipient: Record<string, string>, text: string, buttons: Btn[]) {
  const url = `https://graph.instagram.com/${GV}/me/messages`;
  const post = async (message: unknown) => {
    // deno-lint-ignore no-explicit-any
    let last: { ok: boolean; status: number; j: any; attempt: number } = { ok: false, status: 0, j: {}, attempt: 0 };
    for (let a = 1; a <= 2; a++) {
      const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ recipient, message }) });
      last = { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})), attempt: a };
      if (r.ok || !(r.status >= 500 || r.status === 429)) break;
      if (a < 2) await sleep(2000);
    }
    return last;
  };
  if (buttons.length) {
    const res = await post({ attachment: { type: "template", payload: { template_type: "button", text: text.slice(0, 640), buttons } } });
    if (res.ok) return { ...res, mode: "button" };
  }
  let extra = buttons.filter((b) => b.type === "web_url").map((b) => `${b.title}: ${b.url}`).join("\n");
  if (buttons.some((b) => b.type === "postback")) extra += (extra ? "\n" : "") + "After you follow, reply DONE.";
  const res2 = await post({ text: (text + (extra ? "\n\n" + extra : "")).slice(0, 1000) });
  return { ...res2, mode: "text" };
}

// deno-lint-ignore no-explicit-any
const followButtons = (acct: any, ruleId: string): Btn[] => [
  ...(acct.username ? [{ type: "web_url", url: `https://www.instagram.com/${acct.username}/`, title: "Follow" }] : []),
  { type: "postback", title: "I've followed", payload: `fg:${ruleId}` },
];
// deno-lint-ignore no-explicit-any
const linkButtons = (rule: any): Btn[] => httpsOk(rule.link_url) ? [{ type: "web_url", url: rule.link_url, title: String(rule.link_label || "Open link").slice(0, 20) }] : [];

// deno-lint-ignore no-explicit-any
async function saveOut(acct: any, igUserId: string, leadId: string | null, body: string, mid?: string) {
  const now = new Date().toISOString();
  const { data: cv } = await sb.from("conversations").upsert({ workspace_id: acct.workspace_id, ig_account_id: acct.id, ig_user_id: igUserId, lead_id: leadId, last_message_at: now }, { onConflict: "workspace_id,ig_account_id,ig_user_id" }).select("id").single();
  if (cv) await sb.from("messages").insert({ workspace_id: acct.workspace_id, conversation_id: cv.id, direction: "out", body, provider_message_id: mid ?? null });
}

const DEF_CFG = { posts: true, reels: true, max_per_day: 1000, dedupe_user: true, add_leads: true, save_comments: true, track_source: true };
async function getCfg(ws: string) {
  const { data } = await sb.from("integration_settings").select("config").eq("workspace_id", ws).eq("provider", "automation").maybeSingle();
  return { ...DEF_CFG, ...((data?.config as Record<string, unknown>) ?? {}) } as typeof DEF_CFG;
}

// deno-lint-ignore no-explicit-any
async function onComment(acct: any, v: any) {
  const cid = String(v.id ?? ""), from = v.from ?? {}, text = String(v.text ?? "");
  if (!cid || String(from.id) === acct.ig_user_id || v.parent_id) return;
  const cfg = await getCfg(acct.workspace_id);
  const ins = await sb.from("automation_events").insert({ workspace_id: acct.workspace_id, ig_account_id: acct.id, provider_event_id: cid, event_type: "comment", payload: { text: cfg.save_comments ? text : null, from_username: from.username, from_id: from.id, media_id: cfg.track_source ? v.media?.id : null } }).select("id").single();
  if (ins.error) { if (ins.error.code === "23505") return; throw ins.error; } // duplicate delivery: already handled
  const evId = ins.data.id;
  const done = (status: string, error?: string) => sb.from("automation_events").update({ status, error: error ?? null, processed_at: new Date().toISOString() }).eq("id", evId);

  const isReel = String(v.media?.media_product_type ?? "").toUpperCase() === "REELS";
  if (isReel && !cfg.reels) return void (await done("skipped", "Comments on Reels are turned off in Automation settings."));
  if (!isReel && !cfg.posts) return void (await done("skipped", "Comments on Posts are turned off in Automation settings."));
  const { data: rules } = await sb.from("automation_rules").select("*, dm_templates(body,status)").eq("ig_account_id", acct.id).eq("status", "active").order("priority");
  // deno-lint-ignore no-explicit-any
  const rule = (rules ?? []).find((r: any) => matches(r, text, v.media?.id) && r.dm_templates?.status === "active");
  if (!rule) return void (await done("skipped", "No matching rule."));

  await sb.from("automation_events").update({ rule_id: rule.id, status: "matched" }).eq("id", evId);
  let lead: { id: string } | null = null;
  if (cfg.add_leads) {
    const r = await sb.from("leads").upsert({ workspace_id: acct.workspace_id, ig_account_id: acct.id, ig_user_id: String(from.id), username: from.username ?? null, source: "comment", keyword: rule.keyword, last_activity_at: new Date().toISOString() }, { onConflict: "workspace_id,ig_account_id,ig_user_id" }).select("id").single();
    lead = r.data;
  }

  const { data: sub } = await sb.from("subscriptions").select("status").eq("workspace_id", acct.workspace_id).maybeSingle();
  if (sub && !["active", "trialing", "canceled"].includes(sub.status)) return void (await done("skipped", "Subscription is not active."));
  const { data: tok } = await sb.from("instagram_tokens").select("access_token").eq("account_id", acct.id).maybeSingle();
  if (!tok) return void (await done("failed", "Account token missing. Reconnect Instagram."));
  if (cfg.dedupe_user) {
    const since = new Date(Date.now() - 864e5).toISOString();
    const { count: prior } = await sb.from("automation_events").select("id", { count: "exact", head: true }).eq("rule_id", rule.id).eq("status", "sent").eq("payload->>from_id", String(from.id)).gte("created_at", since).neq("id", evId);
    if ((prior ?? 0) > 0) return void (await done("skipped", "Already sent to this user by this rule in the last 24 hours."));
  }
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const { count: today } = await sb.from("automation_events").select("id", { count: "exact", head: true }).eq("workspace_id", acct.workspace_id).eq("status", "sent").gte("created_at", dayStart.toISOString());
  if ((today ?? 0) >= Number(cfg.max_per_day)) return void (await done("skipped", "Daily DM limit from Automation settings reached."));
  const { data: ok } = await sb.rpc("consume_dm", { ws: acct.workspace_id });
  if (!ok) return void (await done("skipped", "Monthly DM limit reached for your plan."));

  await sleep(Math.min(Number(rule.delay_seconds) || 0, 10) * 1000);
  let postUrl = "";
  if (v.media?.id) { const { data: p } = await sb.from("posts_cache").select("permalink").eq("ig_account_id", acct.id).eq("media_id", v.media.id).maybeSingle(); postUrl = p?.permalink ?? ""; }
  const mv = { username: from.username ?? "", keyword: rule.keyword, post_url: postUrl, account: acct.username ?? "" };
  // Follow-first: send the follow prompt now; the link message is sent after the follow is verified.
  const text1 = rule.require_follow ? fill(rule.follow_message || DEFAULT_FOLLOW, mv) : fill(rule.dm_templates.body, mv);
  const btn1 = rule.require_follow ? followButtons(acct, rule.id) : linkButtons(rule);
  const res = await sendDM(tok.access_token, { comment_id: cid }, text1, btn1);

  await sb.from("message_logs").insert({ workspace_id: acct.workspace_id, event_id: evId, rule_id: rule.id, status: res.ok ? "sent" : "failed", http_status: res.status, provider_response: res.ok ? { message_id: res.j.message_id, mode: res.mode } : { error: { message: res.j.error?.message, code: res.j.error?.code } }, attempt: res.attempt });
  if (!res.ok) return void (await done("failed", res.j.error?.message ?? `Instagram returned ${res.status}.`));
  await done("sent", rule.require_follow ? "Follow request sent. Link is sent after they follow." : undefined);
  if (rule.require_follow) await sb.from("follow_gates").upsert({ workspace_id: acct.workspace_id, ig_account_id: acct.id, rule_id: rule.id, event_id: evId, ig_user_id: String(from.id), username: from.username ?? null, status: "pending", created_at: new Date().toISOString(), completed_at: null }, { onConflict: "ig_account_id,ig_user_id,rule_id" });
  await saveOut(acct, String(from.id), lead?.id ?? null, text1, res.j.message_id);
}

// The user tapped "I've followed" (or replied DONE). Verify the follow with Instagram, then send the link.
// deno-lint-ignore no-explicit-any
async function handleFollow(acct: any, igsid: string, ruleId: string) {
  const { data: rule } = await sb.from("automation_rules").select("*, dm_templates(body,status)").eq("id", ruleId).eq("ig_account_id", acct.id).maybeSingle();
  if (!rule || rule.status !== "active" || rule.dm_templates?.status !== "active") return;
  const { data: tok } = await sb.from("instagram_tokens").select("access_token").eq("account_id", acct.id).maybeSingle();
  if (!tok) return;
  const { data: gate } = await sb.from("follow_gates").select("*").eq("ig_account_id", acct.id).eq("ig_user_id", igsid).eq("rule_id", ruleId).maybeSingle();
  if (gate?.status === "completed" && gate.completed_at && Date.now() - new Date(gate.completed_at).getTime() < 30000) return; // duplicate delivery
  const log = (status: string, resp: unknown, http: number) => sb.from("message_logs").insert({ workspace_id: acct.workspace_id, event_id: gate?.event_id ?? null, rule_id: ruleId, status, http_status: http, provider_response: resp, attempt: 1 });

  const r = await fetch(`https://graph.instagram.com/${GV}/${igsid}?fields=is_user_follow_business`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    await log("failed", { step: "follow_check", error: { message: j.error?.message, code: j.error?.code } }, r.status);
    if (gate?.event_id) await sb.from("automation_events").update({ error: "Follow check failed: " + (j.error?.message ?? r.status) }).eq("id", gate.event_id);
    await sendDM(tok.access_token, { id: igsid }, "We couldn't verify your follow right now. Please try again in a minute.", []);
    return;
  }
  const mv = { username: gate?.username ?? "", keyword: rule.keyword, post_url: "", account: acct.username ?? "" };
  if (!j.is_user_follow_business) {
    await sendDM(tok.access_token, { id: igsid }, fill(`We can't see your follow yet 🙏 Please follow @{{account}}, then tap "I've followed" again.`, mv), followButtons(acct, ruleId));
    return;
  }
  const body = fill(rule.dm_templates.body, mv);
  const res = await sendDM(tok.access_token, { id: igsid }, body, linkButtons(rule));
  await log(res.ok ? "sent" : "failed", res.ok ? { step: "link", message_id: res.j.message_id, mode: res.mode } : { step: "link", error: { message: res.j.error?.message, code: res.j.error?.code } }, res.status);
  if (!res.ok) { if (gate?.event_id) await sb.from("automation_events").update({ error: "Link message failed: " + (res.j.error?.message ?? res.status) }).eq("id", gate.event_id); return; }
  await sb.from("follow_gates").upsert({ workspace_id: acct.workspace_id, ig_account_id: acct.id, rule_id: ruleId, ig_user_id: igsid, status: "completed", completed_at: new Date().toISOString() }, { onConflict: "ig_account_id,ig_user_id,rule_id" });
  await sb.from("leads").update({ status: "contacted", last_activity_at: new Date().toISOString() }).eq("ig_account_id", acct.id).eq("ig_user_id", igsid).eq("status", "new");
  await saveOut(acct, igsid, null, body, res.j.message_id);
}

// deno-lint-ignore no-explicit-any
async function onMessage(acct: any, m: any) {
  const sender = String(m.sender?.id ?? "");
  if (!sender || sender === acct.ig_user_id) return;
  const payload = m.postback?.payload;
  if (typeof payload === "string" && payload.startsWith("fg:")) return void (await handleFollow(acct, sender, payload.slice(3)));
  const mid = m.message?.mid;
  if (!m.message || m.message.is_echo) return;
  if (mid) { const { data: dup } = await sb.from("messages").select("id").eq("workspace_id", acct.workspace_id).eq("provider_message_id", mid).maybeSingle(); if (dup) return; }
  const now = new Date().toISOString();
  await sb.from("leads").upsert({ workspace_id: acct.workspace_id, ig_account_id: acct.id, ig_user_id: sender, source: "dm" }, { onConflict: "workspace_id,ig_account_id,ig_user_id", ignoreDuplicates: true });
  const { data: lead } = await sb.from("leads").select("id").eq("workspace_id", acct.workspace_id).eq("ig_account_id", acct.id).eq("ig_user_id", sender).maybeSingle();
  await sb.from("leads").update({ last_activity_at: now }).eq("id", lead?.id ?? "");
  const { data: ex } = await sb.from("conversations").select("id,unread_count").eq("workspace_id", acct.workspace_id).eq("ig_account_id", acct.id).eq("ig_user_id", sender).maybeSingle();
  let cid = ex?.id as string | undefined;
  if (ex) await sb.from("conversations").update({ unread_count: ex.unread_count + 1, last_message_at: now, status: "open" }).eq("id", ex.id);
  else cid = (await sb.from("conversations").insert({ workspace_id: acct.workspace_id, ig_account_id: acct.id, ig_user_id: sender, lead_id: lead?.id ?? null, unread_count: 1, last_message_at: now }).select("id").single()).data?.id;
  if (cid) await sb.from("messages").insert({ workspace_id: acct.workspace_id, conversation_id: cid, direction: "in", body: m.message.text ?? "[attachment]", provider_message_id: mid ?? null });
  // Fallback when buttons were not supported: any reply while a follow request is pending triggers the check.
  if (m.message.text) {
    const { data: g } = await sb.from("follow_gates").select("rule_id").eq("ig_account_id", acct.id).eq("ig_user_id", sender).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (g?.rule_id) await handleFollow(acct, sender, g.rule_id);
  }
}
