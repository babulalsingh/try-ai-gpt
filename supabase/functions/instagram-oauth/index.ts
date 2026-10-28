// Start Instagram OAuth (POST, signed-in owner/admin) and handle Meta's redirect (GET).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const env = (k: string) => Deno.env.get(k) ?? "";
const GV = env("META_GRAPH_VERSION") || "v21.0"; // check Meta docs for the current version
const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const cors = { "Access-Control-Allow-Origin": env("APP_BASE_URL") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET") return callback(new URL(req.url));
  return start(req);
});

async function start(req: Request) {
  for (const k of ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI", "APP_BASE_URL"]) if (!env(k)) return json({ error: `Server is missing the ${k} secret.` }, 500);
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: { user } } = await sb.auth.getUser(jwt);
  if (!user) return json({ error: "Not signed in." }, 401);
  const { workspace_id } = await req.json().catch(() => ({}));
  const { data: m } = await sb.from("workspace_members").select("role").eq("workspace_id", workspace_id).eq("user_id", user.id).eq("status", "active").maybeSingle();
  if (!m || !["owner", "admin"].includes(m.role)) return json({ error: "Only owners and admins can connect Instagram." }, 403);
  const state = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
  const { error } = await sb.from("oauth_states").insert({ state, user_id: user.id, workspace_id });
  if (error) return json({ error: "Could not start the connection." }, 500);
  const p = new URLSearchParams({ client_id: env("META_APP_ID"), redirect_uri: env("META_REDIRECT_URI"), response_type: "code", scope: "instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages", state });
  return json({ url: "https://www.instagram.com/oauth/authorize?" + p });
}

async function callback(url: URL) {
  const base = env("APP_BASE_URL").replace(/\/$/, "");
  const back = (q: string) => Response.redirect(`${base}/connect-instagram.html?${q}`, 302);
  const err = (m: string) => back("error=" + encodeURIComponent(m));
  if (url.searchParams.get("error")) return err(url.searchParams.get("error_description") || "Authorization was cancelled.");
  const code = (url.searchParams.get("code") ?? "").replace(/#_$/, ""), state = url.searchParams.get("state");
  if (!code || !state) return err("Missing authorization code.");
  const { data: st } = await sb.from("oauth_states").select("*").eq("state", state).maybeSingle();
  if (!st || new Date(st.expires_at) < new Date()) return err("This link expired. Please try again.");
  await sb.from("oauth_states").delete().eq("state", state);
  try {
    const form = new URLSearchParams({ client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET"), grant_type: "authorization_code", redirect_uri: env("META_REDIRECT_URI"), code });
    const r1 = await (await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form })).json();
    const t1 = r1.data?.[0] ?? r1;
    if (!t1.access_token) throw new Error(r1.error_message || r1.error?.message || "Token exchange failed.");
    const r2 = await (await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${env("META_APP_SECRET")}&access_token=${t1.access_token}`)).json();
    const token: string = r2.access_token || t1.access_token;
    const expires = r2.expires_in ? new Date(Date.now() + r2.expires_in * 1000).toISOString() : null;
    const me = await (await fetch(`https://graph.instagram.com/${GV}/me?fields=user_id,username,account_type&access_token=${token}`)).json();
    if (!me.username) throw new Error(me.error?.message || "Could not read the Instagram profile.");
    const igId = String(me.user_id ?? t1.user_id);

    const { data: other } = await sb.from("connected_instagram_accounts").select("id").eq("ig_user_id", igId).neq("workspace_id", st.workspace_id).neq("status", "disconnected").limit(1).maybeSingle();
    if (other) throw new Error(`This Instagram account (@${me.username}) is already connected to another AGS GPT account. Disconnect it there first, or use a different Instagram account.`);
    const { data: existing } = await sb.from("connected_instagram_accounts").select("id").eq("workspace_id", st.workspace_id).eq("ig_user_id", igId).maybeSingle();
    if (!existing) {
      const { data: w } = await sb.from("workspaces").select("plans(max_ig_accounts)").eq("id", st.workspace_id).single();
      const { count } = await sb.from("connected_instagram_accounts").select("id", { count: "exact", head: true }).eq("workspace_id", st.workspace_id).neq("status", "disconnected");
      // deno-lint-ignore no-explicit-any
      if ((count ?? 0) >= ((w as any)?.plans?.max_ig_accounts ?? 1)) throw new Error("Your plan's Instagram account limit is reached. Upgrade to Agency to connect up to 3 accounts.");
    }
    const perms = typeof t1.permissions === "string" ? t1.permissions.split(",") : Array.isArray(t1.permissions) ? t1.permissions : [];
    const { data: acct, error: e1 } = await sb.from("connected_instagram_accounts").upsert({ workspace_id: st.workspace_id, ig_user_id: igId, username: me.username, account_type: me.account_type, status: "connected", permissions: perms, token_expires_at: expires, connected_at: new Date().toISOString(), last_checked_at: new Date().toISOString() }, { onConflict: "workspace_id,ig_user_id" }).select("id").single();
    if (e1?.code === "23505") throw new Error("This Instagram account is already connected to another AGS GPT account.");
    if (e1 || !acct) throw new Error("Could not save the account.");
    await sb.from("instagram_tokens").upsert({ account_id: acct.id, access_token: token, updated_at: new Date().toISOString() });
    const sub = await fetch(`https://graph.instagram.com/${GV}/me/subscribed_apps?subscribed_fields=comments,messages,messaging_postbacks&access_token=${token}`, { method: "POST" });
    if (!sub.ok) console.error("webhook subscription failed", sub.status);
    await sb.from("activity_logs").insert({ workspace_id: st.workspace_id, user_id: st.user_id, action: "instagram_connected", details: { username: me.username } });
    return back("connected=1");
  } catch (e) { return err((e as Error).message); }
}
