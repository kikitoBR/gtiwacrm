"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Contact, ContactNote, Tag } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Users,
  Tag as TagIcon,
  StickyNote,
  Plus,
  Search,
  Image as ImageIcon,
  Link as LinkIcon,
  FileText,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { useTranslations } from "next-intl";

interface GroupData {
  subject: string | null;
  description: string | null;
  pictureUrl: string | null;
  owner: string | null;
  totalParticipantsCount?: number;
  participants: { phone: string | null; name: string; avatar_url: string | null; admin?: string | null }[];
  media: { id: string; content_type: string; media_url: string; created_at: string }[];
  links: { id: string; url: string; created_at: string }[];
  docs: { id: string; media_url: string; created_at: string }[];
}

interface ContactSidebarProps {
  contact: Contact | null;
  conversationId?: string;
  onNavigateToContact?: (phone: string) => void;
}

export function ContactSidebar({ contact, conversationId, onNavigateToContact }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  // Avatar error fallback states
  const [headerAvatarError, setHeaderAvatarError] = useState(false);
  const [failedMemberAvatars, setFailedMemberAvatars] = useState<Record<string, boolean>>({});

  // Group state
  const [groupData, setGroupData] = useState<GroupData | null>(null);
  const [loadingGroup, setLoadingGroup] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [activeMediaTab, setActiveMediaTab] = useState<"media" | "links" | "docs">("media");
  const [showFullDesc, setShowFullDesc] = useState(false);

  // Ref to track the current active contact ID to eliminate race conditions on fast switches
  const activeContactIdRef = useRef<string | null>(contact?.id || null);

  const isGroup = Boolean(contact?.is_group || contact?.phone?.includes("@g.us"));

  useEffect(() => {
    const targetContactId = contact?.id || null;
    activeContactIdRef.current = targetContactId;

    // Synchronously reset state on contact switch to avoid lag or showing old contact data
    setHeaderAvatarError(false);
    setFailedMemberAvatars({});
    setNotes([]);
    setTags([]);
    setGroupData(null);
    setMemberSearch("");
    setShowFullDesc(false);

    if (!contact || !targetContactId) return;

    const supabase = createClient();

    // Fetch notes and tags
    Promise.all([
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", targetContactId)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", targetContactId),
    ]).then(([notesRes, tagsRes]) => {
      if (activeContactIdRef.current !== targetContactId) return; // Discard stale response
      if (notesRes.data) setNotes(notesRes.data);
      if (tagsRes.data) {
        const mapped = tagsRes.data
          .filter((ct: Record<string, unknown>) => ct.tags)
          .map((ct: Record<string, unknown>) => ({
            ...(ct.tags as Tag),
            contact_tag_id: ct.id as string,
          }));
        setTags(mapped);
      }
    });

    // Fetch group details if group
    if (isGroup) {
      setLoadingGroup(true);
      const queryParams = new URLSearchParams();
      const rawPhone = contact.phone || "";
      const groupJid = rawPhone.includes("@g.us")
        ? rawPhone
        : `${rawPhone.split("@")[0]}@g.us`;

      queryParams.set("groupJid", groupJid);
      if (conversationId) queryParams.set("conversationId", conversationId);

      fetch(`/api/whatsapp/group-info?${queryParams.toString()}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (activeContactIdRef.current !== targetContactId) return; // Discard stale response
          if (data) setGroupData(data);
        })
        .catch(() => {
          /* ignore fetch error */
        })
        .finally(() => {
          if (activeContactIdRef.current === targetContactId) {
            setLoadingGroup(false);
          }
        });
    }
  }, [contact, conversationId, isGroup]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim() || !accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const filteredMembers = useMemo(() => {
    if (!groupData?.participants) return [];
    if (!memberSearch.trim()) return groupData.participants;
    const term = memberSearch.toLowerCase();
    return groupData.participants.filter((m) => {
      const nameMatch = m.name ? m.name.toLowerCase().includes(term) : false;
      const phoneMatch = m.phone ? m.phone.includes(term) : false;
      return nameMatch || phoneMatch;
    });
  }, [groupData?.participants, memberSearch]);

  if (!contact) {
    return (
      <div className="flex h-full w-80 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = isGroup
    ? groupData?.subject || contact.name || contact.phone
    : contact.name || contact.phone;
  const initials = displayName ? displayName.charAt(0).toUpperCase() : "C";
  const avatarImage = isGroup
    ? groupData?.pictureUrl || contact.avatar_url
    : contact.avatar_url;
  const rawDigits = contact.phone ? contact.phone.replace(/\D/g, "") : "";
  const displayPhone =
    rawDigits.length >= 8 && rawDigits.length <= 13
      ? contact.phone.startsWith("+")
        ? contact.phone
        : `+${rawDigits}`
      : "Não informado";

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-card overflow-hidden">
      {/* Native smooth flex scroll container ensuring bottom items (Notes) are never cut off */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Header Info */}
        <div className="flex flex-col items-center text-center">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-muted text-xl font-bold text-foreground overflow-hidden ring-2 ring-primary/20 shadow-md">
            {avatarImage && !headerAvatarError ? (
              <img
                src={avatarImage}
                alt={displayName}
                className="h-20 w-20 rounded-full object-cover"
                onError={() => setHeaderAvatarError(true)}
              />
            ) : (
              initials
            )}
          </div>
          <h3 className="mt-3 text-base font-bold text-foreground line-clamp-2">
            {displayName}
          </h3>

          {isGroup ? (
            <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Users className="h-3.5 w-3.5" />
              <span>
                {(groupData?.totalParticipantsCount || groupData?.participants?.length || 0) > 0
                  ? `${groupData?.totalParticipantsCount || groupData?.participants?.length} membros`
                  : "Grupo WhatsApp"}
              </span>
            </div>
          ) : (
            contact.company && (
              <p className="text-xs text-muted-foreground mt-0.5">{contact.company}</p>
            )
          )}
        </div>

        {/* Group Description */}
        {isGroup && groupData?.description && (
          <div className="rounded-xl border border-border bg-muted/40 p-3">
            <p className="text-xs font-semibold text-foreground mb-1">Descrição do grupo</p>
            <p
              className={
                showFullDesc
                  ? "text-xs text-muted-foreground whitespace-pre-wrap"
                  : "text-xs text-muted-foreground line-clamp-3"
              }
            >
              {groupData.description}
            </p>
            {groupData.description.length > 100 && (
              <button
                type="button"
                onClick={() => setShowFullDesc(!showFullDesc)}
                className="mt-1 flex items-center gap-1 text-[11px] font-medium text-primary hover:underline cursor-pointer"
              >
                {showFullDesc ? (
                  <>
                    Mostrar menos <ChevronUp className="h-3 w-3" />
                  </>
                ) : (
                  <>
                    Ver descrição completa <ChevronDown className="h-3 w-3" />
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Phone / Email for individual contact */}
        {!isGroup && (
          <div className="space-y-2">
            <button
              onClick={handleCopyPhone}
              disabled={rawDigits.length < 8 || rawDigits.length > 13}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">{displayPhone}</span>
              {rawDigits.length >= 8 && rawDigits.length <= 13 && (
                copied ? (
                  <Check className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                )
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-border" />

        {/* Group Media, Links and Docs Section */}
        {isGroup && (
          <div>
            <div className="flex items-center justify-between gap-1 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Mídia, links e docs
              </span>
              <span className="text-xs font-bold text-primary">
                {(groupData?.media?.length || 0) +
                  (groupData?.links?.length || 0) +
                  (groupData?.docs?.length || 0)}
              </span>
            </div>

            {/* Sub-tabs */}
            <div className="flex rounded-lg bg-muted p-0.5 gap-0.5 mb-2.5">
              <button
                type="button"
                onClick={() => setActiveMediaTab("media")}
                className={`flex-1 flex items-center justify-center gap-1 rounded-md py-1 text-xs font-medium transition-colors cursor-pointer ${
                  activeMediaTab === "media"
                    ? "bg-card text-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <ImageIcon className="h-3 w-3" />
                Mídia ({groupData?.media?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setActiveMediaTab("links")}
                className={`flex-1 flex items-center justify-center gap-1 rounded-md py-1 text-xs font-medium transition-colors cursor-pointer ${
                  activeMediaTab === "links"
                    ? "bg-card text-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <LinkIcon className="h-3 w-3" />
                Links ({groupData?.links?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setActiveMediaTab("docs")}
                className={`flex-1 flex items-center justify-center gap-1 rounded-md py-1 text-xs font-medium transition-colors cursor-pointer ${
                  activeMediaTab === "docs"
                    ? "bg-card text-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <FileText className="h-3 w-3" />
                Docs ({groupData?.docs?.length || 0})
              </button>
            </div>

            {/* Tab Content */}
            {activeMediaTab === "media" && (
              <div>
                {!groupData?.media || groupData.media.length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">
                    Nenhuma mídia compartilhada
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5 max-h-48 overflow-y-auto pr-0.5">
                    {groupData.media.map((m) => (
                      <a
                        key={m.id}
                        href={m.media_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative aspect-square overflow-hidden rounded-lg bg-muted ring-1 ring-border"
                      >
                        <img
                          src={m.media_url}
                          alt="Mídia"
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeMediaTab === "links" && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {!groupData?.links || groupData.links.length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">
                    Nenhum link encontrado
                  </p>
                ) : (
                  groupData.links.map((l) => (
                    <a
                      key={l.id}
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2 text-xs text-primary hover:bg-muted transition-colors"
                    >
                      <LinkIcon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate flex-1 font-medium">{l.url}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                    </a>
                  ))
                )}
              </div>
            )}

            {activeMediaTab === "docs" && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {!groupData?.docs || groupData.docs.length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">
                    Nenhum documento encontrado
                  </p>
                ) : (
                  groupData.docs.map((d) => (
                    <a
                      key={d.id}
                      href={d.media_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2 text-xs text-foreground hover:bg-muted transition-colors"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="truncate flex-1 font-medium">Documento</span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </a>
                  ))
                )}
              </div>
            )}

            <div className="my-4 border-t border-border" />
          </div>
        )}

        {/* Group Members List */}
        {isGroup && (
          <div>
            <div className="flex items-center justify-between gap-1 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Membros do Grupo
              </span>
              <span className="text-xs font-bold text-primary">
                {groupData?.totalParticipantsCount || groupData?.participants?.length || 0}
              </span>
            </div>

            {/* Search input */}
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Pesquisar membro..."
                className="h-8 pl-8 text-xs border-border bg-muted/50"
              />
            </div>

            {/* Members list */}
            <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
              {loadingGroup ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Carregando membros do grupo...
                </p>
              ) : filteredMembers.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Nenhum membro encontrado
                </p>
              ) : (
                filteredMembers.map((member, idx) => {
                  const memberKey = member.phone || member.name || `mem-${idx}`;
                  const hasAvatarErr = failedMemberAvatars[memberKey];
                  const hasValidPhone =
                    member.phone && member.phone.length >= 8 && member.phone.length <= 13;
                  const displayMemberPhone = hasValidPhone
                    ? member.phone!.startsWith("+")
                      ? member.phone
                      : `+${member.phone}`
                    : null;

                  const canOpenChat = Boolean(hasValidPhone && onNavigateToContact);

                  return (
                    <div
                      key={memberKey}
                      onClick={() => {
                        if (canOpenChat && member.phone) {
                          onNavigateToContact!(member.phone);
                        }
                      }}
                      title={canOpenChat ? `Abrir conversa direta com ${member.name}` : undefined}
                      className={`flex items-center gap-2.5 rounded-lg p-2 transition-all ${
                        canOpenChat
                          ? "cursor-pointer hover:bg-primary/10 group"
                          : "cursor-default hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground overflow-hidden ring-1 ring-border">
                        {member.avatar_url && !hasAvatarErr ? (
                          <img
                            src={member.avatar_url}
                            alt={member.name}
                            className="h-8 w-8 rounded-full object-cover"
                            onError={() =>
                              setFailedMemberAvatars((prev) => ({
                                ...prev,
                                [memberKey]: true,
                              }))
                            }
                          />
                        ) : (
                          member.name.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-xs font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                            {member.name}
                          </p>
                          <div className="flex items-center gap-1 shrink-0">
                            {member.admin && (
                              <span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] font-bold text-primary">
                                {member.admin === "superadmin" ? "Dono" : "Admin"}
                              </span>
                            )}
                            {canOpenChat && (
                              <MessageSquare className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:text-primary transition-opacity" />
                            )}
                          </div>
                        </div>
                        {displayMemberPhone && (
                          <p className="text-[11px] text-muted-foreground truncate">
                            {displayMemberPhone}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="my-4 border-t border-border" />
          </div>
        )}

        {/* Tags */}
        <div>
          <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <TagIcon className="h-3 w-3" />
            {tSidebar("tags")}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {tags.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
            ) : (
              tags.map((tag) => (
                <span
                  key={tag.contact_tag_id}
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: `${tag.color}20`,
                    color: tag.color,
                  }}
                >
                  {tag.name}
                </span>
              ))
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-border" />

        {/* Notes */}
        <div>
          <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <StickyNote className="h-3 w-3" />
            {tSidebar("notes")}
          </div>
          <div className="mt-2">
            <div className="flex gap-2">
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder={tSidebar("addNotePlaceholder")}
                rows={2}
                className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
              />
              <Button
                size="sm"
                className="h-auto bg-primary px-2 hover:bg-primary/90"
                onClick={handleAddNote}
                disabled={!newNote.trim() || addingNote}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>

            <div className="mt-2 space-y-2">
              {notes.map((note) => (
                <div key={note.id} className="rounded-lg bg-muted px-3 py-2">
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                    {note.note_text}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
