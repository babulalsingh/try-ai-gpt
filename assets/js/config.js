// Public values only. The anon key is safe in the browser because Row Level Security protects data.
// NEVER put the service-role key, Meta app secret or Stripe secret here.
window.APP_CONFIG = {
  SUPABASE_URL: "https://whejwbbgxtbpqflpcirp.supabase.co",       // e.g. https://xxxx.supabase.co
  SUPABASE_ANON_KEY: "sb_publishable_nqTu7bUaBVq0DsnkXU0ACw_F9b5uFs5",  // Project Settings > API > publishable (or anon) key
  // Shown on the Privacy, Terms and Data Deletion pages. Fill these in before going live.
  COMPANY_NAME: "AGS Solutions",       // e.g. "AGS Solutions"
  CONTACT_EMAIL: "contact@ags.com"       // e.g. "support@yourdomain.com"
};
