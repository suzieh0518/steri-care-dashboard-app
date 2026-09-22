import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, verifyToken } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = Deno.env.get("SESSION_SECRET");
  if (!secret) return jsonResponse({ error: "서버 설정 오류" }, 500);

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "잘못된 요청 본문" }, 400);
  }

  const ok = await verifyToken(secret, body.token ?? null);
  if (!ok) return jsonResponse({ error: "인증이 필요합니다" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // PostgREST caps rows per request (project db-max-rows, commonly 1000) regardless of
  // .range() -- paginate past it rather than relying on a single request.
  async function fetchAll(table: string) {
    const pageSize = 1000;
    let offset = 0;
    const all: Record<string, unknown>[] = [];
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .order("year")
        .order("month")
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      all.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
      offset += pageSize;
    }
    return all;
  }

  try {
    const [lineItems, summaryMetrics, logRes, commentsRes, standingNotesRes] = await Promise.all([
      fetchAll("pnl_line_items"),
      fetchAll("pnl_summary_metrics"),
      supabase.from("upload_log").select("*").order("uploaded_at", { ascending: false }).limit(20),
      supabase.from("monthly_comments").select("*").order("year").order("month"),
      supabase.from("standing_notes").select("*"),
    ]);
    return jsonResponse({
      lineItems,
      summaryMetrics,
      uploadLog: logRes.data ?? [],
      comments: commentsRes.data ?? [],
      standingNotes: standingNotesRes.data ?? [],
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
