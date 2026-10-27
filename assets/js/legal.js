// Fills company name / contact email from config.js. Shows a visible reminder if they are not set.
(function () {
  const c = window.APP_CONFIG || {};
  document.querySelectorAll('[data-cfg="company"]').forEach(e => { e.textContent = c.COMPANY_NAME || "DM Me Insta"; });
  document.querySelectorAll('[data-cfg="email"]').forEach(e => { e.textContent = c.CONTACT_EMAIL || "[add CONTACT_EMAIL in assets/js/config.js]"; });
  document.querySelectorAll("[data-cfg-mail]").forEach(a => { if (c.CONTACT_EMAIL) a.href = "mailto:" + c.CONTACT_EMAIL; });
})();
