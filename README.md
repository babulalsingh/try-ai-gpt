# DM Me Insta — Stage 1 & 2 (design system, public pages, auth)

## Run locally
1. Create a Supabase project. Auth > Providers: enable Email and Google. Auth > URL Configuration: add your site URL and `http://localhost:8080`.
2. Paste Project URL + anon key into `assets/js/config.js` (anon key only).
3. `python3 -m http.server 8080` in this folder, open http://localhost:8080.

## Test
- Sign up with a bad email / short password / mismatched confirm: inline errors appear.
- Sign up valid: confirmation email arrives; after confirming, Sign in opens dashboard.
- Open `dashboard.html` signed out: redirects to login.
- Without config: pages show a "Setup needed" notice and never fake success.

## Next: Stage 3 (migrations + RLS), then dashboard pages.

## Stage 3: Database setup
1. Supabase Dashboard > SQL Editor > New query.
2. Paste all of `supabase/migrations/20261015000000_init.sql` and Run. (Or: `supabase link` then `supabase db push`.)
3. Table Editor: confirm 25 tables and that `plans` has 3 rows (starter, growth, agency).
4. Sign up a test user, then check `profiles`, `workspaces`, `workspace_members` (role owner) and `subscriptions` (starter) each have one row.
5. Auth > Providers: enable Email and Google; Auth > URL Configuration: add Site URL and redirect URLs.
6. Never expose the service-role key in the browser. Edge Functions (Stage 5+) use it from secrets.

## Stage 4-6: all dashboard pages + Instagram backend

### 1. Database (run in order in the SQL Editor)
1. `supabase/migrations/20261015000000_init.sql`
2. `supabase/migrations/20261015000100_team_and_helpers.sql`

### 2. Deploy Edge Functions (needs Supabase CLI: https://supabase.com/docs/guides/cli)
```
supabase login
supabase link --project-ref <your-project-id>
supabase secrets set META_APP_ID=... META_APP_SECRET=... \
  META_REDIRECT_URI=https://<project-id>.supabase.co/functions/v1/instagram-oauth \
  META_WEBHOOK_VERIFY_TOKEN=<any long random text> \
  APP_BASE_URL=https://<your-netlify-site>.netlify.app
supabase functions deploy instagram-oauth --no-verify-jwt
supabase functions deploy instagram-webhook --no-verify-jwt
supabase functions deploy instagram-api --no-verify-jwt
```
Optional secret `META_GRAPH_VERSION` (default v21.0): set it to the current version from Meta's docs.

### 3. Meta app settings
- Instagram > Business login > OAuth redirect URI = the `META_REDIRECT_URI` above.
- Instagram > Webhooks > Callback URL = `https://<project-id>.supabase.co/functions/v1/instagram-webhook`, Verify token = your `META_WEBHOOK_VERIFY_TOKEN`, subscribe `comments` and `messages`.
- Add your Instagram account as an Instagram Tester while the app is in Development mode.

### 4. Test end to end
1. Dashboard > Connect Instagram > Connect. After approving you return with "Connected".
2. DM Templates > Add starter templates. Automation > Create rule (keyword GUIDE, status Active).
3. From another Instagram account, comment GUIDE on your post.
4. Automation > Execution history shows the event (sent / failed with reason). Leads and Inbox fill in.

### Not built yet
- Invitation emails (invites are saved; the person joins on their next login with that email).
- Integrations (Sheets, Slack, Zapier), account deletion is a support request.

## Link button and "follow first" (Automation rules)
1. SQL Editor: run `supabase/migrations/20261016000100_follow_gate_and_link.sql`.
2. Replace the code of the Edge Functions `instagram-webhook` and `instagram-oauth` with the new `index.ts` files and deploy (Verify JWT off).
3. Meta app > Webhooks (Instagram): also subscribe the field `messaging_postbacks`.
4. Dashboard > Connect Instagram > Reconnect (so the new webhook field is subscribed for your account).
5. Automation > Create rule: fill "Link to send" (https://) and optionally tick "Ask them to follow me first".

## Try AI GPT hub
- After sign up or login everyone lands on `hub.html` (Try AI GPT dashboard). Only **AGS DM Insta** is live (opens `dashboard.html`); the other tools show "Coming soon".
- To make another tool live later, set its `href` in the `TOOLS` list in `assets/js/hub.js`.
- Optional images: `assets/img/ags-logo.png` (hub logo) and `assets/img/hero-person.png` (person on the hero banner).
- Sidebar links: Billing, Settings and Help open the existing AGS DM Insta pages.

## Automation page: Test Automation
Deploy the new `instagram-api` function. "Send Test DM" sends the rule's real message to a person who messaged your account in the last 24 hours (Instagram's rule). Message your account from another Instagram account first, then pick that person on the Automation page.

