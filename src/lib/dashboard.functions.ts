import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TOOL_HREF: Record<string, string> = {
  analyze: "/app/analyze",
  presentations: "/app/presentations",
  agent: "/app/agent",
};

export const getDashboardSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase;
    const userId = context.userId;

    const [
      profile,
      chats,
      projects,
      studies,
      populations,
      chatCount,
      projectCount,
      studyCount,
      populationCount,
      personaCount,
    ] = await Promise.all([
      supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
      supabase.from("chat_conversations").select("id, tool, title, updated_at").order("updated_at", { ascending: false }).limit(6),
      supabase.from("projects").select("id, name, created_at").order("created_at", { ascending: false }).limit(5),
      supabase.from("interview_studies").select("id, title, created_at, status").eq("user_id", userId).order("created_at", { ascending: false }).limit(5),
      supabase.from("populations").select("id, name, created_at, target_size").order("created_at", { ascending: false }).limit(5),
      supabase.from("chat_conversations").select("*", { count: "exact", head: true }),
      supabase.from("projects").select("*", { count: "exact", head: true }),
      supabase.from("interview_studies").select("*", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("populations").select("*", { count: "exact", head: true }),
      supabase.from("personas").select("*", { count: "exact", head: true }).eq("user_id", userId),
    ]);

    type ActivityItem = { kind: string; title: string; at: string; href: string };
    const activity: ActivityItem[] = [
      ...(chats.data ?? []).map((c) => ({
        kind: c.tool === "analyze" ? "Writing" : c.tool === "presentations" ? "Presentations" : "Agent",
        title: c.title || "Untitled chat",
        at: c.updated_at,
        href: TOOL_HREF[c.tool] ?? "/app",
      })),
      ...(projects.data ?? []).map((p) => ({ kind: "Project", title: p.name, at: p.created_at, href: "/app/projects" })),
      ...(studies.data ?? []).map((s) => ({ kind: "Interview study", title: s.title, at: s.created_at, href: "/app/interviews" })),
      ...(populations.data ?? []).map((p) => ({ kind: "Population", title: p.name, at: p.created_at, href: "/app/personas" })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 8);

    return {
      displayName: profile.data?.display_name ?? null,
      counts: {
        chats: chatCount.count ?? 0,
        projects: projectCount.count ?? 0,
        interviewStudies: studyCount.count ?? 0,
        populations: populationCount.count ?? 0,
        personas: personaCount.count ?? 0,
      },
      activity,
    };
  });
