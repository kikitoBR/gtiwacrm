import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { getWhatsAppProvider } from '@/lib/whatsapp/provider-factory'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Fetches the message + conversation + contact phone using either admin or
 * session client (whichever succeeds first).
 */
async function fetchMessageContext(
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...clients: any[]
) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

  for (const client of clients) {
    // 1. Try joined query first
    const joinedQuery = client
      .from('messages')
      .select('*, conversations(account_id, contact_id, contacts(phone))')
    const { data: msg } = isUuid
      ? await joinedQuery.eq('id', id).maybeSingle()
      : await joinedQuery.eq('message_id', id).maybeSingle()

    if (msg) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conv = Array.isArray(msg?.conversations) ? msg.conversations[0] : (msg?.conversations as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contact = Array.isArray(conv?.contacts) ? conv.contacts[0] : (conv?.contacts as any)
      if (conv?.account_id && contact?.phone) {
        return {
          msg,
          phone: contact.phone as string,
          accountId: conv.account_id as string,
          waMsgId: ((msg as any)?.message_id || msg?.whatsapp_message_id) as string | undefined,
        }
      }
    }

    // 2. Fallback: query message alone, then conversation and contact separately
    const baseQuery = client.from('messages').select('*')
    const { data: rawMsg } = isUuid
      ? await baseQuery.eq('id', id).maybeSingle()
      : await baseQuery.eq('message_id', id).maybeSingle()

    if (rawMsg) {
      let phone: string | undefined
      let accountId: string | undefined

      const { data: conversation } = await client
        .from('conversations')
        .select('account_id, contact_id')
        .eq('id', rawMsg.conversation_id)
        .maybeSingle()

      if (conversation) {
        accountId = conversation.account_id
        if (conversation.contact_id) {
          const { data: contactRow } = await client
            .from('contacts')
            .select('phone')
            .eq('id', conversation.contact_id)
            .maybeSingle()
          phone = contactRow?.phone
        }
      }

      return {
        msg: rawMsg,
        phone,
        accountId,
        waMsgId: ((rawMsg as any)?.message_id || rawMsg?.whatsapp_message_id) as string | undefined,
      }
    }
  }
  return null
}

export async function DELETE(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const currentUser = user || session?.user
  if (!currentUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const ctx = await fetchMessageContext(id, admin, supabase)

  if (!ctx) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  const { msg, phone, accountId, waMsgId } = ctx

  if (waMsgId && accountId && phone) {
    const { data: config } = await admin
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()

    if (config) {
      try {
        const provider = getWhatsAppProvider(config)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const provAny = provider as any
        if (typeof provAny.deleteMessage === 'function') {
          await provAny.deleteMessage({
            to: phone,
            messageId: waMsgId,
            fromMe: msg.sender_type === 'agent' || msg.sender_type === 'bot',
          })
        }
      } catch (err) {
        console.warn('Failed to delete message on WhatsApp provider:', err)
      }
    }
  }

  const isAgent = msg.sender_type === 'agent' || msg.sender_type === 'bot'
  const deletedText = isAgent ? '🚫 Você apagou esta mensagem' : '🚫 Esta mensagem foi apagada'

  // Soft delete: update content_text and status using admin client
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const filterCol = isUuid ? 'id' : 'message_id'

  let { error: adminErr } = await admin
    .from('messages')
    .update({ content_text: deletedText, status: 'deleted' })
    .eq(filterCol, id)

  // If Postgres rejects status 'deleted' due to messages_status_check constraint,
  // fallback to soft-deleting with content_text and clearing media_url
  if (adminErr && adminErr.code === '23514') {
    console.warn('[messages/delete] status: "deleted" rejected by constraint, soft-deleting via content_text')
    const fallback = await admin
      .from('messages')
      .update({ content_text: deletedText, media_url: null })
      .eq(filterCol, id)
    adminErr = fallback.error
  }

  if (adminErr) {
    console.error('Error soft-deleting message:', adminErr)
    return NextResponse.json({ error: adminErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function PATCH(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const currentUser = user || session?.user
  if (!currentUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { newText } = (await request.json()) as { newText?: string }
  if (!newText || typeof newText !== 'string' || newText.trim() === '') {
    return NextResponse.json({ error: 'newText is required' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const ctx = await fetchMessageContext(id, admin, supabase)

  if (!ctx) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  const { msg, phone, accountId, waMsgId } = ctx

  if (waMsgId && accountId && phone) {
    const { data: config } = await admin
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()

    if (config) {
      try {
        const provider = getWhatsAppProvider(config)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const provAny = provider as any
        if (typeof provAny.editMessage === 'function') {
          await provAny.editMessage({
            to: phone,
            messageId: waMsgId,
            newText: newText.trim(),
            fromMe: msg.sender_type === 'agent' || msg.sender_type === 'bot',
          })
        }
      } catch (err) {
        console.warn('Failed to edit message on WhatsApp provider:', err)
      }
    }
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const filterCol = isUuid ? 'id' : 'message_id'

  const { error: adminErr } = await admin
    .from('messages')
    .update({ content_text: newText.trim() })
    .eq(filterCol, id)

  if (adminErr) {
    console.error('Error editing message:', adminErr)
    return NextResponse.json({ error: adminErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, newText: newText.trim() })
}
