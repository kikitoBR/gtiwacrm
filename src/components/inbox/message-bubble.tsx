"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { Contact, Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
  Sparkles,
  Ban,
  ZoomIn,
  Download,
  ExternalLink,
  X,
  Maximize2,
} from "lucide-react";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";
import { InteractivePreview } from "@/components/interactive/interactive-preview";
import { useTranslations } from "next-intl";
import { parseGroupMessage, getParticipantColor } from "@/lib/whatsapp/group-utils";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
  isGroup?: boolean;
  participantContact?: Contact | null;
  onSelectParticipant?: (participant: Contact | string) => void;
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-muted-foreground" />;
    case "sent":
      return <Check className="h-3 w-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

function MediaUnavailable({ label, t }: { label: string, t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{t("unavailable", { label })}</span>
    </div>
  );
}

function MediaImage({ url, alt, caption }: { url: string; alt: string; caption?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);

  const loadImage = useCallback(async () => {
    if (!url) return;

    // Proxy URLs need auth fetch to create blob URL
    if (url.startsWith("/api/whatsapp/media/")) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setSrc(blobUrl);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    loadImage();
    return () => {
      if (src?.startsWith("blob:")) {
        URL.revokeObjectURL(src);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadImage]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  if (error) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <ImageOff className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const mediaSrc = src ?? "";

  return (
    <>
      <div
        className="group relative cursor-pointer overflow-hidden rounded-lg"
        onClick={() => setIsOpen(true)}
      >
        <img
          src={mediaSrc}
          alt={alt}
          className="max-h-64 max-w-60 rounded-lg object-cover transition-transform duration-200 group-hover:scale-105"
          onError={() => setError(true)}
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <div className="flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1.5 text-xs font-medium text-white shadow-xl backdrop-blur-sm">
            <ZoomIn className="h-3.5 w-3.5" />
            <span>Ampliar</span>
          </div>
        </div>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md transition-all duration-200 animate-in fade-in"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="relative flex max-h-[90vh] max-w-[90vw] flex-col items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Toolbar */}
            <div className="absolute -top-12 right-0 flex items-center gap-2">
              <a
                href={mediaSrc}
                download="imagem-whatsapp.jpg"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                title="Baixar imagem"
              >
                <Download className="h-4 w-4" />
              </a>
              <a
                href={mediaSrc}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                title="Abrir em nova aba"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                title="Fechar (Esc)"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Image */}
            <img
              src={mediaSrc}
              alt={alt}
              className="max-h-[80vh] max-w-[85vw] rounded-lg object-contain shadow-2xl"
            />

            {/* Caption */}
            {caption && (
              <p className="mt-3 max-w-xl text-center text-sm font-medium text-white/90">
                {caption}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function MediaVideo({ url, caption }: { url: string; caption?: string }) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return (
    <>
      <div className="group relative max-w-60 overflow-hidden rounded-lg">
        <video
          src={url}
          controls
          className="max-h-64 max-w-60 rounded-lg"
        />
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="absolute top-2 right-2 flex items-center gap-1.5 rounded-full bg-black/75 px-2.5 py-1 text-[11px] font-medium text-white opacity-90 transition-opacity hover:opacity-100 backdrop-blur-sm shadow-md"
          title="Expandir vídeo"
        >
          <Maximize2 className="h-3 w-3" />
          <span>Expandir</span>
        </button>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md transition-all duration-200 animate-in fade-in"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="relative flex max-h-[90vh] max-w-[90vw] flex-col items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Toolbar */}
            <div className="absolute -top-12 right-0 flex items-center gap-2">
              <a
                href={url}
                download="video-whatsapp.mp4"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                title="Baixar vídeo"
              >
                <Download className="h-4 w-4" />
              </a>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                title="Abrir em nova aba"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                title="Fechar (Esc)"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Video Player */}
            <video
              src={url}
              controls
              autoPlay
              className="max-h-[80vh] max-w-[85vw] rounded-lg shadow-2xl"
            />

            {/* Caption */}
            {caption && (
              <p className="mt-3 max-w-xl text-center text-sm font-medium text-white/90">
                {caption}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function MessageContent({ message, t }: { message: Message, t: ReturnType<typeof useTranslations> }) {
  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text}
        </p>
      );

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImage
              url={message.media_url}
              alt="Shared image"
              caption={message.content_text}
            />
          ) : (
            <MediaUnavailable label={t("photo")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <MediaVideo
              url={message.media_url}
              caption={message.content_text}
            />
          ) : (
            <MediaUnavailable label={t("video")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <audio src={message.media_url} controls className="max-w-60" />
          ) : (
            <MediaUnavailable label={t("audio")} t={t} />
          )}
        </div>
      );

    case "document":
      if (!message.media_url) {
        return <MediaUnavailable label={message.content_text || t("document")} t={t} />;
      }
      return (
        <a
          href={message.media_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-muted"
        >
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {message.content_text || t("document")}
          </span>
        </a>
      );

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <LayoutTemplate className="h-3 w-3" />
            {t("template")}
          </span>
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || t("locationShared")}</span>
        </div>
      );

    case "interactive": {
      // Three cases share content_type='interactive':
      //  - OUTBOUND with payload (composer / automation / Flow send after
      //    migration 035): render the buttons/list as they appear on the phone.
      //  - INBOUND tap (customer chose an option, sender_type='customer'):
      //    no payload; show the tapped option's title with a reply affordance
      //    so agents can tell it's a tap, not the customer typing.
      //  - OUTBOUND with NO payload (legacy bot/Flow sends from before
      //    migration 035 backfilled the column): show the body text plainly —
      //    it is our own message, NOT a customer tap.
      if (message.interactive_payload) {
        return <InteractivePreview payload={message.interactive_payload} />;
      }
      if (message.sender_type === "customer") {
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <CornerDownLeft className="h-3 w-3" />
              {t("buttonReply")}
            </span>
            <p className="whitespace-pre-wrap break-words text-sm">
              {message.content_text || t("interactiveReply")}
            </p>
          </div>
        );
      }
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("interactiveReply")}
        </p>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("unsupported")}
        </p>
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
  isGroup = false,
  participantContact,
  onSelectParticipant,
}: MessageBubbleProps) {
  const t = useTranslations("Inbox.bubble");

  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const time = format(new Date(message.created_at), "HH:mm");

  const parsed = isGroup && !isAgent
    ? parseGroupMessage(message.content_text)
    : { participantName: null, participantPhone: null, cleanText: message.content_text || "" };

  const participantName = parsed.participantName;
  const participantPhone = parsed.participantPhone;
  const displayMessage: Message = {
    ...message,
    content_text: parsed.cleanText,
  };
  const participantColor = participantName ? getParticipantColor(participantName) : null;

  const initialAvatarUrl = participantContact?.avatar_url || null;
  const [fetchedAvatarUrl, setFetchedAvatarUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const avatarUrl = initialAvatarUrl || fetchedAvatarUrl;

  useEffect(() => {
    const phoneToQuery = participantContact?.phone || participantPhone || participantName;
    if (!initialAvatarUrl && phoneToQuery) {
      if (phoneToQuery.replace(/\D/g, "").length >= 8) {
        let cancelled = false;
        fetch(`/api/whatsapp/contact-avatar?phone=${encodeURIComponent(phoneToQuery)}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (!cancelled && data?.avatar_url) setFetchedAvatarUrl(data.avatar_url);
          })
          .catch(() => {});
        return () => {
          cancelled = true;
        };
      }
    }
  }, [initialAvatarUrl, participantContact?.phone, participantPhone, participantName]);

  const handleParticipantClick = () => {
    if (onSelectParticipant) {
      onSelectParticipant(participantContact || participantName || "");
    }
  };

  const isDeleted = message.status === "deleted" || message.content_text?.startsWith("🚫");
  const isEdited = message.is_edited || message.status === "edited";

  return (
    <div
      className={cn(
        "flex items-end gap-2",
        isAgent ? "justify-end" : "justify-start",
      )}
    >
      {isGroup && !isAgent && (
        <div
          className="flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm mb-1 transition-transform hover:scale-105 select-none overflow-hidden"
          style={{ backgroundColor: participantColor || "#0284c7" }}
          onClick={handleParticipantClick}
          title={participantName ? `Ver dados de ${participantName}` : "Ver dados do contato"}
        >
          {avatarUrl && !avatarError ? (
            <img
              src={avatarUrl}
              alt={participantName || "Avatar"}
              className="h-7 w-7 rounded-full object-cover"
              onError={() => setAvatarError(true)}
            />
          ) : (
            (participantName || "?").charAt(0).toUpperCase()
          )}
        </div>
      )}
      <div
        className={cn(
          "flex flex-col min-w-0",
          isAgent ? "items-end" : "items-start",
        )}
      >
        <div
          className={cn(
            "relative rounded-2xl px-3 py-2 min-w-0 max-w-full",
            isDeleted
              ? "rounded-2xl bg-muted/40 text-muted-foreground border border-muted-foreground/20 italic"
              : isAgent
              ? "rounded-br-md bg-primary text-primary-foreground"
              : "rounded-bl-md bg-muted text-foreground",
          )}
        >
          {isGroup && !isAgent && participantName && !isDeleted && (
            <div
              className="mb-1 text-xs font-semibold cursor-pointer hover:underline select-none"
              style={{ color: participantColor || "#0284c7" }}
              onClick={handleParticipantClick}
            >
              ~ {participantName}
            </div>
          )}
          {reply && !isDeleted && (
            <ReplyQuote
              authorLabel={reply.authorLabel}
              preview={reply.preview}
              onPrimary={isAgent}
            />
          )}
          {isDeleted ? (
            <div className="flex items-center gap-1.5 py-0.5 text-xs italic opacity-85 select-none">
              <Ban className="h-3.5 w-3.5 shrink-0 opacity-75" />
              <span>
                {isAgent ? "Você apagou esta mensagem" : "Esta mensagem foi apagada"}
              </span>
            </div>
          ) : (
            <MessageContent message={displayMessage} t={t} />
          )}
          <div
            className={cn(
              "mt-1 flex items-center gap-1",
              isAgent ? "justify-end" : "justify-start",
            )}
          >
            {/* AI badge */}
            {message.ai_generated && !isDeleted && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full bg-primary-foreground/20 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-primary-foreground"
                title={t("aiBadgeTitle")}
              >
                <Sparkles className="h-2.5 w-2.5" />
                {t("aiBadge")}
              </span>
            )}
            <span
              className={cn(
                "text-[10px]",
                isAgent && !isDeleted ? "text-primary-foreground/70" : "text-muted-foreground",
              )}
            >
              {time}
              {isEdited && !isDeleted && (
                <span className="ml-1 font-normal opacity-85">• Editada</span>
              )}
            </span>
            {isAgent && !isDeleted && <StatusIcon status={message.status} />}
          </div>
        </div>
        {reactions && reactions.length > 0 && onToggleReaction && !isDeleted && (
          <MessageReactions
            reactions={reactions}
            currentUserId={currentUserId}
            onToggle={onToggleReaction}
          />
        )}
      </div>
    </div>
  );
}
