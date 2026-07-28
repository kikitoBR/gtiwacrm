YSTEM_REFERENCE_EVOLUTION_GROUPS.md
Instruction for AI Agent: Use this document as the single source of truth when implementing, refactoring, or debugging WhatsApp Group integrations via Evolution API. Follow all data normalization rules, LID resolution workflows, and edge-case handling strictly.

1. Core Architecture & Data Flow
When working with WhatsApp Groups in Evolution API, data flows through two distinct paths:

Inbound Path (Event-Driven): Webhook triggers MESSAGES_UPSERT when any member sends a message in a group.

Outbound Path (REST API): Asynchronous REST calls made to fetch missing metadata (LIDs, profile pictures) or execute group administration tasks.

[ WhatsApp Group ] 
       │
       ▼ (User sends message)
[ Evolution API Webhook ] ────► Event: MESSAGES_UPSERT
                                       │
                                       ├─► Is Group? (key.remoteJid ends with @g.us)
                                       ├─► Raw Sender JID (key.participant)
                                       │
                                       ├─── [If @s.whatsapp.net] ──► Parse E.164 Phone
                                       └─── [If @lid] ────────────► Resolve via /chat/fetchProfile
2. Webhook Event Analysis (MESSAGES_UPSERT)
Webhook Payload Schema
When a group message arrives, key.remoteJid contains the Group ID, while key.participant contains the Sender ID.

JSON
{
  "event": "messages.upsert",
  "instance": "my_instance_name",
  "data": {
    "key": {
      "remoteJid": "1203630123456789@g.us",
      "fromMe": false,
      "id": "3EB0ABC123456789",
      "participant": "5511999998888@s.whatsapp.net"
    },
    "pushName": "John Doe",
    "message": {
      "conversation": "Hello team!"
    },
    "messageType": "conversation"
  }
}
Context Identification Rules
Is Group Message: key.remoteJid.endsWith('@g.us') === true

Is Direct Message (DM): key.remoteJid.endsWith('@s.whatsapp.net') === true

Sender JID Location:

For Groups: key.participant

For Direct Messages: key.remoteJid

3. Phone Number Sanitization & LID Resolution
3.1 Standard JID Sanitization Algorithm
WhatsApp JIDs can contain device IDs (5511999998888:12@s.whatsapp.net) or domain suffixes. Always sanitize raw strings using the following logic:

Strip device suffix: Split by : and take the first part.

Strip domain suffix: Remove @s.whatsapp.net, @g.us, or @lid.

Strip non-numeric characters (except leading + if applicable, but standard E.164 digit string is preferred: 5511999998888).

3.2 Handling Privacy Identifiers (@lid)
WhatsApp uses LID (Linked ID) identifiers (e.g., 10023456789@lid) to hide actual phone numbers in multi-device contexts, communities, or privacy-enabled accounts.

Resolution Workflow for @lid:

If participant ends with @lid, make a POST request to /chat/fetchProfile/{instance} passing { "number": "10023456789@lid" }.

Extract number or jid from the returned profile object to obtain the E.164 phone number.

Cache the resolved mapping (LID -> E.164 Phone) in Redis/In-Memory storage to prevent duplicate API requests.

4. REST API Endpoint Reference
All REST requests require the header:
apikey: <YOUR_EVOLUTION_API_KEY>

4.1 Get Group Info
Fetches complete metadata, settings, owner, and participant list.

Method: GET

Path: /group/findGroupInfos/{instance}

Query Params: groupJid (e.g., 1203630123456789@g.us)

Response Example
JSON
{
  "id": "1203630123456789@g.us",
  "subject": "Group Name",
  "owner": "5511999998888@s.whatsapp.net",
  "creation": 1690000000,
  "desc": "Group Description",
  "participants": [
    {
      "id": "5511999998888@s.whatsapp.net",
      "admin": "superadmin"
    },
    {
      "id": "5511988887777@s.whatsapp.net",
      "admin": "admin"
    },
    {
      "id": "5511977776666@s.whatsapp.net",
      "admin": null
    }
  ]
}
4.2 Get Group Participants
Lightweight endpoint returning only the list of members and their admin roles.

Method: GET

Path: /group/participants/{instance}

Query Params: groupJid (e.g., 1203630123456789@g.us)

Response Example
JSON
{
  "participants": [
    {
      "id": "5511999998888@s.whatsapp.net",
      "admin": "admin"
    }
  ]
}
4.3 Update Participant (Add, Remove, Promote, Demote)
Executes member actions in a group.

Method: POST

Path: /group/updateParticipant/{instance}

Query Params: groupJid (e.g., 1203630123456789@g.us)

Body:

JSON
{
  "action": "add", // Options: "add" | "remove" | "promote" | "demote"
  "participants": [
    "5511999998888@s.whatsapp.net"
  ]
}
4.4 Fetch Profile Picture URL
Method: POST

Path: /chat/fetchProfilePictureUrl/{instance}

Body:

JSON
{
  "number": "5511999998888@s.whatsapp.net"
}
Response:

JSON
{
  "profilePictureUrl": "https://pps.whatsapp.net/v/t61.24694-24/..."
}
4.5 Resolve LID / Fetch Profile Info
Method: POST

Path: /chat/fetchProfile/{instance}

Body:

JSON
{
  "number": "10023456789@lid"
}
Response:

JSON
{
  "id": "10023456789@lid",
  "number": "5511999998888",
  "name": "John Doe",
  "picture": "https://pps.whatsapp.net/..."
}
5. Complete Production TypeScript Implementation
TypeScript
import axios, { AxiosInstance } from 'axios';

