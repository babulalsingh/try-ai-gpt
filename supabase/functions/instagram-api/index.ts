// Authenticated actions: sync_posts, send_message, disconnect, test_connection.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const env = (k: string) => Deno.env.get(k) ?? "";
const GV = env("META_GRAPH_VERSION") || "v21.0";
const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const cors = { "Access-Control-Allow-Origin": env("APP_BASE_URL") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (m: string, s = 400) => json({ error: m }, s);


// ---- Test DM helpers (same message building as the webhook) ----
// deno-lint-ignore no-explicit-any
type Btn = Record<string, any>;
const httpsOk = (u?: string | null) => !!u && /^https:\/\//i.test(u);
const fill = (t: string, m: Record<string, string>) => String(t).replace(/\{\{\s*(username|keyword|post_url|account)\s*\}\}/g, (_: string, k: string) => m[k] ?? "");
const DEFAULT_FOLLOW = 'Hi {{username}}! 👋 Please follow @{{account}} first, then tap "I\'ve followed" below to get your link.';
// deno-lint-ignore no-explicit-any
const ruleMatches = (r: any, text: string) => { const n = (x: string) => x.trim().toLowerCase(); return r.match_type === "exact" ? n(text) === n(r.keyword) : n(text).includes(n(r.keyword)); };
async function sendDM(token: string, recipient: Record<string, string>, text: string, buttons: Btn[]) {
  const url = `https://graph.instagram.com/${GV}/me/messages`;
  const post = async (message: unknown) => {
    const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ recipient, message }) });
    return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) };
  };
  if (buttons.length) {
    const res = await post({ attachment: { type: "template", payload: { template_type: "button", text: text.slice(0, 640), buttons } } });
    if (res.ok) return { ...res, mode: "button" };
  }
  let extra = buttons.filter((b) => b.type === "web_url").map((b) => `${b.title}: ${b.url}`).join("\n");
  if (buttons.some((b) => b.type === "postback")) extra += (extra ? "\n" : "") + "After you follow, reply DONE.";
  return { ...(await post({ text: (text + (extra ? "\n\n" + extra : "")).slice(0, 1000) })), mode: "text" };
}

