(function () {
  const { sb } = App, P = window.P;
  const card = (h, cls = "") => `<div class="card ${cls}">${h}</div>`;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt = n => n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toLocaleString();
  const pct = n => n == null ? "—" : `${Number(n).toFixed(2)}%`;
  const btn = (id, label, cls="btn") => `<button class="${cls}" id="${id}">${label}</button>`;
  const table = (heads, rows) => `<div class="tw"><table><thead><tr>${heads.map(x=>`<th>${x}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  const must = r => { if (r.error) throw r.error; return r.data; };
  const blank = (title, msg) => `<div class="empty"><strong>${title}</strong><p>${msg}</p></div>`;
  P.analytics = async (c, el) => {
    let accounts=[], accountId="", posts=[], selected=null, charts=[], range=7, section="overview", snapshots=[];
    const destroy=()=>{ charts.forEach(x=>{try{x.destroy()}catch{}}); charts=[]; };
    const accountOptions=()=>accounts.map(a=>`<option value="${esc(a.id)}" ${a.id===accountId?"selected":""}>@${esc(a.username||a.ig_user_id)}</option>`).join("");
    const header=()=>`<div class="bar2" style="align-items:center;flex-wrap:wrap"><div><b>Instagram Analytics</b><div style="color:var(--muted);font-size:12px">Real insights from your connected professional account</div></div><span class="sp"></span><select class="input" id="an-account" style="max-width:230px">${accountOptions()}</select><select class="input" id="an-range" style="max-width:150px">${[[7,"Last 7 Days"],[30,"Last 30 Days"],[90,"Last 90 Days"]].map(([v,l])=>`<option value="${v}" ${range===v?"selected":""}>${l}</option>`).join("")}</select>${btn("an-refresh","↻ Refresh")}</div>`;
    const tabs=()=>`<div class="tabs" id="an-tabs">${[["overview","Overview"],["posts","Post Analytics"],["automation","Automation Analytics"],["audience","Audience Analytics"],["reports","Reports"]].map(([v,l])=>`<button data-tab="${v}" class="${section===v?"on":""}">${l}</button>`).join("")}</div>`;
    function metric(label,value,sub="",symbol="") { return `<div class="card stat" style="min-width:0"><span style="color:var(--muted)">${symbol} ${label}</span><b style="font-size:23px">${value}</b>${sub?`<small style="color:var(--muted)">${sub}</small>`:""}</div>`; }
    async function init(){
      accounts=must(await sb.from("connected_instagram_accounts").select("id,ig_user_id,username,status").eq("workspace_id",c.ws).eq("status","connected").order("connected_at",{ascending:false}));
      if(!accounts.length){el.innerHTML=blank("Connect an Instagram account","Connect a Business or Creator account to start viewing real analytics.")+`<p><a class="btn btn-primary" href="connect-instagram">Connect Instagram</a></p>`;return;}
      accountId=accounts[0].id; await load();
    }
    async function load(){
      el.innerHTML=header()+tabs()+`<div id="an-body">${blank("Loading analytics…","Fetching account and post insights.")}</div>`;
      bindHeader();
      try {
        const result=await App.fn("instagram-api",{action:"analytics_sync",account_id:accountId,days:range});
        posts=result.posts||[];
        const snap=await sb.from("analytics_snapshots").select("metric_name,metric_value,period_start,snapshot_at,media_id").eq("workspace_id",c.ws).eq("ig_account_id",accountId).gte("snapshot_at",new Date(Date.now()-range*864e5).toISOString()).order("snapshot_at",{ascending:true}).limit(10000);
        snapshots=snap.error?[]:(snap.data||[]);
        renderSection();
      }catch(e){
        App.q("#an-body").innerHTML=blank("Analytics could not be refreshed",esc(e.message||"Instagram did not return insights. Check permissions and reconnect if required."))+`<p>${btn("an-retry","Try again")}</p>`;
        App.q("#an-retry").onclick=load;
      }
    }
    function bindHeader(){
      App.q("#an-account").onchange=e=>{accountId=e.target.value;load();};
      App.q("#an-range").onchange=e=>{range=+e.target.value;load();};
      App.q("#an-refresh").onclick=load;
      App.q("#an-tabs").onclick=e=>{const b=e.target.closest("[data-tab]");if(!b)return;section=b.dataset.tab;renderSection();};
    }
    function metricValue(p,k){const v=p.insights?.[k];return v===undefined||v===null?null:Number(v);}
    function aggregate(k){
      const accountKey=k==="saved"?"saves":k;
      const accountValues=snapshots.filter(x=>!x.media_id&&x.metric_name===accountKey).map(x=>Number(x.metric_value)).filter(Number.isFinite);
      if(accountValues.length)return accountValues.reduce((a,b)=>a+b,0);
      // Reach is unique at account level; never add per-post reach values together.
      if(k==="reach")return null;
      const vals=posts.map(p=>metricValue(p,k)).filter(v=>v!==null&&Number.isFinite(v));
      return vals.length?vals.reduce((a,b)=>a+b,0):null;
    }
    function renderSection(){
      destroy();const body=App.q("#an-body");if(!body)return;
      if(section==="overview")overview(body);
      if(section==="posts")postList(body);
      if(section==="automation")automation(body);
      if(section==="audience")audience(body);
      if(section==="reports")reports(body);
    }
    function chartLine(canvas, labels, sets){
      if(!window.Chart)return;
      charts.push(new Chart(canvas,{type:"line",data:{labels,datasets:sets.map(s=>({label:s.label,data:s.data,borderColor:s.color,backgroundColor:s.color+"22",borderWidth:3,tension:.32,pointRadius:3,spanGaps:false,fill:false}))},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},plugins:{legend:{display:true,position:"top"},tooltip:{enabled:true}},scales:{y:{beginAtZero:true,ticks:{callback:v=>Number(v).toLocaleString()}}}}}));
    }
    function overview(body){
      const views=aggregate("views"), reach=aggregate("reach"), likes=aggregate("likes"), comments=aggregate("comments"), shares=aggregate("shares"), saves=aggregate("saved"), visits=aggregate("profile_visits");
      const interactions=[likes,comments,shares,saves].every(x=>x!==null)?likes+comments+shares+saves:null;
      const engagement=reach&&interactions!==null?interactions/reach*100:null;
      const byDate={};snapshots.filter(x=>!x.media_id).forEach(x=>{const d=x.period_start||String(x.snapshot_at).slice(0,10);(byDate[d]??={})[x.metric_name]=Number(x.metric_value);});
      const labels=Object.keys(byDate).sort();
      body.innerHTML=`<div class="stats">${metric("Views",fmt(views))}${metric("Reach",fmt(reach))}${metric("Likes",fmt(likes))}${metric("Comments",fmt(comments))}${metric("Shares",fmt(shares))}${metric("Saves",fmt(saves))}${metric("Profile Visits",fmt(visits))}${metric("Engagement Rate",pct(engagement),"Interactions ÷ reach")}</div>
      <div class="grid2">${card(`<h3>Performance Over Time</h3><p class="muted">Views, Likes and Comments — date-wise saved insights</p><div class="chartbox" style="height:300px"><canvas id="an-performance"></canvas></div>`)}${card(`<h3>Top Performing Posts</h3>${posts.length?table(["Post","Views","Likes","Comments"],posts.slice().sort((a,b)=>(metricValue(b,"views")||0)-(metricValue(a,"views")||0)).slice(0,5).map(p=>`<tr><td><a href="#" data-post="${esc(p.media_id)}">${esc((p.caption||"Instagram post").slice(0,45))}</a></td><td>${fmt(metricValue(p,"views"))}</td><td>${fmt(metricValue(p,"likes"))}</td><td>${fmt(metricValue(p,"comments"))}</td></tr>`)) : blank("No posts","Sync posts from Instagram first.")}</div>`)}</div>
      <div class="grid2">${card(`<h3>Engagement Breakdown</h3><div class="chartbox" style="height:240px"><canvas id="an-engagement"></canvas></div>`)}${card(`<h3>Automation Results</h3><div id="an-auto-mini">Loading automation results…</div>`)}</div>
      <p class="muted">Only metrics returned by Instagram are shown. Historical lines appear after snapshots have been collected; no synthetic values are generated.</p>`;
      const ds=k=>labels.map(d=>byDate[d]?.[k]??null);
      chartLine(App.q("#an-performance"),labels.map(d=>d.slice(5)),[{label:"Views",data:ds("views"),color:"#7625f5"},{label:"Likes",data:ds("likes"),color:"#f02c9b"},{label:"Comments",data:ds("comments"),color:"#168bfa"}]);
      const vals=[likes,comments,shares,saves];if(window.Chart&&vals.some(x=>x!==null))charts.push(new Chart(App.q("#an-engagement"),{type:"doughnut",data:{labels:["Likes","Comments","Shares","Saves"],datasets:[{data:vals.map(x=>x||0),backgroundColor:["#ef3a9b","#168bfa","#8c39ed","#f5a623"]} ]},options:{maintainAspectRatio:false,plugins:{legend:{position:"bottom"}}}}));
      App.q("#an-body").onclick=e=>{const a=e.target.closest("[data-post]");if(a){e.preventDefault();selected=posts.find(p=>p.media_id===a.dataset.post);detail(body);}};
      miniAutomation();
    }
    async function miniAutomation(){
      const [ev,ld]=await Promise.all([sb.from("automation_events").select("status,event_type").eq("workspace_id",c.ws).eq("ig_account_id",accountId).gte("created_at",new Date(Date.now()-range*864e5).toISOString()),sb.from("leads").select("id").eq("workspace_id",c.ws).eq("ig_account_id",accountId).gte("first_seen_at",new Date(Date.now()-range*864e5).toISOString())]);
      const events=ev.data||[],sent=events.filter(x=>x.status==="sent").length,failed=events.filter(x=>x.status==="failed").length;
      const node=App.q("#an-auto-mini");if(node)node.innerHTML=`${metric("Auto DMs Sent",fmt(sent))}${metric("Failed",fmt(failed))}${metric("New Leads",fmt((ld.data||[]).length))}`;
    }
    function postList(body){
      let q="",type="all",sort="views",page=0,per=10;
      const draw=()=>{
        const list=posts.filter(p=>(!q||`${p.caption||""} ${p.media_type||""}`.toLowerCase().includes(q.toLowerCase()))&&(type==="all"||String(p.media_type||"").toLowerCase().includes(type)));
        list.sort((a,b)=>(metricValue(b,sort)||0)-(metricValue(a,sort)||0));
        const rows=list.slice(page*per,(page+1)*per).map(p=>`<tr><td style="min-width:220px"><div style="display:flex;gap:9px;align-items:center">${p.thumbnail_url?`<img src="${esc(p.thumbnail_url)}" style="width:58px;height:58px;object-fit:cover;border-radius:9px">`:""}<span>${esc((p.caption||"(no caption)").slice(0,70))}</span></div></td><td>${esc(p.media_type||"—")}</td><td>${p.posted_at?new Date(p.posted_at).toLocaleString():"—"}</td><td>${fmt(metricValue(p,"views"))}</td><td>${fmt(metricValue(p,"reach"))}</td><td>${fmt(metricValue(p,"likes"))}</td><td>${fmt(metricValue(p,"comments"))}</td><td>${fmt(metricValue(p,"shares"))}</td><td>${fmt(metricValue(p,"saved"))}</td><td><button class="ibtn" data-detail="${esc(p.media_id)}">Details</button></td></tr>`);
        body.innerHTML=`<div class="bar2"><input class="input" id="post-search" placeholder="Search captions…" value="${esc(q)}"><select class="input" id="post-type"><option value="all">All types</option><option value="image">Image</option><option value="video">Video</option><option value="reel">Reel</option><option value="carousel">Carousel</option></select><select class="input" id="post-sort">${["views","likes","comments","reach","shares"].map(k=>`<option value="${k}" ${sort===k?"selected":""}>Sort: ${k}</option>`).join("")}</select></div>${list.length?table(["Post / Caption","Type","Published","Views","Reach","Likes","Comments","Shares","Saves",""],rows):blank("No matching posts","No posts match this filter or Instagram has not returned post data.")}<div class="bar2">${btn("post-prev","← Previous","ibtn") }<span>Page ${page+1} of ${Math.max(1,Math.ceil(list.length/per))}</span>${btn("post-next","Next →","ibtn")}<span class="sp"></span>${btn("post-csv","Export CSV")}</div>`;
        App.q("#post-search").onchange=e=>{q=e.target.value;page=0;draw();};
        App.q("#post-type").value=type;App.q("#post-type").onchange=e=>{type=e.target.value;page=0;draw();};
        App.q("#post-sort").onchange=e=>{sort=e.target.value;draw();};
        App.q("#post-prev").onclick=()=>{page=Math.max(0,page-1);draw();};
        App.q("#post-next").onclick=()=>{if((page+1)*per<list.length)page++;draw();};
        App.q("#post-csv").onclick=()=>exportCSV("ags-post-analytics.csv",["media_id","caption","type","published","views","reach","likes","comments","shares","saves","engagement_rate"],list.map(p=>[p.media_id,p.caption,p.media_type,p.posted_at,...["views","reach","likes","comments","shares","saved"].map(k=>metricValue(p,k)),rateFor(p)]));
        body.querySelectorAll("[data-detail]").forEach(b=>b.onclick=()=>{selected=posts.find(p=>p.media_id===b.dataset.detail);detail(body);});
      };draw();
    }
    function rateFor(p){const i=["likes","comments","shares","saved"].map(k=>metricValue(p,k));const r=metricValue(p,"reach");return r&&i.every(x=>x!==null)?((i.reduce((a,b)=>a+b,0)/r)*100).toFixed(2):"";}
    function detail(body){
      if(!selected)return;
      const p=selected, keys=["views","likes","comments","shares","saved","reach","total_interactions","profile_visits"];
      body.innerHTML=`<div class="bar2">${btn("detail-back","← Back to posts","ibtn")}<span class="sp"></span>${p.permalink?`<a class="btn" target="_blank" rel="noopener" href="${esc(p.permalink)}">View Post ↗</a>`:""}</div><div class="grid2">${card(`<div style="display:flex;gap:14px;align-items:flex-start">${p.thumbnail_url?`<img src="${esc(p.thumbnail_url)}" style="width:180px;max-width:38%;border-radius:12px;object-fit:cover">`:""}<div><h3>${esc((p.caption||"Instagram post").slice(0,180))}</h3><p>${esc(p.media_type||"")} · ${p.posted_at?new Date(p.posted_at).toLocaleString():"Date unavailable"}</p><small>Connected account: @${esc(accounts.find(a=>a.id===accountId)?.username||"")}</small></div></div>`)}${card(`<h3>Post Performance</h3><div class="stats">${keys.map(k=>metric(k.replace("_"," "),fmt(metricValue(p,k)))).join("")}${metric("Engagement Rate",pct(rateFor(p)))}</div>`)}</div><p class="muted">A dash means Instagram did not return that metric for this media type, permission set, or account.</p>`;
      App.q("#detail-back").onclick=()=>{section="posts";renderSection();};
    }
    async function automation(body){
      const since=new Date(Date.now()-range*864e5).toISOString();
      const [er,lr,rr]=await Promise.all([sb.from("automation_events").select("status,event_type,rule_id,created_at").eq("workspace_id",c.ws).eq("ig_account_id",accountId).gte("created_at",since).limit(10000),sb.from("leads").select("id,status,first_seen_at").eq("workspace_id",c.ws).eq("ig_account_id",accountId).gte("first_seen_at",since),sb.from("automation_rules").select("id,name,keyword,status").eq("workspace_id",c.ws).eq("ig_account_id",accountId)]);
      const events=er.data||[],leads=lr.data||[],rules=rr.data||[],count=s=>events.filter(x=>x.status===s).length,sent=count("sent"),failed=count("failed"),triggers=events.length,converted=leads.filter(x=>x.status==="converted").length;
      const rate=triggers?sent/triggers*100:null,conv=leads.length?converted/leads.length*100:null;
      body.innerHTML=`<div class="stats">${metric("Total Auto DMs Sent",fmt(sent))}${metric("Successful DMs",fmt(sent))}${metric("Failed DMs",fmt(failed))}${metric("New Leads Captured",fmt(leads.length))}${metric("Rule Triggers",fmt(triggers))}${metric("Comment-to-DM Rate",pct(rate),"Successful sends ÷ events")}${metric("Lead Conversion",pct(conv))}${metric("Active Rules",fmt(rules.filter(x=>x.status==="active").length))}</div>${card(`<h3>Rule-wise performance</h3>${table(["Rule","Keyword","Status","Triggers","Successful DMs"],rules.map(r=>{const ev=events.filter(x=>x.rule_id===r.id);return `<tr><td>${esc(r.name)}</td><td>${esc(r.keyword)}</td><td>${esc(r.status)}</td><td>${ev.length}</td><td>${ev.filter(x=>x.status==="sent").length}</td></tr>`;}))}`)}<p class="muted">Automation metrics are calculated from your existing automation_events and leads records.</p>`;
    }
    async function audience(body){
      const res=await App.fn("instagram-api",{action:"analytics_audience",account_id:accountId});
      const data=res.audience||{};
      const groups=Object.entries(data).filter(([k,v])=>Array.isArray(v)&&v.length);
      body.innerHTML=`<div class="stats">${metric("Followers",fmt(res.followers))}${metric("Accounts Reached",fmt(res.reach))}${metric("Accounts Engaged",fmt(res.accounts_engaged))}</div>${groups.length?`<div class="grid2">${groups.map(([k,arr],i)=>card(`<h3>${esc(k.replaceAll("_"," "))}</h3>${arr.map(x=>`<div class="kv"><span>${esc(x.dimension||x.name||"")}</span><b>${fmt(x.value)}</b></div>`).join("")}`)).join("")}</div>`:blank("Audience demographics unavailable","Meta only returns demographic insights for eligible professional accounts, typically with at least 100 followers and the required insights permission.")}<p class="muted">No gender, age, location, or follower split is inferred when Meta does not provide it.</p>`;
    }
    function exportCSV(name,heads,rows){
      const csv=[heads,...rows].map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
      const a=document.createElement("a"),u=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}));a.href=u;a.download=name;a.click();URL.revokeObjectURL(u);
    }
    function reports(body){
      body.innerHTML=`<div class="grid2">${card(`<h3>Analytics Reports</h3><p>Export the selected account and date range. CSV opens in Excel and other spreadsheet applications.</p>${btn("report-posts","Download Post Analytics CSV","btn btn-primary")}<br><br>${btn("report-summary","Download Summary CSV","btn")}<br><br>${btn("report-xlsx","Export Excel (.xlsx)","btn")}<br><br>${btn("report-print","Export PDF / Print","btn")}`)}${card(`<h3>Report scope</h3><div class="kv"><span>Instagram account</span><b>@${esc(accounts.find(a=>a.id===accountId)?.username||"")}</b></div><div class="kv"><span>Date range</span><b>Last ${range} days</b></div><div class="kv"><span>Posts available</span><b>${posts.length}</b></div><div class="kv"><span>Data source</span><b>Instagram Graph API</b></div>`)}</div><p class="muted">PDF export uses your browser's Print → Save as PDF. Excel export is a CSV file that opens in Excel; native XLSX is not generated in this browser build.</p>`;
      App.q("#report-posts").onclick=()=>exportCSV("ags-post-analytics.csv",["media_id","caption","type","published","views","reach","likes","comments","shares","saves","engagement_rate"],posts.map(p=>[p.media_id,p.caption,p.media_type,p.posted_at,...["views","reach","likes","comments","shares","saved"].map(k=>metricValue(p,k)),rateFor(p)]));
      App.q("#report-summary").onclick=()=>exportCSV("ags-analytics-summary.csv",["metric","value"],["views","reach","likes","comments","shares","saved","profile_visits"].map(k=>[k,aggregate(k)]));
      App.q("#report-xlsx").onclick=()=>{
        if(!window.XLSX){App.err(new Error("Excel export library could not load. Use CSV export instead."));return;}
        const data=[["Post ID","Caption","Type","Published","Views","Reach","Likes","Comments","Shares","Saves","Engagement Rate"],...posts.map(p=>[p.media_id,p.caption,p.media_type,p.posted_at,...["views","reach","likes","comments","shares","saved"].map(k=>metricValue(p,k)),rateFor(p)])];
        const ws=XLSX.utils.aoa_to_sheet(data), wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Post Analytics");XLSX.writeFile(wb,"ags-post-analytics.xlsx");
      };
      App.q("#report-print").onclick=()=>window.print();
    }
    await init();
  };
})();