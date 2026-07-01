import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// The admin email is set via VITE_ADMIN_EMAIL env var for client-side fallback
const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL as string | undefined;

/**
 * Hook to check if the current user is an admin.
 * Falls back to VITE_ADMIN_EMAIL env var check if the admin_users table doesn't exist yet.
 */
export function useIsAdmin() {
  return useQuery({
    queryKey: ["isAdmin"],
    queryFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      const user = session?.session?.user;
      if (!user) return false;

      // Fallback: check by email against VITE_ADMIN_EMAIL env var
      if (ADMIN_EMAIL && user.email === ADMIN_EMAIL) return true;

      // Primary: check admin_users table (may not exist before migration is run)
      const { data, error } = await supabase
        .from("admin_users")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      return !error && !!data;
    },
    staleTime: 1000 * 60 * 5,
  });
}
