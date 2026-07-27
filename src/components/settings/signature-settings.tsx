"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, UserCheck, MessageSquare, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export function SignatureSettings() {
  const { user, profile, refreshProfile } = useAuth();
  const supabase = createClient();

  const [enabled, setEnabled] = useState<boolean>(false);
  const [signatureText, setSignatureText] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setEnabled(profile.signature_enabled ?? false);
      setSignatureText(profile.signature_text ?? profile.full_name ?? "");
    }
  }, [profile]);

  const displaySig = signatureText.trim() || profile?.full_name || "Atendente";
  const formattedSig = displaySig.startsWith("*") && displaySig.endsWith("*")
    ? displaySig
    : `*${displaySig}*`;

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          signature_enabled: enabled,
          signature_text: signatureText.trim(),
        })
        .eq("user_id", user.id);

      if (error) {
        console.warn("Profiles signature update note:", error.message);
      }

      await refreshProfile();
      toast.success("Configuração de assinatura salva com sucesso!");
    } catch {
      toast.error("Erro ao salvar configuração de assinatura.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <UserCheck className="h-5 w-5 text-primary" />
          Identificação do Atendente / Assinatura
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Adicione automaticamente seu nome no topo das mensagens enviadas pelo WhatsApp para que o cliente saiba quem está atendendo.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-6">
        {/* Toggle */}
        <div className="flex items-center justify-between gap-4 border-b border-border/50 pb-5">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium text-foreground">
              Ativar identificação automática
            </Label>
            <p className="text-xs text-muted-foreground">
              Insere seu nome em negrito antes do texto de cada mensagem enviada no WhatsApp.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled(!enabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              enabled ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Input */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">
            Nome de Exibição / Assinatura
          </Label>
          <Input
            value={signatureText}
            onChange={(e) => setSignatureText(e.target.value)}
            placeholder="Ex: Marcos Alexandre"
            className="max-w-md border-border bg-muted text-foreground"
          />
          <p className="text-xs text-muted-foreground">
            O nome será exibido em negrito no topo da mensagem.
          </p>
        </div>

        {/* Live Preview Box */}
        <div className="space-y-2 pt-2">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5 text-primary" />
            Pré-visualização da mensagem no WhatsApp
          </Label>
          <div className="max-w-md rounded-xl border border-border bg-muted/60 p-4">
            <div className="max-w-[85%] rounded-2xl rounded-tr-xs bg-primary/20 border border-primary/30 p-3 text-sm text-foreground space-y-2 shadow-sm">
              {enabled ? (
                <>
                  <p className="font-bold text-primary">{formattedSig}</p>
                  <p className="whitespace-pre-wrap leading-relaxed">
                    Olá! Tudo bem? Como posso te ajudar hoje?
                  </p>
                </>
              ) : (
                <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                  Olá! Tudo bem? Como posso te ajudar hoje? (Sem identificação)
                </p>
              )}
              <div className="flex justify-end text-[10px] text-muted-foreground gap-1 items-center pt-1">
                <span>14:32</span>
                <CheckCircle2 className="h-3 w-3 text-primary" />
              </div>
            </div>
          </div>
        </div>

        {/* Save CTA */}
        <div className="pt-4 border-t border-border/50">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar Assinatura
          </Button>
        </div>
      </div>
    </div>
  );
}
