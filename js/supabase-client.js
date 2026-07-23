/* ==========================================================================
   supabase-client.js
   ------------------------------------------------------------------------
   This is the ONLY file where you paste your Supabase project's URL and
   "anon" public key. Both come from: Supabase Dashboard → Project Settings
   → API.

   Is it safe to have the anon key visible in plain JavaScript?
   Yes — the anon key is *designed* to be public. It identifies your
   project, it does not grant access by itself. What actually protects
   your data is Row Level Security (RLS), configured in sql/schema.sql:
     - anyone (anon key) can INSERT into `orders` and `order_items`
       (that's how the public checkout form saves a new order)
     - only a logged-in admin (Supabase Auth session) can SELECT/UPDATE
       rows in those tables — which is what the /admin panel needs.
   Never put your Supabase "service_role" key in this file or in any
   file that ships to the browser — that key bypasses RLS entirely and
   must stay on a server (this project doesn't use one, on purpose).
   ========================================================================== */

const SUPABASE_URL = 'COLE_AQUI_A_URL_DO_SEU_PROJETO_SUPABASE';
const SUPABASE_ANON_KEY = 'COLE_AQUI_A_ANON_KEY_DO_SEU_PROJETO_SUPABASE';

// `supabase` here is the global provided by the CDN script tag loaded
// before this file. We create our own client and store it as `sb` so it
// never collides with that global.
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
