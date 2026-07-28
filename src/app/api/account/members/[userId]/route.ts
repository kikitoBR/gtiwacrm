// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role.   Admin+.
//   DELETE — remove a member.          Admin+.
// ============================================================

import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type PostgrestError } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isAccountRole } from "@/lib/auth/roles";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

function supabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[members route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Falha ao remover membro" },
    { status: 500 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRole:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown }
      | null;
    const role = body?.role;

    if (!isAccountRole(role)) {
      return NextResponse.json(
        { error: "'role' deve ser um de: owner, admin, agent, viewer" },
        { status: 400 },
      );
    }

    if (role === "owner") {
      return NextResponse.json(
        {
          error:
            "Use POST /api/account/transfer-ownership para promover um membro a proprietário",
        },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase.rpc("set_member_role", {
      p_user_id: userId,
      p_new_role: role,
    });

    if (error) {
      try {
        const admin = supabaseAdmin();
        const { error: updateErr } = await admin
          .from("profiles")
          .update({
            account_role: role,
            role,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId)
          .eq("account_id", ctx.accountId);

        if (updateErr) return rpcErrorToResponse(error);
      } catch {
        return rpcErrorToResponse(error);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    if (userId === ctx.userId) {
      return NextResponse.json(
        { error: "Não é possível remover a si próprio da conta." },
        { status: 400 },
      );
    }

    // 1. Attempt RPC call first
    const { data, error } = await ctx.supabase.rpc("remove_account_member", {
      p_user_id: userId,
    });

    if (!error) {
      return NextResponse.json({ ok: true, newPersonalAccountId: data });
    }

    // 2. Fallback: Use service role admin client if RPC fails
    const admin = supabaseAdmin();

    const { data: targetProfile, error: profileErr } = await admin
      .from("profiles")
      .select("id, user_id, account_id, account_role, full_name, email")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileErr || !targetProfile) {
      return NextResponse.json(
        { error: "Membro não encontrado." },
        { status: 404 },
      );
    }

    if (targetProfile.account_id !== ctx.accountId) {
      return NextResponse.json(
        { error: "Este usuário não pertence a esta conta." },
        { status: 403 },
      );
    }

    if (targetProfile.account_role === "owner") {
      return NextResponse.json(
        { error: "Não é possível remover o proprietário da conta." },
        { status: 400 },
      );
    }

    // Create fresh personal account for removed member
    const accountName =
      targetProfile.full_name?.trim() ||
      targetProfile.email?.trim() ||
      "Minha Conta";

    const { data: newAccount, error: accErr } = await admin
      .from("accounts")
      .insert({
        name: accountName,
        owner_user_id: userId,
      })
      .select("id")
      .single();

    if (accErr || !newAccount) {
      console.error("[DELETE member fallback] Failed to create new personal account:", accErr);
      return rpcErrorToResponse(error);
    }

    // Relocate member's profile to their new personal account
    const { error: updateErr } = await admin
      .from("profiles")
      .update({
        account_id: newAccount.id,
        role: "owner",
        account_role: "owner",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (updateErr) {
      console.error("[DELETE member fallback] Failed to update target profile:", updateErr);
      return rpcErrorToResponse(error);
    }

    return NextResponse.json({ ok: true, newPersonalAccountId: newAccount.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
