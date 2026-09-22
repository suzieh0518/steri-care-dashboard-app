import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, verifyToken } from "../_shared/auth.ts";

interface SaveCommentBody {
  token?: string;
  year?: string; // "25" | "26"
  month?: number; // 1-12
  comment?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = Deno.env.get("SESSION_SECRET");
  if (!secret) return jsonResponse({ error: "서버 설정 오류" }, 500);

  let body: SaveCommentBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "잘못된 요청 본문" }, 400);
  }

  const ok = await verifyToken(secret, body.token ?? null);
  if (!ok) return jsonResponse({ error: "인증이 필요합니다" }, 401);

  if (!body.year || !["25", "26"].includes(body.year)) {
    return jsonResponse({ error: "year는 '25' 또는 '26'이어야 합니다" }, 400);
  }
  if (!body.month || body.month < 1 || body.month > 12) {
    return jsonResponse({ error: "month는 1~12여야 합니다" }, 400);
  }
  if (typeof body.comment !== "string") {
    return jsonResponse({ error: "comment가 필요합니다" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error } = await supabase
    .from("monthly_comments")
    .upsert(
      { year: body.year, month: body.month, comment: body.comment, updated_at: new Date().toISOString() },
      { onConflict: "year,month" },
    );

  if (error) return jsonResponse({ error: error.message }, 500);

  return jsonResponse({ ok: true });
});
