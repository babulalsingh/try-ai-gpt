(function () {
  const { sb } = App, P = window.P;
  const card = (h, cls = "") => `<div class="card ${cls}">${h}</div>`;
  const empty = (t, m, a = "") => `<div class="empty"><strong>${t}</strong>${m}${a ? "<br><br>" + a : ""}</div>`;
  const opts = (arr, sel) => arr.map(([v, l]) => `<option value="${esc(v)}" ${v == sel ? "selected" : ""}>${esc(l)}</option>`).join("");
  const tbl = (heads, rows) => `<div class="tw"><table><thead><tr>${heads.map(h => "<th>" + h + "</th>").join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  const must = r => { if (r.error) throw r.error; return r.data; };
  const norm = s => String(s || "").trim().toLowerCase();
  const kv = (a, b) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`;
  const stKind = s => ({ sent: "ok", failed: "bad", skipped: "warn", converted: "ok", qualified: "ok", new: "", contacted: "warn" }[s] || "");
  const AGENTS = ["owner", "admin", "moderator", "support"], ROLES = ["admin", "moderator", "support", "analyst"];

  /* ---------- Audience & Leads ---------- */
  P["audience-leads"] = async (c, el) => {
    const can = AGENTS.includes(c.role) && c.plan.features && c.plan.features.leads;
    let all = [], tags = {};
    async function load() {
      const [l, t] = await Promise.all([sb.from("leads").select("*").eq("workspace_id", c.ws).order("last_activity_at", { ascending: false }).limit(2000), sb.from("lead_tags").select("lead_id,tag").eq("workspace_id", c.ws)]);
      all = must(l); tags = {}; (t.data || []).forEach(x => (tags[x.lead_id] = tags[x.lead_id] || []).push(x.tag)); draw();
    }
    function view() { const q = App.q("#lq") ? App.q("#lq").value : "", st = App.q("#ls") ? App.q("#ls").value : ""; return { q, st, list: all.filter(x => (!st || x.status === st) && (!q || norm([x.username, x.keyword, x.ig_user_id, (tags[x.id] || []).join(" ")].join(" ")).includes(norm(q)))) }; }
    function draw() {
      const { q, st, list } = view(), by = s => all.filter(x => x.status === s).length;
      el.innerHTML = (c.plan.features && c.plan.features.leads ? "" : `<div class="setup">Editing leads and CSV export are part of the Growth plan. You can still view captured leads. <a href="billing-plan.html">Upgrade</a></div>`) +
        `<div class="stats">${[[all.length, "Total leads"], [by("new"), "New"], [by("qualified"), "Qualified"], [by("converted"), "Converted"]].map(x => `<div class="card stat"><b>${App.num(x[0])}</b><span>${x[1]}</span></div>`).join("")}</div>` +
        card(`<div class="bar2"><input class="input" id="lq" placeholder="Search username, keyword, tag…" value="${esc(q)}"><select class="input" id="ls">${opts([["", "All status"], ["new", "New"], ["contacted", "Contacted"], ["qualified", "Qualified"], ["converted", "Converted"]], st)}</select><span class="sp"></span><button class="btn" id="exp" ${can ? "" : "disabled"}>Export CSV</button></div>
        ${list.length ? tbl(["Username", "Source", "Keyword", "Status", "Tags", "Last activity"], list.slice(0, 200).map(x => `<tr class="click" data-id="${x.id}"><td><b>@${esc(x.username || x.ig_user_id)}</b></td><td>${esc(x.source || "—")}</td><td>${esc(x.keyword || "—")}</td><td>${App.badge(x.status, stKind(x.status))}</td><td>${esc((tags[x.id] || []).join(", "))}</td><td>${App.fmt(x.last_activity_at)}</td></tr>`)) : empty("No leads yet", "Leads are added automatically when someone triggers a rule or messages you.")}${list.length > 200 ? `<p style="color:var(--muted)">Showing 200 of ${list.length}. Use search or export.</p>` : ""}`);
      ["#lq", "#ls"].forEach(s => (App.q(s).onchange = draw));
      App.q("#exp").onclick = () => App.csv("leads.csv", [["username", "ig_user_id", "source", "keyword", "status", "tags", "notes", "first_seen", "last_activity"], ...list.map(x => [x.username, x.ig_user_id, x.source, x.keyword, x.status, (tags[x.id] || []).join("|"), x.notes, x.first_seen_at, x.last_activity_at])]);
      el.onclick = e => { const r = e.target.closest("tr[data-id]"); if (r) openLead(all.find(x => x.id === r.dataset.id)); };
    }
    function openLead(x) {
      App.modal({
        title: "@" + esc(x.username || x.ig_user_id), save: can ? "Save" : "", onSave: can ? async f => {
          must(await sb.from("leads").update({ status: f.status, notes: f.notes }).eq("id", x.id));
          const nw = f.tags.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 20), old = tags[x.id] || [];
          const add = nw.filter(t => !old.includes(t)), del = old.filter(t => !nw.includes(t));
          if (del.length) must(await sb.from("lead_tags").delete().eq("lead_id", x.id).in("tag", del));
          if (add.length) must(await sb.from("lead_tags").insert(add.map(tag => ({ lead_id: x.id, workspace_id: c.ws, tag }))));
          load();
        } : null,
        body: `${kv("Source", esc(x.source || "—"))}${kv("Keyword", esc(x.keyword || "—"))}${kv("First seen", App.fmt(x.first_seen_at))}${kv("Last activity", App.fmt(x.last_activity_at))}<br>
        <label class="field"><span>Status</span><select class="input" name="status" ${can ? "" : "disabled"}>${opts([["new", "New"], ["contacted", "Contacted"], ["qualified", "Qualified"], ["converted", "Converted"]], x.status)}</select></label>
        <label class="field"><span>Tags (comma separated)</span><input class="input" name="tags" value="${esc((tags[x.id] || []).join(", "))}" ${can ? "" : "disabled"}></label>
        <label class="field"><span>Notes</span><textarea class="input" name="notes" ${can ? "" : "disabled"}>${esc(x.notes || "")}</textarea></label><a href="inbox.html">Open inbox</a>`
      });
    }
    await load();
  };

  /* ---------- Analytics ---------- */
  P.analytics = async (c, el) => {
    let charts = [];
    el.innerHTML = card(`<div class="bar2"><b>Date range</b><select class="input" id="rg">${opts([[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"]], 30)}</select></div>`) + `<div id="an"></div>`;
    async function draw() {
      charts.forEach(x => x.destroy()); charts = [];
      const days = +App.q("#rg").value, since = new Date(Date.now() - days * 864e5).toISOString();
      const [ev, ld, rl, us] = await Promise.all([
        sb.from("automation_events").select("status,event_type,rule_id,created_at").eq("workspace_id", c.ws).gte("created_at", since).limit(10000),
        sb.from("leads").select("status,first_seen_at").eq("workspace_id", c.ws).gte("first_seen_at", since),
        sb.from("automation_rules").select("id,keyword,template_id,dm_templates(name)").eq("workspace_id", c.ws),
        sb.from("usage_counters").select("dm_sent").eq("workspace_id", c.ws).eq("period", App.monthStart()).maybeSingle()]);
      const e = must(ev), l = must(ld), r = must(rl), n = s => e.filter(x => x.status === s).length;
      const comments = e.filter(x => x.event_type === "comment").length, conv = l.filter(x => x.status === "converted").length;
      const rate = l.length ? ((conv / l.length) * 100).toFixed(1) + "%" : "—";
      const labels = [...Array(days)].map((_, i) => new Date(Date.now() - (days - 1 - i) * 864e5).toISOString().slice(0, 10));
      const series = s => labels.map(d => e.filter(x => x.status === s && x.created_at.slice(0, 10) === d).length);
      const top = {}; e.filter(x => x.status === "sent" && x.rule_id).forEach(x => (top[x.rule_id] = (top[x.rule_id] || 0) + 1));
      const topRows = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, k]) => { const ru = r.find(y => y.id === id) || {}; return `<tr><td><b>${esc(ru.keyword || "(deleted rule)")}</b></td><td>${esc((ru.dm_templates && ru.dm_templates.name) || "—")}</td><td>${k}</td></tr>`; });
      const used = us.data ? us.data.dm_sent : 0;
      App.q("#an").innerHTML = `<div class="stats">${[[comments, "Comments received"], [n("sent"), "Replies sent"], [n("failed"), "Failed"], [n("skipped"), "Skipped"]].map(x => `<div class="card stat"><b>${App.num(x[0])}</b><span>${x[1]}</span></div>`).join("")}</div>
      <div class="stats">${[[l.length, "Leads generated"], [rate, "Conversion rate"], [App.num(used) + " / " + App.lim(c.plan.dm_limit), "Monthly usage"], [n("received") + n("matched"), "Unprocessed"]].map(x => `<div class="card stat"><b>${x[0]}</b><span>${x[1]}</span></div>`).join("")}</div>
      <p style="color:var(--muted);margin-top:-6px">Conversion rate = leads marked Converted ÷ leads first seen in this period.</p>
      <div class="grid2">${card(`<h3>Activity by day</h3><div class="chartbox"><canvas id="c1"></canvas></div>`)}${card(`<h3>Outcome</h3><div class="chartbox"><canvas id="c2"></canvas></div>`)}</div><br>
      ${card(`<h3>Top rules (by sent replies)</h3>${topRows.length ? tbl(["Keyword", "Template", "Sent"], topRows) : empty("No data yet", "Rules appear here after replies are sent.")}`)}`;
      if (!window.Chart) return App.q("#an").insertAdjacentHTML("afterbegin", `<div class="setup">Charts library could not load. Check your connection.</div>`);
      charts.push(new Chart(App.q("#c1"), { type: "bar", data: { labels: labels.map(d => d.slice(5)), datasets: [{ label: "Sent", data: series("sent"), backgroundColor: "#6d3cf0" }, { label: "Failed", data: series("failed"), backgroundColor: "#f04438" }, { label: "Skipped", data: series("skipped"), backgroundColor: "#f79009" }] }, options: { maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } } }));
      charts.push(new Chart(App.q("#c2"), { type: "doughnut", data: { labels: ["Sent", "Failed", "Skipped"], datasets: [{ data: [n("sent"), n("failed"), n("skipped")], backgroundColor: ["#12b76a", "#f04438", "#f79009"] }] }, options: { maintainAspectRatio: false } }));
    }
    App.q("#rg").onchange = draw; await draw();
  };

  /* ---------- Inbox ---------- */
  P.inbox = async (c, el) => {
    const can = AGENTS.includes(c.role); let convs = [], cur = null, tab = "open", q = "", timer;
    const tpls = must(await sb.from("dm_templates").select("name,body").eq("workspace_id", c.ws).eq("status", "active"));
    el.innerHTML = `<div class="tabs" id="tabs">${[["open", "All"], ["unread", "Unread"], ["starred", "Starred"], ["archived", "Archived"]].map(([k, l]) => `<button data-k="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="inbox"><div class="card"><div style="padding:10px"><input class="input" id="sq" placeholder="Search conversations…"></div><div class="clist" id="cl"></div></div><div class="card" id="th">${empty("Select a conversation", "")}</div></div>
    <p style="color:var(--muted)">Replies must follow Meta's messaging window; errors from Instagram are shown if a reply is not allowed.</p>`;
    const name = x => (x.leads && x.leads.username) || x.ig_user_id;
    async function loadList() {
      convs = must(await sb.from("conversations").select("*,leads(username)").eq("workspace_id", c.ws).order("last_message_at", { ascending: false }).limit(200));
      const f = convs.filter(x => (tab === "archived" ? x.status === "archived" : x.status === "open") && (tab !== "unread" || x.unread_count > 0) && (tab !== "starred" || x.starred) && (!q || norm(name(x)).includes(norm(q))));
      App.q("#cl").innerHTML = f.length ? f.map(x => `<div class="citem ${x.unread_count ? "unread" : ""} ${cur && cur.id === x.id ? "on" : ""}" data-id="${x.id}"><b>${x.starred ? "★ " : ""}@${esc(name(x))}</b> ${x.unread_count ? App.badge(x.unread_count, "warn") : ""}<br><small style="color:var(--muted)">${App.fmt(x.last_message_at)}</small></div>`).join("") : empty("No conversations", "");
    }
    async function openConv(id, keepScroll) {
      cur = convs.find(x => x.id === id); if (!cur) return;
      const m = must(await sb.from("messages").select("*").eq("conversation_id", id).order("created_at").limit(300));
      if (cur.unread_count) { await sb.from("conversations").update({ unread_count: 0 }).eq("id", id); cur.unread_count = 0; }
      App.q("#th").innerHTML = `<div style="padding:12px 16px;border-bottom:1px solid var(--line);display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>@${esc(name(cur))}</b><span class="sp" style="flex:1"></span>${can ? `<button class="ibtn" id="st">${cur.starred ? "Unstar" : "Star"}</button><button class="ibtn" id="ar">${cur.status === "archived" ? "Unarchive" : "Archive"}</button>` : ""}</div>
      <div class="thread" id="tl">${m.length ? m.map(x => `<div class="msg ${x.direction}">${esc(x.body || "")}<br><small style="opacity:.7">${App.fmt(x.created_at)}</small></div>`).join("") : empty("No messages", "")}</div>
      ${can ? `<form class="compose" id="cf"><select class="input" id="tp" style="width:auto"><option value="">Use template…</option>${tpls.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join("")}</select><textarea class="input" id="tx" placeholder="Type a message…" required maxlength="1000"></textarea><button class="btn btn-primary">Send</button></form>` : `<p style="padding:12px;color:var(--muted)">Your role cannot reply.</p>`}`;
      const tl = App.q("#tl"); tl.scrollTop = tl.scrollHeight;
      if (can) {
        App.q("#tp").onchange = e => { if (e.target.value !== "") App.q("#tx").value = App.vars(tpls[e.target.value].body, { username: name(cur), keyword: "", post_url: "" }); };
        App.q("#st").onclick = async () => { must(await sb.from("conversations").update({ starred: !cur.starred }).eq("id", cur.id)); await loadList(); openConv(cur.id); };
        App.q("#ar").onclick = async () => { must(await sb.from("conversations").update({ status: cur.status === "archived" ? "open" : "archived" }).eq("id", cur.id)); cur = null; await loadList(); App.q("#th").innerHTML = empty("Select a conversation", ""); };
        App.q("#cf").onsubmit = async e => { e.preventDefault(); const b = e.submitter; b.disabled = true; try { await App.fn("instagram-api", { action: "send_message", conversation_id: cur.id, text: App.q("#tx").value.trim() }); await loadList(); await openConv(cur.id); } catch (x) { App.err(x); b.disabled = false; } };
      }
      loadList();
    }
    App.q("#tabs").onclick = e => { const b = e.target.closest("[data-k]"); if (!b) return; tab = b.dataset.k; document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("on", x === b)); loadList(); };
    App.q("#sq").oninput = e => { q = e.target.value; loadList(); };
    App.q("#cl").onclick = e => { const i = e.target.closest("[data-id]"); if (i) openConv(i.dataset.id); };
    await loadList();
    timer = setInterval(() => { if (!document.hidden && !document.querySelector("dialog[open]") && document.activeElement.id !== "tx") { loadList(); if (cur) openConv(cur.id); } }, 20000);
    window.addEventListener("pagehide", () => clearInterval(timer));
  };

  /* ---------- Team ---------- */
  P["team-members"] = async (c, el) => {
    const admin = ["owner", "admin"].includes(c.role);
    async function draw() {
      const [m, i, a] = await Promise.all([sb.from("workspace_members").select("user_id,role,status,created_at").eq("workspace_id", c.ws), admin ? sb.from("invitations").select("*").eq("workspace_id", c.ws).eq("status", "pending") : { data: [] }, sb.from("activity_logs").select("action,details,created_at,user_id").eq("workspace_id", c.ws).order("created_at", { ascending: false }).limit(10)]);
      const mem = must(m), inv = must(i), act = must(a);
      const pr = must(await sb.from("profiles").select("id,full_name,email").in("id", mem.map(x => x.user_id))), nm = id => { const p = pr.find(x => x.id === id) || {}; return p.full_name || p.email || id.slice(0, 8); };
      const lim = c.plan.max_team_members;
      el.innerHTML = `<div class="cols"><div class="stack">${card(`<h3>Members (${mem.length})</h3>${tbl(["Name", "Email", "Role", "Joined", ""], mem.map(x => { const p = pr.find(y => y.id === x.user_id) || {}, own = x.role === "owner", ed = admin && !own && (x.role !== "admin" || c.role === "owner"); return `<tr><td><b>${esc(nm(x.user_id))}</b> ${x.user_id === c.user.id ? "(you)" : ""}</td><td>${esc(p.email || "—")}</td><td>${ed ? `<select class="input" data-role="${x.user_id}" style="width:auto">${opts(ROLES.filter(r => r !== "admin" || c.role === "owner").map(r => [r, r]), x.role)}</select>` : App.badge(x.role)}</td><td>${App.fmt(x.created_at)}</td><td>${ed ? `<button class="ibtn red" data-rm="${x.user_id}">Remove</button>` : ""}</td></tr>`; }))}`)}
      ${card(`<h3>Pending invitations</h3>${inv.length ? tbl(["Email", "Role", "Expires", ""], inv.map(x => `<tr><td>${esc(x.email)}</td><td>${x.role}</td><td>${App.fmt(x.expires_at)}</td><td><button class="ibtn red" data-rv="${x.id}">Revoke</button></td></tr>`)) : empty("None", "")}`)}
      ${card(`<h3>Recent activity</h3>${act.length ? tbl(["Who", "Action", "When"], act.map(x => `<tr><td>${esc(nm(x.user_id || ""))}</td><td>${esc(x.action)}</td><td>${App.fmt(x.created_at)}</td></tr>`)) : empty("No activity yet", "")}`)}</div>
      <div class="stack">${card(`<h3>Invite a teammate</h3>${lim === 0 ? `<div class="setup">Your ${esc(c.plan.name)} plan has no team seats. <a href="billing-plan.html">Upgrade</a></div>` : ""}${admin ? `<form id="inv"><label class="field"><span>Email</span><input class="input" name="email" type="email" required></label><label class="field"><span>Role</span><select class="input" name="role">${opts(ROLES.filter(r => r !== "admin" || c.role === "owner").map(r => [r, r]), "moderator")}</select></label><button class="btn btn-primary" style="width:100%">Save invitation</button></form><p style="color:var(--muted);font-size:12.5px">No email is sent automatically. Ask them to sign up or sign in with this email; they join this workspace on their next login.</p>` : `<p style="color:var(--muted)">Only owners and admins can invite.</p>`}`)}
      ${card(`<h3>Role permissions</h3>${kv("Owner", "Everything")}${kv("Admin", "Team, rules, templates, billing view")}${kv("Moderator", "Rules, templates, leads, inbox")}${kv("Support", "Leads and inbox")}${kv("Analyst", "View only")}<p style="color:var(--muted);font-size:12.5px">Permissions are enforced by the database, not just hidden buttons.</p>`)}</div></div>`;
      const f = App.q("#inv"); if (f) f.onsubmit = async e => { e.preventDefault(); try { must(await sb.rpc("invite_member", { ws: c.ws, p_email: f.email.value, p_role: f.role.value })); App.log(c, "member_invited", { role: f.role.value }); Auth.toast("Invitation saved.", "ok"); draw(); } catch (x) { App.err(x); } };
      el.onchange = async e => { const s = e.target.closest("[data-role]"); if (s) try { must(await sb.rpc("set_member_role", { ws: c.ws, uid: s.dataset.role, p_role: s.value })); App.log(c, "role_changed", { role: s.value }); Auth.toast("Role updated.", "ok"); } catch (x) { App.err(x); draw(); } };
      el.onclick = async e => { const r = e.target.closest("[data-rm]"), v = e.target.closest("[data-rv]"); try { if (r && confirm("Remove this member?")) { must(await sb.rpc("remove_member", { ws: c.ws, uid: r.dataset.rm })); draw(); } if (v) { must(await sb.from("invitations").update({ status: "revoked" }).eq("id", v.dataset.rv)); draw(); } } catch (x) { App.err(x); } };
    }
    await draw();
  };

  /* ---------- Billing (Easebuzz, prepaid, INR) ---------- */
  P["billing-plan"] = async (c, el) => {
    const qp = new URLSearchParams(location.search), payRes = qp.get("pay");
    if (payRes) { history.replaceState(null, "", "billing-plan.html"); const msg = { success: "Payment received. Your plan is active.", failed: "Payment failed. Please try again.", cancelled: "Payment cancelled.", invalid: "We could not verify that payment. If money was deducted, contact support." }[payRes]; if (msg) Auth.toast(msg, payRes === "success" ? "ok" : "bad"); }
    const [pl, sub, us, hs, gr, pf] = await Promise.all([sb.from("plans").select("*").order("price_cents"), sb.from("subscriptions").select("*").eq("workspace_id", c.ws).maybeSingle(), sb.from("usage_counters").select("dm_sent").eq("workspace_id", c.ws).eq("period", App.monthStart()).maybeSingle(), sb.from("billing_history").select("*").eq("workspace_id", c.ws).order("created_at", { ascending: false }).limit(100), sb.from("subscription_entitlements").select("*").eq("workspace_id", c.ws).eq("status", "active").order("created_at", { ascending: false }).limit(1), sb.from("profiles").select("phone").eq("id", c.user.id).maybeSingle()]);
    const plans = must(pl), s = sub.data || {}, used = us.data ? us.data.dm_sent : 0, owner = c.role === "owner", spl = plans.find(x => x.id === s.plan_id), hist = hs.error ? [] : hs.data || [], grant = (gr.data || []).find(g => !g.expires_at || new Date(g.expires_at) > new Date());
    const periodEnd = s.current_period_end ? new Date(s.current_period_end) : null, paid = !!(spl && spl.price_cents > 0 && s.provider_subscription_id && (!periodEnd || periodEnd > new Date()));
    let interval = "monthly";
    const usd = n => (n === 0 ? "$0" : "$" + n.toFixed(2)), inr = n => "₹" + Number(n).toLocaleString("en-IN");
    const mo = p => p.price_cents / 100, yr = p => (p.price_yearly_cents != null ? p.price_yearly_cents : Math.round(p.price_cents * 12 * 0.75)) / 100;
    const inrM = p => (p.price_inr == null ? null : Number(p.price_inr)), inrY = p => (p.price_yearly_inr != null ? Number(p.price_yearly_inr) : inrM(p) != null ? Math.round(inrM(p) * 12 * 0.75) : null);
    const feats = p => [p.dm_limit == null ? "Unlimited automated DMs" : `${App.lim(p.dm_limit)} automated DMs / month`, `${p.max_ig_accounts} Instagram account${p.max_ig_accounts > 1 ? "s" : ""}`, `Templates: ${p.features.templates}`, `Analytics: ${p.features.analytics}`, p.features.leads ? "Audience & lead management" : "View-only leads", p.max_team_members ? `Up to ${p.max_team_members} team members` : "No team members", p.features.priority_support ? "Priority support" : "Standard support"];
    const money = h => (h.amount_minor == null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency: h.currency || "INR" }).format(h.amount_minor / 100));
    const pname = id => (plans.find(x => x.id === id) || {}).name || id || "—";
    const groups = {}; hist.filter(h => h.status === "paid").forEach(h => { const k = h.plan_id + "|" + h.billing_interval; (groups[k] = groups[k] || []).push(h); });
    const subRows = Object.entries(groups).map(([k, arr]) => { const [pid, iv] = k.split("|"); const cur = paid && pid === s.plan_id && iv === (s.billing_interval || "monthly"); return `<tr><td><b>${esc(pname(pid))}</b></td><td>${iv === "yearly" ? "Yearly" : "Monthly"}</td><td>${App.fmt(arr[0].created_at)}</td><td>${arr.length}</td><td>${App.badge(cur ? "Current" : "Ended", cur ? "ok" : "")}</td></tr>`; });
    const btn = p => {
      if (p.price_cents === 0) return `<button class="btn" style="width:100%" disabled>Free plan</button>`;
      if (paid && s.plan_id !== p.id) return `<button class="btn" style="width:100%" disabled title="You can switch after your current prepaid period ends">Available after current plan ends</button>`;
      const amt = interval === "yearly" ? inrY(p) : inrM(p);
      if (amt == null) return `<button class="btn" style="width:100%" disabled>Price not set yet</button>`;
      const own = paid && s.plan_id === p.id;
      return `<button class="btn btn-primary" style="width:100%" data-plan="${p.id}" ${owner ? "" : "disabled"}>${own ? "Renew" : "Upgrade to " + esc(p.name)} · ${inr(amt)} (${interval === "yearly" ? "Yearly" : "Monthly"})</button>`;
    };
    function draw() {
      el.innerHTML = card(`<h3>Current plan: ${esc(c.plan.name)}${paid ? ` · ${s.billing_interval === "yearly" ? "Yearly" : "Monthly"}` : ""}</h3><div class="bar"><i style="width:${c.plan.dm_limit == null ? 0 : Math.min(100, (used / c.plan.dm_limit) * 100)}%"></i></div>${kv("Usage this month", App.num(used) + " / " + App.lim(c.plan.dm_limit) + " DMs")}${paid ? kv("Plan active until", App.fmt(s.current_period_end)) + `<p style="color:var(--muted);margin:8px 0 0">Prepaid: this plan does not renew automatically. Press Renew to extend it.</p>` : kv("Subscription", "Free (no paid plan)")}${grant ? kv("Complimentary " + esc(pname(grant.plan_id)) + " plan", grant.expires_at ? "until " + App.fmt(grant.expires_at) : "no end date") : ""}`) + "<br>" +
        `<div class="bar2" style="justify-content:center"><div class="vt" id="ivt"><button data-iv="monthly" class="${interval === "monthly" ? "on" : ""}">Monthly</button><button data-iv="yearly" class="${interval === "yearly" ? "on" : ""}">Annually · Save 25%</button></div></div>
        <div class="grid3">${plans.map(p => { const y = interval === "yearly" && p.price_cents > 0, amt = interval === "yearly" ? inrY(p) : inrM(p); return `<div class="card plan ${p.id === c.plan.id ? "cur" : ""}"><b>${esc(p.name)}</b> ${p.id === c.plan.id ? App.badge("Current", "ok") : ""} ${y ? App.badge("Save 25%", "ok") : ""}<h2>${y ? usd(yr(p) / 12) : usd(mo(p))}<small style="font-size:14px;color:var(--muted)"> / month</small></h2>${y ? `<div style="color:var(--muted);margin:-6px 0 6px"><s>${usd(mo(p))}</s> · ${usd(yr(p))} per year</div>` : ""}${p.price_cents > 0 ? `<div style="color:var(--muted);margin:${y ? "0" : "-6px"} 0 6px">${amt != null ? `You pay <b>${inr(amt)}</b> (INR) ${interval === "yearly" ? "for 1 year" : "for 1 month"}` : "INR price not set"}</div>` : ""}<ul>${feats(p).map(f => "<li>" + esc(f) + "</li>").join("")}</ul>${btn(p)}</div>`; }).join("")}</div><br>` +
        card(`<h3>Subscriptions &amp; payment history</h3>${owner || c.role === "admin" ? `<h4 style="margin:8px 0">Subscriptions you have taken</h4>${subRows.length ? tbl(["Plan", "Billing", "First paid", "Payments", "Status"], subRows) : empty("No paid subscription yet", "You are on the free Starter plan.")}<h4 style="margin:18px 0 8px">Payment history</h4>${hist.length ? tbl(["Date", "Plan", "Billing", "Amount", "Status"], hist.map(h => `<tr><td>${App.fmt(h.created_at)}</td><td>${esc(pname(h.plan_id))}</td><td>${h.billing_interval === "yearly" ? "Yearly" : "Monthly"}</td><td>${money(h)}</td><td>${App.badge(h.status === "paid" ? "Paid" : h.status === "failed" ? "Failed" : "Cancelled", h.status === "paid" ? "ok" : h.status === "failed" ? "bad" : "warn")}</td></tr>`)) : empty("No payments yet", "Payments appear here after Easebuzz confirms them.")}` : `<p style="color:var(--muted)">Only owners and admins can see billing history.</p>`}`) + "<br>" +
        card(`<h3>Payment methods</h3><p style="margin:0">Payments are processed by <b>Easebuzz</b> in <b>INR</b>: UPI, cards, netbanking and wallets. We never see or store your card details.</p><p style="color:var(--muted);margin-bottom:0">${owner ? "" : "Only the workspace owner can buy or renew a plan. "}A plan turns on only after Easebuzz confirms your payment to our server, not when you return to this page. Plans are prepaid and do not renew automatically. You can switch to a different paid plan after the current period ends.</p>`);
    }
    draw();
    el.onclick = e => {
      const iv = e.target.closest("[data-iv]"); if (iv) { interval = iv.dataset.iv; return draw(); }
      const b = e.target.closest("[data-plan]"); if (!b) return;
      const plan = plans.find(x => x.id === b.dataset.plan), amt = interval === "yearly" ? inrY(plan) : inrM(plan);
      App.modal({ title: "Confirm payment", save: "Continue to payment",
        body: `<p style="margin-top:0">You will pay <b>${inr(amt)}</b> (INR) through Easebuzz for the <b>${esc(plan.name)}</b> plan, ${interval === "yearly" ? "1 year" : "1 month"}. The plan stays active until the end of that period and does not renew automatically.</p><label class="field"><span>Mobile number (required by the payment gateway)</span><input class="input" name="phone" value="${esc((pf.data && pf.data.phone) || "")}" inputmode="numeric" maxlength="15" placeholder="10-digit mobile number"></label>`,
        onSave: async f => { const r = await App.fn("easebuzz-checkout", { workspace_id: c.ws, plan_id: plan.id, interval, phone: f.phone }); location.href = r.url; await new Promise(() => {}); } });
    };
  };

  /* ---------- Settings ---------- */
  P.settings = async (c, el) => {
    const prof = must(await sb.from("profiles").select("*").eq("id", c.user.id).single());
    const ns = must(await sb.from("integration_settings").select("config").eq("workspace_id", c.ws).eq("provider", "notifications").maybeSingle().then(r => (r.error ? { data: null } : r))) || { config: {} };
    const nconf = ns.config || {}, admin = ["owner", "admin"].includes(c.role);
    const NT = [["comment", "New comment notification"], ["dm", "New DM notification"], ["lead", "Lead capture notification"], ["usage", "Plan usage alert"]];
    const tz = ["Asia/Kolkata", "UTC", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "America/Los_Angeles", "Australia/Sydney"];
    el.innerHTML = `<div class="grid2"><div class="stack">
      ${card(`<h3>Profile</h3><form id="fp"><label class="field"><span>Full name</span><input class="input" name="full_name" value="${esc(prof.full_name || "")}"></label><label class="field"><span>Email</span><input class="input" value="${esc(c.user.email)}" disabled></label><div class="row2"><label class="field"><span>Time zone</span><select class="input" name="timezone">${opts(tz.map(t => [t, t]), prof.timezone)}</select></label><label class="field"><span>Language</span><select class="input" name="language">${opts([["en", "English"], ["hi", "Hindi"]], prof.language)}</select></label></div><button class="btn btn-primary">Save profile</button></form>`)}
      ${card(`<h3>Workspace</h3><form id="fw"><label class="field"><span>Workspace name</span><input class="input" name="name" value="${esc(c.wsName)}" ${admin ? "" : "disabled"}></label>${admin ? `<button class="btn btn-primary">Save</button>` : ""}</form>${kv("Plan", esc(c.plan.name))}${kv("Your role", esc(c.role))}`)}
      ${card(`<h3>Instagram</h3><p style="color:var(--muted)">Connect, test or disconnect accounts on the Connect Instagram page.</p><a class="btn" href="connect-instagram.html">Manage connection</a>`)}
    </div><div class="stack">
      ${card(`<h3>Notification preferences</h3>${NT.map(([k, l]) => `<div class="row-tog"><span>${l}</span><button class="sw ${nconf[k] !== false ? "on" : ""}" data-n="${k}" ${admin ? "" : "disabled"} aria-label="${l}"></button></div>`).join("")}<p style="color:var(--muted);font-size:12.5px">Preferences are saved. Email delivery is not connected yet.</p>`)}
      ${card(`<h3>Security</h3><form id="fs"><label class="field"><span>New password</span><input class="input" type="password" name="pw" minlength="8" autocomplete="new-password"></label><button class="btn btn-primary">Change password</button></form><br><button class="btn" id="so">Sign out on all devices</button>`)}
      ${card(`<h3>Integrations</h3>${["Google Sheets", "Slack", "Zapier", "Webhook"].map(x => `<div class="row-tog"><span>${x}</span>${App.badge("Not available yet", "warn")}</div>`).join("")}`)}
      ${card(`<h3>Data</h3><button class="btn" id="ex">Download my workspace data (JSON)</button><br><br><button class="btn" style="color:var(--red)" id="del">Request account deletion</button><p style="color:var(--muted);font-size:12.5px">Deletion requests are sent to support and handled manually.</p>`)}
    </div></div><br>${card(`<h3>Log out</h3><p style="color:var(--muted);margin-top:0">Sign out of ${esc(c.user.email)} on this device.</p><button class="btn" style="width:100%;color:var(--red);font-weight:700" id="lo">Log out</button>`)}`;
    App.q("#lo").onclick = () => App.modal({ title: "Logout", body: "<p>Are you sure you want to sign out from your account?</p>", save: "Logout", onSave: async () => { await Auth.signOut(); } });
    const done = (m) => Auth.toast(m, "ok");
    App.q("#fp").onsubmit = async e => { e.preventDefault(); const f = e.target; try { must(await sb.from("profiles").update({ full_name: f.full_name.value.trim(), timezone: f.timezone.value, language: f.language.value }).eq("id", c.user.id)); done("Profile saved."); } catch (x) { App.err(x); } };
    const fw = App.q("#fw"); if (fw) fw.onsubmit = async e => { e.preventDefault(); if (!admin) return; try { must(await sb.from("workspaces").update({ name: fw.name.value.trim() }).eq("id", c.ws)); done("Workspace saved."); } catch (x) { App.err(x); } };
    App.q("#fs").onsubmit = async e => { e.preventDefault(); const pw = e.target.pw.value; if (pw.length < 8 || !/[a-z]/i.test(pw) || !/\d/.test(pw)) return Auth.toast("Use 8+ characters with a letter and a number.", "bad"); const { error } = await sb.auth.updateUser({ password: pw }); error ? App.err(error) : (done("Password changed."), e.target.reset()); };
    App.q("#so").onclick = async () => { await sb.auth.signOut({ scope: "global" }); location.replace("login.html"); };
    el.addEventListener("click", async e => { const b = e.target.closest("[data-n]"); if (!b) return; b.classList.toggle("on"); nconf[b.dataset.n] = b.classList.contains("on"); try { must(await sb.from("integration_settings").upsert({ workspace_id: c.ws, provider: "notifications", config: nconf, enabled: true }, { onConflict: "workspace_id,provider" })); } catch (x) { App.err(x); } });
    App.q("#ex").onclick = async () => { try { const out = {}; for (const t of ["dm_templates", "automation_rules", "leads", "lead_tags", "conversations"]) out[t] = must(await sb.from(t).select("*").eq("workspace_id", c.ws).limit(10000)); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" })); a.download = "dm-me-insta-data.json"; a.click(); } catch (x) { App.err(x); } };
    App.q("#del").onclick = async () => { if (!confirm("Send an account deletion request to support?")) return; try { const t = must(await sb.from("support_tickets").insert({ workspace_id: c.ws, user_id: c.user.id, subject: "Account deletion request" }).select("id").single()); must(await sb.from("support_ticket_messages").insert({ ticket_id: t.id, workspace_id: c.ws, user_id: c.user.id, body: "Please delete my account and workspace data." })); done("Request sent to support."); } catch (x) { App.err(x); } };
  };

  /* ---------- Help & Support ---------- */
  P["help-support"] = async (c, el) => {
    const FAQ = [["How does AGS DM Insta work?", "You connect a Business or Creator Instagram account, create a template and a keyword rule. When someone comments the keyword, we send one private reply to that comment."], ["Do I need an Instagram Business account?", "Yes. Business or Creator accounts are required by Meta for this feature."], ["Can I send DMs to anyone?", "No. Replies are limited to people who commented or messaged you, within Meta's allowed windows. Bulk cold DMs are not supported."], ["How many DMs can I send per month?", "It depends on your plan: Starter 1,000, Growth 50,000, Agency has a fair-use cap. See Billing & Plan."], ["Can I customize messages?", "Yes. Use DM Templates with the variables {{username}}, {{keyword}} and {{post_url}}."], ["How do keyword rules work?", "A rule matches a comment by exact text or by containing the keyword. If several rules match, only the first by priority sends."], ["What happens at my monthly limit?", "Further replies are skipped and logged as skipped until the next month or until you upgrade."], ["A reply failed. Why?", "Check Automation, Execution history for the error from Instagram. Common causes: the comment is too old, the token expired (reconnect), or the account is not eligible."]];
    const tk = must(await sb.from("support_tickets").select("id,subject,status,created_at").eq("workspace_id", c.ws).order("created_at", { ascending: false }).limit(20));
    el.innerHTML = `<div class="grid2">${card(`<h3>FAQ</h3><input class="input" id="fq" placeholder="Search…"><div class="faq" id="fl"></div>`)}<div class="stack">${card(`<h3>Contact support</h3><form id="ft"><label class="field"><span>Subject</span><select class="input" name="subject">${opts(["Connecting Instagram", "Automation not sending", "Billing & plan", "Bug report", "Other"].map(x => [x, x]), "Other")}</select></label><label class="field"><span>Message</span><textarea class="input" name="body" required maxlength="2000" placeholder="Describe the issue and what you expected."></textarea></label><button class="btn btn-primary">Send</button></form><p style="color:var(--muted);font-size:12.5px">Tickets are stored in your workspace and reviewed by the team.</p>`)}${card(`<h3>My tickets</h3>${tk.length ? tbl(["Subject", "Status", "Created"], tk.map(x => `<tr class="click" data-tk="${x.id}"><td>${esc(x.subject)}</td><td>${App.badge(x.status, x.status === "resolved" ? "ok" : "warn")}</td><td>${App.fmt(x.created_at)}</td></tr>`)) : empty("No tickets", "")}`)}</div></div>`;
    const draw = () => { const q = norm(App.q("#fq").value); App.q("#fl").innerHTML = FAQ.filter(f => !q || norm(f[0] + f[1]).includes(q)).map(f => `<details><summary>${esc(f[0])}</summary><p>${esc(f[1])}</p></details>`).join("") || empty("No match", ""); };
    App.q("#fq").oninput = draw; draw();
    el.addEventListener("click", async e => {
      const r = e.target.closest("[data-tk]"); if (!r) return; const t = tk.find(x => x.id === r.dataset.tk);
      try {
        const m = must(await sb.from("support_ticket_messages").select("body,user_id,created_at").eq("ticket_id", t.id).order("created_at"));
        App.modal({ title: esc(t.subject), save: "Send reply", body: `<div class="thread" style="max-height:320px;border-radius:12px">${m.map(x => `<div class="msg ${x.user_id === c.user.id ? "out" : ""}">${esc(x.body)}<br><small style="opacity:.7">${App.fmt(x.created_at)}</small></div>`).join("") || "<small>No messages.</small>"}</div><label class="field" style="margin-top:12px"><span>Reply</span><textarea class="input" name="body" maxlength="2000"></textarea></label>`,
          onSave: async f => { if (!f.body.trim()) throw new Error("Write a reply."); must(await sb.from("support_ticket_messages").insert({ ticket_id: t.id, workspace_id: c.ws, user_id: c.user.id, body: f.body.trim() })); Auth.toast("Reply sent.", "ok"); } });
      } catch (x) { App.err(x); }
    });
    App.q("#ft").onsubmit = async e => { e.preventDefault(); const f = e.target; try { const t = must(await sb.from("support_tickets").insert({ workspace_id: c.ws, user_id: c.user.id, subject: f.subject.value }).select("id").single()); must(await sb.from("support_ticket_messages").insert({ ticket_id: t.id, workspace_id: c.ws, user_id: c.user.id, body: f.body.value.trim() })); Auth.toast("Ticket created.", "ok"); P["help-support"](c, (el.innerHTML = "", el)); } catch (x) { App.err(x); } };
  };

  App.boot();
})();