// --- Interfaces ---
export interface WebhookMessagePayload {
  event: string;
  instance: string;
  data: {
    key: {
      remoteJid: string;
      fromMe: boolean;
      id: string;
      participant?: string;
    };
    pushName?: string;
    message?: Record<string, any>;
  };
}

export interface ParsedGroupSender {
  isGroup: boolean;
  groupId: string | null;
  rawParticipantJid: string;
  isLid: boolean;
  phoneNumber: string | null; // Resolved E.164 phone number
  pushName: string;
}

export interface GroupParticipant {
  id: string;
  phoneNumber: string;
  admin: 'superadmin' | 'admin' | null;
}

export interface GroupMetadata {
  id: string;
  subject: string;
  owner: string;
  description: string;
  participants: GroupParticipant[];
}

// --- Service Class ---
export class EvolutionGroupManager {
  private client: AxiosInstance;
  private instance: string;
  private lidCache: Map<string, string> = new Map(); // Simple in-memory LID cache

  constructor(baseURL: string, apiKey: string, instance: string) {
    this.instance = instance;
    this.client = axios.create({
      baseURL,
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Sanitizes any WhatsApp JID into clean digits (E.164 compatible).
   */
  public cleanJidToDigits(jid: string): string {
    if (!jid) return '';
    const withoutDevice = jid.split(':')[0];
    return withoutDevice.replace(/[^0-9]/g, '');
  }

  /**
   * Resolves a LID identifier to a real phone number using API lookup with caching.
   */
  public async resolveLidToPhone(lidJid: string): Promise<string | null> {
    const cleanedLid = lidJid.split(':')[0];
    
    if (this.lidCache.has(cleanedLid)) {
      return this.lidCache.get(cleanedLid)!;
    }

    try {
      const response = await this.client.post(`/chat/fetchProfile/${this.instance}`, {
        number: lidJid,
      });

      const phone = response.data?.number || this.cleanJidToDigits(response.data?.id);
      if (phone) {
        this.lidCache.set(cleanedLid, phone);
        return phone;
      }
    } catch (error) {
      console.error(`Failed to resolve LID ${lidJid}:`, error);
    }

    return null;
  }

  /**
   * Main Webhook Processor: Extracts sender details from an incoming message payload.
   */
  public async processWebhookMessage(payload: WebhookMessagePayload): Promise<ParsedGroupSender> {
    const { key, pushName } = payload.data;
    const isGroup = key.remoteJid.endsWith('@g.us');
    const rawParticipantJid = isGroup ? (key.participant || '') : key.remoteJid;
    const isLid = rawParticipantJid.endsWith('@lid');

    let phoneNumber: string | null = null;

    if (isLid) {
      phoneNumber = await this.resolveLidToPhone(rawParticipantJid);
    } else if (rawParticipantJid) {
      phoneNumber = this.cleanJidToDigits(rawParticipantJid);
    }

    return {
      isGroup,
      groupId: isGroup ? key.remoteJid : null,
      rawParticipantJid,
      isLid,
      phoneNumber,
      pushName: pushName || 'Unknown Contact',
    };
  }

  /**
   * Fetches full group details and normalizes participant data.
   */
  public async getGroupInfo(groupJid: string): Promise<GroupMetadata> {
    const response = await this.client.get(`/group/findGroupInfos/${this.instance}`, {
      params: { groupJid },
    });

    const data = response.data;
    const participants: GroupParticipant[] = (data.participants || []).map((p: any) => ({
      id: p.id,
      phoneNumber: this.cleanJidToDigits(p.id),
      admin: p.admin || null,
    }));

    return {
      id: data.id,
      subject: data.subject || '',
      owner: data.owner || '',
      description: data.desc || '',
      participants,
    };
  }

  /**
   * Fetches profile picture URL for a contact or group.
   */
  public async getProfilePicture(numberOrJid: string): Promise<string | null> {
    try {
      const response = await this.client.post(`/chat/fetchProfilePictureUrl/${this.instance}`, {
        number: numberOrJid,
      });
      return response.data?.profilePictureUrl || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Adds, removes, promotes, or demotes participants.
   */
  public async updateParticipant(
    groupJid: string,
    action: 'add' | 'remove' | 'promote' | 'demote',
    phoneNumbersOrJids: string[]
  ): Promise<any> {
    const formattedParticipants = phoneNumbersOrJids.map((item) =>
      item.includes('@') ? item : `${item}@s.whatsapp.net`
    );

    const response = await this.client.post(
      `/group/updateParticipant/${this.instance}`,
      { action, participants: formattedParticipants },
      { params: { groupJid } }
    );

    return response.data;
  }
}
6. Edge Cases & Safety Constraints Checklist
PushName Privacy: pushName can be empty or null if the user has strict privacy settings. Always fallback to 'Unknown' or the phone number.

Bot Admin Status: The updateParticipant actions (remove, promote, demote) will fail with 403/500 errors if the instance account connected to WhatsApp is not an Admin of the target group.

Rate Limiting (Profile Pics): Never trigger fetchProfilePictureUrl synchronously on every single group message. Cache URLs in a database or Redis with a TTL (e.g., 24 hours).

Device Suffixes: Always strip :device_id (e.g., :1, :12) before querying database records or making direct user calls.

Group JID Format: Group IDs strictly end in @g.us. Never pass individual user JIDs (@s.whatsapp.net) to group management endpoints.