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
    const toUpsert = []
    for (const item of rawContacts) {
      const cleanPhone = item.id ? item.id.replace(/\D/g, '') : ''
      if (cleanPhone && cleanPhone.length >= 8 && cleanPhone.length <= 13) {
        toUpsert.push({
          account_id: accountId,
          phone: cleanPhone,
          name: item.name || item.pushName || `+${cleanPhone}`,
          avatar_url: item.pictureUrl || null,
        })
      }
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
