import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Server-only client using the service role key, which bypasses RLS.
// Auth is handled by Clerk in the server actions, so never import this
// from client components.
export const createClient = () => {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
};
