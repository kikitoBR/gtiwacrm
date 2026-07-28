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

  let convId = conversationId
  let jid = groupJid

  // 1. Resolve conversationId and groupJid
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
    const { data: contactRec } = await admin
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq('phone', jid)
      .maybeSingle()

    if (contactRec) {
      const { data: conv } = await admin
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contactRec.id)
        .maybeSingle()

      convId = conv?.id || null
    }
  }

  // 2. Query provider for group metadata and full participants list
  const { data: config } = await admin
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fullGroupInfo: any = null
  const participantMap = new Map<string, { phone: string; name: string; avatar_url: string | null; admin?: string | null }>()

  if (config && jid) {
    try {
      const provider = getWhatsAppProvider(config)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provAny = provider as any
      if (typeof provAny.getGroupInfo === 'function') {
        fullGroupInfo = await provAny.getGroupInfo(jid)
        if (fullGroupInfo?.participants && Array.isArray(fullGroupInfo.participants)) {
          for (const p of fullGroupInfo.participants) {
            const key = p.phone || p.id
            if (key && !participantMap.has(key)) {
              participantMap.set(key, {
                phone: p.phone || null,
                name: p.name || (p.phone ? `+${p.phone}` : 'Membro do Grupo'),
                avatar_url: p.avatar_url || null,
                admin: p.admin || null,
              })
            }
          }
        }
      }
    } catch (e) {
      console.warn('[group-info] Provider fetch failed:', e)
    }
  }

  // 3. Media, links, docs, and message-extracted participants from database
  const mediaList: { id: string; content_type: string; media_url: string; created_at: string }[] = []
  const linksList: { id: string; url: string; created_at: string }[] = []
  const docsList: { id: string; media_url: string; created_at: string }[] = []

  if (convId) {
    const { data: msgs } = await admin
      .from('messages')
      .select('id, content_type, content_text, media_url, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: false })
      .limit(500)

    if (msgs) {
      const urlRegex = /(https?:\/\/[^\s]+)/g
      for (const m of msgs) {
        if ((m.content_type === 'image' || m.content_type === 'video' || m.content_type === 'audio') && m.media_url) {
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
        } else if (m.media_url && !mediaList.some((item) => item.id === m.id)) {
          const lower = m.media_url.toLowerCase()
          if (lower.match(/\.(png|jpe?g|gif|webp|mp4|mov|webm|mp3|ogg|wav)$/)) {
            mediaList.push({
              id: m.id,
              content_type: m.content_type || 'image',
              media_url: m.media_url,
              created_at: m.created_at,
            })
          } else if (lower.match(/\.(pdf|docx?|xlsx?|pptx?|zip|rar|txt)$/)) {
            docsList.push({
              id: m.id,
              media_url: m.media_url,
              created_at: m.created_at,
            })
          }
        }

        if (m.content_text) {
          const { participantName, participantPhone } = parseGroupMessage(m.content_text)
          if (participantPhone && participantPhone.length >= 8 && participantPhone.length <= 13) {
            if (!participantMap.has(participantPhone)) {
              participantMap.set(participantPhone, {
                phone: participantPhone,
                name: participantName || `+${participantPhone}`,
                avatar_url: null,
              })
            }
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

  // 4. Enrich participants with saved contact names and avatars from `contacts` table
  if (participantMap.size > 0) {
    const phonesArr = Array.from(participantMap.keys())
    const { data: contacts } = await admin
      .from('contacts')
      .select('phone, name, avatar_url')
      .eq('account_id', accountId)
      .in('phone', phonesArr)

    if (contacts) {
      for (const c of contacts) {
        if (c.phone && participantMap.has(c.phone)) {
          const existing = participantMap.get(c.phone)!
          participantMap.set(c.phone, {
            ...existing,
            name: c.name || existing.name,
            avatar_url: c.avatar_url || existing.avatar_url,
          })
        }
      }
    }
  }

  const finalParticipants = Array.from(participantMap.values())

  return NextResponse.json({
    subject: fullGroupInfo?.subject || null,
    description: fullGroupInfo?.description || null,
    pictureUrl: fullGroupInfo?.pictureUrl || null,
    owner: fullGroupInfo?.owner || null,
    participants: finalParticipants,
    media: mediaList,
    links: linksList,
    docs: docsList,
  })
}
