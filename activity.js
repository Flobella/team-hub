/* Flobella Group app · Weekly activity + leaderboard
   Data lives in Supabase. Security is enforced by the database rules, not by this file. */
(function () {
  "use strict";

  const SB_URL = "https://dcwvgaocvncocjizzrva.supabase.co";
  const SB_KEY = "sb_publishable_iGe3lQ1qb6iA_HOlBhqCMg_1VzSyoDZ";
  const TZ = "America/New_York";

  // Metric order matches the team's Weekly Stats; labels and points load from the database.
  const METRICS = ["contracts","listings","offers","leads","networking","buyer_consults","seller_consults","preapprovals","showings"];
  const DEFAULT_POINTS = {
    contracts:["New Contracts Executed",10], listings:["Listing Agreements Signed",8], offers:["Offers Submitted",5],
    leads:["New Leads",1], networking:["Networking Events",2], buyer_consults:["Buyer Consultations Completed",4],
    seller_consults:["Seller Consultations Completed",4], preapprovals:["New Pre-Approvals",3], showings:["Buyer Showings Completed",2]
  };

  const root = document.getElementById("lb-root");
  const who = document.getElementById("lb-who");
  if (!root) return;

  // ---------- helpers ----------
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const etToday = () => new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const parseD = s => { const [y,m,d] = s.split("-").map(Number); return new Date(Date.UTC(y,m-1,d)); };
  const fmtD = d => d.toISOString().slice(0,10);
  const addDays = (s,n) => { const d = parseD(s); d.setUTCDate(d.getUTCDate()+n); return fmtD(d); };
  const mondayOf = s => { const d = parseD(s); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay()+6)%7)); return fmtD(d); };
  const short = s => parseD(s).toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"UTC"});
  const weekLabel = ws => `${short(ws)} – ${short(addDays(ws,6))}`;
  const thisWeek = () => mondayOf(etToday());
  const lastWeek = () => addDays(thisWeek(), -7);

  function friendlyError(err) {
    const m = (err && (err.message || err.error_description)) || String(err || "");
    if (/Invalid login credentials/i.test(m)) return "Wrong email or password. First time here? Tap “Create your account.”";
    if (/Database error|roster/i.test(m)) return "That email isn't on the team roster yet. Ask Chris or Lesly to add it.";
    if (/already registered|already been registered/i.test(m)) return "You already have an account. Sign in instead, or tap “Forgot password.”";
    if (/row-level security|violates/i.test(m)) return "That week is locked. Weeks lock Sunday at midnight. Ask a Team Lead to fix past weeks.";
    if (/Password should be|password.*characters/i.test(m)) return "Use a password with at least 8 characters.";
    if (/Failed to fetch|NetworkError|network/i.test(m)) return "No connection. Check your signal and try again.";
    if (/rate limit/i.test(m)) return "Too many tries. Wait a few minutes and try again.";
    return m || "Something went wrong. Try again.";
  }

  // ---------- setup checks ----------
  if (!SB_URL) { root.innerHTML = `<p class="lb-msg">The leaderboard is being set up. Check back soon.</p>`; return; }
  if (!window.supabase || !window.supabase.createClient) {
    root.innerHTML = `<p class="lb-msg">Connect to the internet to see the leaderboard.</p>`; return;
  }
  const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

  const S = { session:null, me:null, members:[], points:{...DEFAULT_POINTS}, rows:[], period:"week", authMode:"signin", recovering:false };

  // ---------- auth ----------
  function renderAuth(msg, ok) {
    who.hidden = true;
    const m = S.authMode;
    const title = { signin:"Sign in", signup:"Create your account", forgot:"Reset your password", recover:"Set a new password" }[m];
    const help = {
      signin: "Use your Flobella Group company email.",
      signup: "First time only. Use your company email and pick a password (8+ characters).",
      forgot: "We'll email you a link to set a new password.",
      recover: "Pick a new password (8+ characters)."
    }[m];
    root.innerHTML = `
      <form class="panel auth" id="authf" novalidate>
        <h3>${title}</h3>
        <p class="sub">${help}</p>
        ${m !== "recover" ? `<div><label for="a-email">Company email</label><input id="a-email" type="email" autocomplete="username" inputmode="email" required></div>` : ""}
        ${m !== "forgot" ? `<div><label for="a-pass">${m==="signin"?"Password":"New password"}</label><input id="a-pass" type="password" autocomplete="${m==="signin"?"current-password":"new-password"}" required minlength="8"></div>` : ""}
        ${m === "signup" || m === "recover" ? `<div><label for="a-pass2">Confirm password</label><input id="a-pass2" type="password" autocomplete="new-password" required minlength="8"></div>` : ""}
        <div class="row"><button class="btn dark" type="submit" id="a-go">${title}</button></div>
        <div class="row">
          ${m==="signin" ? `<button class="linkbtn" type="button" data-mode="signup">Create your account</button><button class="linkbtn" type="button" data-mode="forgot">Forgot password?</button>` : ""}
          ${m==="signup" || m==="forgot" ? `<button class="linkbtn" type="button" data-mode="signin">Back to sign in</button>` : ""}
        </div>
        ${msg ? `<p class="${ok?"lb-ok":"lb-err"}" role="status">${esc(msg)}</p>` : ""}
      </form>`;
    root.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => { S.authMode = b.dataset.mode; renderAuth(); }));
    root.querySelector("#authf").addEventListener("submit", onAuthSubmit);
  }

  async function onAuthSubmit(e) {
    e.preventDefault();
    const go = root.querySelector("#a-go"); go.disabled = true;
    const email = (root.querySelector("#a-email")?.value || "").trim().toLowerCase();
    const pass = root.querySelector("#a-pass")?.value || "";
    const pass2 = root.querySelector("#a-pass2")?.value;
    try {
      if (S.authMode !== "recover" && !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter your company email.");
      if ((S.authMode === "signup" || S.authMode === "recover") && pass !== pass2) throw new Error("The passwords don't match.");
      if (S.authMode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password: pass }); if (error) throw error;
      } else if (S.authMode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password: pass }); if (error) throw error;
        if (!data.session) { S.authMode = "signin"; renderAuth("Account created. Check your email to confirm it, then sign in.", true); return; }
      } else if (S.authMode === "forgot") {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        if (error) throw error;
        S.authMode = "signin"; renderAuth("Check your email for a reset link.", true); return;
      } else if (S.authMode === "recover") {
        const { error } = await sb.auth.updateUser({ password: pass }); if (error) throw error;
        S.recovering = false; S.authMode = "signin"; await boot(); return;
      }
    } catch (err) { renderAuth(friendlyError(err)); const f = root.querySelector("#a-email"); if (f) f.value = email; }
  }

  // ---------- data ----------
  async function loadAll() {
    const yearStart = etToday().slice(0,4) + "-01-01";
    const from = addDays(mondayOf(yearStart), -7);
    const [mem, pts, act] = await Promise.all([
      sb.from("team_members").select("email,full_name,role,active").order("full_name"),
      sb.from("point_values").select("metric,label,points,sort").order("sort"),
      sb.from("weekly_activity").select("*").gte("week_start", from)
    ]);
    for (const r of [mem, pts, act]) if (r.error) throw r.error;
    S.members = mem.data;
    S.points = {...DEFAULT_POINTS};
    pts.data.forEach(p => { S.points[p.metric] = [p.label, p.points]; });
    S.rows = act.data;
  }

  const scoreOf = row => METRICS.reduce((t,k) => t + (row[k]||0) * S.points[k][1], 0);
  function inPeriod(ws, p) {
    const today = etToday();
    if (p === "week") return ws === thisWeek();
    if (p === "last") return ws === lastWeek();
    if (p === "month") return ws.slice(0,7) === today.slice(0,7);
    if (p === "year") return ws.slice(0,4) === today.slice(0,4);
    return false;
  }
  function standings(p) {
    const agents = S.members.filter(m => m.role === "agent" && m.active);
    const list = agents.map(a => {
      const tot = Object.fromEntries(METRICS.map(k => [k,0]));
      S.rows.filter(r => r.email === a.email && inPeriod(r.week_start, p)).forEach(r => METRICS.forEach(k => tot[k] += r[k]||0));
      return { ...a, tot, score: scoreOf(tot) };
    });
    list.sort((x,y) => y.score - x.score || x.full_name.localeCompare(y.full_name));
    return list;
  }

  // ---------- views ----------
  function renderWho() {
    who.hidden = false;
    who.innerHTML = `<span>Signed in as <b>${esc(S.me.full_name)}</b>${S.me.role==="owner"?" · Owner":""}</span><button class="linkbtn" id="so">Sign out</button>`;
    who.querySelector("#so").addEventListener("click", async () => { await sb.auth.signOut(); });
  }

  function stepperForm(values, opts) {
    const v = Object.fromEntries(METRICS.map(k => [k, values?.[k] || 0]));
    const id = opts.id;
    const html = `
      <form id="${id}" novalidate>
        ${METRICS.map(k => `
          <div class="metric">
            <label for="${id}-${k}">${esc(S.points[k][0])}<span class="pts">${S.points[k][1]} pt${S.points[k][1]===1?"":"s"} each</span></label>
            <div class="step">
              <button type="button" data-d="-1" data-k="${k}" aria-label="Minus one ${esc(S.points[k][0])}">−</button>
              <input id="${id}-${k}" data-k="${k}" type="number" inputmode="numeric" min="0" step="1" value="${v[k]}">
              <button type="button" data-d="1" data-k="${k}" aria-label="Plus one ${esc(S.points[k][0])}">+</button>
            </div>
          </div>`).join("")}
        <div class="formfoot">
          <div class="total">Points this week <b id="${id}-tot">0</b></div>
          <button class="btn dark" type="submit">${opts.button}</button>
        </div>
        <p class="lb-msg" id="${id}-msg" role="status" style="margin-top:8px"></p>
      </form>`;
    return html;
  }
  function wireForm(id, onSave) {
    const f = root.querySelector("#" + id);
    const read = () => Object.fromEntries(METRICS.map(k => [k, Math.max(0, parseInt(f.querySelector(`input[data-k="${k}"]`).value,10) || 0)]));
    const upd = () => { f.querySelector(`#${id}-tot`).textContent = scoreOf(read()); };
    f.querySelectorAll("button[data-d]").forEach(b => b.addEventListener("click", () => {
      const i = f.querySelector(`input[data-k="${b.dataset.k}"]`);
      i.value = Math.max(0, (parseInt(i.value,10)||0) + Number(b.dataset.d)); upd();
    }));
    f.querySelectorAll("input").forEach(i => i.addEventListener("input", upd));
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = f.querySelector('button[type="submit"]'), msg = f.querySelector(`#${id}-msg`);
      btn.disabled = true; msg.className = "lb-msg"; msg.textContent = "Saving…";
      try { await onSave(read()); msg.className = "lb-ok"; msg.textContent = "Saved."; }
      catch (err) { msg.className = "lb-err"; msg.textContent = friendlyError(err); }
      finally { btn.disabled = false; }
    });
    upd();
  }

  async function saveWeek(email, week_start, vals) {
    const { data, error } = await sb.from("weekly_activity")
      .upsert({ email, week_start, ...vals }, { onConflict: "email,week_start" }).select().single();
    if (error) throw error;
    S.rows = S.rows.filter(r => !(r.email === email && r.week_start === week_start)).concat(data);
    renderBoard();
  }

  function boardHTML() {
    const tabs = [["week","This week"],["last","Last week"],["month","This month"],["year","This year"]];
    return `
      <div class="panel">
        <h3>Leaderboard</h3>
        <p class="sub" id="lb-range"></p>
        <div class="tabs" role="group" aria-label="Time period">
          ${tabs.map(([k,l]) => `<button class="tab" type="button" data-p="${k}" aria-pressed="${S.period===k}">${l}</button>`).join("")}
        </div>
        <ol class="board" id="board"></ol>
        <div class="teamtot" id="teamtot"></div>
      </div>`;
  }
  function renderBoard() {
    const board = root.querySelector("#board"); if (!board) return;
    root.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-pressed", String(t.dataset.p === S.period)));
    const rng = { week:`Week of ${weekLabel(thisWeek())} · Updates live as agents log`, last:`Week of ${weekLabel(lastWeek())}`,
      month:new Date(parseD(etToday().slice(0,7)+"-01")).toLocaleDateString("en-US",{month:"long",year:"numeric",timeZone:"UTC"}) + " · weeks that start this month",
      year:`${etToday().slice(0,4)} so far` }[S.period];
    root.querySelector("#lb-range").textContent = rng;
    const list = standings(S.period);
    const top = Math.max(1, ...list.map(a => a.score));
    if (!list.length) { board.innerHTML = `<li style="padding:14px">No team agents on the roster yet.</li>`; root.querySelector("#teamtot").innerHTML = ""; return; }
    board.innerHTML = list.map((a,i) => `
      <li class="${S.me && a.email === S.me.email ? "me" : ""}${a.score ? "" : " zero"}">
        <button class="rowbtn" type="button" aria-expanded="false" data-i="${i}">
          <span class="rk">${a.score ? i+1 : "–"}</span>
          <span><span class="nm">${esc(a.full_name)}</span><span class="bar"><i style="width:${Math.round(a.score/top*100)}%"></i></span></span>
          <span class="sc">${a.score}<small>pts</small></span>
        </button>
        <div class="brk" id="brk-${i}">${METRICS.map(k => `<span>${esc(S.points[k][0])}</span><span>${a.tot[k]}</span>`).join("")}</div>
      </li>`).join("");
    board.querySelectorAll(".rowbtn").forEach(b => b.addEventListener("click", () => {
      const d = root.querySelector("#brk-" + b.dataset.i), open = !d.classList.contains("open");
      d.classList.toggle("open", open); b.setAttribute("aria-expanded", String(open));
    }));
    const team = Object.fromEntries(METRICS.map(k => [k, list.reduce((t,a) => t + a.tot[k], 0)]));
    root.querySelector("#teamtot").innerHTML = `<div>Team total <b>${list.reduce((t,a)=>t+a.score,0)} pts</b></div>` +
      ["contracts","offers","showings","leads"].map(k => `<div>${esc(S.points[k][0])} <b>${team[k]}</b></div>`).join("");
  }
  function wireBoard() {
    root.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => { S.period = t.dataset.p; renderBoard(); }));
  }

  function renderAgent() {
    const ws = thisWeek();
    const mine = S.rows.find(r => r.email === S.me.email && r.week_start === ws);
    root.innerHTML = `
      <div class="lb-grid">
        <div class="panel">
          <h3>Your week</h3>
          <p class="sub">Week of ${weekLabel(ws)}. You can update it until Sunday at midnight, then it locks.</p>
          ${stepperForm(mine, { id:"wk", button: mine ? "Update my week" : "Save my week" })}
        </div>
        ${boardHTML()}
      </div>`;
    wireForm("wk", vals => saveWeek(S.me.email, ws, vals));
    wireBoard(); renderBoard();
  }

  function renderOwner() {
    const agents = S.members.filter(m => m.role === "agent");
    root.innerHTML = `
      ${boardHTML()}
      <div class="owner">
        <details>
          <summary>Fix an agent's week</summary>
          <div class="inner">
            <div class="ofields">
              <div><label for="o-agent">Agent</label><select id="o-agent">${agents.map(a => `<option value="${esc(a.email)}">${esc(a.full_name)}${a.active?"":" (inactive)"}</option>`).join("")}</select></div>
              <div><label for="o-date">Any day in that week</label><input id="o-date" type="date" value="${lastWeek()}"></div>
            </div>
            <p class="sub" id="o-wk"></p>
            <div id="o-form"></div>
          </div>
        </details>
        <details>
          <summary>Team roster</summary>
          <div class="inner">
            <p class="sub">Only people on this list can create an account. Turning someone off removes them from the leaderboard and blocks sign-in; their history is kept.</p>
            <div class="tablewrap"><table class="roster"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th></tr></thead><tbody>
              ${S.members.map(m => `<tr><td>${esc(m.full_name)}</td><td>${esc(m.email)}</td>
                <td><select data-role="${esc(m.email)}"><option value="agent"${m.role==="agent"?" selected":""}>Team agent</option><option value="owner"${m.role==="owner"?" selected":""}>Owner</option></select></td>
                <td><input type="checkbox" data-active="${esc(m.email)}"${m.active?" checked":""} aria-label="Active"${m.email===S.me.email?" disabled":""}></td></tr>`).join("")}
            </tbody></table></div>
            <h3>Add someone</h3>
            <form id="o-add" class="ofields" novalidate>
              <div><label for="n-name">Full name</label><input id="n-name" required></div>
              <div><label for="n-email">Company email</label><input id="n-email" type="email" required></div>
              <div><label for="n-role">Role</label><select id="n-role"><option value="agent">Team agent</option><option value="owner">Owner</option></select></div>
              <div style="align-self:end"><button class="btn dark" type="submit">Add to roster</button></div>
            </form>
            <p class="lb-msg" id="o-rmsg" role="status"></p>
          </div>
        </details>
        <details>
          <summary>Point values</summary>
          <div class="inner">
            <p class="sub">Changing a value re-scores every week, past and present.</p>
            <form id="o-pts">
              <div class="ptsgrid">${METRICS.map(k => `<div><label for="p-${k}" style="margin:0;text-transform:none;letter-spacing:0;font-size:13.5px;color:var(--ink)">${esc(S.points[k][0])}</label><input id="p-${k}" data-k="${k}" type="number" min="0" inputmode="numeric" value="${S.points[k][1]}"></div>`).join("")}</div>
              <div class="formfoot"><span></span><button class="btn dark" type="submit">Save point values</button></div>
              <p class="lb-msg" id="o-pmsg" role="status"></p>
            </form>
          </div>
        </details>
        <details>
          <summary>Export for the Monday meeting</summary>
          <div class="inner">
            <p class="sub">Every logged week this year, one row per agent per week. Opens in Excel.</p>
            <div class="row" style="display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn dark" type="button" id="o-dl">Download CSV</button>
              <button class="btn" type="button" id="o-cp">Copy as table</button>
            </div>
            <p class="lb-msg" id="o-emsg" role="status"></p>
          </div>
        </details>
      </div>`;
    wireBoard(); renderBoard();

    // Fix a week
    const loadFix = () => {
      const email = root.querySelector("#o-agent").value, d = root.querySelector("#o-date").value;
      if (!email || !d) return;
      const ws = mondayOf(d);
      root.querySelector("#o-wk").textContent = `Week of ${weekLabel(ws)}`;
      const row = S.rows.find(r => r.email === email && r.week_start === ws);
      root.querySelector("#o-form").innerHTML = stepperForm(row, { id:"fx", button:"Save this week" });
      wireForm("fx", vals => saveWeek(email, ws, vals));
    };
    root.querySelector("#o-agent")?.addEventListener("change", loadFix);
    root.querySelector("#o-date").addEventListener("change", loadFix);
    if (agents.length) loadFix();

    // Roster
    const rmsg = root.querySelector("#o-rmsg");
    const rosterUpdate = async (email, patch) => {
      rmsg.className = "lb-msg"; rmsg.textContent = "Saving…";
      const { error } = await sb.from("team_members").update(patch).eq("email", email);
      if (error) { rmsg.className = "lb-err"; rmsg.textContent = friendlyError(error); return; }
      Object.assign(S.members.find(m => m.email === email), patch); rmsg.className = "lb-ok"; rmsg.textContent = "Saved."; renderBoard();
    };
    root.querySelectorAll("[data-role]").forEach(s => s.addEventListener("change", () => rosterUpdate(s.dataset.role, { role: s.value })));
    root.querySelectorAll("[data-active]").forEach(c => c.addEventListener("change", () => rosterUpdate(c.dataset.active, { active: c.checked })));
    root.querySelector("#o-add").addEventListener("submit", async e => {
      e.preventDefault();
      const full_name = root.querySelector("#n-name").value.trim(), email = root.querySelector("#n-email").value.trim().toLowerCase(), role = root.querySelector("#n-role").value;
      if (!full_name || !/^\S+@\S+\.\S+$/.test(email)) { rmsg.className = "lb-err"; rmsg.textContent = "Enter a name and a valid email."; return; }
      const { error } = await sb.from("team_members").insert({ full_name, email, role });
      if (error) { rmsg.className = "lb-err"; rmsg.textContent = /duplicate/i.test(error.message) ? "That email is already on the roster." : friendlyError(error); return; }
      await refresh(); root.querySelector("#o-rmsg").className = "lb-ok"; root.querySelector("#o-rmsg").textContent = `${full_name} added. They can create their account now.`;
    });

    // Points
    root.querySelector("#o-pts").addEventListener("submit", async e => {
      e.preventDefault();
      const pm = root.querySelector("#o-pmsg"); pm.className = "lb-msg"; pm.textContent = "Saving…";
      try {
        for (const k of METRICS) {
          const v = Math.max(0, parseInt(root.querySelector("#p-"+k).value,10) || 0);
          if (v !== S.points[k][1]) { const { error } = await sb.from("point_values").update({ points: v }).eq("metric", k); if (error) throw error; S.points[k][1] = v; }
        }
        pm.className = "lb-ok"; pm.textContent = "Saved. The leaderboard is re-scored."; renderBoard();
      } catch (err) { pm.className = "lb-err"; pm.textContent = friendlyError(err); }
    });

    // Export
    const csv = (sep) => {
      const name = Object.fromEntries(S.members.map(m => [m.email, m.full_name]));
      const yr = etToday().slice(0,4);
      const head = ["Week Start","Agent", ...METRICS.map(k => S.points[k][0]), "Points"];
      const rows = S.rows.filter(r => r.week_start.slice(0,4) === yr).sort((a,b) => a.week_start.localeCompare(b.week_start) || (name[a.email]||"").localeCompare(name[b.email]||""))
        .map(r => [r.week_start, name[r.email] || r.email, ...METRICS.map(k => r[k]||0), scoreOf(r)]);
      const q = v => sep === "," && /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g,'""')}"` : String(v);
      return [head, ...rows].map(r => r.map(q).join(sep)).join("\n");
    };
    const emsg = root.querySelector("#o-emsg");
    root.querySelector("#o-dl").addEventListener("click", () => {
      try {
        const url = URL.createObjectURL(new Blob([csv(",")], { type: "text/csv" }));
        const a = document.createElement("a"); a.href = url; a.download = `flobella-weekly-activity-${etToday()}.csv`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
        emsg.className = "lb-ok"; emsg.textContent = "Downloaded.";
      } catch (e) { emsg.className = "lb-err"; emsg.textContent = "Download was blocked here. Use Copy as table, then paste into Excel."; }
    });
    root.querySelector("#o-cp").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(csv("\t")); emsg.className = "lb-ok"; emsg.textContent = "Copied. Paste it into Excel."; }
      catch (e) { emsg.className = "lb-err"; emsg.textContent = "Copy was blocked. Use Download CSV instead."; }
    });
  }

  function render() {
    if (S.recovering) { S.authMode = "recover"; renderAuth(); return; }
    if (!S.session) { renderAuth(); return; }
    if (!S.me) {
      who.hidden = true;
      root.innerHTML = `<div class="panel"><p class="lb-msg">Your account isn't on the active team roster. Ask Chris or Lesly to add you.</p><p><button class="linkbtn" id="so2">Sign out</button></p></div>`;
      root.querySelector("#so2").addEventListener("click", () => sb.auth.signOut());
      return;
    }
    renderWho();
    S.me.role === "owner" ? renderOwner() : renderAgent();
  }

  async function refresh() {
    try {
      await loadAll();
      const email = (S.session.user.email || "").toLowerCase();
      S.me = S.members.find(m => m.email === email && m.active) || null;
      render();
    } catch (err) {
      root.innerHTML = `<div class="panel"><p class="lb-err">${esc(friendlyError(err))}</p><p><button class="btn" id="retry">Try again</button></p></div>`;
      root.querySelector("#retry").addEventListener("click", refresh);
    }
  }

  async function boot() {
    const { data } = await sb.auth.getSession();
    S.session = data.session;
    if (S.session && !S.recovering) { root.innerHTML = `<p class="lb-msg">Loading…</p>`; await refresh(); } else render();
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { S.recovering = true; S.session = session; render(); return; }
    const was = S.session?.user?.id, now = session?.user?.id;
    S.session = session;
    if (event === "SIGNED_OUT") { S.me = null; S.authMode = "signin"; render(); return; }
    if (now && now !== was && !S.recovering) setTimeout(refresh, 0);
  });

  // Pull fresh numbers when the app comes back to the foreground
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && S.session && S.me && !document.activeElement?.closest?.("form")) refresh();
  });

  boot();
})();
