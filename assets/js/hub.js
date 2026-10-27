// Try AI GPT hub shell + dashboard. Billing & Plan, Settings and Help & Support also render inside this shell.
(function () {
  const sb = Auth.sb;
  const page = document.body.dataset.page || "hub";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const TOOLS = [
    { name: "AGS DM Insta", desc: "Instagram Auto DM SaaS. Turn comments into conversations.", icon: "✈️", g: "linear-gradient(135deg,#ff3d8b,#7a3cf0)", href: "dashboard.html" },
    { name: "AGS Folio", desc: "Create professional portfolio websites.", icon: "💼", g: "linear-gradient(135deg,#2e6cf6,#4aa3ff)" },
    { name: "AGS FunnelFlow", desc: "Create high-converting landing pages & sales funnels.", icon: "🔻", g: "linear-gradient(135deg,#12b76a,#5be08f)" },
    { name: "AGS WhatsFlow", desc: "Bulk message sender, WhatsApp marketing & more.", icon: "💬", g: "linear-gradient(135deg,#1db954,#12b76a)" },
    { name: "AGS ResumeAI", desc: "Create professional resumes with modern templates.", icon: "📄", g: "linear-gradient(135deg,#ff8a00,#ffb020)" },
    { name: "AGS TubeTools", desc: "YouTube creator toolkit with SEO tools.", icon: "▶️", g: "linear-gradient(135deg,#f04438,#ff3d5a)" },
    { name: "AGS PixelAI", desc: "AI product image generator for e-commerce.", icon: "🖼️", g: "linear-gradient(135deg,#6d3cf0,#4a7bff)" },
    { name: "AGS StrangerTalk", desc: "Video, audio & text chat platform.", icon: "🎥", g: "linear-gradient(135deg,#2e6cf6,#3b9bff)" }
  ];
  // [page id, link, label, icon, short label for the mobile bar]
  const NAV = [["hub", "hub.html", "Dashboard", "⌂", "Dashboard"], ["all-tools", "all-tools.html", "All Tools", "▦", "Tools"], ["billing-plan", "billing-plan.html", "Billing & Plan", "▭", "Billing"], ["settings", "settings.html", "Settings", "⚙", "Settings"], ["help-support", "help-support.html", "Help & Support", "?", "Help"]];
  const card = t => `<article class="tool ${t.href ? "" : "soon"}"><div class="ti" style="background:${t.g}">${t.icon}</div><span class="tb ${t.href ? "live" : ""}">${t.href ? "Live" : "Coming soon"}</span><div class="tx"><h3>${esc(t.name)}</h3><p>${esc(t.desc)}</p></div>${t.href ? `<a class="obtn" href="${t.href}">Open Tool →</a>` : `<button class="obtn dis" disabled>Coming soon</button>`}</article>`;

  window.renderHubShell = async function (pg, title, subtitle, content, withSearch) {
    const s = await Auth.requireAuth(); if (!s) return null;
    const email = s.user.email || "", name = s.user.user_metadata?.full_name || email.split("@")[0] || "Account";
    document.body.classList.add("hubpage");
    if (localStorage.getItem("agsTheme") === "dark") document.body.classList.add("dark");
    let plan = "Free Plan", ws = null;
    if (sb) {
      await sb.rpc("accept_pending_invites");
      const { data } = await sb.from("workspace_members").select("workspace_id,workspaces(plans(name,price_cents))").eq("user_id", s.user.id).eq("status", "active").order("created_at", { ascending: false }).limit(1);
      if (data && data[0]) { ws = data[0].workspace_id; const p = data[0].workspaces.plans; plan = p.price_cents > 0 ? p.name + " Plan" : "Free Plan"; }
    }
    const root = document.getElementById("app-root") || document.getElementById("app");
    root.innerHTML = `
    <div class="hub">
      <aside class="hs"><a class="hlogo" href="hub.html"><img src="assets/img/ags-logo.png" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'mk',textContent:'T'}))">Try AI GPT</a><small class="t">All-in-One Digital Solutions</small>
        ${NAV.map(([id, h, l, ic]) => `<a class="hn ${id === pg ? "on" : ""}" href="${h}" ${id === pg ? 'aria-current="page"' : ""}><span>${ic}</span>${l}</a>`).join("")}
        <div class="up"><div style="font-size:28px">👑</div><b>Upgrade Plan</b><p>Get higher limits and more features on your tools.</p><a href="billing-plan.html">Upgrade Now →</a></div>
      </aside>
      <main class="hm">
        <div class="hbar"><a class="hlogo hb-logo" href="hub.html"><span class="mk">T</span>Try AI GPT</a>
          ${withSearch ? `<div class="sb"><input id="q" type="search" placeholder="Search tools…" aria-label="Search tools"><kbd>Ctrl K</kbd></div>` : ""}<span class="sp"></span>
          <a class="hbtn" href="billing-plan.html">👑 Upgrade Plan</a><button class="hic" id="th" aria-label="Toggle dark mode">🌙</button>
          <button class="huser" id="um" aria-label="Account"><span class="av">${esc(name[0].toUpperCase())}</span><div><b>${esc(name)}</b><small>${esc(plan)}</small></div></button></div>
        ${title ? `<section class="hh"><h1>${esc(title)}</h1><p>${esc(subtitle || "")}</p></section>` : ""}
        <div id="page-content">${content || ""}</div>
      </main>
    </div>
    <nav class="hb2" aria-label="Main">${NAV.map(([id, h, l, ic, sh]) => `<a href="${h}" class="${id === pg ? "on" : ""}"><span class="i">${ic}</span>${sh}</a>`).join("")}</nav>`;
    document.getElementById("th").onclick = () => { const d = document.body.classList.toggle("dark"); localStorage.setItem("agsTheme", d ? "dark" : "light"); };
    document.getElementById("um").onclick = () => { if (innerWidth <= 1000) location.href = "settings.html"; else if (confirm("Sign out of " + email + "?")) Auth.signOut(); };
    return { session: s, name, email, ws, plan };
  };

  async function startHub() {
    const all = page === "all-tools", view = localStorage.getItem("agsView") || (all ? "list" : "grid");
    const content = `${all ? "" : `<section class="hero"><small>Welcome to</small><h1>Try AI GPT</h1><p>All-in-One Digital Solutions</p><div class="chips"><span><i>🧩</i>Multiple tools</span><span><i>⏱️</i>Save time</span><span><i>👆</i>Easy to use</span><span><i>🔑</i>One account for everything</span></div><img class="pp" src="assets/img/hero-person.png" alt="" onerror="this.remove()"></section>`}
      <div class="hmain"><section>
        <div class="thead"><div><h2>${all ? "All Tools" : "Our Tools"}</h2><p>AGS DM Insta is live. More tools are coming soon.</p></div>
          <div class="vt"><button data-v="grid" class="${view === "grid" ? "on" : ""}">▦ Grid View</button><button data-v="list" class="${view === "list" ? "on" : ""}">☰ List View</button></div></div>
        <div id="tl" class="tools ${view === "list" ? "list" : ""}"></div></section>
        ${all ? "" : `<aside class="hside"><div class="hcard"><h3>Your Activity</h3><div id="act"><div class="empty">Loading…</div></div></div>
          <div class="hcard ql"><h3>Quick Links</h3><a href="all-tools.html">Browse All Tools <span>›</span></a><a href="billing-plan.html">Billing &amp; Plan <span>›</span></a><a href="settings.html">Settings <span>›</span></a><a href="help-support.html">Help &amp; Support <span>›</span></a></aside>`}
      </div>`;
    const sh = await renderHubShell(page, "", "", content, true); if (!sh) return;
    const draw = () => { const q = document.getElementById("q").value.toLowerCase(); document.getElementById("tl").innerHTML = TOOLS.filter(t => (t.name + t.desc).toLowerCase().includes(q)).map(card).join("") || '<div class="empty">No tools match your search.</div>'; };
    draw();
    document.getElementById("q").oninput = draw;
    document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); document.getElementById("q").focus(); } });
    document.querySelectorAll(".vt button").forEach(b => (b.onclick = () => { localStorage.setItem("agsView", b.dataset.v); document.getElementById("tl").classList.toggle("list", b.dataset.v === "list"); document.querySelectorAll(".vt button").forEach(x => x.classList.toggle("on", x === b)); }));
    if (sb) {
      const { data: an } = await sb.from("announcements").select("title,body,level").order("created_at", { ascending: false }).limit(3);
      if (an && an.length) document.getElementById("page-content").insertAdjacentHTML("afterbegin", an.map(a => `<div class="ann ${esc(a.level)}"><b>${esc(a.title)}</b><span>${esc(a.body)}</span></div>`).join(""));
    }
    if (!all) activity(sh.ws);
  }

  async function activity(ws) {
    const box = document.getElementById("act");
    const row = (i, l, v) => `<div class="act"><i>${i}</i><div><small>${l}</small><b>${v}</b></div></div>`;
    if (!sb || !ws) return (box.innerHTML = '<div class="empty">Activity appears here once you use AGS DM Insta.</div>');
    const cnt = async (t, f = {}) => { let q = sb.from(t).select("id", { count: "exact", head: true }).eq("workspace_id", ws); for (const k in f) q = q.eq(k, f[k]); const { count, error } = await q; return error ? "—" : (count || 0).toLocaleString(); };
    const d = new Date(), per = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const u = await sb.from("usage_counters").select("dm_sent").eq("workspace_id", ws).eq("period", per).maybeSingle();
    const [leads, rules, accts] = await Promise.all([cnt("leads"), cnt("automation_rules", { status: "active" }), cnt("connected_instagram_accounts", { status: "connected" })]);
    box.innerHTML = row("✉️", "DMs sent this month", u.error ? "—" : (u.data ? u.data.dm_sent : 0).toLocaleString()) + row("👥", "Leads captured", leads) + row("⚡", "Active rules", rules) + row("📸", "Connected Instagram accounts", accts);
  }
  if (page === "hub" || page === "all-tools") startHub();
})();
