// Easebuzz return URL (surl/furl) AND transaction webhook. Public endpoint: every request is verified with Easebuzz's SHA-512 signature.
// This is the ONLY place a paid plan is activated. Idempotent: repeated calls for the same txnid do nothing.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const env = (k: string) => Deno.env.get(k) ?? "";
const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const enc = new TextEncoder();
const sha512 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-512", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const same = (a: string, b: string) => { const x = enc.encode(a), y = enc.encode(b); if (x.length !== y.length) return false; let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]; return d === 0; };
const base = () => (env("APP_BASE_URL") || "").replace(/\/$/, "");

async function readFields(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) { const j = await req.json().catch(() => ({})); return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v == null ? "" : String(v)])); }
  const out: Record<string, string> = {};
  const fd = await req.formData().catch(() => null);
  if (fd) for (const [k, v] of fd.entries()) out[k] = String(v);
  return out;
}

Deno.serve(async (req) => {
  const wantsPage = (req.headers.get("accept") ?? "").includes("text/html");
  const done = (result: "success" | "failed" | "cancelled" | "invalid") =>
    wantsPage ? Response.redirect(`${base()}/billing-plan.html?pay=${result}`, 303) : new Response(JSON.stringify({ ok: result === "success" || result === "cancelled" || result === "failed" }), { status: result === "invalid" ? 400 : 200, headers: { "Content-Type": "application/json" } });
  if (req.method === "GET") return Response.redirect(`${base()}/billing-plan.html`, 303);
  if (req.method !== "POST") return new Response("", { status: 405 });

  const f = await readFields(req);
  const key = env("EASEBUZZ_KEY"), salt = env("EASEBUZZ_SALT");
  if (!key || !salt || !f.hash || f.key !== key || !f.txnid) return done("invalid");
  // response hash = sha512([additional_charges|]salt|status|udf10..udf1|email|firstname|productinfo|amount|txnid|key)
  const udf = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((i) => f["udf" + i] ?? "");
  const seq = [salt, f.status ?? "", ...udf, f.email ?? "", f.firstname ?? "", f.productinfo ?? "", f.amount ?? "", f.txnid, key];
  if (f.additional_charges) seq.unshift(f.additional_charges);
  const calc = await sha512(seq.join("|"));
  if (!same(calc, String(f.hash).toLowerCase())) { console.error("easebuzz hash mismatch for txn", f.txnid); return done("invalid"); }

  const { data: order } = await sb.from("payment_orders").select("*").eq("txnid", f.txnid).maybeSingle();
  if (!order) return done("invalid");
  const status = String(f.status ?? "").toLowerCase();
  const ref = f.easepayid || f.txnid;

  if (status === "success") {
    // the amount must match what we asked for; never trust the callback for the plan or price
    if (Math.abs(Number(f.amount) - Number(order.amount)) > 0.009) { console.error("easebuzz amount mismatch", f.txnid); return done("invalid"); }
    const { data: won } = await sb.from("payment_orders").update({ status: "paid", gateway_ref: ref, paid_at: new Date().toISOString() }).eq("txnid", f.txnid).in("status", ["created", "failed", "cancelled"]).select("txnid");
    if (!won || !won.length) return done("success");           // already processed
    const { data: plan } = await sb.from("plans").select("id,name").eq("id", order.plan_id).single();
    const { data: sub } = await sb.from("subscriptions").select("*").eq("workspace_id", order.workspace_id).maybeSingle();
    const renew = sub && sub.plan_id === order.plan_id && sub.current_period_end && new Date(sub.current_period_end) > new Date();
    const end = new Date(renew ? sub!.current_period_end : Date.now());
    if (order.billing_interval === "yearly") end.setUTCFullYear(end.getUTCFullYear() + 1); else end.setUTCMonth(end.getUTCMonth() + 1);
    await sb.from("subscriptions").update({ plan_id: order.plan_id, status: "active", provider_subscription_id: "eb_" + order.txnid, pending_plan_id: null, current_period_end: end.toISOString(), cancel_at_period_end: false, billing_interval: order.billing_interval }).eq("workspace_id", order.workspace_id);
    await sb.rpc("recompute_plan", { ws: order.workspace_id });
    await sb.from("billing_history").upsert({ workspace_id: order.workspace_id, plan_id: order.plan_id, billing_interval: order.billing_interval, status: "paid", amount_minor: Math.round(Number(order.amount) * 100), currency: order.currency, provider_ref: ref }, { onConflict: "provider_ref", ignoreDuplicates: true });
    await sb.from("notifications").insert({ workspace_id: order.workspace_id, user_id: order.user_id, title: `${plan?.name ?? "Plan"} is active`, body: `Your payment was received. Active until ${end.toDateString()}.` });
    return done("success");
  }
  // failure / user cancelled: only an order that is still "created" can be marked
  const failed = status === "usercancelled" || status === "cancelled" ? "cancelled" : "failed";
  const { data: marked } = await sb.from("payment_orders").update({ status: failed, gateway_ref: ref }).eq("txnid", f.txnid).eq("status", "created").select("txnid");
  if (marked && marked.length) await sb.from("billing_history").upsert({ workspace_id: order.workspace_id, plan_id: order.plan_id, billing_interval: order.billing_interval, status: failed === "cancelled" ? "cancelled" : "failed", amount_minor: Math.round(Number(order.amount) * 100), currency: order.currency, provider_ref: ref }, { onConflict: "provider_ref", ignoreDuplicates: true });
  return done(failed);
});
