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

  const { data: msg } = await admin
    .from('messages')
    .select('*, conversations(account_id, contact_id, contacts(phone))')
    .eq('id', id)
    .maybeSingle()

  if (!msg) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conv = Array.isArray(msg?.conversations) ? msg.conversations[0] : (msg?.conversations as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contact = Array.isArray(conv?.contacts) ? conv.contacts[0] : (conv?.contacts as any)
  const phone = contact?.phone
  const accountId = conv?.account_id
  const waMsgId = msg?.whatsapp_message_id || (msg as any)?.message_id

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

  // Soft delete by updating content_text (prevents PostgreSQL check constraint error on status)
  const { error } = await admin
    .from('messages')
    .update({ content_text: deletedText })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
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

  const { data: msg } = await admin
    .from('messages')
    .select('*, conversations(account_id, contact_id, contacts(phone))')
    .eq('id', id)
    .maybeSingle()

  if (!msg) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conv = Array.isArray(msg?.conversations) ? msg.conversations[0] : (msg?.conversations as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contact = Array.isArray(conv?.contacts) ? conv.contacts[0] : (conv?.contacts as any)
  const phone = contact?.phone
  const accountId = conv?.account_id
  const waMsgId = msg?.whatsapp_message_id || (msg as any)?.message_id

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

  // Update content_text without violating PostgreSQL status constraint
  const { error } = await admin
    .from('messages')
    .update({ content_text: newText.trim() })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, newText: newText.trim() })
}
