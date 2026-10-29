(function () {
  const { sb } = App, P = window.P;
  const card = (h, cls = "") => `<div class="card ${cls}">${h}</div>`;
  const empty = (t, m, a = "") => `<div class="empty"><strong>${t}</strong>${m}${a ? "<br><br>" + a : ""}</div>`;
  const opts = (arr, sel) => arr.map(([v, l]) => `<option value="${esc(v)}" ${v == sel ? "selected" : ""}>${esc(l)}</option>`).join("");
  const tbl = (heads, rows) => `<div class="tw"><table><thead><tr>${heads.map(h => "<th>" + h + "</th>").join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  const must = r => { if (r.error) throw r.error; return r.data; };
  const EDIT = ["owner", "admin", "moderator"];
  const stKind = s => ({ sent: "ok", failed: "bad", skipped: "warn" }[s] || "");
  const CATS = [["lead_generation", "Lead Generation"], ["offers_sales", "Offers & Sales"], ["community", "Community"], ["content_delivery", "Content Delivery"], ["follow_up", "Follow-up"], ["customer_support", "Customer Support"]];
  const catName = v => (CATS.find(x => x[0] === v) || [, v])[1];
  const norm = s => String(s || "").trim().toLowerCase();
  const matches = (r, text, media) => (!r.media_id || r.media_id === media) && (r.match_type === "exact" ? norm(text) === norm(r.keyword) : norm(text).includes(norm(r.keyword)));

  /* ---- Message editor: variables are locked chips, only plain text is editable ---- */
  const VL = { username: "Username", keyword: "Keyword", post_url: "Post link", account: "Your account" };
  const VRE = /\{\{\s*(username|keyword|post_url|account)\s*\}\}/g;
  const toHtml = (t, edit) => esc(t || "").replace(VRE, (_, k) => `<span class="vchip" ${edit ? 'contenteditable="false" ' : ""}data-v="${k}">${VL[k]}</span>`).replace(/\n/g, "<br>");
  const showHtml = t => toHtml(t, false);
  function toText(el) {
    let out = "";
    const walk = n => { for (const c of n.childNodes) {
      if (c.nodeType === 3) out += c.nodeValue.replace(/[{}]+/g, "");
      else if (c.nodeName === "BR") out += "\n";
      else if (c.dataset && c.dataset.v) out += "{{" + c.dataset.v + "}}";
      else { if (/^(DIV|P)$/.test(c.nodeName) && out && !out.endsWith("\n")) out += "\n"; walk(c); }
    } };
    walk(el); return out.replace(/\u00a0/g, " ").replace(/\n+$/, "");
  }
  const editorHtml = ({ name, label, value, vars, max = 1000, ph = "" }) => `<div class="field" data-vedwrap data-max="${max}"><span>${label} <small data-cc style="color:var(--muted)"></small></span><div class="input ved" contenteditable="true" role="textbox" aria-multiline="true" data-ved data-ph="${esc(ph)}">${toHtml(value, true)}</div><div class="vbar">${vars.map(k => `<button type="button" class="ibtn" data-ins="${k}">+ ${VL[k]}</button>`).join("")}</div><input type="hidden" name="${name}" value=""></div>`;
  window.initEditors = root => root.querySelectorAll("[data-vedwrap]").forEach(w => {
    const ed = w.querySelector("[data-ved]"), hid = w.querySelector('input[type=hidden]'), cc = w.querySelector("[data-cc]"), max = +w.dataset.max; let saved = null;
    const sync = () => { const t = toText(ed); hid.value = t; if (cc) cc.textContent = t.length + "/" + max; w.dispatchEvent(new CustomEvent("vedchange", { detail: t, bubbles: true })); };
    const keep = () => { const sel = getSelection(); if (sel.rangeCount && ed.contains(sel.anchorNode)) saved = sel.getRangeAt(0).cloneRange(); };
    ed.addEventListener("input", sync);
    ed.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); document.execCommand("insertLineBreak"); } });
    ed.addEventListener("paste", e => { e.preventDefault(); document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text/plain").replace(/[{}]+/g, "")); });
    ed.addEventListener("drop", e => e.preventDefault());
    ["keyup", "mouseup", "focus", "input"].forEach(ev => ed.addEventListener(ev, keep));
    w.querySelectorAll("[data-ins]").forEach(b => {
      b.addEventListener("mousedown", e => e.preventDefault());
      b.onclick = () => {
        ed.focus(); const sel = getSelection(); sel.removeAllRanges();
        let r = saved; if (!r) { r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); }
        sel.addRange(r); r.deleteContents();
        const chip = document.createElement("span"); chip.className = "vchip"; chip.contentEditable = "false"; chip.dataset.v = b.dataset.ins; chip.textContent = VL[b.dataset.ins];
        const sp = document.createTextNode("\u00a0"); r.insertNode(sp); r.insertNode(chip); r.setStartAfter(sp); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); keep(); sync();
      };
    });
    sync();
  });
  const DEFAULT_FOLLOW_TEXT = `Hi {{username}}! 👋 Please follow @{{account}} first, then tap "I've followed" below to get your link.`;

  /* ---------- Dashboard ---------- */
  P.dashboard = async (c, el) => {
    const since7 = new Date(Date.now() - 7 * 864e5).toISOString();
    const [accts, rules, leads, comments, sent, failed, evs, convs, usage] = await Promise.all([
      sb.from("connected_instagram_accounts").select("username,status,account_type").eq("workspace_id", c.ws).neq("status", "disconnected"),
      App.count("automation_rules", c, { status: "active" }), App.count("leads", c),
      App.count("automation_events", c, { event_type: "comment" }), App.count("automation_events", c, { status: "sent" }), App.count("automation_events", c, { status: "failed" }, since7),
      sb.from("automation_events").select("status,error,payload,created_at").eq("workspace_id", c.ws).order("created_at", { ascending: false }).limit(6),
      sb.from("conversations").select("ig_user_id,unread_count,last_message_at,leads(username)").eq("workspace_id", c.ws).order("last_message_at", { ascending: false }).limit(5),
      sb.from("usage_counters").select("dm_sent").eq("workspace_id", c.ws).eq("period", App.monthStart()).maybeSingle()]);
    const a = must(accts), e = must(evs), cv = must(convs), used = usage.data ? usage.data.dm_sent : 0, on = a.some(x => x.status === "connected");
    const dot = s => ({ sent: "", failed: "bad", skipped: "warn" }[s] ?? "warn"), say = s => ({ sent: "DM sent automatically", failed: "DM failed", skipped: "Skipped", matched: "Processing", received: "Received" }[s] || s);
    el.innerHTML = `${failed ? `<div class="setup">${failed} automation(s) failed in the last 7 days. <a href="automation">See details</a>.</div>` : ""}
    <section class="hero-m"><span class="pill">⚡ Automate Your Growth</span><h2>Turn Comments<br>into DMs <em>Automatically</em></h2><p>Get more leads, more customers and more engagement on Instagram.</p><a class="btn-cta" href="${on ? "automation" : "connect-instagram"}">${on ? "Create automation" : "Connect Instagram"} →</a></section>
    <div class="stats m4">${[[App.num(comments), "Comments"], [App.num(used), "DMs this month"], [App.num(leads), "Leads"], [App.num(sent), "DMs sent"]].map(x => `<div class="card stat"><b>${x[0]}</b><span>${x[1]}</span></div>`).join("")}</div>
    <div class="cols"><div class="stack">
      ${card(`<h3>Instagram account</h3>${a.length ? a.map(x => `<div class="kv"><span><b style="color:var(--ink)">@${esc(x.username)}</b><br><small>${esc(x.account_type || "")}</small></span><span>${App.badge(x.status, x.status === "connected" ? "ok" : "bad")} <a class="btn btn-sm" href="connect-instagram">Manage</a></span></div>`).join("") : `<span class="badge warn">Not connected</span><p style="color:var(--muted)">Connect a Business or Creator account to start.</p><a class="btn btn-primary btn-sm" href="connect-instagram">Connect Instagram</a>`}`)}
      ${card(`<h3>Quick actions</h3><div class="qa4 qa"><a class="q q1" href="automation"><i>💬</i><b>Auto Reply</b><small>Keyword based DM automation</small></a><a class="q q2" href="dm-templates"><i>✉️</i><b>Templates</b><small>Reusable DM messages</small></a><a class="q q3" href="audience-leads"><i>👥</i><b>Leads</b><small>View &amp; manage contacts</small></a><a class="q q4" href="analytics"><i>📊</i><b>Analytics</b><small>Track performance</small></a></div>`)}
      ${card(`<div class="bar2"><h3 style="margin:0">Recent activity</h3><span class="sp"></span><a href="automation">View All</a></div>${e.length ? e.map(x => `<div class="act"><span class="av">${esc(((x.payload && x.payload.from_username) || "?")[0].toUpperCase())}</span><div class="tx"><b>@${esc((x.payload && x.payload.from_username) || "user")} commented: “${esc((x.payload && x.payload.text) || "")}”</b><small><span class="dot ${dot(x.status)}"></span>${say(x.status)}</small></div><small>${App.ago(x.created_at)}</small></div>`).join("") : empty("No activity yet", "Connect Instagram and turn on a rule to see comments and DMs here.")}`)}
    </div><div class="stack">
      ${card(`<h3>Automation</h3>${kv2("Active rules", rules)}${kv2("Plan", esc(c.plan.name))}`)}
      ${card(`<h3>Recent conversations</h3>${cv.length ? cv.map(x => `<div class="kv"><span>${esc((x.leads && x.leads.username) || x.ig_user_id)}</span><span>${x.unread_count ? App.badge(x.unread_count + " unread", "warn") : ""} ${App.ago(x.last_message_at)}</span></div>`).join("") : empty("No conversations yet", "Messages appear here after people comment or DM you.")}`)}
    </div></div>`;
  };
  const kv2 = (a, b) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`;

  /* ---------- Connect Instagram ---------- */
  P["connect-instagram"] = async (c, el) => {
    const qs = new URLSearchParams(location.search), admin = App.canAny(c, ["owner", "admin"]);
    const errMsg = qs.get("error");
    if (qs.get("connected")) Auth.toast("Instagram connected.", "ok");
    if (errMsg) Auth.toast(errMsg, "bad");
    if (qs.get("connected") || errMsg) history.replaceState(null, "", "connect-instagram");
    const list = must(await sb.from("connected_instagram_accounts").select("*").eq("workspace_id", c.ws).order("connected_at", { ascending: false }));
    const live = list.filter(x => x.status !== "disconnected");
    const max = c.plan.max_ig_accounts || 1, slots = Math.max(0, max - live.length);
    const multi = max > 1;
    // Button rules: no account -> Connect. Plans with 1 account -> no add button once connected. Agency -> Add account while slots remain.
    const addBtn = !admin ? "" : live.length === 0 ? `<button class="btn btn-primary" id="conn">Connect Instagram</button>` : slots > 0 ? `<button class="btn btn-primary" id="conn">＋ Add account</button>` : "";
    const slotCards = multi && live.length > 0 ? Array.from({ length: slots }, (_, i) => `<div class="slot"><span>Slot ${live.length + i + 1} of ${max}</span><b>Available</b>${admin ? `<button class="btn btn-sm" data-add>＋ Add account</button>` : ""}</div>`).join("") : "";
    el.innerHTML = `${errMsg ? `<div class="alert-bad" role="alert">⚠️ ${esc(errMsg)}</div>` : ""}<div class="cols"><div class="stack">
      ${card(`<ul class="chk"><li>Auto DM on comments</li><li>Reply to messages from your inbox</li><li>Manage all conversations</li><li>Grow your audience faster</li></ul>`)}
      ${card(`<div class="bar2"><h3 style="margin:0">Connected accounts</h3><span class="sp"></span>${App.badge(`${live.length} of ${max} used`, slots === 0 ? "warn" : "ok")}</div>${live.length ? tbl(["Account", "Type", "Status", "Token expires", "Last checked", ""], live.map(x => `<tr><td><b>@${esc(x.username)}</b></td><td>${esc(x.account_type || "—")}</td><td>${App.badge(x.status, x.status === "connected" ? "ok" : "bad")}</td><td>${App.fmt(x.token_expires_at)}</td><td>${App.fmt(x.last_checked_at)}</td><td style="white-space:nowrap">${admin ? `${x.status !== "connected" ? `<button class="ibtn" data-r>Reconnect</button> ` : ""}<button class="ibtn" data-t="${x.id}">Test</button> <button class="ibtn red" data-d="${x.id}">Disconnect</button>` : ""}</td></tr>`)) : empty("No account connected", "Connect your Instagram Business or Creator account.")}
        ${slotCards ? `<div class="slots">${slotCards}</div>` : ""}<br>${addBtn}${!multi && live.length ? `<p style="color:var(--muted);margin:0">Your ${esc(c.plan.name)} plan includes 1 Instagram account. <a href="billing-plan">Upgrade to Agency</a> to connect up to 3 accounts.</p>` : ""}${!admin ? `<p style="color:var(--muted)">Only owners and admins can connect accounts.</p>` : ""}`)}
      ${card(`<h3>How it works</h3><ol><li>Select Connect Instagram and sign in on Instagram.</li><li>Approve access to comments and messages.</li><li>You return here, and the account shows Connected after we verify it.</li><li>Create a template and a rule on the Automation page.</li></ol>`)}
    </div><div class="stack">
      ${card(`<h3>Requirements</h3><ul><li>Instagram <b>Business or Creator</b> account (switch in Instagram settings).</li><li>Each Instagram account can be linked to only <b>one</b> Try AI GPT account at a time.</li><li>Until your Meta app passes App Review, only accounts added as testers can connect.</li></ul>`)}
      ${card(`<h3>Your plan</h3>${kvc("Plan", esc(c.plan.name))}${kvc("Instagram accounts", `${live.length} of ${max}`)}${multi ? kvc("Free slots", slots) : ""}`)}
      ${card(`<h3>Meta rules</h3><p style="color:var(--muted);margin:0">Automatic replies are private replies to comments, sent once per comment within Meta's allowed window. Bulk or cold DMs are not supported. Use automation responsibly.</p>`)}
    </div></div>`;
    const start = async btn => { if (btn) btn.disabled = true; try { const r = await App.fn("instagram-oauth", { workspace_id: c.ws }); location.href = r.url; } catch (e) { App.err(e); if (btn) btn.disabled = false; } };
    el.onclick = async e => {
      const t = e.target.closest("[data-t]"), d = e.target.closest("[data-d]"), add = e.target.closest("#conn, [data-add], [data-r]");
      try {
        if (add) return start(add);
        if (t) { await App.fn("instagram-api", { action: "test_connection", account_id: t.dataset.t }); Auth.toast("Connection verified.", "ok"); P["connect-instagram"](c, (el.innerHTML = "", el)); }
        if (d && confirm("Disconnect this account? Its rules will be paused.")) { await App.fn("instagram-api", { action: "disconnect", account_id: d.dataset.d }); App.log(c, "instagram_disconnected", {}); P["connect-instagram"](c, (el.innerHTML = "", el)); }
      } catch (x) { App.err(x); }
    };
  };
  const kvc = (a, b) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`;

  /* ---------- Rules (Automation + Keywords) ---------- */
  async function rulesData(c) {
    const [r, a, t] = await Promise.all([
      sb.from("automation_rules").select("*").eq("workspace_id", c.ws).order("priority").order("created_at", { ascending: false }),
      sb.from("connected_instagram_accounts").select("id,username,status,ig_user_id").eq("workspace_id", c.ws).neq("status", "disconnected"),
      sb.from("dm_templates").select("id,name,body").eq("workspace_id", c.ws).eq("status", "active")]);
    return { rules: must(r), accounts: must(a), templates: must(t) };
  }
  function openRule(c, d, rule, done) {
    if (!d.accounts.length) return Auth.toast("Connect an Instagram account first.", "bad");
    if (!d.templates.length) return Auth.toast("Create a DM template first.", "bad");
    const v = rule || {};
    App.modal({
      title: v.id ? "Edit rule" : "Create rule", save: "Save rule",
      body: `<label class="field"><span>Rule name</span><input class="input" name="name" value="${esc(v.name || "")}"></label>
      <div class="row2"><label class="field"><span>Keyword</span><input class="input" name="keyword" required value="${esc(v.keyword || "")}"></label>
      <label class="field"><span>Match type</span><select class="input" name="match_type">${opts([["exact", "Exact match"], ["contains", "Contains"]], v.match_type)}</select></label></div>
      <div class="row2"><label class="field"><span>Instagram account</span><select class="input" name="ig_account_id">${opts(d.accounts.map(a => [a.id, "@" + a.username]), v.ig_account_id)}</select></label>
      <label class="field"><span>DM template</span><select class="input" name="template_id">${opts(d.templates.map(t => [t.id, t.name]), v.template_id)}</select></label></div>
      <label class="field"><span>Post/Reel media ID (optional, blank = all posts)</span><input class="input" name="media_id" value="${esc(v.media_id || "")}"></label>
      <div class="row2"><label class="field"><span>Delay (0-10 seconds)</span><input class="input" type="number" min="0" max="10" name="delay_seconds" value="${v.delay_seconds ?? 5}"></label>
      <label class="field"><span>Priority (lower runs first)</span><input class="input" type="number" name="priority" value="${v.priority ?? 100}"></label></div>
      <label class="field"><span>Link to send (must start with https://)</span><input class="input" type="url" name="link_url" placeholder="https://yourlink.com/guide" value="${esc(v.link_url || "")}"></label>
      <div class="row2"><label class="field"><span>Link button text</span><input class="input" name="link_label" maxlength="20" value="${esc(v.link_label || "Open link")}"></label>
      <div class="field"><span>Follow first?</span><label style="font-weight:400;display:flex;gap:8px;align-items:center;padding-top:10px"><input type="checkbox" name="require_follow" ${v.require_follow ? "checked" : ""}> Ask them to follow me first</label></div></div>
      ${editorHtml({ name: "follow_message", label: "Follow message (used only if follow first is on)", value: v.follow_message || DEFAULT_FOLLOW_TEXT, vars: ["username", "account"], max: 500 })}
      <p style="color:var(--muted);font-size:12.5px;margin:0 0 10px">The link is sent as a tappable button, so it opens with one tap. With follow first on, they get a Follow button and an “I've followed” button; the link is sent after Instagram confirms the follow.</p>
      <label class="field"><span>Status</span><select class="input" name="status">${opts([["active", "Active"], ["paused", "Paused"]], v.status || "paused")}</select></label>`,
      onSave: async f => {
        const row = { workspace_id: c.ws, ig_account_id: f.ig_account_id, name: (f.name || "").trim() || f.keyword.trim(), keyword: f.keyword.trim(), match_type: f.match_type, media_id: (f.media_id || "").trim() || null, template_id: f.template_id, delay_seconds: Math.max(0, Math.min(10, +f.delay_seconds || 0)), priority: +f.priority || 100, status: f.status, link_url: (f.link_url || "").trim() || null, link_label: (f.link_label || "").trim().slice(0, 20) || "Open link", require_follow: f.require_follow === "on", follow_message: (f.follow_message || "").trim() || null };
        if (row.link_url && !/^https:\/\//i.test(row.link_url)) throw new Error("The link must start with https://");
        if (!row.keyword) throw new Error("Enter a keyword.");
        must(await (v.id ? sb.from("automation_rules").update(row).eq("id", v.id) : sb.from("automation_rules").insert(row)));
        App.log(c, v.id ? "rule_updated" : "rule_created", { keyword: row.keyword }); done();
      }
    });
  }
  function rulesTable(c, d, list, reload) {
    const can = App.canAny(c, EDIT), acct = id => (d.accounts.find(a => a.id === id) || {}).username, tpl = id => (d.templates.find(t => t.id === id) || {}).name;
    const html = list.length ? tbl(["On", "Keyword", "Match", "Account", "Template", "Post", "Priority", ""], list.map(r => `<tr><td><button class="sw ${r.status === "active" ? "on" : ""}" data-tog="${r.id}" aria-label="Toggle rule" ${can ? "" : "disabled"}></button></td><td><b>${esc(r.keyword)}</b>${r.link_url ? " 🔗" : ""}${r.require_follow ? " " + App.badge("Follow first", "warn") : ""}</td><td>${r.match_type}</td><td>@${esc(acct(r.ig_account_id) || "—")}</td><td>${esc(tpl(r.template_id) || "—")}</td><td>${r.media_id ? esc(r.media_id) : "All"}</td><td>${r.priority}</td><td style="white-space:nowrap">${can ? `<button class="ibtn" data-ed="${r.id}">Edit</button> <button class="ibtn" data-dup="${r.id}">Copy</button> <button class="ibtn red" data-del="${r.id}">Delete</button>` : ""}</td></tr>`)) : empty("No rules yet", "Create a keyword rule to reply to comments automatically.");
    return { html, bind(root) {
      root.onclick = async e => {
        const g = k => e.target.closest(`[data-${k}]`), r = id => list.find(x => x.id === id);
        try {
          if (g("tog")) { const x = r(g("tog").dataset.tog); must(await sb.from("automation_rules").update({ status: x.status === "active" ? "paused" : "active" }).eq("id", x.id)); reload(); }
          else if (g("ed")) openRule(c, d, r(g("ed").dataset.ed), reload);
          else if (g("dup")) { const { id, created_at, updated_at, ...x } = r(g("dup").dataset.dup); must(await sb.from("automation_rules").insert({ ...x, name: x.name + " (copy)", status: "paused" })); reload(); }
          else if (g("del") && confirm("Delete this rule?")) { must(await sb.from("automation_rules").delete().eq("id", g("del").dataset.del)); App.log(c, "rule_deleted", {}); reload(); }
        } catch (x) { App.err(x); }
      };
    } };
  }
  function testCard(d) {
    return card(`<h3>Test keyword matching</h3><p style="color:var(--muted);margin-top:0">Runs on this page only. It does not send a DM.</p><div class="bar2"><input class="input" id="tc" placeholder="Type a sample comment, e.g. GUIDE"><button class="btn btn-primary" id="tb">Test</button></div><div id="tr"></div>`);
  }
  function bindTest(d) {
    App.q("#tb").onclick = () => {
      const text = App.q("#tc").value, hit = d.rules.filter(r => r.status === "active").find(r => matches(r, text, null)), out = App.q("#tr");
      if (!text.trim()) return (out.innerHTML = "");
      if (!hit) return (out.innerHTML = `<div class="setup">No active rule matches this comment (rules limited to one post are skipped in this test).</div>`);
      const t = d.templates.find(x => x.id === hit.template_id);
      out.innerHTML = `<p>Matched rule <b>${esc(hit.keyword)}</b> (${hit.match_type}). Only the first match by priority is sent. Preview:</p>${hit.require_follow ? `<p style="color:var(--muted)">Follow first is ON: they first get a Follow + “I've followed” message. After Instagram confirms the follow, they get:</p>` : ""}<div class="msg" style="white-space:pre-wrap">${esc(App.vars(t ? t.body : "", { username: "sample_user", keyword: hit.keyword, post_url: "" }))}</div>${hit.link_url ? `<p>Link button: <b>${esc(hit.link_label || "Open link")}</b> → ${esc(hit.link_url)}</p>` : ""}`;
    };
  }
  async function eventsTable(c, status) {
    let q = sb.from("automation_events").select("status,error,payload,created_at,rule_id").eq("workspace_id", c.ws).order("created_at", { ascending: false }).limit(25);
    if (status) q = q.eq("status", status);
    const e = must(await q);
    return e.length ? tbl(["When", "Comment", "From", "Status", "Detail"], e.map(x => `<tr><td>${App.fmt(x.created_at)}</td><td>${esc((x.payload && x.payload.text) || "—")}</td><td>${esc((x.payload && x.payload.from_username) || "—")}</td><td>${App.badge(x.status, stKind(x.status))}</td><td>${esc(x.error || "")}</td></tr>`)) : empty("Nothing here yet", "Events appear when comments arrive.");
  }

  P.automation = async (c, el) => {
    let selRule = null, txt = "";
    async function draw() {
      const d = await rulesData(c), rules = d.rules;
      const now = Date.now(), d7 = new Date(now - 7 * 864e5).toISOString(), d14 = new Date(now - 14 * 864e5).toISOString(), d1 = new Date(now - 864e5).toISOString();
      const range = async (table, f, col, from, to) => { let q = sb.from(table).select("id", { count: "exact", head: true }).eq("workspace_id", c.ws).gte(col, from); if (to) q = q.lt(col, to); for (const k in f) q = q.eq(k, f[k]); const r = await q; if (r.error) throw r.error; return r.count || 0; };
      const [c1, c0, s1, s0, l1, l0, conv, allLeads, evs, posts, inMsgs] = await Promise.all([
        range("automation_events", { event_type: "comment" }, "created_at", d7), range("automation_events", { event_type: "comment" }, "created_at", d14, d7),
        range("automation_events", { status: "sent" }, "created_at", d7), range("automation_events", { status: "sent" }, "created_at", d14, d7),
        range("leads", {}, "first_seen_at", d7), range("leads", {}, "first_seen_at", d14, d7),
        App.count("leads", c, { status: "converted" }), App.count("leads", c),
        sb.from("automation_events").select("rule_id").eq("workspace_id", c.ws).not("rule_id", "is", null).limit(5000),
        sb.from("posts_cache").select("media_id,thumbnail_url").eq("workspace_id", c.ws).limit(300),
        sb.from("messages").select("conversation_id").eq("workspace_id", c.ws).eq("direction", "in").gte("created_at", d1).limit(300)]);
      const trig = {}; must(evs).forEach(x => (trig[x.rule_id] = (trig[x.rule_id] || 0) + 1));
      const pst = must(posts), ids = [...new Set(must(inMsgs).map(x => x.conversation_id))];
      const recent = ids.length ? must(await sb.from("conversations").select("id,ig_account_id,ig_user_id,leads(username)").in("id", ids)) : [];
      const can = App.canAny(c, EDIT), acct = d.accounts[0], admin = ["owner", "admin"].includes(c.role);
      const cfgRes = await sb.from("integration_settings").select("config").eq("workspace_id", c.ws).eq("provider", "automation").maybeSingle();
      const cfg = { posts: true, reels: true, max_per_day: 1000, dedupe_user: true, add_leads: true, save_comments: true, track_source: true, ...((cfgRes.data && cfgRes.data.config) || {}) };
      const ck = (k, label) => `<label class="ck"><input type="checkbox" data-cfg="${k}" ${cfg[k] ? "checked" : ""} ${admin ? "" : "disabled"}> <span>${label}</span></label>`;
      const off = (label, note) => `<label class="ck off"><input type="checkbox" disabled> <span>${label} <em>${note}</em></span></label>`;
      if (!selRule || !rules.find(r => r.id === selRule)) selRule = rules[0] ? rules[0].id : null;
      const dl = (a, b) => (b ? Math.round(((a - b) / b) * 100) : a ? null : 0);
      const delta = (a, b) => { const v = dl(a, b); return v === null ? `<small style="color:var(--green)">▲ new</small>` : `<small style="color:var(${v >= 0 ? "--green" : "--red"})">${v >= 0 ? "▲" : "▼"} ${Math.abs(v)}%</small> <small style="color:var(--muted)">vs previous 7 days</small>`; };
      const stat = (ic, bg, v, l, extra) => `<div class="card stat4"><i style="background:${bg}">${ic}</i><div><b>${v}</b><span>${l}</span><div>${extra}</div></div></div>`;
      const thumb = r => { const p = r.media_id ? pst.find(x => x.media_id === r.media_id) : null; return p && p.thumbnail_url ? `<img class="rth" src="${esc(p.thumbnail_url)}" alt="" referrerpolicy="no-referrer">` : `<div class="rth all">${r.media_id ? "Post" : "All<br>posts"}</div>`; };
      const row = r => { const t = d.templates.find(x => x.id === r.template_id), acc = d.accounts.find(x => x.id === r.ig_account_id);
        return `<div class="rrow ${r.id === selRule ? "sel" : ""}" data-pick="${r.id}"><button class="sw ${r.status === "active" ? "on" : ""}" data-tog="${r.id}" aria-label="Toggle rule" ${can ? "" : "disabled"}></button>
          <div class="rk"><small>Keyword</small><b>${esc(r.keyword)}</b><div>${App.badge(r.match_type === "exact" ? "Exact Match" : "Contains")} ${App.badge(r.status === "active" ? "Active" : "Paused", r.status === "active" ? "ok" : "bad")}${r.require_follow ? " " + App.badge("Follow first", "warn") : ""}</div></div>
          <div class="rm"><small>Reply Message</small><div class="cap" style="-webkit-line-clamp:3;white-space:pre-wrap">${t ? showHtml(t.body) : "(template missing or archived)"}</div>${r.link_url ? `<div class="rl">🔗 <b>${esc(r.link_label || "Open link")}</b> → <a href="${esc(r.link_url)}" target="_blank" rel="noopener">${esc(r.link_url)}</a></div>` : ""}<small>@${esc((acc && acc.username) || "—")}</small></div>
          <div class="rp"><small>Post/ Reel</small>${thumb(r)}</div><div class="rt"><b>${App.num(trig[r.id] || 0)}</b><small>Triggers</small></div>
          <div class="ra">${can ? `<button class="ibtn" data-ed="${r.id}" title="Edit">✎</button><button class="ibtn" data-dup="${r.id}" title="Duplicate">⧉</button><button class="ibtn red" data-del="${r.id}" title="Delete">🗑</button>` : ""}</div></div>`; };
      const ro = (on, label, note) => `<label class="ck ${on ? "" : "off"}"><input type="checkbox" ${on ? "checked" : ""} disabled> <span>${label}${note ? ` <em>${note}</em>` : ""}</span></label>`;
      el.innerHTML = `<div class="stats4">${stat("💬", "#ffe4ee", App.num(c1), "Total Comments", delta(c1, c0))}${stat("➤", "#e6efff", App.num(s1), "Auto DMs Sent", delta(s1, s0))}${stat("👥", "#ece6ff", App.num(l1), "New Leads", delta(l1, l0))}${stat("🎯", "#e3f8ee", allLeads ? ((conv / allLeads) * 100).toFixed(1) + "%" : "—", "Conversion Rate", `<small style="color:var(--muted)">converted ÷ all leads</small>`)}</div>
      <div class="auto-grid"><div class="stack">
        ${card(`<div class="bar2"><div><h3 style="margin:0">Automation Rules</h3><small style="color:var(--muted)">Create keyword-based rules to send automatic DMs</small></div><span class="sp"></span>${can ? `<button class="btn btn-primary" id="new">＋ Create New Rule</button>` : ""}</div><div id="rl">${rules.length ? rules.map(row).join("") : empty("No rules yet", "Create a keyword rule to reply to comments automatically.")}</div>`)}
        <div class="grid3">
          ${card(`<h3>Trigger Settings</h3><small style="color:var(--muted)">Where automation works</small>${ck("posts", "Comments on Posts")}${ck("reels", "Comments on Reels")}${off("Comments on Stories", "Not supported by Meta")}${off("Mentions", "Coming soon")}`)}
          ${card(`<h3>Safety &amp; Limits</h3><small style="color:var(--muted)">Set daily limits to avoid spam</small><label class="field" style="margin-top:8px"><span>Max DMs per day (UTC)</span><input class="input" type="number" min="1" max="100000" data-cfgn="max_per_day" value="${esc(cfg.max_per_day)}" ${admin ? "" : "disabled"}></label>${kvl("Monthly plan limit", App.lim(c.plan.dm_limit))}${kvl("Delay between DMs", "Set per rule (0-10 s)")}${ck("dedupe_user", "Prevent duplicate DMs to same user (24 hours, per rule)")}`)}
          ${card(`<h3>Advanced Options</h3><small style="color:var(--muted)">What happens on each trigger</small>${ck("add_leads", "Add user to lead list")}${ck("save_comments", "Save comment details")}${ck("track_source", "Track source post/reel")}${off("AI personalized replies", "Coming soon")}${off("Follow-up message after 1 day", "Not possible: Meta 24-hour window")}`)}
        </div>
        <div class="bar2"><span class="sp"></span>${admin ? `<button class="btn btn-primary" id="savecfg">Save settings</button>` : `<small style="color:var(--muted)">Only owners and admins can change these settings.</small>`}</div>
        ${card(`<h3>Execution history</h3>${await eventsTable(c)}`)}
      </div><div class="stack">
        ${card(`<div class="bar2"><b>Instagram Account</b><span class="sp"></span><a href="connect-instagram">Manage</a></div>${acct ? `<div class="acc"><span class="av">${esc((acct.username || "?")[0].toUpperCase())}</span><div><b>@${esc(acct.username)}</b><br><small style="color:var(--muted)">Instagram account</small></div>${App.badge(acct.status, acct.status === "connected" ? "ok" : "bad")}</div><div class="kv"><span>Active rules</span><b>${rules.filter(r => r.status === "active").length}</b></div><div class="kv"><span>Posts loaded</span><b>${pst.length}</b></div><div class="kv"><span>Leads</span><b>${App.num(allLeads)}</b></div>` : empty("Not connected", "", `<a class="btn btn-primary btn-sm" href="connect-instagram">Connect Instagram</a>`)}`)}
        ${card(`<h3>Test Automation</h3><small style="color:var(--muted)">Test your rule before activating on live posts</small><br><br>
          <label class="field"><span>Select Rule</span><select class="input" id="trr">${rules.map(r => `<option value="${r.id}" ${r.id === selRule ? "selected" : ""}>${esc(r.keyword)}${r.status === "paused" ? " (paused)" : ""}</option>`).join("") || "<option>No rules yet</option>"}</select></label>
          <label class="field"><span>Test Comment</span><input class="input" id="trt" value="${esc(txt)}"></label>
          <label class="field"><span>Send test to (Instagram user ID or @username)</span><input class="input" id="trs" placeholder="e.g. 17841400000000000 or @username" autocomplete="off"></label><div id="trrec" class="tags"></div><small style="color:var(--muted)">Use another person's ID, not your own account${acct ? " (@" + esc(acct.username) + ")" : ""}. Tap a name below to fill it in.</small>
          <button class="btn btn-primary" style="width:100%" id="trg">Send Test DM</button><div id="tro" style="margin-top:10px"></div>
          <p style="color:var(--muted);font-size:12.5px;margin:10px 0 0">Instagram delivers the test only if that person messaged you in the last 24 hours. The preview below always works.</p>`)}
        ${card(`<h3>Message Preview</h3><div id="pv"></div>`)}
      </div></div>`;
      const rule = () => rules.find(r => r.id === selRule);
      const fillSel = () => { const r = rule(), list = recent.filter(x => r && x.ig_account_id === r.ig_account_id); App.q("#trrec").innerHTML = list.length ? list.map(x => `<button type="button" class="chip" data-id="${esc(x.ig_user_id)}">@${esc((x.leads && x.leads.username) || x.ig_user_id)}</button>`).join("") : `<small style="color:var(--muted)">Recent (last 24h): nobody yet</small>`; App.q("#trg").disabled = !r; };
      const preview = () => {
        const r = rule(), box = App.q("#pv"); if (!r) return (box.innerHTML = empty("No rule selected", "Create a rule to see the preview."));
        const t = d.templates.find(x => x.id === r.template_id), a = d.accounts.find(x => x.id === r.ig_account_id) || {}, ok = matches(r, txt, r.media_id || undefined);
        const sample = { username: "sample_user", keyword: r.keyword, post_url: "", account: a.username || "youraccount" };
        const msg = r.require_follow ? App.vars(r.follow_message || DEFAULT_FOLLOW_TEXT, sample) : App.vars(t ? t.body : "", sample);
        const btns = r.require_follow ? `<div class="pb">Follow</div><div class="pb">I've followed</div>` : r.link_url ? `<div class="pb">${esc(r.link_label || "Open link")}</div>` : "";
        box.innerHTML = `${ok ? "" : `<div class="setup">This comment does not match the rule (${r.match_type}: ${esc(r.keyword)}), so no DM would be sent.</div>`}<div class="phone-prev"><div class="ph-h">‹ <b>@${esc(a.username || "youraccount")}</b> <small>Active now</small></div><div class="ph-b"><div class="bub-in">${esc(msg)}</div>${btns}${r.require_follow ? `<small style="color:var(--muted)">After they follow, they get the link message.</small>` : ""}</div></div>`;
      };
      const setRule = id => { selRule = id; const r = rule(); txt = r ? r.keyword : ""; App.q("#trr").value = id || ""; App.q("#trt").value = txt; document.querySelectorAll(".rrow").forEach(x => x.classList.toggle("sel", x.dataset.pick === id)); fillSel(); preview(); };
      if (!txt && rule()) { txt = rule().keyword; App.q("#trt").value = txt; }
      fillSel(); preview();
      App.q("#trr").onchange = e => setRule(e.target.value);
      App.q("#trrec").onclick = e => { const b = e.target.closest("[data-id]"); if (b) App.q("#trs").value = b.dataset.id; };
      const sv = App.q("#savecfg"); if (sv) sv.onclick = async () => { const n = { ...cfg }; el.querySelectorAll("[data-cfg]").forEach(i => (n[i.dataset.cfg] = i.checked)); const mx = parseInt(App.q("[data-cfgn=max_per_day]").value, 10); if (!(mx >= 1 && mx <= 100000)) return Auth.toast("Max DMs per day must be between 1 and 100000.", "bad"); n.max_per_day = mx; try { must(await sb.from("integration_settings").upsert({ workspace_id: c.ws, provider: "automation", config: n, enabled: true }, { onConflict: "workspace_id,provider" })); Object.assign(cfg, n); App.log(c, "automation_settings_saved", {}); Auth.toast("Settings saved.", "ok"); } catch (x) { App.err(x); } };
      App.q("#trt").oninput = e => { txt = e.target.value; preview(); };
      App.q("#trg").onclick = async e => { const out = App.q("#tro"); e.target.disabled = true; out.innerHTML = ""; try { const rcp = App.q("#trs").value.trim().replace(/^@/, ""), cr = rule(), ac = d.accounts.find(x => cr && x.id === cr.ig_account_id) || {};
          if (!rcp) throw new Error("Enter the Instagram user ID or @username of the person to test with. Example: 17841400000000000");
          if (rcp === ac.ig_user_id || rcp.toLowerCase() === String(ac.username || "").toLowerCase()) throw new Error("This is your own account (not self ID). Enter another person's Instagram ID or @username.");
          const r = await App.fn("instagram-api", { action: "send_test", rule_id: selRule, recipient: rcp, text: App.q("#trt").value }); out.innerHTML = `<div class="okbox">✅ Test DM sent successfully! Check your Instagram inbox.${r.mode === "text" ? " (Sent as plain text because Instagram did not accept the button format.)" : ""}</div>`; } catch (x) { out.innerHTML = `<div class="setup">${esc(x.message)}</div>`; } e.target.disabled = false; };
      const nb = App.q("#new"); if (nb) nb.onclick = () => openRule(c, d, null, draw);
      App.q("#rl").onclick = async e => {
        const g = k => e.target.closest(`[data-${k}]`), r = id => rules.find(x => x.id === id);
        try {
          if (g("tog")) { const x = r(g("tog").dataset.tog); must(await sb.from("automation_rules").update({ status: x.status === "active" ? "paused" : "active" }).eq("id", x.id)); draw(); }
          else if (g("ed")) openRule(c, d, r(g("ed").dataset.ed), draw);
          else if (g("dup")) { const { id, created_at, updated_at, ...x } = r(g("dup").dataset.dup); must(await sb.from("automation_rules").insert({ ...x, name: x.name + " (copy)", status: "paused" })); draw(); }
          else if (g("del") && confirm("Delete this rule?")) { must(await sb.from("automation_rules").delete().eq("id", g("del").dataset.del)); App.log(c, "rule_deleted", {}); draw(); }
          else if (g("pick")) setRule(g("pick").dataset.pick);
        } catch (x) { App.err(x); }
      };
      const qp = new URLSearchParams(location.search), m = qp.get("media"), tp = qp.get("template");
      if (m || tp) { history.replaceState(null, "", "automation"); openRule(c, d, { media_id: m || null, template_id: tp || undefined }, draw); }
    }
    await draw();
  };
  const kvl = (a, b) => `<div class="kv"><span>${a}</span><b style="text-align:right">${b}</b></div>`;

  P["keywords-rules"] = async (c, el) => {
    async function draw() {
      const d = await rulesData(c), q = App.q("#fq") ? App.q("#fq").value : "", st = App.q("#fs") ? App.q("#fs").value : "", mt = App.q("#fm") ? App.q("#fm").value : "";
      const list = d.rules.filter(r => (!q || norm(r.keyword + r.name).includes(norm(q))) && (!st || r.status === st) && (!mt || r.match_type === mt));
      const rt = rulesTable(c, d, list, draw);
      el.innerHTML = card(`<div class="bar2"><input class="input" id="fq" placeholder="Search keywords…" value="${esc(q)}"><select class="input" id="fs">${opts([["", "All status"], ["active", "Active"], ["paused", "Paused"]], st)}</select><select class="input" id="fm">${opts([["", "All match types"], ["exact", "Exact"], ["contains", "Contains"]], mt)}</select><span class="sp"></span>${App.canAny(c, EDIT) ? `<button class="btn btn-primary" id="new">Add rule</button>` : ""}</div><div id="rt">${rt.html}</div>`) + "<br>" +
        `<div class="grid2">${testCard(d)}${card(`<h3>Recent errors</h3>${await eventsTable(c, "failed")}`)}</div>`;
      rt.bind(App.q("#rt")); bindTest(d);
      ["#fq", "#fs", "#fm"].forEach(s => (App.q(s).onchange = draw));
      const n = App.q("#new"); if (n) n.onclick = () => openRule(c, d, null, draw);
    }
    await draw();
  };

  /* ---------- My Posts ---------- */
  P["my-posts"] = async (c, el) => {
    const accts = must(await sb.from("connected_instagram_accounts").select("id,username").eq("workspace_id", c.ws).eq("status", "connected"));
    async function draw() {
      const q = App.q("#pq") ? App.q("#pq").value : "", ty = App.q("#pt") ? App.q("#pt").value : "";
      const [p, r] = await Promise.all([sb.from("posts_cache").select("*").eq("workspace_id", c.ws).order("posted_at", { ascending: false }).limit(60), sb.from("automation_rules").select("media_id,status").eq("workspace_id", c.ws)]);
      const rules = must(r), posts = must(p).filter(x => (!ty || x.media_type === ty) && (!q || norm(x.caption).includes(norm(q))));
      el.innerHTML = card(`<div class="bar2"><input class="input" id="pq" placeholder="Search captions…" value="${esc(q)}"><select class="input" id="pt">${opts([["", "All types"], ["IMAGE", "Image"], ["VIDEO", "Video / Reel"], ["CAROUSEL_ALBUM", "Carousel"]], ty)}</select><span class="sp"></span><button class="btn btn-primary" id="sync" ${accts.length ? "" : "disabled"}>Refresh from Instagram</button></div>
      ${posts.length ? `<div class="posts">${posts.map(x => { const n = rules.filter(y => y.media_id === x.media_id && y.status === "active").length, m = x.metrics || {}; return `<div class="card post">${x.thumbnail_url ? `<img src="${esc(x.thumbnail_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<img alt="">`}<div class="pb">${App.badge(x.media_type || "POST")} <small style="color:var(--muted)">${App.fmt(x.posted_at)}</small><div class="cap">${esc(x.caption || "(no caption)")}</div><div style="color:var(--muted);font-size:12.5px">♥ ${App.num(m.like_count)} · 💬 ${App.num(m.comments_count)}</div><p style="margin:8px 0">${n ? App.badge("Automation ON (" + n + ")", "ok") : App.badge("No rule", "warn")}</p><a class="btn btn-sm" href="automation?media=${encodeURIComponent(x.media_id)}">${n ? "Add rule" : "Create rule"}</a> ${x.permalink ? `<a class="btn btn-sm" href="${esc(x.permalink)}" target="_blank" rel="noopener">Open</a>` : ""}</div></div>`; }).join("")}</div>` : empty("No posts loaded", accts.length ? "Select Refresh from Instagram to load your posts." : "Connect Instagram first.")}`);
      ["#pq", "#pt"].forEach(s => (App.q(s).onchange = draw));
      App.q("#sync").onclick = async e => { e.target.disabled = true; try { for (const a of accts) await App.fn("instagram-api", { action: "sync_posts", account_id: a.id }); Auth.toast("Posts refreshed.", "ok"); await draw(); } catch (x) { App.err(x); e.target.disabled = false; } };
    }
    await draw();
  };

  /* ---------- DM Templates ---------- */
  P["dm-templates"] = async (c, el) => {
    const can = App.canAny(c, EDIT);
    function openT(t) {
      const v = t || {};
      const d = App.modal({
        wide: true, title: v.id ? "Edit template" : "New template",
        body: `<div class="row2"><label class="field"><span>Name</span><input class="input" name="name" required value="${esc(v.name || "")}"></label><label class="field"><span>Category</span><select class="input" name="category">${opts(CATS, v.category)}</select></label></div>
        ${editorHtml({ name: "body", label: "Message", value: v.body || "", vars: ["username", "keyword", "post_url"], max: 1000 })}
        <p style="color:var(--muted);font-size:12.5px;margin:0 0 8px">Use the + buttons to add Username, Keyword or Post link. These stay locked and are filled in automatically; you can edit only the text around them. Add your real link in the rule (Link to send), not here.</p><div class="msg" id="tprev"></div>`,
        onSave: async f => {
          const row = { workspace_id: c.ws, name: f.name.trim(), category: f.category, body: f.body.trim(), created_by: c.user.id };
          if (!row.body) throw new Error("Write a message.");
          must(await (v.id ? sb.from("dm_templates").update(row).eq("id", v.id) : sb.from("dm_templates").insert(row)));
          App.log(c, v.id ? "template_updated" : "template_created", { name: row.name }); draw();
        }
      });
      const prev = t => (d.querySelector("#tprev").textContent = App.vars(t, { username: "sample_user", keyword: "GUIDE", post_url: "https://instagram.com/p/…" }));
      d.addEventListener("vedchange", e => prev(e.detail)); prev(v.body || "");
    }
    async function draw() {
      const cat = App.q("#tcat") ? App.q("#tcat").value : "", q = App.q("#tq") ? App.q("#tq").value : "", st = App.q("#tst") ? App.q("#tst").value : "active";
      const all = must(await sb.from("dm_templates").select("*").eq("workspace_id", c.ws).order("created_at", { ascending: false }));
      const list = all.filter(t => (!cat || t.category === cat) && (!q || norm(t.name + t.body).includes(norm(q))) && (!st || t.status === st));
      el.innerHTML = card(`<div class="bar2"><input class="input" id="tq" placeholder="Search templates…" value="${esc(q)}"><select class="input" id="tcat">${opts([["", "All categories"], ...CATS], cat)}</select><select class="input" id="tst">${opts([["active", "Active"], ["archived", "Archived"], ["", "All"]], st)}</select><span class="sp"></span>${can ? `${all.length ? "" : `<button class="btn" id="seed">Add starter templates</button>`}<button class="btn btn-primary" id="new">New template</button>` : ""}</div>
      ${list.length ? `<div class="grid3">${list.map(t => `<div class="card"><div>${App.badge(catName(t.category))} ${t.status === "archived" ? App.badge("Archived", "warn") : ""}</div><h3 style="margin:8px 0">${esc(t.name)}</h3><div class="cap" style="-webkit-line-clamp:5;white-space:pre-wrap">${showHtml(t.body)}</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px"><button class="ibtn" data-cp="${t.id}">Copy</button>${can ? `${t.status === "active" ? `<a class="ibtn" style="background:#efe9ff;color:#5528d4" href="automation?template=${t.id}">Create rule</a>` : ""}<button class="ibtn" data-ed="${t.id}">Edit</button><button class="ibtn" data-dup="${t.id}">Duplicate</button><button class="ibtn" data-ar="${t.id}">${t.status === "archived" ? "Restore" : "Archive"}</button><button class="ibtn red" data-del="${t.id}">Delete</button>` : ""}</div></div>`).join("")}</div>` : empty("No templates", "Create a template, or add the starter set.")}`);
      ["#tq", "#tcat", "#tst"].forEach(s => (App.q(s).onchange = draw));
      const n = App.q("#new"); if (n) n.onclick = () => openT(null);
      const sd = App.q("#seed"); if (sd) sd.onclick = async () => { try { must(await sb.rpc("seed_starter_templates", { ws: c.ws })); draw(); } catch (x) { App.err(x); } };
      el.onclick = async e => {
        const g = k => e.target.closest(`[data-${k}]`), t = id => all.find(x => x.id === id);
        try {
          if (g("cp")) { await navigator.clipboard.writeText(t(g("cp").dataset.cp).body); Auth.toast("Copied.", "ok"); }
          else if (g("ed")) openT(t(g("ed").dataset.ed));
          else if (g("dup")) { const { id, created_at, updated_at, ...x } = t(g("dup").dataset.dup); must(await sb.from("dm_templates").insert({ ...x, name: x.name + " (copy)" })); draw(); }
          else if (g("ar")) { const x = t(g("ar").dataset.ar); must(await sb.from("dm_templates").update({ status: x.status === "archived" ? "active" : "archived" }).eq("id", x.id)); draw(); }
          else if (g("del") && confirm("Delete this template? Rules using it will stop sending.")) { must(await sb.from("dm_templates").delete().eq("id", g("del").dataset.del)); draw(); }
        } catch (x) { App.err(x); }
      };
    }
    await draw();
  };
})();
