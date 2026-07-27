// ============================================================
// GET /api/invitations/[token]/peek
//
// Public — no auth required. Lets the /join/<token> page render
// "You're being invited to <Account> as <Role>" before the
// visitor signs up or signs in.
// ============================================================

import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { hashInviteToken } from "@/lib/auth/invitations";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

function supabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`peek:${ip}`, RATE_LIMITS.invitationPeek);
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  if (!token || typeof token !== "string") {
    return NextResponse.json(
      { ok: false, reason: "not_found" },
      { status: 404 },
    );
  }

  const tokenHash = hashInviteToken(token);

  // 1. Try calling the RPC via user/anon client first
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("peek_invitation", {
      p_token_hash: tokenHash,
    });

    if (!error && data) {
      return NextResponse.json(data);
    }
  } catch {
    /* fallback to service role below */
  }

  // 2. Direct Service Role fallback (bypasses RLS / missing RPC)
  try {
    const admin = supabaseAdmin();
    const { data: inv, error: invErr } = await admin
      .from("account_invitations")
      .select("account_id, role, expires_at, accepted_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (invErr || !inv) {
      return NextResponse.json({ ok: false, reason: "not_found" });
    }

    if (inv.accepted_at) {
      return NextResponse.json({ ok: false, reason: "used" });
    }

    if (new Date(inv.expires_at) <= new Date()) {
      return NextResponse.json({ ok: false, reason: "expired" });
    }

    const { data: acc } = await admin
      .from("accounts")
      .select("name")
      .eq("id", inv.account_id)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      account_name: acc?.name || "Workspace",
      role: inv.role,
      expires_at: inv.expires_at,
    });
  } catch (err) {
    console.error("[peek] fallback query error:", err);
    return NextResponse.json(
      { ok: false, reason: "server_error" },
      { status: 500 },
    );
  }
}
