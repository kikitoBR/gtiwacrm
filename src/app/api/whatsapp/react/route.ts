import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getWhatsAppProvider } from '@/lib/whatsapp/provider-factory';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

function supabaseAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limit = checkRateLimit(`react:${user.id}`, RATE_LIMITS.react);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const accountId = profile?.account_id as string | undefined;
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { message_id, emoji } = body as {
      message_id?: string;
      emoji?: string;
    };

    if (!message_id || typeof emoji !== 'string') {
      return NextResponse.json(
        { error: 'message_id and emoji are required' },
        { status: 400 },
      );
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(message_id);
    const admin = supabaseAdmin();

    // 1. Fetch message + conversation + contact in a single query
    const joinedQuery = admin
      .from('messages')
      .select('id, message_id, sender_type, conversation_id, conversations(id, account_id, contact_id, contacts(phone))');

    const { data: joinedMsg } = isUuid
      ? await joinedQuery.eq('id', message_id).maybeSingle()
      : await joinedQuery.eq('message_id', message_id).maybeSingle();

    let targetMessage: {
      id: string;
      message_id?: string | null;
      sender_type: string;
      conversation_id: string;
    } | null = null;
    let conversation: { id: string; account_id: string; contact_id?: string | null } | null = null;
    let phone: string | undefined;

    if (joinedMsg) {
      targetMessage = {
        id: joinedMsg.id,
        message_id: joinedMsg.message_id,
        sender_type: joinedMsg.sender_type,
        conversation_id: joinedMsg.conversation_id,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conv = Array.isArray(joinedMsg.conversations) ? joinedMsg.conversations[0] : (joinedMsg.conversations as any);
      if (conv) {
        conversation = {
          id: conv.id,
          account_id: conv.account_id,
          contact_id: conv.contact_id,
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const contact = Array.isArray(conv.contacts) ? conv.contacts[0] : (conv.contacts as any);
        if (contact?.phone) {
          phone = contact.phone;
        }
      }
    }

    // 2. Fallback: if not found via joined query or missing conversation/phone, query step-by-step
    if (!targetMessage) {
      const baseQuery = admin.from('messages').select('id, message_id, sender_type, conversation_id');
      const { data: rawMsg } = isUuid
        ? await baseQuery.eq('id', message_id).maybeSingle()
        : await baseQuery.eq('message_id', message_id).maybeSingle();

      if (rawMsg) {
        targetMessage = rawMsg;
      }
    }

    if (!targetMessage) {
      console.error('[whatsapp/react] Message not found for id:', message_id, 'isUuid:', isUuid);
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    if (!conversation) {
      const { data: conv } = await admin
        .from('conversations')
        .select('id, account_id, contact_id')
        .eq('id', targetMessage.conversation_id)
        .maybeSingle();

      if (conv) {
        conversation = conv;
      }
    }

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      );
    }

    if (!phone && conversation.contact_id) {
      const { data: contact } = await admin
        .from('contacts')
        .select('phone')
        .eq('id', conversation.contact_id)
        .maybeSingle();
      if (contact?.phone) {
        phone = contact.phone;
      }
    }

    if (!phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 },
      );
    }

    const waMsgId = targetMessage.message_id || targetMessage.id;
    if (!waMsgId) {
      return NextResponse.json(
        { error: 'Cannot react to a message that has not been sent to WhatsApp' },
        { status: 400 },
      );
    }

    const { data: config } = await admin
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', conversation.account_id || accountId)
      .maybeSingle();

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured.' },
        { status: 400 },
      );
    }

    try {
      const provider = getWhatsAppProvider(config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provAny = provider as any;
      await provAny.sendReactionMessage({
        to: phone,
        targetMessageId: waMsgId,
        emoji,
        fromMe: targetMessage.sender_type === 'agent' || targetMessage.sender_type === 'bot',
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown WhatsApp API error';
      console.error('[whatsapp/react] Send reaction failed:', message);
      return NextResponse.json(
        { error: `WhatsApp API error: ${message}` },
        { status: 502 },
      );
    }

    // Mirror reaction into DB using admin client to ensure consistency
    const { data: existingReaction } = await admin
      .from('message_reactions')
      .select('id')
      .eq('message_id', targetMessage.id)
      .eq('actor_type', 'agent')
      .eq('actor_id', user.id)
      .maybeSingle();

    if (emoji === '') {
      if (existingReaction) {
        await admin
          .from('message_reactions')
          .delete()
          .eq('id', existingReaction.id);
      }
    } else if (existingReaction) {
      await admin
        .from('message_reactions')
        .update({ emoji })
        .eq('id', existingReaction.id);
    } else {
      await admin.from('message_reactions').insert({
        message_id: targetMessage.id,
        conversation_id: targetMessage.conversation_id,
        actor_type: 'agent',
        actor_id: user.id,
        emoji,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[whatsapp/react] Internal error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
