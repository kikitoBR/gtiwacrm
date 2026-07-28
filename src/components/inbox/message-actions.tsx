"use client";

import { useState, type ReactNode } from "react";
import { CornerUpLeft, Copy, SmilePlus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Message } from "@/types";
import { useTranslations } from "next-intl";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

interface MessageActionsProps {
  message: Message;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onDelete?: (messageId: string) => void;
  onEdit?: (messageId: string, newText: string) => void;
  children: ReactNode;
}

function stripSignature(text: string): { cleanText: string; signaturePrefix: string } {
  const match = text.match(/^(\*[^*]+\*\n\n?)/);
  if (match) {
    const signaturePrefix = match[1];
    const cleanText = text.slice(signaturePrefix.length);
    return { cleanText, signaturePrefix };
  }
  return { cleanText: text, signaturePrefix: "" };
}

export function MessageActions({
  message,
  onReply,
  onReact,
  onDelete,
  onEdit,
  children,
}: MessageActionsProps) {
  const t = useTranslations("Inbox.actions");

  const [touchOpen, setTouchOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Edit modal state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editText, setEditText] = useState("");
  const [sigPrefix, setSigPrefix] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete modal state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isAgent =
    message.sender_type === "agent" || message.sender_type === "bot";

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setTouchOpen(true);
  };

  const handleCopy = async () => {
    const text = message.content_text ?? "";
    if (!text) {
      toast.error(t("nothingToCopy"));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
    setTouchOpen(false);
  };

  const handlePickEmoji = (emoji: string) => {
    onReact(emoji);
    setPickerOpen(false);
    setTouchOpen(false);
  };

  const handleReply = () => {
    onReply();
    setTouchOpen(false);
  };

  const handleOpenEdit = () => {
    const { cleanText, signaturePrefix } = stripSignature(message.content_text ?? "");
    setEditText(cleanText);
    setSigPrefix(signaturePrefix);
    setEditDialogOpen(true);
  };

  const handleConfirmEdit = async () => {
    if (!editText.trim() || !onEdit) return;
    setSavingEdit(true);
    try {
      const finalText = sigPrefix ? `${sigPrefix}${editText.trim()}` : editText.trim();
      await onEdit(message.id, finalText);
      setEditDialogOpen(false);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete(message.id);
      setDeleteConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          "flex w-full",
          isAgent ? "justify-end" : "justify-start",
        )}
        onContextMenu={handleContextMenu}
        onBlur={() => setTouchOpen(false)}
      >
        <div className="group/actions relative min-w-0 max-w-[75%]">
          {children}
          <div
            data-touch-open={touchOpen || pickerOpen ? "true" : undefined}
            className={cn(
              "absolute -top-3 z-10 flex h-7 items-center gap-0.5 rounded-full border border-border bg-popover/95 px-1 shadow-md backdrop-blur-sm transition-opacity",
              "opacity-0 group-hover/actions:opacity-100 group-focus-within/actions:opacity-100",
              "data-[touch-open=true]:opacity-100",
              isAgent ? "right-3" : "left-3",
            )}
          >
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger
                className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
                aria-label={t("react")}
              >
                <SmilePlus className="h-3.5 w-3.5" />
              </PopoverTrigger>
              <PopoverContent
                className="flex w-auto flex-row gap-1 p-1.5"
                sideOffset={6}
              >
                {QUICK_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => handlePickEmoji(e)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none transition-transform hover:scale-125 hover:bg-muted"
                    aria-label={t("reactWith", { emoji: e })}
                  >
                    {e}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <button
              type="button"
              onClick={handleReply}
              className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("reply")}
            >
              <CornerUpLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("copyText")}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>

            {onEdit && isAgent && message.content_type === "text" && (
              <button
                type="button"
                onClick={handleOpenEdit}
                className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
                title="Editar mensagem"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}

            {onDelete && (
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(true)}
                className="flex h-5 w-5 items-center justify-center rounded-full text-red-400 hover:bg-red-500/10 hover:text-red-300"
                title="Apagar mensagem"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {onEdit && (
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Editar Mensagem</DialogTitle>
            </DialogHeader>
            <div className="py-2">
              <Input
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                placeholder="Novo texto da mensagem..."
                className="bg-muted text-foreground"
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setEditDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleConfirmEdit}
                disabled={savingEdit || !editText.trim()}
              >
                {savingEdit ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Confirmation Modal */}
      {onDelete && (
        <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Apagar Mensagem</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground py-2">
              Tem certeza de que deseja apagar esta mensagem? Esta ação tentará remover a mensagem para todos.
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteConfirmOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting ? "Apagando..." : "Apagar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
