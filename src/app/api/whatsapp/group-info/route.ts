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
  if (config && jid) {
    try {
      const provider = getWhatsAppProvider(config)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provAny = provider as any
      if (typeof provAny.getGroupInfo === 'function') {
        fullGroupInfo = await provAny.getGroupInfo(jid)
      }
    } catch (e) {
      console.warn('[group-info] Provider fetch failed:', e)
    }
  }

  // 3. Collect participants from provider
  const rawList: { phone: string | null; name: string; avatar_url: string | null; admin?: string | null }[] = []

  if (fullGroupInfo?.participants && Array.isArray(fullGroupInfo.participants)) {
    for (const p of fullGroupInfo.participants) {
      const cleanPhone = p.phone ? p.phone.replace(/\D/g, '') : ''
      // E.164 phone numbers have 8 to 13 digits (LIDs are 14+ digits)
      const isRealPhone = cleanPhone.length >= 8 && cleanPhone.length <= 13
      const phone = isRealPhone ? cleanPhone : null
      const name = p.name && p.name !== 'Membro do Grupo' ? p.name : (phone ? `+${phone}` : 'Membro do Grupo')
      rawList.push({
        phone,
        name,
        avatar_url: p.avatar_url || null,
        admin: p.admin || null,
      })
    }
  }

  // 4. Media, links, docs, and message-extracted senders from database
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
          if (participantName && participantName.trim()) {
            const trimmedName = participantName.trim()
            const cleanPhone = participantPhone ? participantPhone.replace(/\D/g, '') : ''
            const isRealPhone = cleanPhone.length >= 8 && cleanPhone.length <= 13 ? cleanPhone : null

            const existingByName = rawList.find(
              (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
            )
            const existingByPhone = isRealPhone
              ? rawList.find((p) => p.phone === isRealPhone)
              : null

            if (existingByPhone) {
              if (existingByPhone.name === 'Membro do Grupo' || existingByPhone.name.startsWith('+')) {
                existingByPhone.name = trimmedName
              }
            } else if (existingByName) {
              if (isRealPhone && !existingByName.phone) {
                existingByName.phone = isRealPhone
              }
            } else {
              // Replace an unnamed LID entry if available
              const unnamedLid = rawList.find((p) => p.name === 'Membro do Grupo')
              if (unnamedLid) {
                unnamedLid.name = trimmedName
                if (isRealPhone) unnamedLid.phone = isRealPhone
              } else {
                rawList.push({
                  phone: isRealPhone,
                  name: trimmedName,
                  avatar_url: null,
                })
              }
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

  // 5. Enrich and match with `contacts` table in Supabase
  if (accountId) {
    const { data: dbContacts } = await admin
      .from('contacts')
      .select('phone, name, avatar_url')
      .eq('account_id', accountId)

    if (dbContacts && dbContacts.length > 0) {
      for (const c of dbContacts) {
        if (!c.name) continue
        const cCleanPhone = c.phone ? c.phone.replace(/\D/g, '') : ''

        if (cCleanPhone && cCleanPhone.length <= 13) {
          const matchByPhone = rawList.find((p) => p.phone === cCleanPhone)
          if (matchByPhone) {
            matchByPhone.name = c.name
            matchByPhone.avatar_url = c.avatar_url || matchByPhone.avatar_url
            continue
          }
        }

        const matchByName = rawList.find(
          (p) => p.name.toLowerCase() === c.name.toLowerCase()
        )
        if (matchByName) {
          if (cCleanPhone && cCleanPhone.length <= 13 && !matchByName.phone) {
            matchByName.phone = cCleanPhone
          }
          matchByName.avatar_url = c.avatar_url || matchByName.avatar_url
        }
      }
    }
  }

  // 6. Strict deduplication by phone or name
  const deduplicatedParticipants: { phone: string | null; name: string; avatar_url: string | null; admin?: string | null }[] = []
  const seenKeys = new Set<string>()

  for (const item of rawList) {
    const key = item.phone ? `phone:${item.phone}` : `name:${item.name.toLowerCase()}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    deduplicatedParticipants.push({
      phone: item.phone,
      name: item.name,
      avatar_url: item.avatar_url,
    })
  }

  const totalCount =
    fullGroupInfo?.size ||
    (Array.isArray(fullGroupInfo?.participants) ? fullGroupInfo.participants.length : 0) ||
    deduplicatedParticipants.length;

  return NextResponse.json({
    subject: fullGroupInfo?.subject || null,
    description: fullGroupInfo?.description || null,
    pictureUrl: fullGroupInfo?.pictureUrl || null,
    owner: fullGroupInfo?.owner || null,
    totalParticipantsCount: totalCount,
    participants: deduplicatedParticipants,
    media: mediaList,
    links: linksList,
    docs: docsList,
  })
}
