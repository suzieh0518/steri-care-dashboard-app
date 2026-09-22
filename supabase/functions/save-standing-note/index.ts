import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, verifyToken } from "../_shared/auth.ts";

// 종합의견(월별)과 달리, 여기 저장되는 노트는 기준월과 무관하게 하나만 유지된다 (예:
// "향후 도입 안건" 등 계속 누적/수정되는 메모). key로 여러 개의 독립된 상시 메모를 둘 수
// 있게 만들어서, 나중에 비슷한 박스가 더 필요해져도 테이블을 새로 만들 필요가 없다.
interface SaveStandingNoteBody {
  token?: string;
  key?: string;
  content?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = Deno.env.get("SESSION_SECRET");
  if (!secret) return jsonResponse({ error: "서버 설정 오류" }, 500);

  let body: SaveStandingNoteBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "잘못된 요청 본문" }, 400);
  }

  const ok = await verifyToken(secret, body.token ?? null);
  if (!ok) return jsonResponse({ error: "인증이 필요합니다" }, 401);

  if (!body.key || typeof body.key !== "string") {
    return jsonResponse({ error: "key가 필요합니다" }, 400);
  }
  if (typeof body.content !== "string") {
    return jsonResponse({ error: "content가 필요합니다" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error } = await supabase
    .from("standing_notes")
    .upsert(
      { key: body.key, content: body.content, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

  if (error) return jsonResponse({ error: error.message }, 500);

  return jsonResponse({ ok: true });
});
