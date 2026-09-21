import { corsHeaders, jsonResponse, signToken } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const teamPin = Deno.env.get("TEAM_PIN");
  const secret = Deno.env.get("SESSION_SECRET");
  if (!teamPin || !secret) {
    return jsonResponse({ error: "서버 설정 오류 (TEAM_PIN/SESSION_SECRET 미설정)" }, 500);
  }

  let body: { pin?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "잘못된 요청 본문" }, 400);
  }

  if (!body.pin || body.pin !== teamPin) {
    return jsonResponse({ error: "비밀번호가 올바르지 않습니다" }, 401);
  }

  const token = await signToken(secret, 60 * 60 * 24);
  return jsonResponse({ token });
});
