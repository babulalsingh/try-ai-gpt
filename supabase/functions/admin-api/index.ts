// Admin API for the Try AI GPT admin panel. EVERY request is checked: valid session + admin role in user_roles.
// The service-role key is used only here, on the server. The browser never sees it.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const env = (k: string) => Deno.env.get(k) ?? "";
const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const cors = { "Access-Control-Allow-Origin": env("APP_BASE_URL") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
class HttpError extends Error { constructor(public status: number, m: string) { super(m); } }
const bad = (m: string) => new HttpError(400, m);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uid = (v: unknown, n = "id") => { if (typeof v !== "string" || !UUID.test(v)) throw bad(`Invalid ${n}.`); return v; };
const str = (v: unknown, max: number, n = "Value") => { const s = String(v ?? "").trim(); if (s.length > max) throw bad(`${n} is too long.`); return s; };
const intIn = (v: unknown, lo: number, hi: number, n: string) => { const x = Number(v); if (!Number.isInteger(x) || x < lo || x > hi) throw bad(`${n} must be a whole number from ${lo} to ${hi}.`); return x; };
const inrOrNull = (v: unknown, n: string) => { if (v === null || v === undefined || v === "") return null; const x = Number(v); if (!Number.isFinite(x) || x < 1 || x > 1000000) throw bad(`${n} must be between 1 and 1,000,000.`); return Math.round(x * 100) / 100; };
const like = (s: string) => s.replace(/[\\%_]/g, (m) => "\\" + m);
const isoOrNull = (v: unknown) => { if (v === null || v === undefined || v === "") return null; const d = new Date(String(v)); if (isNaN(+d)) throw bad("Invalid date."); return d.toISOString(); };
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
const rows = <T>(r: { data: T | null; error: { message: string } | null }) => { if (r.error) { console.error("db:", r.error.message); throw new HttpError(500, "Database error."); } return r.data as T; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

// Best-effort rate limit for privileged actions (per admin, per minute)
const hits = new Map<string, number[]>();
const limited = (id: string) => { const now = Date.now(), a = (hits.get(id) ?? []).filter((t) => now - t < 60000); a.push(now); hits.set(id, a); return a.length > 90; };

async function setting<T>(key: string, def: T): Promise<T> { const { data } = await sb.from("app_settings").select("value").eq("key", key).maybeSingle(); return (data ? data.value : def) as T; }
async function ownedWorkspace(userId: string) { const { data } = await sb.from("workspaces").select("id").eq("owner_id", userId).order("created_at").limit(1).maybeSingle(); if (!data) throw bad("This user has no workspace."); return data.id as string; }
async function isAdmin(userId: string) { const { data } = await sb.from("user_roles").select("role").eq("user_id", userId).maybeSingle(); return data?.role === "admin"; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: { user } } = await sb.auth.getUser(jwt);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (!(await isAdmin(user.id))) return json({ error: "Not authorized." }, 403);
  if (limited(user.id)) return json({ error: "Too many requests. Slow down." }, 429);
  const b = await req.json().catch(() => ({}));
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64);
  const audit = (action: string, target: string | null, details: Record<string, unknown> = {}, type = "user") =>
    sb.from("admin_audit_logs").insert({ admin_id: user.id, action, target_user_id: target, target_type: type, details, ip });
  try {
    switch (b.action) {
      case "me": return json({ ok: true, id: user.id, email: user.email });

      case "stats": {
        await sb.rpc("expire_lapsed_subscriptions");
        const s = rows(await sb.rpc("admin_stats", { p_from: isoOrNull(b.from), p_to: isoOrNull(b.to) }));
        return json({ ok: true, stats: s });
      }
      case "users": {
        await sb.rpc("expire_lapsed_subscriptions");
        const per = intIn(b.per ?? 8, 1, 100, "Page size"), page = intIn(b.page ?? 1, 1, 100000, "Page");
        const tab = ["all", "free", "paid", "complimentary", "active", "blocked", "expired", "removed"].includes(b.tab) ? b.tab : "all";
        const sort = ["joined", "login", "name"].includes(b.sort) ? b.sort : "joined", dir = b.dir === "asc" ? "asc" : "desc";
        const r = rows(await sb.rpc("admin_users", { p_q: like(str(b.q, 100, "Search")), p_tab: tab, p_plan: str(b.plan, 20), p_status: str(b.status, 20), p_from: isoOrNull(b.from), p_to: isoOrNull(b.to), p_sort: sort, p_dir: dir, p_limit: per, p_offset: (page - 1) * per }));
        return json({ ok: true, ...(r as object) });
      }
      case "user_detail": {
        const id = uid(b.id, "user id");
        const d = rows(await sb.rpc("admin_user_detail", { p_id: id }));
        // deno-lint-ignore no-explicit-any
        if (!(d as any).profile) throw new HttpError(404, "User not found.");
        return json({ ok: true, detail: d });
      }

      case "plans": return json({ ok: true, plans: rows(await sb.from("plans").select("*").order("price_cents")) });
      case "plan_update": {
        const id = str(b.id, 20), f = b.features ?? {};
        if (!["limited", "unlimited"].includes(f.templates) || !["basic", "detailed"].includes(f.analytics)) throw bad("Invalid features.");
        const upd = {
          price_cents: intIn(b.price_cents, 0, 10000000, "Price"), price_yearly_cents: intIn(b.price_yearly_cents, 0, 100000000, "Yearly price"),
          dm_limit: b.dm_limit === null || b.dm_limit === "" ? null : intIn(b.dm_limit, 1, 1000000000, "DM limit"),
          max_ig_accounts: intIn(b.max_ig_accounts, 1, 100, "Instagram accounts"), max_team_members: intIn(b.max_team_members, 0, 1000, "Team members"),
          features: { templates: f.templates, analytics: f.analytics, leads: !!f.leads, priority_support: !!f.priority_support },
          price_inr: inrOrNull(b.price_inr, "Monthly INR price"), price_yearly_inr: inrOrNull(b.price_yearly_inr, "Yearly INR price"),
        };
        const { error, count } = await sb.from("plans").update(upd, { count: "exact" }).eq("id", id);
        if (error || !count) throw bad("Could not update the plan.");
        await audit("plan_updated", null, { plan: id, ...upd }, "plan");
        return json({ ok: true });
      }

      case "grant_plan": {
        const target = uid(b.user_id, "user id"), plan = str(b.plan_id, 20), reason = str(b.reason, 500, "Reason");
        const { data: pl } = await sb.from("plans").select("id,name").eq("id", plan).maybeSingle(); if (!pl) throw bad("Unknown plan.");
        const { data: prof } = await sb.from("profiles").select("account_status").eq("id", target).maybeSingle();
        if (!prof || prof.account_status === "deleted") throw bad("User not found.");
        const ws = await ownedWorkspace(target);
        let expires: string | null = null;
        if (b.duration === "lifetime") { if (!(await setting("lifetime_grants_enabled", false))) throw bad("Lifetime grants are turned off in Settings."); }
        else if (b.duration === "date") { expires = isoOrNull(b.expires_at); if (!expires || new Date(expires) <= new Date()) throw bad("Choose an expiry date in the future."); }
        else expires = new Date(Date.now() + intIn(b.days, 1, 3650, "Days") * 864e5).toISOString();
        await sb.from("subscription_entitlements").update({ status: "replaced" }).eq("workspace_id", ws).eq("status", "active");
        const internal = "grant_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
        rows(await sb.from("subscription_entitlements").insert({ internal_id: internal, user_id: target, workspace_id: ws, plan_id: plan, status: "active", expires_at: expires, reason: reason || null, granted_by: user.id }).select("id"));
        rows(await sb.rpc("recompute_plan", { ws }));
        await audit("plan_granted", target, { plan, grant: internal, expires_at: expires, reason });
        return json({ ok: true, grant_id: internal });
      }
      case "revoke_grant": {
        const id = uid(b.id, "grant id"), reason = str(b.reason, 500);
        const { data: g } = await sb.from("subscription_entitlements").select("id,workspace_id,user_id,internal_id,status").eq("id", id).maybeSingle();
        if (!g || g.status !== "active") throw bad("This grant is not active.");
        rows(await sb.from("subscription_entitlements").update({ status: "revoked", revoked_by: user.id, revoked_at: new Date().toISOString(), revoke_reason: reason || null }).eq("id", id).select("id"));
        rows(await sb.rpc("recompute_plan", { ws: g.workspace_id }));
        await audit("grant_revoked", g.user_id, { grant: g.internal_id, reason });
        return json({ ok: true });
      }

      case "set_status": {
        const target = uid(b.user_id, "user id"), status = str(b.status, 20);
        if (!["active", "suspended", "banned", "deactivated", "deleted"].includes(status)) throw bad("Invalid status.");
        if (target === user.id) throw bad("You cannot change your own account status.");
        if (await isAdmin(target)) throw bad("Admin accounts cannot be blocked from here.");
        const { data: prof } = await sb.from("profiles").select("account_status").eq("id", target).maybeSingle(); if (!prof) throw new HttpError(404, "User not found.");
        const { error: e1 } = await sb.auth.admin.updateUserById(target, { ban_duration: status === "active" ? "none" : "876000h" });
        if (e1) throw new HttpError(500, "Could not update the sign-in permission.");
        rows(await sb.from("profiles").update({ account_status: status, deleted_at: status === "deleted" ? new Date().toISOString() : null }).eq("id", target).select("id"));
        await audit("status_" + status, target, { from: prof.account_status, to: status, reason: str(b.reason, 500) });
        return json({ ok: true });
      }
      case "hard_delete": {
        const target = uid(b.user_id, "user id");
        if (!(await setting("permanent_delete_enabled", false))) throw bad("Permanent deletion is turned off in Settings.");
        if (target === user.id || (await isAdmin(target))) throw bad("This account cannot be deleted from here.");
        const { data: prof } = await sb.from("profiles").select("email").eq("id", target).maybeSingle(); if (!prof) throw new HttpError(404, "User not found.");
        if (String(b.confirm_email ?? "").trim().toLowerCase() !== String(prof.email ?? "").toLowerCase()) throw bad("Type the user's email exactly to confirm.");
        await audit("user_permanently_deleted", target, { email: prof.email });
        rows(await sb.rpc("admin_hard_delete_user", { p_id: target }));
        const { error } = await sb.auth.admin.deleteUser(target);
        if (error) throw new HttpError(500, "Could not delete the sign-in account.");
        return json({ ok: true });
      }
      case "edit_user": {
        const target = uid(b.user_id, "user id"), name = str(b.full_name, 100, "Name"), phone = str(b.phone, 30, "Phone"), email = str(b.email, 254, "Email").toLowerCase();
        if (phone && !/^[0-9+()\-\s]{5,30}$/.test(phone)) throw bad("Phone number looks invalid.");
        if (!emailOk(email)) throw bad("Enter a valid email.");
        const { data: prof } = await sb.from("profiles").select("email").eq("id", target).maybeSingle(); if (!prof) throw new HttpError(404, "User not found.");
        const changed: string[] = ["name", "phone"];
        if (email !== String(prof.email ?? "").toLowerCase()) {
          const { error } = await sb.auth.admin.updateUserById(target, { email, email_confirm: true });
          if (error) throw bad("Could not change the email (it may already be used).");
          changed.push("email");
        }
        rows(await sb.from("profiles").update({ full_name: name || null, phone: phone || null, email }).eq("id", target).select("id"));
        await audit("user_edited", target, { changed });
        return json({ ok: true });
      }
      case "reset_password": {
        const target = uid(b.user_id, "user id");
        const { data: prof } = await sb.from("profiles").select("email").eq("id", target).maybeSingle(); if (!prof?.email) throw new HttpError(404, "User not found.");
        const anon = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"));
        const { error } = await anon.auth.resetPasswordForEmail(prof.email, { redirectTo: `${(env("APP_BASE_URL") || "").replace(/\/$/, "")}/reset-password.html` });
        if (error) throw bad("Could not send the reset email: " + error.message);
        await audit("password_reset_sent", target, {});
        return json({ ok: true, email: prof.email });
      }
      case "send_email": {
        const target = uid(b.user_id, "user id"), subject = str(b.subject, 150, "Subject"), message = str(b.message, 5000, "Message");
        if (!subject || !message) throw bad("Subject and message are required.");
        if (!env("RESEND_API_KEY") || !env("MAIL_FROM")) throw bad("Email sending is not configured. Add the RESEND_API_KEY and MAIL_FROM secrets (see README).");
        const { data: prof } = await sb.from("profiles").select("email").eq("id", target).maybeSingle(); if (!prof?.email) throw new HttpError(404, "User not found.");
        const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: env("MAIL_FROM"), to: [prof.email], subject, html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${esc(message)}</div>` }) });
        if (!r.ok) throw bad("The email provider rejected the message.");
        await audit("email_sent", target, { subject });
        return json({ ok: true });
      }

      case "subscriptions": { const per = intIn(b.per ?? 15, 1, 100, "Page size"), page = intIn(b.page ?? 1, 1, 100000, "Page");
        return json({ ok: true, ...(rows(await sb.rpc("admin_subscriptions", { p_source: str(b.source, 20), p_status: str(b.status, 20), p_plan: str(b.plan, 20), p_q: like(str(b.q, 100)), p_limit: per, p_offset: (page - 1) * per })) as object) }); }
      case "payments": { const per = intIn(b.per ?? 15, 1, 100, "Page size"), page = intIn(b.page ?? 1, 1, 100000, "Page");
        return json({ ok: true, ...(rows(await sb.rpc("admin_payments", { p_status: str(b.status, 20), p_q: like(str(b.q, 100)), p_limit: per, p_offset: (page - 1) * per })) as object) }); }
      case "usage": { const per = intIn(b.per ?? 15, 1, 100, "Page size"), page = intIn(b.page ?? 1, 1, 100000, "Page");
        return json({ ok: true, ...(rows(await sb.rpc("admin_usage", { p_q: like(str(b.q, 100)), p_limit: per, p_offset: (page - 1) * per })) as object) }); }

      case "report": {
        const type = str(b.type, 20); if (!["registrations", "payments", "subscriptions", "usage"].includes(type)) throw bad("Unknown report.");
        // deno-lint-ignore no-explicit-any
        const data = rows(await sb.rpc("admin_report", { p_type: type, p_from: isoOrNull(b.from), p_to: isoOrNull(b.to) })) as any[];
        if (b.format === "csv") {
          const cols = data.length ? Object.keys(data[0]) : [];
          const cell = (v: unknown) => { let s = v === null || v === undefined ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
          const csv = [cols.map(cell).join(","), ...data.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
          await audit("report_exported", null, { type, rows: data.length }, "report");
          return json({ ok: true, filename: `${type}-report.csv`, csv });
        }
        return json({ ok: true, total: data.length, rows: data.slice(0, 100) });
      }

      case "coupon_list": return json({ ok: true, coupons: rows(await sb.from("coupons").select("*").order("created_at", { ascending: false }).limit(500)) });
      case "coupon_save": {
        const code = str(b.code, 30).toUpperCase(); if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw bad("Code must be 3-30 letters, numbers, - or _.");
        const type = b.discount_type === "fixed" ? "fixed" : "percent", val = intIn(b.discount_value, 1, type === "percent" ? 100 : 100000000, "Discount value");
        const plans = Array.isArray(b.applies_to) ? b.applies_to.map((x: unknown) => str(x, 20)).filter(Boolean) : [];
        const rec = { code, description: str(b.description, 200) || null, discount_type: type, discount_value: val, applies_to: plans.length ? plans : null,
          max_redemptions: b.max_redemptions === "" || b.max_redemptions == null ? null : intIn(b.max_redemptions, 1, 100000000, "Max redemptions"), expires_at: isoOrNull(b.expires_at), active: !!b.active };
        if (b.id) { rows(await sb.from("coupons").update(rec).eq("id", uid(b.id, "coupon id")).select("id")); await audit("coupon_updated", null, { code }, "coupon"); }
        else { const { error } = await sb.from("coupons").insert({ ...rec, created_by: user.id }); if (error) throw bad(error.code === "23505" ? "That code already exists." : "Could not save the coupon."); await audit("coupon_created", null, { code }, "coupon"); }
        return json({ ok: true });
      }
      case "coupon_delete": { rows(await sb.from("coupons").delete().eq("id", uid(b.id, "coupon id")).select("id")); await audit("coupon_deleted", null, { id: b.id }, "coupon"); return json({ ok: true }); }

      case "ann_list": return json({ ok: true, items: rows(await sb.from("announcements").select("*").order("created_at", { ascending: false }).limit(200)) });
      case "ann_save": {
        const rec = { title: str(b.title, 120), body: str(b.body, 2000), level: ["info", "success", "warning"].includes(b.level) ? b.level : "info", starts_at: isoOrNull(b.starts_at) ?? new Date().toISOString(), ends_at: isoOrNull(b.ends_at), active: !!b.active };
        if (!rec.title || !rec.body) throw bad("Title and message are required.");
        if (b.id) rows(await sb.from("announcements").update(rec).eq("id", uid(b.id, "announcement id")).select("id")); else rows(await sb.from("announcements").insert({ ...rec, created_by: user.id }).select("id"));
        await audit("announcement_saved", null, { title: rec.title }, "announcement"); return json({ ok: true });
      }
      case "ann_delete": { rows(await sb.from("announcements").delete().eq("id", uid(b.id, "announcement id")).select("id")); await audit("announcement_deleted", null, {}, "announcement"); return json({ ok: true }); }

      case "ticket_list": {
        let q = sb.from("support_tickets").select("*").order("created_at", { ascending: false }).limit(200);
        if (["open", "pending", "resolved"].includes(b.status)) q = q.eq("status", b.status);
        const t = rows(await q) as { user_id: string }[]; const ids = [...new Set(t.map((x) => x.user_id))];
        const profs = ids.length ? rows(await sb.from("profiles").select("id,email,full_name").in("id", ids)) as { id: string; email: string; full_name: string }[] : [];
        return json({ ok: true, tickets: t.map((x) => ({ ...x, user: profs.find((p) => p.id === x.user_id) ?? null })) });
      }
      case "ticket_get": {
        const id = uid(b.id, "ticket id");
        const { data: t } = await sb.from("support_tickets").select("*").eq("id", id).maybeSingle(); if (!t) throw new HttpError(404, "Ticket not found.");
        const msgs = rows(await sb.from("support_ticket_messages").select("id,user_id,body,created_at").eq("ticket_id", id).order("created_at")) as { user_id: string | null }[];
        const admins = (rows(await sb.from("user_roles").select("user_id")) as { user_id: string }[]).map((a) => a.user_id);
        return json({ ok: true, ticket: t, messages: msgs.map((m) => ({ ...m, from_admin: !!m.user_id && admins.includes(m.user_id) })) });
      }
      case "ticket_update": {
        const id = uid(b.id, "ticket id"), upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (b.status) { if (!["open", "pending", "resolved"].includes(b.status)) throw bad("Invalid status."); upd.status = b.status; }
        if (b.assign_to_me === true) upd.assigned_to = user.id; if (b.assign_to_me === false) upd.assigned_to = null;
        rows(await sb.from("support_tickets").update(upd).eq("id", id).select("id")); await audit("ticket_updated", null, { id, status: b.status ?? null }, "ticket"); return json({ ok: true });
      }
      case "ticket_reply": {
        const id = uid(b.id, "ticket id"), body = str(b.body, 4000, "Reply"); if (!body) throw bad("Write a reply.");
        const { data: t } = await sb.from("support_tickets").select("id,workspace_id,user_id,subject,status").eq("id", id).maybeSingle(); if (!t) throw new HttpError(404, "Ticket not found.");
        rows(await sb.from("support_ticket_messages").insert({ ticket_id: id, workspace_id: t.workspace_id, user_id: user.id, body }).select("id"));
        await sb.from("support_tickets").update({ status: t.status === "open" ? "pending" : t.status, updated_at: new Date().toISOString() }).eq("id", id);
        await sb.from("notifications").insert({ workspace_id: t.workspace_id, user_id: t.user_id, title: "Support replied to your ticket", body: t.subject });
        await audit("ticket_replied", t.user_id, { ticket: id }, "ticket"); return json({ ok: true });
      }

      case "audit_list": { const per = 25, page = intIn(b.page ?? 1, 1, 100000, "Page");
        const { data, count, error } = await sb.from("admin_audit_logs").select("*", { count: "exact" }).order("created_at", { ascending: false }).range((page - 1) * per, page * per - 1); if (error) throw new HttpError(500, "Database error.");
        const ids = [...new Set((data ?? []).flatMap((x) => [x.admin_id, x.target_user_id]).filter(Boolean))];
        const profs = ids.length ? rows(await sb.from("profiles").select("id,email").in("id", ids)) as { id: string; email: string }[] : [];
        const em = (i: string | null) => (profs.find((p) => p.id === i) ?? {}).email ?? null;
        return json({ ok: true, total: count ?? 0, rows: (data ?? []).map((x) => ({ ...x, admin_email: em(x.admin_id), target_email: em(x.target_user_id) })) });
      }
      case "settings_get": {
        const s = rows(await sb.from("app_settings").select("key,value")) as { key: string; value: unknown }[];
        const admins = rows(await sb.from("user_roles").select("user_id,created_at")) as { user_id: string; created_at: string }[];
        const profs = admins.length ? rows(await sb.from("profiles").select("id,email").in("id", admins.map((a) => a.user_id))) as { id: string; email: string }[] : [];
        return json({ ok: true, settings: Object.fromEntries(s.map((x) => [x.key, x.value])), admins: admins.map((a) => ({ ...a, email: profs.find((p) => p.id === a.user_id)?.email ?? null })),
          mail_configured: !!(env("RESEND_API_KEY") && env("MAIL_FROM")) });
      }
      case "settings_set": {
        const key = str(b.key, 40), types: Record<string, string> = { lifetime_grants_enabled: "boolean", permanent_delete_enabled: "boolean", website_url: "string", support_email: "string" };
        if (!types[key] || typeof b.value !== types[key]) throw bad("Invalid setting.");
        const value = types[key] === "string" ? str(b.value, 200) : b.value;
        if (key === "website_url" && value && !/^https:\/\//i.test(value as string)) throw bad("Website URL must start with https://");
        rows(await sb.from("app_settings").upsert({ key, value, updated_by: user.id, updated_at: new Date().toISOString() }).select("key"));
        await audit("setting_changed", null, { key, value }, "setting"); return json({ ok: true });
      }
      default: throw bad("Unknown action.");
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error("admin-api error:", (e as Error).message);
    return json({ error: "Something went wrong." }, 500);
  }
});
