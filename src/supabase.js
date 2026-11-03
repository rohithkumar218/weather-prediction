const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

if (Boolean(supabaseUrl) !== Boolean(supabaseKey)) {
  console.error('Supabase setup is incomplete. Set both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

let clientPromise;

export function getSupabaseClient() {
  if (!isSupabaseConfigured) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) => createClient(
      supabaseUrl,
      supabaseKey,
      {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          persistSession: true,
        },
      },
    ));
  }
  return clientPromise;
}
