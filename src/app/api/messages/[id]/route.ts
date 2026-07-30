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
  for (const client of clients) {
    // Try the joined query first
    const { data: msg } = await client
      .from('messages')
      .select('*, conversations(account_id, contact_id, contacts(phone))')
      .eq('id', id)
      .maybeSingle()

    if (msg) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conv = Array.isArray(msg?.conversations) ? msg.conversations[0] : (msg?.conversations as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contact = Array.isArray(conv?.contacts) ? conv.contacts[0] : (conv?.contacts as any)
      return {
        msg,
        phone: contact?.phone as string | undefined,
        accountId: conv?.account_id as string | undefined,
        waMsgId: (msg?.whatsapp_message_id || (msg as any)?.message_id) as string | undefined,
      }
    }

    // Fallback: query message alone, then conversation and contact separately
    const { data: rawMsg } = await client
      .from('messages')
      .select('*')
      .eq('id', id)
      .maybeSingle()

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
        waMsgId: (rawMsg?.whatsapp_message_id || (rawMsg as any)?.message_id) as string | undefined,
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
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const ctx = await fetchMessageContext(id, supabase, admin)

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

  // Soft delete: update content_text and status. Try admin first (bypasses RLS), fallback to session client.
  let updateError = null
  const { error: adminErr } = await admin
    .from('messages')
    .update({ content_text: deletedText, status: 'deleted' })
    .eq('id', id)

  if (adminErr) {
    const { error: sessErr } = await supabase
      .from('messages')
      .update({ content_text: deletedText, status: 'deleted' })
      .eq('id', id)
    updateError = sessErr
  }

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
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
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { newText } = (await request.json()) as { newText?: string }
  if (!newText || typeof newText !== 'string' || newText.trim() === '') {
    return NextResponse.json({ error: 'newText is required' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const ctx = await fetchMessageContext(id, supabase, admin)

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

  // Update content_text. Try admin first, fallback to session client.
  let updateError = null
  const { error: adminErr } = await admin
    .from('messages')
    .update({ content_text: newText.trim() })
    .eq('id', id)

  if (adminErr) {
    const { error: sessErr } = await supabase
      .from('messages')
      .update({ content_text: newText.trim() })
      .eq('id', id)
    updateError = sessErr
  }

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, newText: newText.trim() })
}