async function role(ws: string, uid: string) {
  const { data } = await sb.from("workspace_members").select("role").eq("workspace_id", ws).eq("user_id", uid).eq("status", "active").maybeSingle();
  return data?.role as string | undefined;
}
async function account(id: string) {
  const { data: a } = await sb.from("connected_instagram_accounts").select("*").eq("id", id).maybeSingle();
  if (!a) return null;
  const { data: t } = await sb.from("instagram_tokens").select("access_token").eq("account_id", id).maybeSingle();
  return { ...a, token: t?.access_token as string | undefined };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: { user } } = await sb.auth.getUser(jwt);
  if (!user) return fail("Not signed in.", 401);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "send_message") {
      const { data: cv } = await sb.from("conversations").select("*").eq("id", body.conversation_id).maybeSingle();
      if (!cv) return fail("Conversation not found.", 404);
      if (!["owner", "admin", "moderator", "support"].includes((await role(cv.workspace_id, user.id)) ?? "")) return fail("Not allowed.", 403);
      const text = String(body.text ?? "").trim();
      if (!text || text.length > 1000) return fail("Message must be 1-1000 characters.");
      const a = await account(cv.ig_account_id);
      if (!a?.token || a.status !== "connected") return fail("Instagram account is not connected. Reconnect it.");
      const r = await fetch(`https://graph.instagram.com/${GV}/me/messages`, { method: "POST", headers: { Authorization: `Bearer ${a.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ recipient: { id: cv.ig_user_id }, message: { text } }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return fail(j.error?.message || "Instagram did not accept this message (the messaging window may have closed).", 400);
      await sb.from("messages").insert({ workspace_id: cv.workspace_id, conversation_id: cv.id, direction: "out", body: text, provider_message_id: j.message_id ?? null, sent_by: user.id });
      await sb.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", cv.id);
      return json({ ok: true });
    }
    if (body.action === "send_test") {
      const { data: rule } = await sb.from("automation_rules").select("*, dm_templates(body,status)").eq("id", body.rule_id).maybeSingle();
      if (!rule) return fail("Rule not found.", 404);
      if (!["owner", "admin", "moderator"].includes((await role(rule.workspace_id, user.id)) ?? "")) return fail("Not allowed.", 403);
      const raw = String(body.recipient ?? "").trim();
      if (!raw) return fail("Enter the Instagram user ID or @username of the person to test with.");
      if (!ruleMatches(rule, String(body.text ?? ""))) return fail("This test comment does not match the rule, so nothing was sent.");
      if (rule.dm_templates?.status !== "active") return fail("The template for this rule is missing or archived.");
      const a = await account(rule.ig_account_id);
      if (!a?.token || a.status !== "connected") return fail("Instagram account is not connected. Reconnect it.");
      const handle = raw.replace(/^@/, "");
      if (handle === a.ig_user_id || handle.toLowerCase() === String(a.username ?? "").toLowerCase()) return fail("This is your own account (not self ID). Enter another person's Instagram ID or @username.");
      const hourAgo = new Date(Date.now() - 3600e3).toISOString();
      const { count: recent } = await sb.from("messages").select("id", { count: "exact", head: true }).eq("sent_by", user.id).gte("created_at", hourAgo);
      if ((recent ?? 0) >= 30) return fail("Too many test messages this hour. Try again later.", 429);
      let igsid = "", username: string | null = null;
      if (/^\d+$/.test(handle)) {
        igsid = handle;
        const { data: ld } = await sb.from("leads").select("username").eq("workspace_id", rule.workspace_id).eq("ig_account_id", a.id).eq("ig_user_id", igsid).maybeSingle();
        username = ld?.username ?? null;
      } else {
        const { data: ld } = await sb.from("leads").select("ig_user_id,username").eq("workspace_id", rule.workspace_id).eq("ig_account_id", a.id).eq("username", handle.toLowerCase()).limit(1).maybeSingle();
        if (!ld) return fail(`We do not know @${handle} yet. Enter their numeric Instagram ID, or ask them to message or comment on your account first.`);
        igsid = ld.ig_user_id; username = ld.username;
      }
      const mv = { username: username ?? "", keyword: rule.keyword, post_url: "", account: a.username ?? "" };
      const text = rule.require_follow ? fill(rule.follow_message || DEFAULT_FOLLOW, mv) : fill(rule.dm_templates.body, mv);
      const buttons: Btn[] = rule.require_follow
        ? [...(a.username ? [{ type: "web_url", url: `https://www.instagram.com/${a.username}/`, title: "Follow" }] : []), { type: "postback", title: "I've followed", payload: `fg:${rule.id}` }]
        : httpsOk(rule.link_url) ? [{ type: "web_url", url: rule.link_url, title: String(rule.link_label || "Open link").slice(0, 20) }] : [];
      const res = await sendDM(a.token, { id: igsid }, text, buttons);
      if (!res.ok) return fail((res.j.error?.message || "Instagram did not accept the test message.") + " Instagram allows this only if that person messaged you in the last 24 hours.");
      const now = new Date().toISOString();
      const { data: cv } = await sb.from("conversations").upsert({ workspace_id: rule.workspace_id, ig_account_id: a.id, ig_user_id: igsid, last_message_at: now }, { onConflict: "workspace_id,ig_account_id,ig_user_id" }).select("id").single();
      if (cv) await sb.from("messages").insert({ workspace_id: rule.workspace_id, conversation_id: cv.id, direction: "out", body: text, provider_message_id: res.j.message_id ?? null, sent_by: user.id });
      return json({ ok: true, mode: res.mode });
    }
    const a = await account(body.account_id);
    if (!a) return fail("Account not found.", 404);
    const r = await role(a.workspace_id, user.id);
    if (!r) return fail("Not allowed.", 403);

    if (body.action === "sync_posts") {
      if (!a.token || a.status !== "connected") return fail("Instagram account is not connected.");
      const res = await fetch(`https://graph.instagram.com/${GV}/me/media?fields=id,caption,media_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count&limit=50`, { headers: { Authorization: `Bearer ${a.token}` } });
      const j = await res.json();
      if (!res.ok) return fail(j.error?.message || "Could not load posts.");
      // deno-lint-ignore no-explicit-any
      const rows = (j.data ?? []).map((m: any) => ({ workspace_id: a.workspace_id, ig_account_id: a.id, media_id: m.id, media_type: m.media_type, caption: m.caption ?? null, permalink: m.permalink ?? null, thumbnail_url: m.thumbnail_url ?? m.media_url ?? null, posted_at: m.timestamp ?? null, metrics: { like_count: m.like_count ?? 0, comments_count: m.comments_count ?? 0 }, fetched_at: new Date().toISOString() }));
      if (rows.length) await sb.from("posts_cache").upsert(rows, { onConflict: "ig_account_id,media_id" });
      return json({ ok: true, count: rows.length });
    }
    if (!["owner", "admin"].includes(r)) return fail("Only owners and admins can do this.", 403);
    if (body.action === "test_connection") {
      if (!a.token) return fail("No token stored. Reconnect the account.");
      const res = await fetch(`https://graph.instagram.com/${GV}/me?fields=user_id,username`, { headers: { Authorization: `Bearer ${a.token}` } });
      const j = await res.json();
      await sb.from("connected_instagram_accounts").update({ last_checked_at: new Date().toISOString(), status: res.ok ? "connected" : j.error?.code === 190 ? "expired" : "error" }).eq("id", a.id);
      return res.ok ? json({ ok: true }) : fail(j.error?.message || "Instagram rejected the token. Reconnect the account.");
    }
    if (body.action === "disconnect") {
      await sb.from("instagram_tokens").delete().eq("account_id", a.id);
      await sb.from("connected_instagram_accounts").update({ status: "disconnected" }).eq("id", a.id);
      await sb.from("automation_rules").update({ status: "paused" }).eq("ig_account_id", a.id);
      return json({ ok: true });
    }
    return fail("Unknown action.");
  } catch (e) { console.error("instagram-api error", (e as Error).message); return fail("Something went wrong. Please try again.", 500); }
});
