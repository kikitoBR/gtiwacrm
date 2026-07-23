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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const phone = searchParams.get('phone')

  if (!phone) {
    return NextResponse.json({ error: 'phone query parameter is required' }, { status: 400 })
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

  const cleanPhone = phone.split('@')[0].split(':')[0]
  const digitsOnly = cleanPhone.replace(/\D/g, '')

  const admin = supabaseAdmin()
  const { data: existingContact } = await admin
    .from('contacts')
    .select('id, avatar_url')
    .eq('account_id', accountId)
    .or(`phone.eq.${cleanPhone},phone_normalized.eq.${digitsOnly}`)
    .maybeSingle()

  if (existingContact?.avatar_url) {
    return NextResponse.json({ avatar_url: existingContact.avatar_url })
  }

  const { data: config } = await admin
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()

  if (!config) {
    return NextResponse.json({ avatar_url: null })
  }

  try {
    const provider = getWhatsAppProvider(config) as unknown as {
      getProfilePictureUrl?: (phone: string) => Promise<string | null>
    }
    if (!provider.getProfilePictureUrl) {
      return NextResponse.json({ avatar_url: null })
    }

    const avatarUrl = await provider.getProfilePictureUrl(cleanPhone)
    if (avatarUrl && existingContact) {
      await admin
        .from('contacts')
        .update({ avatar_url: avatarUrl })
        .eq('id', existingContact.id)
    }

    return NextResponse.json({ avatar_url: avatarUrl || null })
  } catch (err) {
    console.warn('[contact-avatar] Failed to fetch profile picture:', err)
    return NextResponse.json({ avatar_url: null })
  }
}
