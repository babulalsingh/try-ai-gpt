// Easebuzz: start a prepaid payment (monthly or yearly, in INR). Owner only. Returns the Easebuzz hosted-payment URL.
// The plan is NOT changed here. It changes only after easebuzz-callback verifies Easebuzz's signed response.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const env = (k: string) => Deno.env.get(k) ?? "";
const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const cors = { "Access-Control-Allow-Origin": env("APP_BASE_URL") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const enc = new TextEncoder();
const PROD = env("EASEBUZZ_ENV") === "prod";
const PAY_HOST = PROD ? "https://pay.easebuzz.in" : "https://testpay.easebuzz.in";
const sha512 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-512", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!env("EASEBUZZ_KEY") || !env("EASEBUZZ_SALT")) return json({ error: "Easebuzz keys are not configured on the server." }, 500);
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: { user } } = await sb.auth.getUser(jwt);
  if (!user) return json({ error: "Not signed in." }, 401);
  const b = await req.json().catch(() => ({}));
  const { data: m } = await sb.from("workspace_members").select("role").eq("workspace_id", b.workspace_id).eq("user_id", user.id).eq("status", "active").maybeSingle();
  if (m?.role !== "owner") return json({ error: "Only the workspace owner can manage billing." }, 403);

  const interval = b.interval === "yearly" ? "yearly" : "monthly";
  const { data: plan } = await sb.from("plans").select("*").eq("id", b.plan_id).maybeSingle();
  if (!plan || plan.price_cents <= 0) return json({ error: "Choose a paid plan." }, 400);
  const monthly = plan.price_inr == null ? null : Number(plan.price_inr);
  const yearly = plan.price_yearly_inr != null ? Number(plan.price_yearly_inr) : monthly != null ? Math.round(monthly * 12 * 0.75) : null;
  const amountNum = interval === "yearly" ? yearly : monthly;
  if (!amountNum || amountNum <= 0) return json({ error: `The INR price for ${plan.name} (${interval}) is not set yet. Ask the admin to set it in Settings.` }, 400);

  const phone = String(b.phone ?? "").replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) return json({ error: "Enter a valid 10-digit Indian mobile number." }, 400);

  // A different paid plan can be bought only after the current prepaid period ends. Renewing the same plan extends it.
  const { data: sub } = await sb.from("subscriptions").select("plan_id,provider_subscription_id,current_period_end").eq("workspace_id", b.workspace_id).maybeSingle();
  if (sub && sub.plan_id !== "starter" && sub.provider_subscription_id && sub.plan_id !== plan.id && sub.current_period_end && new Date(sub.current_period_end) > new Date())
    return json({ error: `Your current plan is active until ${new Date(sub.current_period_end).toDateString()}. You can switch plans after it ends.` }, 400);

  const { data: prof } = await sb.from("profiles").select("full_name,email").eq("id", user.id).maybeSingle();
  const email = String(prof?.email ?? user.email ?? "");
  const firstname = String(prof?.full_name ?? email.split("@")[0] ?? "Customer").replace(/[^A-Za-z0-9 ]/g, "").trim().split(" ")[0].slice(0, 30) || "Customer";
  const amount = amountNum.toFixed(2);
  const productinfo = `Try AI GPT ${plan.name} ${interval}`;
  const txnid = "TAI" + Date.now().toString(36).toUpperCase() + crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();

  const { error: oe } = await sb.from("payment_orders").insert({ txnid, workspace_id: b.workspace_id, user_id: user.id, plan_id: plan.id, billing_interval: interval, amount });
  if (oe) return json({ error: "Could not start the payment." }, 500);
  await sb.from("profiles").update({ phone }).eq("id", user.id).is("phone", null);

  const back = `${env("SUPABASE_URL")}/functions/v1/easebuzz-callback`;
  // hash = sha512(key|txnid|amount|productinfo|firstname|email|udf1..udf10|salt)
  const hash = await sha512([env("EASEBUZZ_KEY"), txnid, amount, productinfo, firstname, email, "", "", "", "", "", "", "", "", "", "", env("EASEBUZZ_SALT")].join("|"));
  const form = new URLSearchParams({ key: env("EASEBUZZ_KEY"), txnid, amount, productinfo, firstname, phone, email, surl: back, furl: back, hash });
  let res: { status?: number; data?: unknown };
  try {
    const r = await fetch(`${PAY_HOST}/payment/initiateLink`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form });
    res = await r.json();
  } catch { await sb.from("payment_orders").update({ status: "failed" }).eq("txnid", txnid); return json({ error: "Could not reach Easebuzz. Try again." }, 502); }
  if (res.status !== 1 || typeof res.data !== "string") {
    console.error("easebuzz initiate failed:", JSON.stringify(res).slice(0, 300));
    await sb.from("payment_orders").update({ status: "failed" }).eq("txnid", txnid);
    return json({ error: "Easebuzz did not accept the payment request" + (typeof res.data === "string" ? ": " + res.data.slice(0, 120) : ".") }, 502);
  }
  return json({ url: `${PAY_HOST}/pay/${res.data}` });
});
