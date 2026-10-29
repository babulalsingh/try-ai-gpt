// Try AI GPT admin panel (admindashboard.html). All data comes from the admin-api Edge Function, which re-checks the admin role on every call.
(function () {
  "use strict";
  const cfg = window.APP_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const root = $("#root");
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) { root.innerHTML = '<div class="lg"><div class="lgc"><h2>Setup needed</h2><p class="sub">Add your Supabase URL and key in assets/js/config.js.</p></div></div>'; return; }
  // Separate storage key: the admin session never mixes with the normal user session.
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { storageKey: "tryai-admin-auth", persistSession: true, autoRefreshToken: true } });
  let me = null, stats = null, plansCache = null;
  const S = { range: { from: dayISO(-30), to: "" }, u: { tab: "all", q: "", plan: "", status: "", time: "", sort: "joined", dir: "desc", page: 1, per: 8, sel: null } };
  const LOGO = '<span class="mk">T</span>';

  /* ---------- helpers ---------- */
  function dayISO(offset) { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); }
  const fd = d => (d ? new Date(d).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }) : "—");
  const fdt = d => (d ? new Date(d).toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  const money = (m, cur) => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "USD" }).format((m || 0) / 100); } catch { return (m || 0) / 100 + " " + cur; } };
  const revTxt = r => { const e = Object.entries(r || {}); return e.length ? e.map(([c, v]) => money(v, c)).join(" + ") : "$0.00"; };
  const num = n => Number(n || 0).toLocaleString();
  const toast = (m, t = "info") => { const e = document.createElement("div"); e.className = "toast " + t; e.setAttribute("role", "status"); e.textContent = m; document.body.appendChild(e); setTimeout(() => e.remove(), 5000); };
  const stLabel = { active: "Active", free: "Free", expired: "Expired", blocked: "Blocked", deactivated: "Deactivated", deleted: "Deleted" };
  const badge = (t, k) => `<span class="st ${k || ""}">${esc(t)}</span>`;
  const tbl = (h, r) => `<div class="tw"><table><thead><tr>${h.map(x => "<th>" + x + "</th>").join("")}</tr></thead><tbody>${r.join("")}</tbody></table></div>`;
  const empty = (t, m) => `<div class="empty"><b>${t}</b>${m || ""}</div>`;
  const opts = (a, sel) => a.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? "selected" : ""}>${esc(l)}</option>`).join("");
  const pager = (total, per, page) => { const n = Math.max(1, Math.ceil(total / per)), s = (page - 1) * per + 1, e = Math.min(total, page * per); const pgs = new Set([1, n, page - 1, page, page + 1, 2, 3, 4, 5].filter(x => x >= 1 && x <= n)); let last = 0, h = "";
    [...pgs].sort((a, b) => a - b).forEach(p => { if (last && p - last > 1) h += "<button disabled>…</button>"; h += `<button data-p="${p}" class="${p === page ? "on" : ""}">${p}</button>`; last = p; });
    return `<div class="pg"><span>${total ? `Showing ${s} to ${e} of ${num(total)}` : "No results"}</span><div><button data-p="${Math.max(1, page - 1)}" aria-label="Previous">‹</button>${h}<button data-p="${Math.min(n, page + 1)}" aria-label="Next">›</button></div></div>`; };

  async function api(action, p = {}) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { showLogin("Your session has ended. Please sign in again."); throw new Error("Session ended."); }
    let r;
    try { r = await fetch(`${cfg.SUPABASE_URL}/functions/v1/admin-api`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token, apikey: cfg.SUPABASE_ANON_KEY }, body: JSON.stringify({ action, ...p }) }); }
    catch { throw new Error('Cannot reach the admin service. Check that the "admin-api" function is deployed and that its CORS allows this website.'); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) { await sb.auth.signOut(); showLogin("This account is not authorized for the admin panel."); const e = new Error(j.error || "Not authorized."); e.handled = true; throw e; }
    if (r.status === 404 && (j.code === "NOT_FOUND" || !j.error)) throw new Error('The "admin-api" function is not deployed on Supabase yet.');
    if (!r.ok) throw new Error(j.error || "Request failed (" + r.status + ").");
    return j;
  }
  const fail = e => toast(e && e.message ? e.message : String(e), "bad");

  function modal({ title, body, save = "Save", danger, onSave, wide }) {
    const d = document.createElement("dialog"); d.className = "dlg"; if (wide) d.style.width = "min(760px,94vw)";
    d.innerHTML = `<form method="dialog"><h3>${title}</h3><div class="bd2">${body}</div><div class="err" data-err role="alert"></div><div class="ac"><button type="button" class="btn" data-x>${onSave ? "Cancel" : "Close"}</button>${onSave ? `<button class="btn ${danger ? "r" : "p"}" type="submit">${save}</button>` : ""}</div></form>`;
    document.body.appendChild(d); d.showModal(); d.addEventListener("close", () => d.remove());
    d.querySelector("[data-x]").onclick = () => d.close();
    d.querySelector("form").onsubmit = async e => { e.preventDefault(); if (!onSave) return; const b = e.submitter; if (b) b.disabled = true; try { await onSave(Object.fromEntries(new FormData(e.target)), d); d.close(); } catch (x) { d.querySelector("[data-err]").textContent = x.message || String(x); } finally { if (b) b.disabled = false; } };
    return d;
  }
  const confirmBox = (title, text, label, onYes, danger = true, extra = "") => modal({ title, save: label, danger, body: `<p style="margin-top:0">${text}</p>${extra}`, onSave: onYes });

  /* ---------- login ---------- */
  function showLogin(msg) {
    me = null; location.hash = "";
    root.innerHTML = `<div class="lg"><div class="lgc"><div class="brand">${LOGO}<div><b>Try AI GPT</b><small>One Platform. Endless AI.</small></div></div>
      <h2>Admin sign in</h2><p class="sub">Authorized administrators only.</p>
      <form id="lf" novalidate><label class="fld"><span>Admin email</span><input class="in" name="email" type="email" autocomplete="username" required></label>
      <label class="fld"><span>Password</span><div class="pw"><input class="in" name="password" type="password" autocomplete="current-password" required><button type="button" id="tg">Show</button></div></label>
      <div class="err" id="le" role="alert">${esc(msg || "")}</div><button class="btn p w" type="submit">Sign in</button></form>
      <p style="text-align:center;margin:14px 0 0"><button class="lk" id="fg" type="button">Forgot password?</button></p></div></div>`;
    $("#tg").onclick = e => { const i = $("input[name=password]"); i.type = i.type === "password" ? "text" : "password"; e.target.textContent = i.type === "password" ? "Show" : "Hide"; };
    $("#fg").onclick = async () => { const em = $("input[name=email]").value.trim(); const le = $("#le"); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { le.textContent = "Enter your admin email first."; return; }
      const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo: location.origin + location.pathname.replace(/[^/]*$/, "") + "reset-password" });
      le.style.color = error ? "" : "#0a8a52"; le.textContent = error ? "Could not send the email. Try again later." : "If this email has an account, a reset link has been sent."; };
    $("#lf").onsubmit = async e => { e.preventDefault(); const f = e.target.elements, b = e.submitter || e.target.querySelector("[type=submit]"), le = $("#le"); le.style.color = ""; le.textContent = ""; b.disabled = true; b.textContent = "Signing in…";
      const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
      if (error) { le.textContent = "Invalid email or password."; b.disabled = false; b.textContent = "Sign in"; return; }
      await boot(); };
  }
  async function logout(msg) { await sb.auth.signOut(); showLogin(msg); }

  async function boot() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return showLogin();
    try { me = await api("me"); }
    catch (e) { if (!e.handled) { await sb.auth.signOut(); showLogin(e.message || "Could not reach the admin service."); } return; }   // 401/403 already showed the login screen
    renderShell();
  }

  /* ---------- shell ---------- */
  const NAV = [["dashboard", "Dashboard", "⌂"], ["users", "Users", "👥"], ["subscriptions", "Subscriptions", "👑"], ["payments", "Payments", "💳"], ["usage", "AI Usage", "🤖"], ["reports", "Reports", "📊"], ["withdrawals", "Withdrawals", "💸"], ["coupons", "Coupons", "🏷️"], ["tickets", "Support Tickets", "🎧"], ["announcements", "Announcements", "📣"], ["settings", "Settings", "⚙"]];
  function renderShell() {
    root.innerHTML = `<div class="ad"><aside class="sd" id="sd"><div class="brand">${LOGO}<div><b>Try AI GPT</b><small>One Platform. Endless AI.</small></div></div>
      ${NAV.map(([id, l, ic]) => `<a class="nv" href="#/${id}" data-nv="${id}"><span class="ic">${ic}</span>${l}</a>`).join("")}
      <a class="nv" href="/" target="_blank" rel="noopener"><span class="ic">🌐</span>Website</a>
      <a class="back" href="hub"><span style="font-size:24px">🏠</span>Back to Website</a></aside>
      <div class="mn"><div class="mc"><div class="tp"><button class="ib mnu" id="mb" aria-label="Menu">☰</button><div class="sq"><input id="gs" type="search" placeholder="Search users by name, email, phone, user ID, subscription or payment ID…" aria-label="Global search"></div>
        <button class="ib" id="bell" aria-label="Open support tickets">🔔<span class="bd hide" id="bn"></span></button>
        <button class="me" id="me"><span class="av">${esc((me.email || "A")[0].toUpperCase())}</span><div><b>Admin</b><small>${esc(me.email)}</small></div></button></div>
        <div id="pg"></div></div><aside class="up hide" id="up"></aside></div></div>`;
    $("#mb").onclick = () => $("#sd").classList.toggle("open");
    $("#bell").onclick = () => (location.hash = "#/tickets");
    $("#me").onclick = e => { e.stopPropagation(); const old = $(".dd"); if (old) return old.remove(); const d = document.createElement("div"); d.className = "dd"; d.innerHTML = `<button id="so" class="dn">Sign out</button>`; $("#me").appendChild(d); $("#so").onclick = () => logout(); };
    document.addEventListener("click", () => { const d = $(".dd"); if (d) d.remove(); const m = $(".cmenu"); if (m) m.remove(); });
    $("#gs").addEventListener("keydown", e => { if (e.key === "Enter") { S.u.q = e.target.value.trim(); S.u.tab = "all"; S.u.page = 1; if (location.hash === "#/users") route(); else location.hash = "#/users"; } });
    window.addEventListener("hashchange", route); route();
    api("stats", {}).then(r => { const n = r.stats.open_tickets; if (n) { const b = $("#bn"); b.textContent = n; b.classList.remove("hide"); } }).catch(() => {});
  }
  function route() {
    if (!me) return;
    const id = (location.hash.replace("#/", "") || "dashboard");
    const page = PAGES[id] ? id : "dashboard";
    document.querySelectorAll("[data-nv]").forEach(a => a.classList.toggle("on", a.dataset.nv === page));
    $("#sd").classList.remove("open"); $("#up").classList.add("hide");
    const el = $("#pg"); el.innerHTML = '<div class="pn"><div class="skel" style="width:40%"></div></div>';
    PAGES[page](el).catch(e => { el.innerHTML = `<div class="note">${esc(e.message || e)}</div>`; });
  }
  const head = (t, sub, withRange) => `<div class="ph"><div><h1>${t}</h1><p>${sub}</p></div>${withRange ? `<div class="rg">📅 <input type="date" id="rf" value="${S.range.from}" aria-label="From date"> – <input type="date" id="rt" value="${S.range.to}" aria-label="To date"></div>` : ""}</div>`;
  const bindRange = () => { ["#rf", "#rt"].forEach(s => { const i = $(s); if (i) i.onchange = () => { S.range.from = $("#rf").value; S.range.to = $("#rt").value; route(); }; }); };
  const rangeParams = () => ({ from: S.range.from ? new Date(S.range.from).toISOString() : null, to: S.range.to ? new Date(new Date(S.range.to).getTime() + 864e5).toISOString() : null });
  const card = (ic, bg, v, l, sub) => `<div class="sc"><i style="background:${bg}">${ic}</i><div><b>${v}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ""}</div></div>`;

  /* ---------- pages ---------- */
  const PAGES = {};
  PAGES.dashboard = async el => {
    const [s, ru, rp] = await Promise.all([api("stats", rangeParams()), api("users", { per: 5, sort: "joined", dir: "desc" }), api("payments", { per: 5 })]);
    const t = s.stats; stats = t;
    el.innerHTML = head("Dashboard", "Live numbers from your database.", true) +
      `<div class="cards">${card("👥", "#e3e9ff", num(t.total_users), "Total registered users")}${card("🟢", "#e0f6ea", num(t.active_users), "Active users", "signed in, last 30 days")}${card("👑", "#fff1cf", num(t.paid_subscribers), "Paid subscribers")}${card("💰", "#ffe6dc", revTxt(t.revenue), "Verified revenue", "selected dates")}</div>
      <div class="cards">${card("🆕", "#e3e9ff", num(t.new_registrations), "New registrations", "selected dates")}${card("✅", "#e0f6ea", num(t.paid_subscribers + t.complimentary), "Active subscriptions", num(t.complimentary) + " complimentary")}${card("⌛", "#fff1cf", num(t.expired_subscriptions), "Expired subscriptions")}${card("⛔", "#fde8e6", num(t.blocked_users), "Blocked users")}</div>
      <div class="pn"><h3>Recent signups</h3>${ru.rows.length ? tbl(["User", "Plan", "Status", "Joined"], ru.rows.map(u => `<tr class="click"><td><b>${esc(u.name || "—")}</b><small class="sm2">${esc(u.email)}</small></td><td class="pl ${esc(u.plan_id)}">${esc(u.plan_name)}</td><td>${badge(stLabel[u.status], u.status)}</td><td>${fdt(u.created_at)}</td></tr>`)) : empty("No users yet")}</div>
      <div class="pn"><h3>Recent payments</h3>${rp.rows.length ? tbl(["Date", "User", "Plan", "Amount", "Status"], rp.rows.map(p => `<tr><td>${fdt(p.created_at)}</td><td>${esc(p.email || "—")}</td><td>${esc(p.plan_id || "—")}</td><td>${p.amount_minor == null ? "—" : money(p.amount_minor, p.currency)}</td><td>${badge(p.status, p.status)}</td></tr>`)) : empty("No payments yet", "Payments appear after Easebuzz confirms them.")}</div>`;
    bindRange();
  };

  PAGES.users = async el => {
    const u = S.u, t = (await api("stats", rangeParams())).stats; stats = t;
    el.innerHTML = head("Users Management", "View, manage and control all registered users on Try AI GPT.", true) +
      `<div class="cards">${card("👥", "#e3e9ff", num(t.total_users), "Total Users")}${card("🟢", "#e0f6ea", num(t.active_users), "Active Users", "last 30 days")}${card("👑", "#fff1cf", num(t.paid_subscribers), "Paid Subscribers")}${card("💰", "#ffe6dc", revTxt(t.revenue), "Total Revenue", "selected dates")}</div>
      <div class="pn"><div class="tabs" id="tb">${[["all", "All Users"], ["free", "Free"], ["paid", "Paid"], ["complimentary", "Complimentary"], ["active", "Active"], ["blocked", "Blocked"], ["expired", "Expired"], ["removed", "Deleted / Deactivated"]].map(([k, l]) => `<button data-t="${k}" class="${u.tab === k ? "on" : ""}">${l}</button>`).join("")}<span class="sp"></span><button class="btn v" id="ex">⬆ Export</button></div>
      <div class="fb"><input class="in q" id="uq" placeholder="Search name, email, phone, user ID, subscription ID, payment ID…" value="${esc(u.q)}"><select class="in" id="up2">${opts([["", "All Plans"], ["starter", "Starter"], ["growth", "Growth"], ["agency", "Agency"]], u.plan)}</select>
        <select class="in" id="us">${opts([["", "All Status"], ["active", "Active"], ["free", "Free"], ["expired", "Expired"], ["blocked", "Blocked"], ["deactivated", "Deactivated"]], u.status)}</select>
        <select class="in" id="ut">${opts([["", "All Time"], ["today", "Today"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["month", "This month"]], u.time)}</select></div>
      <div id="ul"><div class="skel" style="width:60%"></div></div></div>`;
    bindRange();
    $("#tb").onclick = e => { const b = e.target.closest("[data-t]"); if (!b) return; u.tab = b.dataset.t; u.page = 1; PAGES.users(el); };
    let tm; $("#uq").oninput = e => { clearTimeout(tm); tm = setTimeout(() => { u.q = e.target.value.trim(); u.page = 1; loadUsers(); }, 350); };
    [["#up2", "plan"], ["#us", "status"], ["#ut", "time"]].forEach(([s, k]) => ($(s).onchange = e => { u[k] = e.target.value; u.page = 1; loadUsers(); }));
    $("#ex").onclick = async () => { try { const r = await api("report", { type: "registrations", format: "csv", ...rangeParams() }); download(r.filename, r.csv); toast("Export downloaded.", "ok"); } catch (x) { fail(x); } };
    await loadUsers();
  };
  function timeFrom(t) { const d = new Date(); if (t === "today") d.setHours(0, 0, 0, 0); else if (t === "7") d.setDate(d.getDate() - 7); else if (t === "30") d.setDate(d.getDate() - 30); else if (t === "month") { d.setDate(1); d.setHours(0, 0, 0, 0); } else return null; return d.toISOString(); }
  async function loadUsers() {
    const u = S.u, box = $("#ul"); if (!box) return;
    const r = await api("users", { tab: u.tab, q: u.q, plan: u.plan, status: u.status, from: timeFrom(u.time), sort: u.sort, dir: u.dir, page: u.page, per: u.per });
    const planCell = x => x.plan_id === "starter" && !x.sub_ref ? `<b class="pl starter">${esc(x.plan_name || "Free")} Plan</b><small class="sm2">ID: -</small>` : `<b class="pl ${esc(x.plan_id)}">${esc(x.plan_name)} Plan</b><small class="sm2">ID: ${esc(x.sub_ref || "-")}</small><small class="sm2">${x.source === "admin_granted" ? "Complimentary" : money(x.price_cents, "USD") + "/Month"}</small>`;
    box.innerHTML = (r.rows.length ? tbl(["#", "User Details", "Subscription", "Status", "Join Date", "Last Login", "Actions"], r.rows.map((x, i) => `<tr data-id="${x.id}" class="${u.sel === x.id ? "sel" : ""}"><td>${(u.page - 1) * u.per + i + 1}</td>
      <td><div class="uc"><span class="av">${esc((x.name || x.email || "?")[0].toUpperCase())}</span><div><b>${esc(x.name || "—")}</b><small>${esc(x.email)}</small><small>${esc(x.phone || "")}</small></div></div></td><td>${planCell(x)}</td><td>${badge(stLabel[x.status] || x.status, x.status)}</td>
      <td>${fdt(x.created_at)}</td><td>${fdt(x.last_login)}</td><td style="white-space:nowrap"><button class="vw" data-view>View</button><button class="dt" data-menu aria-label="More actions">⋮</button></td></tr>`)) : empty("No users found", "Try a different search or filter.")) + pager(r.total, u.per, u.page);
    box.onclick = e => {
      const p = e.target.closest("[data-p]"); if (p) { u.page = +p.dataset.p; return loadUsers(); }
      const tr = e.target.closest("tr[data-id]"); if (!tr) return; const row = r.rows.find(x => x.id === tr.dataset.id);
      if (e.target.closest("[data-view]")) { u.sel = row.id; openUser(row.id); document.querySelectorAll("#ul tr").forEach(x => x.classList.toggle("sel", x === tr)); }
      if (e.target.closest("[data-menu]")) { e.stopPropagation(); rowMenu(e.target.closest("[data-menu]"), row); }
    };
  }
  function rowMenu(btn, row) {
    const old = $(".cmenu"); if (old) old.remove();
    const m = document.createElement("div"); m.className = "cmenu"; const blocked = row.account_status !== "active";
    m.innerHTML = `<button data-a="view">View details</button><button data-a="edit">Edit user</button><button data-a="plan">Change plan</button><button data-a="reset">Reset password</button>${blocked ? `<button data-a="restore">Restore / unban</button>` : `<button data-a="suspend">Suspend account</button><button data-a="ban">Ban account</button><button data-a="deactivate">Deactivate account</button>`}<button data-a="delete" class="dn">Delete user</button><button data-a="purge" class="dn">Delete permanently…</button>`;
    document.body.appendChild(m); const r = btn.getBoundingClientRect(); m.style.top = r.bottom + scrollY + 4 + "px"; m.style.left = Math.max(8, r.right + scrollX - 200) + "px";
    m.onclick = ev => { const a = ev.target.closest("[data-a]"); if (!a) return; m.remove(); userAction(a.dataset.a, row.id, { name: row.name, email: row.email, plan_name: row.plan_name, plan_id: row.plan_id, account_status: row.account_status }); };
  }

  /* ---------- user actions ---------- */
  async function userAction(a, id, u) {
    try {
      if (a === "view") { S.u.sel = id; return openUser(id); }
      if (a === "edit" || a === "plan") { const d = await api("user_detail", { id }); return a === "edit" ? editUser(d.detail) : changePlan(d.detail); }
      if (a === "email") return emailUser(id, u.email);
      if (a === "reset") return confirmBox("Send password reset email", `Send a secure password reset link to <b>${esc(u.email)}</b>? The user chooses a new password; you never see it.`, "Send email", async () => { const r = await api("reset_password", { user_id: id }); toast("Reset email sent to " + r.email, "ok"); }, false);
      const labels = { suspend: ["Suspend account", "suspended", "Suspend"], ban: ["Ban account", "banned", "Ban user"], deactivate: ["Deactivate account", "deactivated", "Deactivate"], restore: ["Restore account", "active", "Restore"], delete: ["Delete user (soft delete)", "deleted", "Delete user"] };
      if (labels[a]) { const [t, status, lbl] = labels[a]; const warn = status === "active" ? "The user can sign in and use the app again." : status === "deleted" ? "The account is hidden and cannot sign in. Records are kept and you can restore it later." : "The user cannot sign in or use the app until restored.";
        return confirmBox(t, `<b>${esc(u.name || u.email)}</b><br>${warn}`, lbl, async f => { await api("set_status", { user_id: id, status, reason: f.reason }); toast("Done.", "ok"); refreshAfter(id); }, status !== "active", `<label class="fld"><span>Reason (optional)</span><input class="in" name="reason" maxlength="300"></label>`); }
      if (a === "purge") return confirmBox("Delete permanently", `This permanently removes <b>${esc(u.email)}</b> and everything they own. Payment records are archived. This cannot be undone.<br>Type the user's email to confirm.`, "Delete permanently", async f => { await api("hard_delete", { user_id: id, confirm_email: f.confirm_email }); toast("User permanently deleted.", "ok"); S.u.sel = null; $("#up").classList.add("hide"); route(); }, true, `<label class="fld"><span>Email</span><input class="in" name="confirm_email" autocomplete="off"></label>`);
    } catch (x) { fail(x); }
  }
  function refreshAfter(id) { if (location.hash === "#/users" || location.hash === "") { loadUsers(); } if (S.u.sel === id && !$("#up").classList.contains("hide")) openUser(id); }

  function editUser(d) {
    const p = d.profile;
    modal({ title: "Edit user", save: "Save changes", body: `<label class="fld"><span>Full name</span><input class="in" name="full_name" value="${esc(p.full_name || "")}" maxlength="100"></label><label class="fld"><span>Email</span><input class="in" name="email" type="email" value="${esc(p.email || "")}"></label><label class="fld"><span>Phone (optional)</span><input class="in" name="phone" value="${esc(p.phone || "")}" maxlength="30"></label><div class="note">Changing the email changes the address the user signs in with.</div>`,
      onSave: async f => { await api("edit_user", { user_id: p.id, full_name: f.full_name, email: f.email, phone: f.phone }); toast("User updated.", "ok"); refreshAfter(p.id); } });
  }
  function emailUser(id, email) {
    modal({ title: "Send email", save: "Send email", body: `<p style="margin-top:0">To: <b>${esc(email)}</b></p><label class="fld"><span>Subject</span><input class="in" name="subject" maxlength="150"></label><label class="fld"><span>Message</span><textarea class="in" name="message" maxlength="5000"></textarea></label>`,
      onSave: async f => { await api("send_email", { user_id: id, subject: f.subject, message: f.message }); toast("Email sent.", "ok"); } });
  }
  async function getPlans() { if (!plansCache) plansCache = (await api("plans")).plans; return plansCache; }
  async function changePlan(d) {
    const p = d.profile, plans = await getPlans(), cur = d.plan || {};
    const lim = pl => `${pl.dm_limit == null ? "Unlimited" : num(pl.dm_limit)} DMs / month · ${pl.max_ig_accounts} Instagram account(s) · ${pl.max_team_members} team member(s)`;
    const dlg = modal({ title: "Change plan", save: "Confirm change", wide: true, body: `<p style="margin-top:0"><b>${esc(p.full_name || p.email)}</b><br><small style="color:#6b7090">User ID: ${esc(p.id)}</small></p>
      <div class="lim">Current plan: <b>${esc(cur.name || "Starter")}</b></div>
      <div class="rad"><label><input type="radio" name="atype" value="free" checked> Free Admin Upgrade</label><label title="Paid plans start only after a verified Easebuzz payment"><input type="radio" name="atype" value="paid" disabled> Paid subscription</label></div>
      <div class="note">Paid plans are activated only by a verified Easebuzz payment (the user pays on their Billing page). An admin upgrade is complimentary: it is recorded as <b>admin_granted</b>, never as a payment.</div>
      <div class="r2"><label class="fld"><span>New plan</span><select class="in" name="plan_id" id="np">${plans.map(pl => `<option value="${pl.id}">${esc(pl.name)}</option>`).join("")}</select></label>
      <label class="fld"><span>Duration</span><select class="in" name="duration" id="dr">${opts([["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["365", "365 days"], ["date", "Until a date…"], ["lifetime", "Lifetime"]], "30")}</select></label></div>
      <div class="lim" id="pl2"></div><div class="r2"><label class="fld"><span>Start date</span><input class="in" value="Starts immediately" disabled></label><label class="fld"><span>Expiry date</span><input class="in" type="date" name="expires_at" id="ed" disabled></label></div>
      <label class="fld"><span>Reason (optional)</span><textarea class="in" name="reason" maxlength="500" placeholder="Why is this plan being granted?"></textarea></label>`,
      onSave: async f => { const dur = f.duration; const prm = { user_id: p.id, plan_id: f.plan_id, reason: f.reason };
        if (dur === "lifetime") prm.duration = "lifetime"; else if (dur === "date") { if (!f.expires_at) throw new Error("Choose an expiry date."); prm.duration = "date"; prm.expires_at = new Date(f.expires_at + "T23:59:59").toISOString(); } else { prm.duration = "days"; prm.days = +dur; }
        const r = await api("grant_plan", prm); toast("Plan granted (" + r.grant_id + ").", "ok"); refreshAfter(p.id); } });
    const upd = () => { const pl = plans.find(x => x.id === $("#np", dlg).value); $("#pl2", dlg).textContent = "Limits: " + lim(pl); const dr = $("#dr", dlg).value; $("#ed", dlg).disabled = dr !== "date"; if (dr !== "date") $("#ed", dlg).value = dr === "lifetime" ? "" : new Date(Date.now() + +dr * 864e5).toISOString().slice(0, 10); };
    $("#np", dlg).onchange = upd; $("#dr", dlg).onchange = upd; upd();
  }

  /* ---------- user detail panel ---------- */
  async function openUser(id) {
    const up = $("#up"); up.classList.remove("hide"); up.innerHTML = '<div class="pad"><div class="skel"></div><br><div class="skel" style="width:70%"></div></div>';
    let d; try { d = (await api("user_detail", { id })).detail; } catch (e) { up.innerHTML = `<div class="pad note">${esc(e.message)}</div>`; return; }
    let tab = "overview"; const p = d.profile, a = d.auth || {}, sub = d.subscription || {}, pl = d.plan || {}, us = d.usage || {};
    const activeGrant = (d.grants || []).find(g => g.status === "active");
    const blocked = p.account_status !== "active", ustat = blocked ? "blocked" : (pl.price_cents > 0 ? "active" : "free");
    const stTxt = { active: "Active", suspended: "Suspended", banned: "Banned", deactivated: "Deactivated", deleted: "Deleted" }[p.account_status];
    const kv = (a1, b1) => `<span>${a1}</span><span>${b1 ?? "—"}</span>`;
    const lim = pl.dm_limit;
    const body = {
      overview: () => `<div class="us"><h4>Personal Information <button class="btn sm" data-do="edit">✎ Edit</button></h4><div class="kv">${kv("Full Name", esc(p.full_name || "—"))}${kv("Email", esc(p.email))}${kv("Phone", esc(p.phone || "Not collected"))}${kv("Signup Method", esc(a.provider || "email"))}${kv("User ID", `<small>${esc(p.id)}</small>`)}${kv("Joined", fdt(p.created_at))}${kv("Last login", fdt(a.last_sign_in_at))}${kv("Email verified", a.email_confirmed_at ? "Yes" : "No")}${kv("Account status", esc(stTxt))}</div></div>
        <div class="us"><h4>Subscription Details <button class="btn sm" data-do="plan">Manage</button></h4><div class="kv">${kv("Plan", `<b class="pl ${esc(pl.id)}">${esc(pl.name || "Starter")}</b>`)}${kv("Source", activeGrant ? "Admin-granted" : sub.provider_subscription_id && sub.plan_id !== "starter" ? "Easebuzz (paid)" : "Free")}${kv("Subscription ID", esc(activeGrant ? activeGrant.internal_id : sub.id && sub.plan_id !== "starter" ? "sub_" + String(sub.id).slice(0, 8) : "-"))}${kv("Status", activeGrant ? "Active (complimentary)" : esc(sub.status || "active"))}${kv(activeGrant ? "Expires" : "Next billing", activeGrant ? (activeGrant.expires_at ? fd(activeGrant.expires_at) : "Lifetime") : fd(sub.current_period_end))}${kv("Amount", pl.price_cents ? money(pl.price_cents, "USD") + "/Month" : "Free")}</div></div>
        <div class="us"><h4>Usage Statistics</h4><div class="kv">${kv("Monthly DM limit", lim == null ? "Unlimited" : num(lim))}${kv("DMs used (month)", num(us.this_month))}${kv("Remaining", lim == null ? "Unlimited" : num(Math.max(0, lim - us.this_month)))}${kv("Automation rules", num(us.rules))}${kv("Instagram accounts", num(us.accounts))}${kv("Last active", fdt(a.last_sign_in_at))}</div></div>`,
      subscription: () => `<div class="us"><h4>Current plan</h4><div class="kv">${kv("Plan", esc(pl.name || "Starter"))}${kv("Billing", esc(sub.billing_interval || "—"))}${kv("Paid subscription", sub.provider_subscription_id && sub.plan_id !== "starter" ? esc(sub.plan_id) + " · " + esc(sub.status) : "None")}${kv("Renewal / end", fd(sub.current_period_end))}</div></div>
        <div class="us"><h4>Admin-granted plans <button class="btn sm" data-do="plan">＋ Grant</button></h4>${(d.grants || []).length ? tbl(["ID", "Plan", "Status", "Ends", ""], d.grants.map(g => `<tr><td><small>${esc(g.internal_id)}</small><small class="sm2">${esc(g.reason || "")}</small></td><td>${esc(g.plan_id)}</td><td>${badge(g.status, g.status)}</td><td>${g.expires_at ? fd(g.expires_at) : "Lifetime"}</td><td>${g.status === "active" ? `<button class="btn sm r" data-revoke="${g.id}">Revoke</button>` : ""}</td></tr>`)) : empty("No admin grants")}</div>`,
      payments: () => `<div class="us"><h4>Verified payments</h4>${(d.payments || []).length ? tbl(["Date", "Plan", "Amount", "Status", "Gateway ID"], d.payments.map(x => `<tr><td>${fd(x.created_at)}</td><td>${esc(x.plan_id || "—")}<small class="sm2">${esc(x.billing_interval || "")}</small></td><td>${x.amount_minor == null ? "—" : money(x.amount_minor, x.currency)}</td><td>${badge(x.status, x.status)}</td><td><small>${esc(x.provider_ref || "—")}</small></td></tr>`)) : empty("No payments", "Complimentary admin grants are not payments.")}<p class="sm2">Gateway: Easebuzz. Refund status is not tracked yet.</p></div>`,
      usage: () => `<div class="us"><h4>DM usage</h4><div class="kv">${kv("Limit", lim == null ? "Unlimited" : num(lim))}${kv("Used this month", num(us.this_month))}${kv("Remaining", lim == null ? "Unlimited" : num(Math.max(0, lim - us.this_month)))}${kv("Automation events", num(us.events))}${kv("Failed events", num(us.failed))}${kv("Leads", num(us.leads))}${kv("Rules", num(us.rules))}${kv("Instagram accounts", num(us.accounts))}</div></div><div class="us"><h4>Monthly history</h4>${(us.history || []).length ? tbl(["Month", "DMs sent"], us.history.map(h => `<tr><td>${esc(h.period)}</td><td>${num(h.dm_sent)}</td></tr>`)) : empty("No usage yet")}</div>`,
      activity: () => `<div class="us"><h4>Recent activity</h4><div class="kv">${kv("Last sign-in", fdt(a.last_sign_in_at))}${kv("Account created", fdt(a.created_at))}</div></div><div class="us">${(d.activity || []).length ? tbl(["When", "Event", "By"], d.activity.map(x => `<tr><td>${fdt(x.at)}</td><td>${esc(x.text)}</td><td>${x.type === "admin" ? esc(x.by || "admin") : "user"}</td></tr>`)) : empty("No activity recorded")}</div>`
    };
    function draw() {
      up.innerHTML = `<div class="uph"><h2>User Details</h2><button class="x" id="xp" aria-label="Close">✕</button></div>
        <div class="ubox"><span class="av lg2">${esc((p.full_name || p.email || "?")[0].toUpperCase())}</span><div><b style="font-size:18px">${esc(p.full_name || "—")}</b> ${badge(blocked ? stTxt : stLabel[ustat], ustat)}<small class="sm2">ID: ${esc(String(p.id).slice(0, 13))}…</small><small class="sm2">Joined: ${fdt(p.created_at)}</small></div></div>
        <div class="ut">${[["overview", "Overview"], ["subscription", "Subscription"], ["payments", "Payments"], ["usage", "Usage"], ["activity", "Activity"]].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <div>${body[tab]()}</div>
        <div class="acts"><button class="btn p" data-do="edit">✎ Edit User</button><button class="btn v" data-do="plan">👑 Change Plan</button><button class="btn g" data-do="email">✉ Send Email</button><button class="btn y" data-do="reset">Reset Password</button><button class="btn o" data-do="delete">🗑 Delete User</button><button class="btn r" data-do="${blocked ? "restore" : "ban"}">${blocked ? "Unban / Restore" : "⛔ Ban User"}</button></div>
        <div class="pad" style="padding-top:0"><button class="btn w" data-tab="activity">View All Activity Logs</button></div>`;
      $("#xp").onclick = () => { up.classList.add("hide"); S.u.sel = null; document.querySelectorAll("#ul tr.sel").forEach(x => x.classList.remove("sel")); };
    }
    draw();
    up.onclick = async e => {
      const t = e.target.closest("[data-tab]"); if (t) { tab = t.dataset.tab; return draw(); }
      const r = e.target.closest("[data-revoke]"); if (r) return confirmBox("Revoke grant", "The user returns to their paid plan (or Starter) immediately.", "Revoke", async f => { await api("revoke_grant", { id: r.dataset.revoke, reason: f.reason }); toast("Grant revoked.", "ok"); openUser(id); loadUsersIfVisible(); }, true, `<label class="fld"><span>Reason (optional)</span><input class="in" name="reason" maxlength="300"></label>`);
      const x = e.target.closest("[data-do]"); if (x) userAction(x.dataset.do, id, { name: p.full_name, email: p.email, account_status: p.account_status });
    };
  }
  const loadUsersIfVisible = () => { if ($("#ul")) loadUsers(); };

  /* ---------- other pages ---------- */
  PAGES.subscriptions = async el => {
    const st = { page: 1, q: "", source: "", status: "", plan: "" };
    el.innerHTML = head("Subscriptions", "Paid subscriptions and admin-granted (complimentary) plans.") + `<div class="pn"><div class="fb"><input class="in q" id="q" placeholder="Search ID, email or name…"><select class="in" id="s1">${opts([["", "All sources"], ["paid", "Paid (Easebuzz)"], ["admin_granted", "Admin-granted"]])}</select><select class="in" id="s2">${opts([["", "All status"], ["active", "Active"], ["expired", "Expired"], ["revoked", "Revoked"], ["canceled", "Cancelled"], ["past_due", "Past due"]])}</select><select class="in" id="s3">${opts([["", "All plans"], ["starter", "Starter"], ["growth", "Growth"], ["agency", "Agency"]])}</select></div><div id="lb"></div></div>`;
    const load = async () => { const r = await api("subscriptions", { ...st, per: 15 });
      $("#lb").innerHTML = (r.rows.length ? tbl(["Reference", "User", "Plan", "Source", "Status", "Started", "Ends"], r.rows.map(x => `<tr><td><small>${esc(x.ref)}</small></td><td>${esc(x.full_name || "—")}<small class="sm2">${esc(x.email || "")}</small></td><td class="pl ${esc(x.plan_id)}">${esc(x.plan_id)}<small class="sm2">${esc(x.interval || "")}</small></td><td>${x.source === "paid" ? badge("Paid", "paid") : badge("Admin-granted", "info")}<small class="sm2">${esc(x.reason || "")}</small></td><td>${badge(x.status, x.status === "active" ? "active" : x.status === "expired" || x.status === "revoked" || x.status === "canceled" ? "cancelled" : "failed")}</td><td>${fd(x.starts_at)}</td><td>${x.ends_at ? fd(x.ends_at) : x.source === "paid" ? "—" : "Lifetime"}</td></tr>`)) : empty("No subscriptions")) + pager(r.total, 15, st.page);
      $("#lb").onclick = e => { const b = e.target.closest("[data-p]"); if (b) { st.page = +b.dataset.p; load().catch(fail); } }; };
    let tm; $("#q").oninput = e => { clearTimeout(tm); tm = setTimeout(() => { st.q = e.target.value.trim(); st.page = 1; load().catch(fail); }, 350); };
    [["#s1", "source"], ["#s2", "status"], ["#s3", "plan"]].forEach(([s, k]) => ($(s).onchange = e => { st[k] = e.target.value; st.page = 1; load().catch(fail); }));
    await load();
  };
  PAGES.payments = async el => {
    const st = { page: 1, q: "", status: "" };
    el.innerHTML = head("Payments", "Verified Easebuzz transactions. Free admin grants are never shown here.") + `<div class="pn"><div class="fb"><input class="in q" id="q" placeholder="Search transaction ID, email or name…"><select class="in" id="s1">${opts([["", "All status"], ["paid", "Paid"], ["failed", "Failed"], ["cancelled", "Cancelled"]])}</select></div><div id="lb"></div><p class="sm2">Refund status is not tracked yet.</p></div>`;
    const load = async () => { const r = await api("payments", { ...st, per: 15 });
      $("#lb").innerHTML = (r.rows.length ? tbl(["Date", "User", "Plan", "Billing", "Amount", "Status", "Gateway transaction ID"], r.rows.map(x => `<tr><td>${fdt(x.created_at)}</td><td>${esc(x.full_name || "—")}<small class="sm2">${esc(x.email || "")}</small></td><td>${esc(x.plan_id || "—")}</td><td>${esc(x.billing_interval || "—")}</td><td>${x.amount_minor == null ? "—" : money(x.amount_minor, x.currency)}</td><td>${badge(x.status, x.status)}</td><td><small>${esc(x.provider_ref || "—")}</small></td></tr>`)) : empty("No payments yet", "Payments appear here after Easebuzz confirms them.")) + pager(r.total, 15, st.page);
      $("#lb").onclick = e => { const b = e.target.closest("[data-p]"); if (b) { st.page = +b.dataset.p; load().catch(fail); } }; };
    let tm; $("#q").oninput = e => { clearTimeout(tm); tm = setTimeout(() => { st.q = e.target.value.trim(); st.page = 1; load().catch(fail); }, 350); };
    $("#s1").onchange = e => { st.status = e.target.value; st.page = 1; load().catch(fail); };
    await load();
  };
  PAGES.usage = async el => {
    const st = { page: 1, q: "" };
    el.innerHTML = head("AI Usage", "Automated DM usage and limits per user (this month).") + `<div id="tt"></div><div class="pn"><div class="fb"><input class="in q" id="q" placeholder="Search email or name…"></div><div id="lb"></div></div>`;
    const load = async () => { const r = await api("usage", { ...st, per: 15 });
      $("#tt").innerHTML = `<div class="cards">${card("✉️", "#e3e9ff", num(r.totals.dm_sent_month), "DMs sent this month")}${card("✅", "#e0f6ea", num(r.totals.sent_30d), "Successful sends", "last 30 days")}${card("⚠️", "#fde8e6", num(r.totals.failed_30d), "Failed events", "last 30 days")}</div>`;
      $("#lb").innerHTML = (r.rows.length ? tbl(["User", "Plan", "DMs this month", "Limit", "Used", "Accounts", "Failed (30d)"], r.rows.map(x => { const pct = x.dm_limit == null ? "—" : Math.round((x.dm_sent / x.dm_limit) * 100) + "%"; return `<tr><td>${esc(x.full_name || "—")}<small class="sm2">${esc(x.email || "")}</small></td><td class="pl ${esc(x.plan_id)}">${esc(x.plan_id)}</td><td>${num(x.dm_sent)}</td><td>${x.dm_limit == null ? "Unlimited" : num(x.dm_limit)}</td><td>${pct}</td><td>${num(x.accounts)}</td><td>${num(x.failed_30d)}</td></tr>`; })) : empty("No usage yet")) + pager(r.total, 15, st.page);
      $("#lb").onclick = e => { const b = e.target.closest("[data-p]"); if (b) { st.page = +b.dataset.p; load().catch(fail); } }; };
    let tm; $("#q").oninput = e => { clearTimeout(tm); tm = setTimeout(() => { st.q = e.target.value.trim(); st.page = 1; load().catch(fail); }, 350); };
    await load();
  };
  PAGES.reports = async el => {
    el.innerHTML = head("Reports", "Registrations, subscriptions, payments and usage. CSV export is recorded in the audit log.", true) + `<div class="pn"><div class="fb"><select class="in" id="rt2">${opts([["registrations", "Registrations"], ["subscriptions", "Subscriptions"], ["payments", "Payments & revenue"], ["usage", "DM usage"]])}</select><button class="btn p" id="pv">Preview</button><button class="btn v" id="dl">⬇ Download CSV</button></div><div id="rp"><p class="sm2">Choose a report and the date range above.</p></div></div>`;
    bindRange();
    $("#pv").onclick = async () => { try { const r = await api("report", { type: $("#rt2").value, ...rangeParams() }); const cols = r.rows.length ? Object.keys(r.rows[0]) : []; $("#rp").innerHTML = r.rows.length ? `<p class="sm2">Showing ${r.rows.length} of ${num(r.total)} rows</p>` + tbl(cols.map(esc), r.rows.map(x => `<tr>${cols.map(c => `<td>${esc(x[c] ?? "")}</td>`).join("")}</tr>`)) : empty("No data for this range"); } catch (x) { fail(x); } };
    $("#dl").onclick = async () => { try { const r = await api("report", { type: $("#rt2").value, format: "csv", ...rangeParams() }); download(r.filename, r.csv); toast("Report downloaded.", "ok"); } catch (x) { fail(x); } };
  };
  PAGES.withdrawals = async el => { el.innerHTML = head("Withdrawals", "Creator and affiliate payouts.") + `<div class="pn">${empty("No withdrawals", "Try AI GPT has no creator or affiliate payout program yet, so there is nothing to approve here.")}</div>`; };

  PAGES.coupons = async el => {
    const r = await api("coupon_list"), plans = await getPlans();
    el.innerHTML = head("Coupons", "Create and manage discount codes.") + `<div class="note">Coupons are saved here, but they are not applied at checkout yet.</div><div class="pn"><div class="fb"><button class="btn p" id="nc">＋ New coupon</button></div>${r.coupons.length ? tbl(["Code", "Discount", "Plans", "Used", "Expires", "Active", ""], r.coupons.map(c => `<tr><td><b>${esc(c.code)}</b><small class="sm2">${esc(c.description || "")}</small></td><td>${c.discount_type === "percent" ? c.discount_value + "%" : money(c.discount_value, "USD")}</td><td>${esc((c.applies_to || ["all"]).join(", "))}</td><td>${c.redeemed_count}${c.max_redemptions ? " / " + c.max_redemptions : ""}</td><td>${fd(c.expires_at)}</td><td>${c.active ? badge("Active", "active") : badge("Off", "free")}</td><td style="white-space:nowrap"><button class="btn sm" data-e="${c.id}">Edit</button> <button class="btn sm r" data-d="${c.id}">Delete</button></td></tr>`)) : empty("No coupons yet")}</div>`;
    const form = c => `<label class="fld"><span>Code</span><input class="in" name="code" value="${esc(c.code || "")}" maxlength="30"></label><label class="fld"><span>Description</span><input class="in" name="description" value="${esc(c.description || "")}" maxlength="200"></label>
      <div class="r2"><label class="fld"><span>Type</span><select class="in" name="discount_type">${opts([["percent", "Percent off"], ["fixed", "Fixed amount (cents)"]], c.discount_type || "percent")}</select></label><label class="fld"><span>Value</span><input class="in" type="number" name="discount_value" min="1" value="${c.discount_value || ""}"></label></div>
      <div class="rad">${plans.filter(p => p.price_cents > 0).map(p => `<label><input type="checkbox" name="pl_${p.id}" ${!c.applies_to || c.applies_to.includes(p.id) ? "checked" : ""}> ${esc(p.name)}</label>`).join("")}</div>
      <div class="r2"><label class="fld"><span>Max redemptions</span><input class="in" type="number" name="max_redemptions" min="1" value="${c.max_redemptions || ""}"></label><label class="fld"><span>Expiry date</span><input class="in" type="date" name="expires_at" value="${c.expires_at ? c.expires_at.slice(0, 10) : ""}"></label></div><label class="rad"><input type="checkbox" name="active" ${c.active !== false ? "checked" : ""}> Active</label>`;
    const save = c => async f => { const applies = plans.filter(p => f["pl_" + p.id]).map(p => p.id); await api("coupon_save", { id: c.id, code: f.code, description: f.description, discount_type: f.discount_type, discount_value: f.discount_value, applies_to: applies, max_redemptions: f.max_redemptions, expires_at: f.expires_at ? new Date(f.expires_at + "T23:59:59").toISOString() : null, active: !!f.active }); toast("Coupon saved.", "ok"); route(); };
    $("#nc").onclick = () => modal({ title: "New coupon", body: form({}), onSave: save({}) });
    el.onclick = e => { const ed = e.target.closest("[data-e]"), dl = e.target.closest("[data-d]"); if (ed) { const c = r.coupons.find(x => x.id === ed.dataset.e); modal({ title: "Edit coupon", body: form(c), onSave: save(c) }); } if (dl) confirmBox("Delete coupon", "Delete this coupon?", "Delete", async () => { await api("coupon_delete", { id: dl.dataset.d }); toast("Deleted.", "ok"); route(); }); };
  };
  PAGES.tickets = async el => {
    let status = "";
    const load = async () => { const r = await api("ticket_list", { status });
      $("#lb").innerHTML = r.tickets.length ? tbl(["Subject", "User", "Status", "Created", ""], r.tickets.map(t => `<tr><td><b>${esc(t.subject)}</b></td><td>${esc(t.user ? t.user.email : "—")}</td><td>${badge(t.status, t.status === "resolved" ? "active" : t.status === "open" ? "failed" : "cancelled")}</td><td>${fdt(t.created_at)}</td><td><button class="btn sm p" data-o="${t.id}">Open</button></td></tr>`)) : empty("No tickets");
      $("#lb").onclick = e => { const o = e.target.closest("[data-o]"); if (o) openTicket(o.dataset.o, load); }; };
    el.innerHTML = head("Support Tickets", "Read, reply, assign and resolve tickets.") + `<div class="pn"><div class="fb"><select class="in" id="ts">${opts([["", "All tickets"], ["open", "Open"], ["pending", "Pending"], ["resolved", "Resolved"]])}</select></div><div id="lb"></div></div>`;
    $("#ts").onchange = e => { status = e.target.value; load().catch(fail); }; await load();
  };
  async function openTicket(id, reload) {
    try { const r = await api("ticket_get", { id }), t = r.ticket;
      const d = modal({ title: esc(t.subject), save: "Send reply", wide: true, body: `<div class="fb"><select class="in" id="tstat">${opts([["open", "Open"], ["pending", "Pending"], ["resolved", "Resolved"]], t.status)}</select><button type="button" class="btn sm" id="asg">${t.assigned_to ? "Unassign" : "Assign to me"}</button></div>
        <div style="max-height:260px;overflow:auto;background:#fafaff;border-radius:12px;padding:12px">${r.messages.map(m => `<div style="margin-bottom:10px;${m.from_admin ? "text-align:right" : ""}"><span style="display:inline-block;max-width:80%;padding:9px 12px;border-radius:12px;background:${m.from_admin ? "#e6efff" : "#fff"};border:1px solid #e7eaf6;white-space:pre-wrap;text-align:left">${esc(m.body)}</span><br><small class="sm2">${m.from_admin ? "Support" : "User"} · ${fdt(m.created_at)}</small></div>`).join("") || "<small>No messages.</small>"}</div>
        <label class="fld" style="margin-top:12px"><span>Reply</span><textarea class="in" name="body" maxlength="4000"></textarea></label>`,
        onSave: async f => { if (f.body.trim()) await api("ticket_reply", { id, body: f.body }); await api("ticket_update", { id, status: $("#tstat", d).value }); toast("Saved.", "ok"); reload(); } });
      $("#asg", d).onclick = async () => { try { await api("ticket_update", { id, assign_to_me: !t.assigned_to }); toast("Assignment updated.", "ok"); d.close(); reload(); } catch (x) { fail(x); } };
    } catch (x) { fail(x); }
  }
  PAGES.announcements = async el => {
    const r = await api("ann_list");
    el.innerHTML = head("Announcements", "Shown as a banner on the Try AI GPT dashboard.") + `<div class="pn"><div class="fb"><button class="btn p" id="na">＋ New announcement</button></div>${r.items.length ? tbl(["Title", "Level", "Starts", "Ends", "Active", ""], r.items.map(a => `<tr><td><b>${esc(a.title)}</b><small class="sm2">${esc(a.body.slice(0, 90))}</small></td><td>${esc(a.level)}</td><td>${fd(a.starts_at)}</td><td>${fd(a.ends_at)}</td><td>${a.active ? badge("Live", "active") : badge("Off", "free")}</td><td style="white-space:nowrap"><button class="btn sm" data-e="${a.id}">Edit</button> <button class="btn sm r" data-d="${a.id}">Delete</button></td></tr>`)) : empty("No announcements")}</div>`;
    const form = a => `<label class="fld"><span>Title</span><input class="in" name="title" value="${esc(a.title || "")}" maxlength="120"></label><label class="fld"><span>Message</span><textarea class="in" name="body" maxlength="2000">${esc(a.body || "")}</textarea></label><div class="r2"><label class="fld"><span>Level</span><select class="in" name="level">${opts([["info", "Info"], ["success", "Success"], ["warning", "Warning"]], a.level || "info")}</select></label><label class="fld"><span>Ends (optional)</span><input class="in" type="date" name="ends_at" value="${a.ends_at ? a.ends_at.slice(0, 10) : ""}"></label></div><label class="rad"><input type="checkbox" name="active" ${a.active !== false ? "checked" : ""}> Show to users</label>`;
    const save = a => async f => { await api("ann_save", { id: a.id, title: f.title, body: f.body, level: f.level, ends_at: f.ends_at ? new Date(f.ends_at + "T23:59:59").toISOString() : null, active: !!f.active }); toast("Saved.", "ok"); route(); };
    $("#na").onclick = () => modal({ title: "New announcement", body: form({}), onSave: save({}) });
    el.onclick = e => { const ed = e.target.closest("[data-e]"), dl = e.target.closest("[data-d]"); if (ed) { const a = r.items.find(x => x.id === ed.dataset.e); modal({ title: "Edit announcement", body: form(a), onSave: save(a) }); } if (dl) confirmBox("Delete announcement", "Delete this announcement?", "Delete", async () => { await api("ann_delete", { id: dl.dataset.d }); toast("Deleted.", "ok"); route(); }); };
  };
  PAGES.settings = async el => {
    const [sr, pr] = await Promise.all([api("settings_get"), api("plans")]); plansCache = pr.plans; const set = sr.settings;
    el.innerHTML = head("Settings", "Plans, permissions and admin accounts.") +
      `<div class="pn"><h3>Plan configuration</h3><div class="note">The USD price is the display price. What Easebuzz actually charges is the INR price below (Easebuzz accepts INR only). Leave the yearly INR price blank to use 12 x monthly x 0.75.</div>${pr.plans.map(p => `<form class="pf" data-id="${p.id}" style="border:1px solid #e7eaf6;border-radius:12px;padding:12px;margin-bottom:12px"><b class="pl ${p.id}">${esc(p.name)}</b>
        <div class="r2" style="margin-top:8px"><label class="fld"><span>Monthly price (cents)</span><input class="in" name="price_cents" type="number" min="0" value="${p.price_cents}"></label><label class="fld"><span>Yearly price (cents)</span><input class="in" name="price_yearly_cents" type="number" min="0" value="${p.price_yearly_cents ?? 0}"></label>
        <label class="fld"><span>DMs / month (blank = unlimited)</span><input class="in" name="dm_limit" type="number" min="1" value="${p.dm_limit ?? ""}"></label><label class="fld"><span>Instagram accounts</span><input class="in" name="max_ig_accounts" type="number" min="1" value="${p.max_ig_accounts}"></label>
        <label class="fld"><span>Team members</span><input class="in" name="max_team_members" type="number" min="0" value="${p.max_team_members}"></label><label class="fld"><span>Templates</span><select class="in" name="templates">${opts([["limited", "Limited"], ["unlimited", "Unlimited"]], p.features.templates)}</select></label>
        <label class="fld"><span>Analytics</span><select class="in" name="analytics">${opts([["basic", "Basic"], ["detailed", "Detailed"]], p.features.analytics)}</select></label><div class="rad" style="align-items:end"><label><input type="checkbox" name="leads" ${p.features.leads ? "checked" : ""}> Lead management</label><label><input type="checkbox" name="priority_support" ${p.features.priority_support ? "checked" : ""}> Priority support</label></div>
        <label class="fld"><span>Charged per month (INR)</span><input class="in" name="price_inr" type="number" min="1" step="0.01" value="${p.price_inr ?? ""}"></label><label class="fld"><span>Charged per year (INR, optional)</span><input class="in" name="price_yearly_inr" type="number" min="1" step="0.01" value="${p.price_yearly_inr ?? ""}"></label></div><button class="btn p sm" type="submit">Save ${esc(p.name)}</button></form>`).join("")}</div>
      <div class="pn"><h3>Permissions</h3>${[["lifetime_grants_enabled", "Allow lifetime plan grants"], ["permanent_delete_enabled", "Allow permanent user deletion"]].map(([k, l]) => `<div class="row"><span>${l}</span><button class="sw ${set[k] === true ? "on" : ""}" data-k="${k}" aria-label="${l}"></button></div>`).join("")}
        <div class="r2" style="margin-top:12px"><label class="fld"><span>Website URL (https://)</span><input class="in" id="wu" value="${esc(set.website_url || "")}"></label><label class="fld"><span>Support email</span><input class="in" id="se" value="${esc(set.support_email || "")}"></label></div><button class="btn p sm" id="sv">Save</button> <small class="sm2">Email sending: ${sr.mail_configured ? "configured" : "not configured (add RESEND_API_KEY and MAIL_FROM)"}</small></div>
      <div class="pn"><h3>Admin accounts</h3>${tbl(["Email", "Admin since"], sr.admins.map(a => `<tr><td>${esc(a.email || a.user_id)}</td><td>${fd(a.created_at)}</td></tr>`))}<p class="sm2">Admins are provisioned only through the one-time SQL step in the README. They cannot be added from the website.</p></div>
      <div class="pn"><h3>Audit log</h3><div id="au"></div></div>`;
    el.querySelectorAll(".pf").forEach(f => (f.onsubmit = async e => { e.preventDefault(); const x = f.elements; try { await api("plan_update", { id: f.dataset.id, price_cents: x.price_cents.value, price_yearly_cents: x.price_yearly_cents.value, dm_limit: x.dm_limit.value === "" ? null : x.dm_limit.value, max_ig_accounts: x.max_ig_accounts.value, max_team_members: x.max_team_members.value, features: { templates: x.templates.value, analytics: x.analytics.value, leads: x.leads.checked, priority_support: x.priority_support.checked }, price_inr: x.price_inr.value, price_yearly_inr: x.price_yearly_inr.value }); plansCache = null; toast("Plan saved.", "ok"); } catch (z) { fail(z); } }));
    el.querySelectorAll("[data-k]").forEach(b => (b.onclick = async () => { const on = !b.classList.contains("on"); try { await api("settings_set", { key: b.dataset.k, value: on }); b.classList.toggle("on", on); toast("Saved.", "ok"); } catch (z) { fail(z); } }));
    $("#sv").onclick = async () => { try { await api("settings_set", { key: "website_url", value: $("#wu").value.trim() }); await api("settings_set", { key: "support_email", value: $("#se").value.trim() }); toast("Saved.", "ok"); } catch (z) { fail(z); } };
    let ap = 1; const loadAudit = async () => { const r = await api("audit_list", { page: ap }); $("#au").innerHTML = (r.rows.length ? tbl(["When", "Admin", "Action", "User", "IP"], r.rows.map(x => `<tr><td>${fdt(x.created_at)}</td><td>${esc(x.admin_email || "—")}</td><td>${esc(x.action)}</td><td>${esc(x.target_email || "—")}</td><td><small>${esc(x.ip || "")}</small></td></tr>`)) : empty("No admin actions yet")) + pager(r.total, 25, ap); $("#au").onclick = e => { const b = e.target.closest("[data-p]"); if (b) { ap = +b.dataset.p; loadAudit(); } }; };
    loadAudit().catch(fail);
  };

  function download(name, text) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
  boot();
})();
