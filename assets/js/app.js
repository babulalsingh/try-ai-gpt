// Shared helpers + page boot. Pages register in window.P (pages1.js, pages2.js).
(function () {
  const sb = Auth.sb, cfg = window.APP_CONFIG || {};
  const App = (window.App = { sb });
  window.P = {};
  App.q = (s, r = document) => r.querySelector(s);
  App.fmt = d => (d ? new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
  App.lim = v => (v == null ? "Unlimited" : Number(v).toLocaleString());
  App.num = n => Number(n || 0).toLocaleString();
  App.ago = d => { const s = (Date.now() - new Date(d)) / 1000; return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + " min ago" : s < 86400 ? Math.floor(s / 3600) + " hr ago" : Math.floor(s / 86400) + " d ago"; };
  App.badge = (t, k) => `<span class="badge ${k || ""}">${esc(t)}</span>`;
  App.err = e => Auth.toast(e && e.message ? e.message : String(e), "bad");
  App.vars = (t, v) => String(t || "").replace(/\{\{\s*(username|keyword|post_url|account)\s*\}\}/g, (_, k) => v[k] ?? "");
  App.canAny = (c, roles) => roles.includes(c.role);

  App.ctx = async sh => {
    if (!sb) throw new Error("Supabase is not configured. Add your URL and key in assets/js/config.js.");
    await sb.rpc("accept_pending_invites"); await sb.rpc("expire_lapsed_subscriptions");
    const { data, error } = await sb.from("workspace_members")
      .select("workspace_id,role,workspaces(name,plan_id,plans(*))")
      .eq("user_id", sh.session.user.id).eq("status", "active").order("created_at", { ascending: false }).limit(1);
    if (error) throw new Error("Database error: " + error.message + ". Did you run both SQL migrations?");
    if (!data.length) {
      const { data: pr } = await sb.from("profiles").select("account_status").eq("id", sh.session.user.id).maybeSingle();
      if (pr && pr.account_status && pr.account_status !== "active") throw new Error("This account has been " + (pr.account_status === "deleted" ? "closed" : pr.account_status) + ". Please contact support.");
      throw new Error("No workspace found for this account. Run the SQL migrations, then sign up again.");
    }
    const m = data[0];
    return { user: sh.session.user, name: sh.name, ws: m.workspace_id, role: m.role, wsName: m.workspaces.name, plan: m.workspaces.plans };
  };

  App.fn = async (name, body) => {
    const s = await Auth.session();
    let r;
    try {
      r = await fetch(`${cfg.SUPABASE_URL}/functions/v1/${name}`, { method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.access_token, apikey: cfg.SUPABASE_ANON_KEY }, body: JSON.stringify(body || {}) });
    } catch { throw new Error(`Cannot reach the "${name}" function. Deploy it first (see README).`); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Function "${name}" failed (${r.status}).`);
    return j;
  };

  App.modal = ({ title, body, save = "Save", onSave, wide }) => {
    const d = document.createElement("dialog");
    d.className = "dlg" + (wide ? " wide" : "");
    d.innerHTML = `<form method="dialog" class="dform"><h3>${title}</h3><div class="dbody">${body}</div><div class="err" data-err role="alert"></div><div class="dact"><button type="button" class="btn" data-x>${onSave ? "Cancel" : "Close"}</button>${onSave ? `<button class="btn btn-primary" type="submit">${save}</button>` : ""}</div></form>`;
    document.body.appendChild(d); d.showModal();
    if (window.initEditors) window.initEditors(d);
    d.addEventListener("close", () => d.remove());
    d.querySelector("[data-x]").onclick = () => d.close();
    d.querySelector("form").onsubmit = async e => {
      e.preventDefault(); if (!onSave) return;
      const b = e.submitter; if (b) b.disabled = true;
      try { await onSave(Object.fromEntries(new FormData(e.target)), d); d.close(); }
      catch (x) { d.querySelector("[data-err]").textContent = x.message || String(x); }
      finally { if (b) b.disabled = false; }
    };
    return d;
  };

  App.log = (c, action, details) => sb.from("activity_logs").insert({ workspace_id: c.ws, user_id: c.user.id, action, details }).then(() => {});
  App.count = async (table, c, f = {}, since) => {
    let q = sb.from(table).select("id", { count: "exact", head: true }).eq("workspace_id", c.ws);
    for (const k in f) q = q.eq(k, f[k]);
    if (since) q = q.gte("created_at", since);
    const { count, error } = await q; if (error) throw error; return count || 0;
  };
  App.csv = (name, rows) => {
    const cell = v => { v = v == null ? "" : String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    const blob = new Blob([rows.map(r => r.map(cell).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  };
  App.monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10); };

  const META = {
    dashboard: ["Welcome back", "Manage your Instagram automation and track performance."],
    "connect-instagram": ["Connect Your Instagram Account", "Connect a Business or Creator account to start automating comment replies."],
    automation: ["Auto DM Automation", "Set up smart rules to automatically send Instagram DMs when someone comments on your posts or reels."],
    "my-posts": ["My Posts", "Posts and Reels from your connected account."],
    "dm-templates": ["DM Templates", "Reusable messages for your automations."],
    "keywords-rules": ["Keywords & Rules", "Manage keyword rules and test how comments match."],
    "audience-leads": ["Audience & Leads", "People who commented or messaged you."],
    analytics: ["Analytics", "Calculated from your real automation events."],
    inbox: ["Inbox", "Conversations from Instagram."],
    "team-members": ["Team Members", "Invite teammates and manage roles."],
    "billing-plan": ["Billing & Plan", "Your plan, usage and upgrades for AGS DM Insta."],
    settings: ["Settings", "Account, workspace, security and data."],
    "help-support": ["Help & Support", "Answers and support tickets."]
  };

  App.boot = async () => {
    const page = document.body.dataset.page, [t, s] = META[page];
    const skel = '<div class="card"><div class="skel" style="width:40%"></div><br><div class="skel" style="width:70%"></div></div>';
    const HUB = ["billing-plan", "settings", "help-support"]; // these live in the Try AI GPT hub shell
    const sh = HUB.includes(page) && window.renderHubShell ? await renderHubShell(page, t, s, skel) : await renderShell(t, s, skel);
    if (!sh) return;
    const el = document.getElementById("page-content");
    let c;
    try { c = await App.ctx(sh); } catch (e) { el.innerHTML = `<div class="setup">${esc(e.message)}</div>`; return; }
    const h1 = document.querySelector(".banner h1"); if (h1) h1.textContent = page === "dashboard" ? "Welcome back, " + c.name : t;
    document.querySelectorAll("#planName,#planName2").forEach(e => (e.textContent = c.plan.name + " plan"));
    document.querySelectorAll(".upbtn").forEach(b => (b.textContent = c.plan.id === "agency" ? "Manage Plan" : "Upgrade Plan"));
    sb.from("usage_counters").select("dm_sent").eq("workspace_id", c.ws).eq("period", App.monthStart()).maybeSingle().then(({ data }) => {
      const used = data ? data.dm_sent : 0, lim = c.plan.dm_limit;
      document.querySelectorAll("#usageTxt,#usageTxt2").forEach(e => (e.textContent = `${App.num(used)} / ${App.lim(lim)} DMs used`));
      document.querySelectorAll("#usageBar,#usageBar2").forEach(e => (e.style.width = (lim == null ? 0 : Math.min(100, (used / lim) * 100)) + "%"));
    });
    try { el.innerHTML = ""; await window.P[page](c, el); } catch (e) { el.innerHTML = `<div class="setup">${esc(e.message || e)}</div>`; }
  };
})();
