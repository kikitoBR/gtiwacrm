// ============================================================
// POST /api/invitations/[token]/redeem
//
// Authenticated. Caller atomically moves from their personal
// account (created at signup) to the inviter's account with the
// invite's role.
// ============================================================

import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type PostgrestError } from "@supabase/supabase-js";

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

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err.code === "23505") {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  console.error("[redeem] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to redeem invitation" },
    { status: 500 },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`redeem:${ip}`, RATE_LIMITS.invitationRedeem);
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  if (!token || typeof token !== "string") {
    return NextResponse.json(
      { error: "Missing invitation token" },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tokenHash = hashInviteToken(token);

  // 1. Try RPC first
  const { data: accountId, error } = await supabase.rpc("redeem_invitation", {
    p_token_hash: tokenHash,
  });

  if (!error && accountId) {
    return NextResponse.json({ ok: true, accountId });
  }

  if (error && ["42501", "22023", "23505"].includes(error.code)) {
    return rpcErrorToResponse(error);
  }

  // 2. Direct Service Role fallback (bypasses RLS / missing RPC)
  try {
    const admin = supabaseAdmin();
    const { data: inv } = await admin
      .from("account_invitations")
      .select("account_id, role, expires_at, accepted_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!inv) {
      return NextResponse.json({ error: "Convite não encontrado" }, { status: 400 });
    }
    if (inv.accepted_at) {
      return NextResponse.json({ error: "Este convite já foi utilizado" }, { status: 400 });
    }
    if (new Date(inv.expires_at) <= new Date()) {
      return NextResponse.json({ error: "Este convite expirou" }, { status: 400 });
    }

    // Update user's profile to join inviter's account and set role
    const { error: updateProfErr } = await admin
      .from("profiles")
      .update({
        account_id: inv.account_id,
        role: inv.role,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    if (updateProfErr) {
      console.error("[redeem] profile update error:", updateProfErr);
      return NextResponse.json({ error: "Falha ao atualizar perfil do usuário" }, { status: 500 });
    }

    // Mark invitation accepted
    await admin
      .from("account_invitations")
      .update({ accepted_at: new Date().toISOString() })
      .eq("token_hash", tokenHash);

    return NextResponse.json({ ok: true, accountId: inv.account_id });
  } catch (fallbackErr) {
    console.error("[redeem] fallback error:", fallbackErr);
    return NextResponse.json({ error: "Failed to redeem invitation" }, { status: 500 });
  }
}
