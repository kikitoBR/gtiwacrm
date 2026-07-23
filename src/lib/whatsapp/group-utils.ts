/**
 * Utility functions for group chat participant name extraction and color assignment,
 * mirroring WhatsApp Web's signature participant header and avatar styling.
 */

const PARTICIPANT_COLORS = [
  "#0284c7", // Sky Blue
  "#16a34a", // Emerald Green
  "#9333ea", // Purple
  "#ea580c", // Orange
  "#db2777", // Pink
  "#0d9488", // Teal
  "#d97706", // Amber
  "#6366f1", // Indigo
];

/**
 * Returns a deterministic, vibrant color for a participant name.
 */
export function getParticipantColor(name: string): string {
  if (!name) return PARTICIPANT_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % PARTICIPANT_COLORS.length;
  return PARTICIPANT_COLORS[index];
}

export interface ParsedGroupMessage {
  participantName: string | null;
  participantPhone: string | null;
  cleanText: string;
}

/**
 * Parses raw message text for `*Participant Name|Phone:* Message` or `*Participant Name:* Message`
 * patterns introduced by group message webhooks, stripping the prefix and extracting details.
 */
export function parseGroupMessage(rawText?: string | null): ParsedGroupMessage {
  if (!rawText) {
    return { participantName: null, participantPhone: null, cleanText: "" };
  }

  const match = rawText.match(/^\*([^|*]+)(?:\|([^*]+))?:\*\s*([\s\S]*)$/);
  if (match) {
    return {
      participantName: match[1].trim(),
      participantPhone: match[2]?.trim() || null,
      cleanText: match[3],
    };
  }

  return {
    participantName: null,
    participantPhone: null,
    cleanText: rawText,
  };
}
