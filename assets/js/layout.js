// Shared dashboard shell: desktop sidebar, tablet drawer, mobile bottom bar + "More" sheet.
(function () {
  const NAV = [["dashboard","Dashboard","⌂"],["connect-instagram","Connect Instagram","◎"],["automation","Automation","➤"],["my-posts","My Posts","▤"],["dm-templates","DM Templates","✉"],["keywords-rules","Keywords & Rules","⚑"],["audience-leads","Audience / Leads","☺"],["analytics","Analytics","▥"],["inbox","Inbox","☐"],["team-members","Team Members","⚇"]];
  // Mobile "More" sheet (logout lives in Settings)
  const MORE = [["my-posts","My Posts","Posts and Reels with automation status","🖼️","#ffe9e0"],["dm-templates","DM Templates","Create and manage templates","📄","#ece6ff"],["keywords-rules","Keywords & Rules","Set keywords for auto DM","🏷️","#ffe4ee"],["audience-leads","Audience / Leads","View & manage your contacts","👥","#e3f8ee"],["analytics","Analytics","Detailed reports & insights","📊","#fff1dc"],["team-members","Team Members","Invite and manage roles","🤝","#e3f8ee"],["hub","Try AI GPT","All tools, Billing & Plan, Settings, Help & Support","🧰","#e6efff"]];
  const page = document.body.dataset.page;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const svg = p => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const IC = {
    home: svg('<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>'),
    ig: svg('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/>'),
    send: svg('<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>'),
    bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
    more: svg('<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>')
  };
  const LOGO = '<img class="logo-img" src="assets/img/logo.png" alt="" width="30" height="30" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline-block\'"><i style="display:none"></i>';

  window.renderShell = async function (title, subtitle, contentHTML) {
    const s = await Auth.requireAuth();
    const email = s?.user?.email || "";
    const name = s?.user?.user_metadata?.full_name || email.split("@")[0] || "Account";
    const bn = (id, label, ic, cls = "") => `<a href="${id}" class="${cls} ${id === page ? "on" : ""}">${cls === "mid" ? `<span class="cir">${ic}</span>` : ic}<span>${label}</span></a>`;
    document.getElementById("app-root").innerHTML = `
    <div class="app">
      <aside class="side" id="side" aria-label="Main navigation">
        <a class="logo" href="dashboard">${LOGO}AGS DM <b>Insta</b></a>
        <div class="tag">Turn Instagram Comments into Conversations.</div>
        <a class="nav-i" href="hub" style="background:#f3f0ff"><span class="ic">◀</span>Try AI GPT · All tools</a>
        ${NAV.map(([id,l,ic]) => `<a class="nav-i ${id===page?"on":""}" href="${id}" ${id===page?'aria-current="page"':""}><span class="ic">${ic}</span>${l}</a>`).join("")}
        <div class="usage"><strong id="planName">Plan</strong>
          <div id="usageTxt" style="color:var(--muted);font-size:12.5px">Usage not available yet</div>
          <div class="bar"><i id="usageBar"></i></div>
          <a class="btn btn-primary btn-sm upbtn" style="width:100%" href="billing-plan">Upgrade Plan</a></div>
      </aside>
      <div class="main">
        <header class="top">
          <button class="btn btn-sm menu-btn" id="menuBtn" aria-label="Open menu" aria-controls="side">☰</button>
          <div class="mbrand"><a class="logo" href="hub" title="Back to Try AI GPT">${LOGO}AGS DM <b>Insta</b></a><small>Turn Instagram Comments into Conversations</small></div>
          <input class="input" type="search" placeholder="Search posts, leads, templates…" aria-label="Search">
          <span class="sp"></span>
          <a class="btn btn-primary btn-sm up-btn" href="billing-plan">Upgrade Plan</a>
          <button class="btn btn-sm" aria-label="Notifications" id="notifBtn">🔔</button>
          <button class="avatar" id="acctBtn" title="${esc(email)}" aria-label="Account">${esc(name[0]||"U").toUpperCase()}</button>
        </header>
        <section class="banner"><h1>${title}</h1><p>${subtitle}</p></section>
        <div id="page-content">${contentHTML}</div>
      </div>
    </div>
    <nav class="bnav" aria-label="Main">
      ${bn("dashboard","Dashboard",IC.home)}${bn("connect-instagram","Connect Instagram",IC.ig)}${bn("inbox","DM",IC.send)}${bn("automation","Automation",IC.bolt)}
      <button id="moreBtn" class="${MORE.some(m => m[0] === page) ? "on" : ""}" aria-haspopup="dialog">${IC.more}<span>More</span></button>
    </nav>
    <div class="sheet" id="sheet" role="dialog" aria-label="More" hidden>
      <div class="sh-head"><h2>More</h2><button id="shX" aria-label="Close">✕</button></div>
      <div class="sh-item"><span class="avatar">${esc(name[0]||"U").toUpperCase()}</span><div><b>${esc(name)}</b><small>${esc(email)}</small></div></div>
      ${MORE.map(([id,t,sub,ic,bg]) => `<a class="sh-item" href="${id}"><span class="tile" style="background:${bg}">${ic}</span><div><b>${t}</b><small>${sub}</small></div><em>›</em></a>`).join("")}
      <div class="usage"><strong id="planName2">Plan</strong><div id="usageTxt2" style="color:var(--muted);font-size:12.5px">Usage not available yet</div><div class="bar"><i id="usageBar2"></i></div><a class="btn btn-primary upbtn" style="width:100%" href="billing-plan">Upgrade Plan</a></div>
    </div>`;
    const side = document.getElementById("side"), sheet = document.getElementById("sheet");
    const toggle = () => { const o = side.classList.toggle("open"); let sc = document.querySelector(".scrim"); if (o && !sc) { sc = document.createElement("div"); sc.className = "scrim"; sc.onclick = toggle; document.body.appendChild(sc); } else if (!o && sc) sc.remove(); };
    const moreBtn = document.getElementById("moreBtn"), sh = open => { sheet.hidden = !open; document.body.style.overflow = open ? "hidden" : ""; moreBtn.classList.toggle("open", open); };
    document.getElementById("menuBtn").onclick = toggle;
    moreBtn.onclick = () => sh(sheet.hidden);
    document.getElementById("shX").onclick = () => sh(false);
    document.addEventListener("keydown", e => { if (e.key === "Escape") sh(false); });
    document.getElementById("notifBtn").onclick = () => Auth.toast("No notifications yet.", "info");
    document.getElementById("acctBtn").onclick = () => { if (innerWidth <= 800) location.href = "settings"; else if (confirm("Sign out of " + email + "?")) Auth.signOut(); };
    return { session: s, name, email };
  };
  window.esc = esc;
})();
