import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook to check if the current user is an admin.
 * Returns null while loading, false if not admin, true if admin.
 */
export function useIsAdmin() {
  return useQuery({
    queryKey: ["isAdmin"],
    queryFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user?.id) return false;

      const { data, error } = await supabase
        .from("admin_users")
        .select("id")
        .eq("user_id", session.session.user.id)
        .maybeSingle();

      return !error && !!data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
