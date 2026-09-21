import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, verifyToken } from "../_shared/auth.ts";
import { parsePnlWorkbook } from "../_shared/parse-pnl.ts";

interface UploadBody {
  token?: string;
  year?: string; // "25" | "26"
  filename?: string;
  fileBase64?: string;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = Deno.env.get("SESSION_SECRET");
  if (!secret) return jsonResponse({ error: "서버 설정 오류" }, 500);

  let body: UploadBody;
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
  if (!body.fileBase64) {
    return jsonResponse({ error: "파일이 없습니다" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let parsed;
  try {
    const bytes = base64ToBytes(body.fileBase64);
    parsed = parsePnlWorkbook(bytes);
  } catch (e) {
    await supabase.from("upload_log").insert({
      year: body.year,
      filename: body.filename ?? null,
      row_count: 0,
      status: "error",
      message: String(e instanceof Error ? e.message : e),
    });
    return jsonResponse({ error: "파일 파싱 실패: " + (e instanceof Error ? e.message : String(e)) }, 422);
  }

  if (parsed.detectedYear && parsed.detectedYear !== body.year) {
    const msg =
      `업로드하신 연도(${body.year}년)와 파일 내용에서 감지된 연도(${parsed.detectedYear}년)가 다릅니다. ` +
      `잘못된 파일을 올리신 건 아닌지 확인해주세요.`;
    await supabase.from("upload_log").insert({
      year: body.year,
      filename: body.filename ?? null,
      row_count: 0,
      status: "error",
      message: msg,
    });
    return jsonResponse({ error: msg }, 422);
  }

  const lineItemsPayload = parsed.lineItems.flatMap((item) =>
    Object.entries(item.months).map(([monthStr, amount]) => {
      const month = Number(monthStr);
      return {
        month,
        category_major: item.category_major,
        category_mid: item.category_mid,
        category_sub: item.category_sub,
        counterparty: item.counterparty,
        detail: item.detail,
        amount,
        ratio_pct: item.ratios?.[month] ?? null,
        is_actual: month <= parsed.cutoffMonth,
        is_subtotal: item.is_subtotal,
      };
    })
  );

  const summaryPayload = parsed.summaryMetrics.flatMap((m) =>
    Object.entries(m.months).map(([monthStr, value]) => ({
      month: Number(monthStr),
      metric_key: m.label,
      value,
    }))
  );

  const { error } = await supabase.rpc("replace_pnl_year", {
    p_year: body.year,
    p_line_items: lineItemsPayload,
    p_summary_metrics: summaryPayload,
    p_filename: body.filename ?? null,
    p_row_count: lineItemsPayload.length,
  });

  if (error) {
    await supabase.from("upload_log").insert({
      year: body.year,
      filename: body.filename ?? null,
      row_count: 0,
      status: "error",
      message: error.message,
    });
    return jsonResponse({ error: "저장 실패: " + error.message }, 500);
  }

  return jsonResponse({
    ok: true,
    year: body.year,
    cutoffMonth: parsed.cutoffMonth,
    lineItemCount: parsed.lineItems.length,
    summaryMetricCount: parsed.summaryMetrics.length,
  });
});
