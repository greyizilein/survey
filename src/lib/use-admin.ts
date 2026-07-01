import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { checkIsAdmin } from "@/lib/admin.functions";

/**
 * Hook to check if the current user is an admin.
 * Delegates entirely to the server function so no client-side email comparison
 * or RLS-bypassed table query is used — the server is the single source of truth.
 */
export function useIsAdmin() {
  return useQuery({
    queryKey: ["isAdmin"],
    queryFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user) return false;
      try {
        return await checkIsAdmin();
      } catch {
        return false;
      }
    },
    staleTime: 1000 * 60 * 5,
  });
}
