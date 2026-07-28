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
    .single()

  if (!msg) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  if (msg.whatsapp_message_id && msg.conversations?.account_id) {
    const { data: config } = await admin
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', msg.conversations.account_id)
      .maybeSingle()

    if (config) {
      try {
        const provider = getWhatsAppProvider(config)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const provAny = provider as any
        if (typeof provAny.deleteMessage === 'function') {
          const phone = msg.conversations.contacts?.phone
          if (phone) {
            await provAny.deleteMessage({
              to: phone,
              messageId: msg.whatsapp_message_id,
              fromMe: msg.sender_type === 'agent' || msg.sender_type === 'bot',
            })
          }
        }
      } catch (err) {
        console.warn('Failed to delete message on WhatsApp provider:', err)
      }
    }
  }

  const { error } = await admin.from('messages').delete().eq('id', id)
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
    .single()

  if (!msg) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  if (msg.whatsapp_message_id && msg.conversations?.account_id) {
    const { data: config } = await admin
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', msg.conversations.account_id)
      .maybeSingle()

    if (config) {
      try {
        const provider = getWhatsAppProvider(config)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const provAny = provider as any
        if (typeof provAny.editMessage === 'function') {
          const phone = msg.conversations.contacts?.phone
          if (phone) {
            await provAny.editMessage({
              to: phone,
              messageId: msg.whatsapp_message_id,
              newText: newText.trim(),
              fromMe: msg.sender_type === 'agent' || msg.sender_type === 'bot',
            })
          }
        }
      } catch (err) {
        console.warn('Failed to edit message on WhatsApp provider:', err)
      }
    }
  }

  const { error } = await admin
    .from('messages')
    .update({ content_text: newText.trim() })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, newText: newText.trim() })
}
