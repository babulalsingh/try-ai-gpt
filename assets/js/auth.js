(function () {
  const cfg = window.APP_CONFIG || {};
  const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  function toast(msg, type) {
    const t = document.createElement("div");
    t.className = "toast " + (type || "info"); t.setAttribute("role", "status"); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 5000);
  }
  function setupBanner(form) {
    if (configured || !form) return;
    const d = document.createElement("div"); d.className = "setup";
    d.textContent = "Setup needed: add your Supabase URL and anon key in assets/js/config.js to enable sign-in.";
    form.prepend(d);
  }
  function fieldErr(input, msg) {
    input.setAttribute("aria-invalid", msg ? "true" : "false");
    const e = input.closest(".field").querySelector(".err"); if (e) e.textContent = msg || "";
    return !msg;
  }
  function pwRules(p) {
    if (p.length < 8) return "Use at least 8 characters.";
    if (!/[a-z]/i.test(p) || !/\d/.test(p)) return "Include at least one letter and one number.";
    return "";
  }
  const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  async function google(btn) {
    if (!sb) return toast("Supabase is not configured yet.", "bad");
    btn.disabled = true;
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname.replace(/[^/]*$/, "") + "hub.html" } });
    if (error) { toast(error.message, "bad"); btn.disabled = false; }
  }

  const A = window.Auth = {
    sb, configured, toast,
    async session() { if (!sb) return null; const { data } = await sb.auth.getSession(); return data.session; },
    async requireAuth() { const s = await A.session(); if (!s) location.replace("login.html"); return s; },
    async redirectIfAuthed() { if (await A.session()) location.replace("hub.html"); },
    async signOut() { if (sb) await sb.auth.signOut(); location.replace("login.html"); }
  };

  document.addEventListener("click", e => {
    const g = e.target.closest("[data-google]"); if (g) google(g);
    const p = e.target.closest("[data-toggle-pw]");
    if (p) { const i = p.parentElement.querySelector("input"); i.type = i.type === "password" ? "text" : "password"; p.textContent = i.type === "password" ? "Show" : "Hide"; }
  });

  const signup = document.getElementById("signupForm");
  if (signup) {
    setupBanner(signup); A.redirectIfAuthed();
    signup.addEventListener("submit", async e => {
      e.preventDefault();
      const f = signup.elements, btn = signup.querySelector("[type=submit]");
      let ok = fieldErr(f.email, emailOk(f.email.value.trim()) ? "" : "Enter a valid email address.");
      ok = fieldErr(f.password, pwRules(f.password.value)) && ok;
      ok = fieldErr(f.confirm, f.confirm.value === f.password.value ? "" : "Passwords do not match.") && ok;
      ok = fieldErr(f.terms, f.terms.checked ? "" : "Accept the Terms and Privacy Policy to continue.") && ok;
      if (!ok) return;
      if (!sb) return toast("Supabase is not configured yet.", "bad");
      btn.disabled = true;
      const { data, error } = await sb.auth.signUp({ email: f.email.value.trim(), password: f.password.value, options: { emailRedirectTo: location.origin + location.pathname.replace(/[^/]*$/, "") + "login.html" } });
      btn.disabled = false;
      if (error) return toast(error.message, "bad");
      if (data.session) return location.replace("hub.html");
      toast("Check your inbox to confirm your email, then sign in.", "ok");
    });
  }

  const login = document.getElementById("loginForm");
  if (login) {
    setupBanner(login); A.redirectIfAuthed();
    login.addEventListener("submit", async e => {
      e.preventDefault();
      const f = login.elements, btn = login.querySelector("[type=submit]");
      let ok = fieldErr(f.email, emailOk(f.email.value.trim()) ? "" : "Enter a valid email address.");
      ok = fieldErr(f.password, f.password.value ? "" : "Enter your password.") && ok;
      if (!ok) return;
      if (!sb) return toast("Supabase is not configured yet.", "bad");
      btn.disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
      btn.disabled = false;
      if (error) return toast(error.message, "bad");
      location.replace("hub.html");
    });
    document.getElementById("forgot")?.addEventListener("click", async e => {
      e.preventDefault();
      const v = login.elements.email.value.trim();
      if (!emailOk(v)) return fieldErr(login.elements.email, "Enter your email first, then select Forgot password.");
      if (!sb) return toast("Supabase is not configured yet.", "bad");
      const { error } = await sb.auth.resetPasswordForEmail(v, { redirectTo: location.origin + location.pathname.replace(/[^/]*$/, "") + "reset-password.html" });
      toast(error ? error.message : "Password reset link sent. Check your inbox.", error ? "bad" : "ok");
    });
  }
  const reset = document.getElementById("resetForm");
  if (reset && sb) {
    const note = document.getElementById("resetNote");
    let ready = false;
    const show = () => { ready = true; reset.hidden = false; note.hidden = true; };
    sb.auth.onAuthStateChange((ev, sess) => { if (ev === "PASSWORD_RECOVERY" || (sess && ev === "SIGNED_IN")) show(); });
    A.session().then(sess => { if (sess) show(); else setTimeout(() => { if (!ready) note.textContent = "This reset link is invalid or has expired. Request a new one from the sign-in page."; }, 2500); });
    reset.addEventListener("submit", async e => {
      e.preventDefault();
      const f = reset.elements, btn = reset.querySelector("[type=submit]");
      let ok = fieldErr(f.password, pwRules(f.password.value));
      ok = fieldErr(f.confirm, f.confirm.value === f.password.value ? "" : "Passwords do not match.") && ok;
      if (!ok) return;
      btn.disabled = true;
      const { error } = await sb.auth.updateUser({ password: f.password.value });
      if (error) { btn.disabled = false; return toast(error.message, "bad"); }
      toast("Password updated. Please sign in again.", "ok");
      await sb.auth.signOut();
      setTimeout(() => location.replace("login.html"), 1500);
    });
  }
})();
