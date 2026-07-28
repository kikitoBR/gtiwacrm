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

export async function POST() {
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
  const { data: config } = await admin
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()

  if (!config) {
    return NextResponse.json({ error: 'Configuração do WhatsApp não encontrada' }, { status: 400 })
  }

  const provider = getWhatsAppProvider(config)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provAny = provider as any

  if (typeof provAny.syncContacts !== 'function') {
    return NextResponse.json({ error: 'Provedor não suporta sincronização de contatos' }, { status: 400 })
  }

  const rawContacts = await provAny.syncContacts()
  let syncedCount = 0

  if (Array.isArray(rawContacts) && rawContacts.length > 0) {
    // Build a set of valid phone numbers for sync
    const candidatesByPhone = new Map<string, { name: string; avatar_url: string | null }>()
    for (const item of rawContacts) {
      const cleanPhone = item.id ? item.id.replace(/\D/g, '') : ''
      if (cleanPhone && cleanPhone.length >= 8 && cleanPhone.length <= 13) {
        const name = item.name || item.pushName || `+${cleanPhone}`
        const avatar_url = item.pictureUrl || null
        // Only set name if we don't already have a better one
        if (!candidatesByPhone.has(cleanPhone)) {
          candidatesByPhone.set(cleanPhone, { name, avatar_url })
        } else {
          const existing = candidatesByPhone.get(cleanPhone)!
          // Prefer a real name over a phone number placeholder
          if (existing.name.startsWith('+') && !name.startsWith('+')) {
            existing.name = name
          }
          if (avatar_url && !existing.avatar_url) {
            existing.avatar_url = avatar_url
          }
        }
      }
    }

    // Fetch existing contacts so we don't overwrite good names with generic ones
    const phones = Array.from(candidatesByPhone.keys())
    const { data: existingContacts } = await admin
      .from('contacts')
      .select('phone, name')
      .eq('account_id', accountId)
      .in('phone', phones)

    const existingNameByPhone = new Map<string, string>()
    if (existingContacts) {
      for (const c of existingContacts) {
        if (c.phone && c.name) {
          existingNameByPhone.set(c.phone, c.name)
        }
      }
    }

    const toUpsert = []
    for (const [phone, candidate] of candidatesByPhone) {
      const existingName = existingNameByPhone.get(phone)

      // If contact already exists in DB with a proper name, don't overwrite it
      // unless the new name is actually better (not a phone number placeholder)
      let finalName = candidate.name
      if (existingName && !existingName.startsWith('+')) {
        // Existing name is real — only overwrite if new name is also real and different
        // AND not a generic group subject or placeholder
        if (finalName.startsWith('+') || finalName === existingName) {
          finalName = existingName
        }
      }

      toUpsert.push({
        account_id: accountId,
        phone,
        name: finalName,
        avatar_url: candidate.avatar_url,
      })
    }

    if (toUpsert.length > 0) {
      const { data: upserted } = await admin
        .from('contacts')
        .upsert(toUpsert, { onConflict: 'account_id,phone' })
        .select('id')

      syncedCount = upserted?.length || toUpsert.length
    }
  }

  return NextResponse.json({ success: true, syncedCount })
}
