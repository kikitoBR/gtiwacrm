'use client';

// ============================================================
// /join/[token] — PÁGINA DE RESGATE DE CONVITE (PORTUGUÊS)
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  MailX,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';

interface PeekOk {
  ok: true;
  account_name: string;
  role: 'admin' | 'agent' | 'viewer';
  expires_at: string;
}
interface PeekFail {
  ok: false;
  reason: 'not_found' | 'used' | 'expired' | 'server_error';
}
type PeekResult = PeekOk | PeekFail;

const ROLE_LABEL: Record<PeekOk['role'], string> = {
  admin: 'Administrador',
  agent: 'Agente',
  viewer: 'Visualizador',
};

const FAIL_COPY: Record<PeekFail['reason'], { title: string; body: string }> = {
  not_found: {
    title: 'Convite não encontrado',
    body: 'Este link não corresponde a um convite válido. Verifique a URL ou solicite um novo link ao administrador.',
  },
  used: {
    title: 'Convite já utilizado',
    body: 'Este convite já foi aceito anteriormente. Caso precise de acesso, solicite um novo link ao administrador.',
  },
  expired: {
    title: 'Convite expirado',
    body: 'Este convite já expirou. Peça ao administrador do sistema para gerar um novo link de convite.',
  },
  server_error: {
    title: 'Algo deu errado',
    body: 'Não foi possível verificar este convite no momento. Tente atualizar a página em alguns instantes.',
  },
};

