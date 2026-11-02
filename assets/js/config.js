// Public values only. The anon key is safe in the browser because Row Level Security protects data.
// NEVER put the service-role key, Meta app secret or Stripe secret here.
window.APP_CONFIG = {
  SUPABASE_URL: "",       // e.g. https://xxxx.supabase.co
  SUPABASE_ANON_KEY: "",  // Project Settings > API > publishable (or anon) key
  // Shown on the Privacy, Terms and Data Deletion pages. Fill these in before going live.
  COMPANY_NAME: "",       // e.g. "AGS Solutions"
  CONTACT_EMAIL: ""       // e.g. "support@yourdomain.com"
};
