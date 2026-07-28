import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { getWhatsAppProvider } from '@/lib/whatsapp/provider-factory'
import { parseGroupMessage } from '@/lib/whatsapp/group-utils'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const groupJid = searchParams.get('groupJid')
  const conversationId = searchParams.get('conversationId')

  if (!groupJid && !conversationId) {
    return NextResponse.json({ error: 'groupJid or conversationId is required' }, { status: 400 })
  }

  const supabase = await createServerClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', session.user.id)
    .maybeSingle()

  const accountId = profile?.account_id
  if (!accountId) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const admin = supabaseAdmin()

  // 1. Get conversation and contact if conversationId provided
  let convId = conversationId
  let jid = groupJid

  if (convId && !jid) {
    const { data: conv } = await admin
      .from('conversations')
      .select('id, contact:contacts(phone)')
      .eq('id', convId)
      .eq('account_id', accountId)
      .maybeSingle()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jid = (conv?.contact as any)?.phone || null
  } else if (jid && !convId) {
    const { data: conv } = await admin
      .from('conversations')
      .select('id, contact:contacts(phone)')
      .eq('account_id', accountId)
      .filter('contact.phone', 'eq', jid)
      .maybeSingle()

    convId = conv?.id || null
  }

  // 2. Fetch provider info if available
  const { data: config } = await admin
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()

  let groupInfo: { subject?: string; description?: string; pictureUrl?: string } | null = null
  const participantPhones = new Set<string>()

  if (config && jid) {
    try {
      const provider = getWhatsAppProvider(config)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provAny = provider as any
      if (typeof provAny.getGroupInfo === 'function') {
        groupInfo = await provAny.getGroupInfo(jid)
      }
      if (typeof provAny.getGroupParticipantsMap === 'function') {
        const partMap = await provAny.getGroupParticipantsMap(jid)
        for (const item of partMap.values()) {
          if (item.phone && item.phone.length <= 13) {
            participantPhones.add(item.phone)
          }
        }
      }
    } catch (e) {
      console.warn('[group-info] Provider group fetch failed:', e)
    }
  }

  // 3. Media, links, docs, and message-extracted participants
  const mediaList: { id: string; content_type: string; media_url: string; created_at: string }[] = []
  const linksList: { id: string; url: string; created_at: string }[] = []
  const docsList: { id: string; media_url: string; created_at: string }[] = []

  if (convId) {
    const { data: msgs } = await admin
      .from('messages')
      .select('id, content_type, content_text, media_url, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: false })
      .limit(300)

    if (msgs) {
      const urlRegex = /(https?:\/\/[^\s]+)/g
      for (const m of msgs) {
        if ((m.content_type === 'image' || m.content_type === 'video') && m.media_url) {
          mediaList.push({
            id: m.id,
            content_type: m.content_type,
            media_url: m.media_url,
            created_at: m.created_at,
          })
        } else if (m.content_type === 'document' && m.media_url) {
          docsList.push({
            id: m.id,
            media_url: m.media_url,
            created_at: m.created_at,
          })
        }

        if (m.content_text) {
          const { participantName, participantPhone } = parseGroupMessage(m.content_text)
          if (participantPhone && participantPhone.length <= 13) {
            participantPhones.add(participantPhone)
          }
          const matches = m.content_text.match(urlRegex)
          if (matches) {
            for (const url of matches) {
              if (!linksList.some((l) => l.url === url)) {
                linksList.push({
                  id: `${m.id}-${url}`,
                  url,
                  created_at: m.created_at,
                })
              }
            }
          }
        }
      }
    }
  }

  // 4. Query contact profiles for all discovered participant phones
  const participants: { phone: string; name: string; avatar_url: string | null }[] = []

  if (participantPhones.size > 0) {
    const phonesArr = Array.from(participantPhones)
    const { data: contacts } = await admin
      .from('contacts')
      .select('phone, name, avatar_url')
      .eq('account_id', accountId)
      .in('phone', phonesArr)

    const contactMap = new Map<string, { name: string; avatar_url: string | null }>()
    if (contacts) {
      for (const c of contacts) {
        if (c.phone) {
          contactMap.set(c.phone, { name: c.name || c.phone, avatar_url: c.avatar_url })
        }
      }
    }

    for (const phone of phonesArr) {
      const match = contactMap.get(phone)
      participants.push({
        phone,
        name: match?.name || `+${phone}`,
        avatar_url: match?.avatar_url || null,
      })
    }
  }

  return NextResponse.json({
    subject: groupInfo?.subject || null,
    description: groupInfo?.description || null,
    pictureUrl: groupInfo?.pictureUrl || null,
    participants,
    media: mediaList,
    links: linksList,
    docs: docsList,
  })
}