export default function JoinPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [peek, setPeek] = useState<PeekResult | null>(null);
  const [authedUserId, setAuthedUserId] = useState<string | null | undefined>(
    undefined, // undefined = carregando; null = não autenticado
  );
  const [accepting, setAccepting] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const loadPeekAndAuth = useCallback(async () => {
    if (!token) return;
    setPeek(null);
    setAuthedUserId(undefined);
    try {
      const [peekRes, authRes] = await Promise.all([
        fetch(`/api/invitations/${encodeURIComponent(token)}/peek`, {
          cache: 'no-store',
        }),
        createClient().auth.getUser(),
      ]);
      const peekBody = (await peekRes.json()) as PeekResult;
      setPeek(peekBody);
      setAuthedUserId(authRes.data.user?.id ?? null);
    } catch (err) {
      console.error('[join] erro no peek:', err);
      setPeek({ ok: false, reason: 'server_error' });
      setAuthedUserId(null);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const [peekRes, authRes] = await Promise.all([
          fetch(`/api/invitations/${encodeURIComponent(token)}/peek`, {
            cache: 'no-store',
          }),
          createClient().auth.getUser(),
        ]);
        const peekBody = (await peekRes.json()) as PeekResult;
        if (cancelled) return;
        setPeek(peekBody);
        setAuthedUserId(authRes.data.user?.id ?? null);
      } catch (err) {
        console.error('[join] erro no peek:', err);
        if (cancelled) return;
        setPeek({ ok: false, reason: 'server_error' });
        setAuthedUserId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleAccept = useCallback(async () => {
    if (!token) return;
    setAccepting(true);
    try {
      const res = await fetch(
        `/api/invitations/${encodeURIComponent(token)}/redeem`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (res.status === 409) {
          setConflictMessage(
            payload.error ||
              'Você já possui uma conta ativa. Faça login com o e-mail do convite para acessar esta equipe.',
          );
        } else {
          toast.error(payload.error || 'Falha ao aceitar o convite');
        }
        setAccepting(false);
        return;
      }
      toast.success('Bem-vindo à equipe!');
      window.location.href = '/dashboard';
    } catch (err) {
      console.error('[join] erro ao resgatar:', err);
      toast.error('Não foi possível conectar ao servidor');
      setAccepting(false);
    }
  }, [token]);

  const handleSignOutAndRetry = useCallback(async () => {
    setSigningOut(true);
    try {
      await createClient().auth.signOut();
      window.location.reload();
    } catch (err) {
      console.error('[join] erro no logout:', err);
      toast.error('Não foi possível sair da conta. Tente recarregar a página.');
      setSigningOut(false);
    }
  }, []);

  // Preservar parâmetro de email da URL se presente
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const emailParam = searchParams?.get('email');
  const emailQuery = emailParam ? `&email=${encodeURIComponent(emailParam)}` : '';

  // ----- Estado de carregamento -----
  if (peek === null || authedUserId === undefined) {
    return (
      <Card className="w-full max-w-md border-border bg-card">
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Verificando convite…</p>
        </CardContent>
      </Card>
    );
  }

  // ----- Convite inválido / expirado -----
  if (!peek.ok) {
    const copy = FAIL_COPY[peek.reason];
    return (
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10">
            <MailX className="h-6 w-6 text-red-400" />
          </div>
          <CardTitle className="text-xl text-foreground">{copy.title}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {copy.body}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {peek.reason === 'server_error' ? (
            <>
              <Button
                onClick={loadPeekAndAuth}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Tentar novamente
              </Button>
              <Link href={`/signup?invite=${encodeURIComponent(token!)}${emailQuery}`}>
                <Button
                  variant="outline"
                  className="w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Criar conta
                </Button>
              </Link>
            </>
          ) : (
            <>
              <Link href={`/signup?invite=${encodeURIComponent(token!)}${emailQuery}`}>
                <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                  Criar conta
                </Button>
              </Link>
              <Link href={`/login?invite=${encodeURIComponent(token!)}${emailQuery}`}>
                <Button
                  variant="outline"
                  className="w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Entrar
                </Button>
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  // ----- Convite Válido Header -----
  const formattedExpiry = new Date(peek.expires_at).toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const inviteHeader = (
    <CardHeader className="items-center text-center">
      <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <UsersRound className="h-6 w-6 text-primary" />
      </div>
      <CardTitle className="text-xl text-foreground">
        Você foi convidado para{' '}
        <span className="text-primary">{peek.account_name}</span>
      </CardTitle>
      <CardDescription className="text-muted-foreground">
        Você entrará como{' '}
        <span className="inline-flex items-center gap-1 text-foreground font-medium">
          <ShieldCheck className="size-3.5 text-primary" />
          {ROLE_LABEL[peek.role]}
        </span>
        . Link válido até {formattedExpiry}.
      </CardDescription>
    </CardHeader>
  );

  // ----- Autenticado: Exibe botão Aceitar -----
  if (authedUserId) {
    return (
      <>
        <Card className="w-full max-w-md border-border bg-card shadow-xl">
          {inviteHeader}
          <CardContent className="flex flex-col gap-3">
            <Button
              onClick={handleAccept}
              disabled={accepting}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm"
            >
              {accepting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Aceitando convite…
                </>
              ) : (
                <>
                  <CheckCircle className="size-4" />
                  Aceitar convite
                </>
              )}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Ao aceitar, seu login será vinculado a{' '}
              <span className="text-foreground font-medium">{peek.account_name}</span>.
            </p>
          </CardContent>
        </Card>

        <Dialog
          open={conflictMessage !== null}
          onOpenChange={(open) => {
            if (!open) setConflictMessage(null);
          }}
        >
          <DialogContent className="bg-popover border-border sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-popover-foreground">
                <AlertTriangle className="size-4 text-amber-400" />
                Não é possível entrar em {peek.account_name} com esta conta
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {conflictMessage}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2 text-xs text-muted-foreground">
              <p>
                Para se juntar a{' '}
                <span className="text-popover-foreground">{peek.account_name}</span>,
                saia da conta atual e faça cadastro novamente com o e-mail do convite.
              </p>
            </div>
            <DialogFooter className="bg-popover border-border">
              <Button
                variant="outline"
                onClick={() => setConflictMessage(null)}
                className="border-border text-popover-foreground hover:bg-muted"
              >
                Permanecer conectado
              </Button>
              <Button
                onClick={handleSignOutAndRetry}
                disabled={signingOut}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {signingOut ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saindo…
                  </>
                ) : (
                  'Sair e usar outro e-mail'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // ----- Não Autenticado: Oferecer Criar Conta ou Entrar -----
  return (
    <Card className="w-full max-w-md border-border bg-card shadow-xl">
      {inviteHeader}
      <CardContent className="flex flex-col gap-2">
        <Link href={`/signup?invite=${encodeURIComponent(token!)}${emailQuery}`}>
          <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
            Criar conta e aceitar convite
          </Button>
        </Link>
        <Link href={`/login?invite=${encodeURIComponent(token!)}${emailQuery}`}>
          <Button
            variant="outline"
            className="w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Já tenho uma conta
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