## Editable automation settings + test to any ID
1. SQL Editor: run `supabase/migrations/20261017000000_automation_settings.sql`.
2. Re-deploy the Edge Functions `instagram-webhook` and `instagram-api` with the new `index.ts` files.
3. Automation page: change Trigger Settings / Safety & Limits / Advanced Options, then press "Save settings" (owners and admins).

## Page layout
- Try AI GPT hub shell (`hub.js`): Dashboard, All Tools, Billing & Plan, Settings, Help & Support.
- AGS DM Insta tool shell (`layout.js`): Dashboard, Connect Instagram, Automation, My Posts, DM Templates, Keywords & Rules, Audience / Leads, Analytics, Inbox, Team Members.

## Plans
Starter $0 (1,000 DMs, 1 account), Growth $4.99 (39,999 DMs, 1 account), Agency $8.99 (unlimited DMs, 3 accounts). Yearly = 25% off. Run `20261018000000_plans_v2_and_billing_history.sql` then `20261019000000_set_final_prices.sql`.

## Admin panel (admindashboard.html)
URL: `https://<your-site>/admindashboard.html` (login page when signed out, dashboard for an authorized admin).

### One-time setup
1. SQL Editor: run `supabase/migrations/20261020000000_admin_panel.sql`.
2. Create the admin login: Supabase > Authentication > Users > **Add user** > your Gmail + a strong password (tick "Auto Confirm User").
   If that Gmail already signed up on the site, use the "Forgot password?" link on the admin login page to set a password.
3. Make that user an admin (SQL Editor, run once, replace the email):
   ```
   insert into public.user_roles (user_id, role) select id, 'admin' from auth.users where email = 'your-gmail@gmail.com';
   ```
   This is the only way to create an admin. Nothing on the website can do it.
4. Deploy the Edge Function `admin-api` (Verify JWT off, the function checks the session and admin role itself) from `supabase/functions/admin-api/index.ts`.
   Payments now use Easebuzz (see the Easebuzz section below).
5. Optional, for "Send Email": add secrets `RESEND_API_KEY` and `MAIL_FROM`.
6. Netlify: deploy the folder. The included `_headers` file stops caching and search indexing of the admin page.
7. Supabase > Authentication > URL Configuration: make sure `https://<your-site>/**` is allowed (used by password reset links, which open `reset-password.html`).

### How plans work
- Paid plans start only after the Easebuzz callback verifies the payment signature.
- "Change plan" in the admin panel creates a complimentary grant (`admin_granted`) with an ID like `grant_ab12...`. It never creates a payment record.
- The user's effective plan = the better of (verified paid plan, active admin grant). Grants expire automatically; revoking a grant restores the paid plan or Starter.
- Banned, suspended, deactivated and deleted users lose access to their workspace data immediately and their automated DMs stop.

### Admin testing checklist
1. Open `/admindashboard.html` signed out: login page appears. Sign in with the admin account: dashboard appears.
2. Sign in on the normal site with a regular user, then open `/admindashboard.html`: you cannot get in (admin login only works for admin accounts).
3. Users > View > Change Plan > Growth, 30 days: user's Billing page shows "Complimentary Growth plan". Subscriptions page lists `grant_...` as Admin-granted. Payments page stays empty.
4. Revoke the grant: user returns to Starter.
5. Ban a user: they cannot sign in; Unban restores. Reset Password sends the email.
6. Delete user (soft) hides the account; "Delete permanently" works only after enabling it in Settings and typing the user's email.
7. Settings > Audit log lists every action with the admin email.

## Payments with Easebuzz (prepaid, INR)
Easebuzz accepts INR only and these plans are prepaid: the user pays for 1 month or 1 year, the plan stays active until that date, and "Renew" extends it. There is no automatic renewal.
1. SQL Editor: run `supabase/migrations/20261021000000_easebuzz.sql`.
2. Set what Easebuzz should charge (INR). Example only, use your own prices:
```
update plans set price_inr = 399, price_yearly_inr = null where id = 'growth';   -- yearly blank = 12 x monthly x 0.75
update plans set price_inr = 749 where id = 'agency';
```
   (You can also set these in the admin panel: Settings > Plan configuration.)
3. Easebuzz dashboard: get your **Merchant Key** and **Salt** (use the TEST ones first).
4. Supabase > Edge Functions > Secrets: `EASEBUZZ_KEY`, `EASEBUZZ_SALT`, `EASEBUZZ_ENV` = `test` (use `prod` for live).
5. Deploy two Edge Functions (Verify JWT off): `easebuzz-checkout` and `easebuzz-callback` (code in `supabase/functions/`). You can delete the old `billing-checkout` and `razorpay-webhook` functions.
6. Easebuzz dashboard > webhook / transaction notification URL: `https://<project-id>.supabase.co/functions/v1/easebuzz-callback`.
7. Netlify: deploy the folder, then Billing & Plan > Upgrade. After paying you return to the Billing page and the plan is active.
8. Go live: Easebuzz KYC/activation, live Key and Salt, `EASEBUZZ_ENV=prod`, live webhook URL.
