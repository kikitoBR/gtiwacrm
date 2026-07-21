import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

/**
 * GET /api/whatsapp/config
 * Supports both 'meta' and 'evolution' providers.
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_account',
          message: 'Your profile is not linked to an account.',
        },
        { status: 200 },
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token, status, provider_type, evolution_api_url, evolution_api_key, evolution_instance_name')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError) {
      console.error('Error fetching whatsapp_config:', configError)
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: 'Failed to fetch configuration' },
        { status: 200 }
      )
    }

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: 'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 }
      )
    }

    const providerType = config.provider_type || 'meta'

    if (providerType === 'evolution') {
      if (!config.evolution_api_url || !config.evolution_api_key || !config.evolution_instance_name) {
        return NextResponse.json(
          {
            connected: false,
            reason: 'no_config',
            message: 'Evolution API configuration is incomplete.',
          },
          { status: 200 }
        )
      }

      let decryptedApiKey: string
      try {
        decryptedApiKey = decrypt(config.evolution_api_key)
      } catch (err) {
        console.error('[whatsapp/config GET] Evolution key decryption failed:', err)
        return NextResponse.json(
          {
            connected: false,
            reason: 'token_corrupted',
            needs_reset: true,
            message: 'Stored Evolution API credentials cannot be decrypted with the current ENCRYPTION_KEY.',
          },
          { status: 200 }
        )
      }

      const decryptedInstanceName = config.evolution_instance_name

      // Health check Evolution connectionState
      try {
        const checkUrl = `${config.evolution_api_url.replace(/\/$/, '')}/instance/connectionState/${decryptedInstanceName}`
        const res = await fetch(checkUrl, {
          method: 'GET',
          headers: { apikey: decryptedApiKey },
        })

        if (!res.ok) {
          throw new Error(`Server returned code ${res.status}`)
        }

        const data = await res.json()
        const state = data?.instance?.state
        const isConnected = state === 'open'

        return NextResponse.json({
          connected: isConnected,
          phone_info: {
            id: decryptedInstanceName,
            display_phone_number: `Instance: ${decryptedInstanceName} (${state || 'unknown'})`,
            verified_name: `Evolution API - ${decryptedInstanceName}`,
          },
          reason: isConnected ? null : 'disconnected',
          message: isConnected ? '' : `WhatsApp connection is ${state || 'disconnected'}. Please scan the QR Code.`,
        })
      } catch (err: any) {
        return NextResponse.json({
          connected: false,
          reason: 'evolution_api_error',
          message: `Failed to connect to Evolution API: ${err.message || err}`,
        })
      }
    }

    // Default Meta Flow
    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (err) {
      console.error('[whatsapp/config GET] Token decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments (local vs Hostinger vs Vercel). Click "Reset Configuration" below, then re-save.',
        },
        { status: 200 }
      )
    }

    try {
      const phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
      })
      return NextResponse.json({ connected: true, phone_info: phoneInfo })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[whatsapp/config GET] Meta API verification failed:', message)
      return NextResponse.json(
        {
          connected: false,
          reason: 'meta_api_error',
          message: `Meta API rejected the credentials: ${message}`,
        },
        { status: 200 }
      )
    }
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/whatsapp/config
 * Supports both Meta and Evolution API configuration.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const {
      provider_type = 'meta',
      phone_number_id,
      waba_id,
      access_token,
      verify_token,
      pin,
      evolution_api_url,
      evolution_api_key,
      evolution_instance_name,
    } = body

    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id, registered_at, phone_number_id, evolution_api_key, evolution_instance_name, evolution_api_url')
      .eq('account_id', accountId)
      .maybeSingle()

    const MASKED_TOKEN = '••••••••••••••••'

    if (provider_type === 'evolution') {
      const finalApiUrl = evolution_api_url?.trim() || existing?.evolution_api_url
      let rawApiKey = evolution_api_key
      let rawInstanceName = evolution_instance_name

      if (!finalApiUrl) {
        return NextResponse.json(
          { error: 'Evolution API URL is required.' },
          { status: 400 }
        )
      }

      if (!rawApiKey || rawApiKey === MASKED_TOKEN) {
        rawApiKey = existing?.evolution_api_key ? decrypt(existing.evolution_api_key) : undefined
      }
      if (!rawInstanceName || rawInstanceName === MASKED_TOKEN) {
        rawInstanceName = existing?.evolution_instance_name ? decrypt(existing.evolution_instance_name) : undefined
      }

      if (!rawApiKey || !rawInstanceName) {
        return NextResponse.json(
          { error: 'API Key and Instance Name are required.' },
          { status: 400 }
        )
      }

      // Check if instance configuration is valid by checking connectionState (auth check)
      try {
        const checkUrl = `${finalApiUrl.replace(/\/$/, '')}/instance/connectionState/${rawInstanceName}`
        const res = await fetch(checkUrl, {
          method: 'GET',
          headers: { apikey: rawApiKey },
        })

        if (res.status === 401) {
          return NextResponse.json(
            { error: 'Evolution API Key is invalid (401 Unauthorized).' },
            { status: 400 }
          )
        }
      } catch (err: any) {
        console.warn('Could not contact Evolution API during validation:', err.message)
        // We warn but don't strictly fail block if the server is temporarily offline, to allow saving.
      }

      // Encrypt sensitive info
      let encryptedApiKey: string
      try {
        encryptedApiKey = encrypt(rawApiKey)
      } catch (err) {
        return NextResponse.json(
          { error: 'Encryption failed. Check your ENCRYPTION_KEY environment variable.' },
          { status: 500 }
        )
      }

      const baseRow = {
        provider_type: 'evolution',
        evolution_api_url: finalApiUrl,
        evolution_api_key: encryptedApiKey,
        evolution_instance_name: rawInstanceName,
        status: 'connected',
        phone_number_id: null,
        waba_id: null,
        access_token: null,
        verify_token: null,
        connected_at: new Date().toISOString(),
        registered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      if (existing) {
        const { error: updateError } = await supabase
          .from('whatsapp_config')
          .update(baseRow)
          .eq('account_id', accountId)

        if (updateError) {
          console.error('Error updating Evolution config:', updateError)
          return NextResponse.json({ error: 'Failed to update Evolution configuration' }, { status: 500 })
        }
      } else {
        const { error: insertError } = await supabase
          .from('whatsapp_config')
          .insert({
            account_id: accountId,
            user_id: user.id,
            ...baseRow,
          })

        if (insertError) {
          console.error('Error inserting Evolution config:', insertError)
          return NextResponse.json({ error: 'Failed to save Evolution configuration' }, { status: 500 })
        }
      }

      return NextResponse.json({
        success: true,
        saved: true,
        registered: true,
        phone_info: {
          id: evolution_instance_name,
          display_phone_number: `Instance: ${evolution_instance_name}`,
          verified_name: `Evolution API - ${evolution_instance_name}`,
        },
      })
    }

    // --- Meta Flow ---
    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: 'access_token and phone_number_id are required' },
        { status: 400 }
      )
    }

    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json(
          { error: 'PIN must be exactly 6 digits.' },
          { status: 400 }
        )
      }
    }

    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', phone_number_id)
      .neq('account_id', accountId)
      .maybeSingle()

    if (claimedError) {
      console.error('Error checking phone_number_id ownership:', claimedError)
      return NextResponse.json(
        { error: 'Failed to validate configuration' },
        { status: 500 }
      )
    }

    if (claimed) {
      return NextResponse.json(
        { error: 'This WhatsApp phone number is already linked to another account.' },
        { status: 409 }
      )
    }

    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken: access_token,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Meta API verification failed during save:', message)
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 400 }
      )
    }

    let encryptedAccessToken: string
    let encryptedVerifyToken: string | null
    try {
      encryptedAccessToken = encrypt(access_token)
      encryptedVerifyToken = verify_token ? encrypt(verify_token) : null
    } catch (err) {
      return NextResponse.json(
        { error: 'Failed to encrypt token.' },
        { status: 500 }
      )
    }

    const sameNumber =
      existing?.phone_number_id === phone_number_id &&
      existing?.registered_at != null

    let registeredAt: string | null = existing?.registered_at ?? null
    let registrationError: string | null = null
    let registrationSkipped = false

    const needsRegistration = !sameNumber || (typeof pin === 'string' && pin.length > 0)
    if (needsRegistration) {
      if (!pin) {
        registrationSkipped = true
      } else {
        try {
          await registerPhoneNumber({
            phoneNumberId: phone_number_id,
            accessToken: access_token,
            pin,
          })
          registeredAt = new Date().toISOString()
        } catch (err) {
          registrationError = err instanceof Error ? err.message : 'Unknown Meta API error'
          console.error('Phone number /register failed:', registrationError)
        }
      }
    }

    let subscribedAppsAt: string | null = null
    if (waba_id) {
      try {
        await subscribeWabaToApp({
          wabaId: waba_id,
          accessToken: access_token,
        })
        subscribedAppsAt = new Date().toISOString()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('WABA subscribed_apps failed (non-fatal):', message)
      }
    }

    const baseRow = {
      provider_type: 'meta',
      phone_number_id,
      waba_id: waba_id || null,
      access_token: encryptedAccessToken,
      verify_token: encryptedVerifyToken,
      status: registrationError ? 'disconnected' : 'connected',
      connected_at: registrationError ? null : new Date().toISOString(),
      registered_at: registrationError ? null : registeredAt,
      subscribed_apps_at: subscribedAppsAt ?? null,
      last_registration_error: registrationError,
      evolution_api_url: null,
      evolution_api_key: null,
      evolution_instance_name: null,
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update(baseRow)
        .eq('account_id', accountId)

      if (updateError) {
        console.error('Error updating Meta config:', updateError)
        return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 })
      }
    } else {
      const { error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({
          account_id: accountId,
          user_id: user.id,
          ...baseRow,
        })

      if (insertError) {
        console.error('Error inserting Meta config:', insertError)
        return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
      }
    }

    if (registrationError) {
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        registration_error: registrationError,
        phone_info: phoneInfo,
      })
    }

    return NextResponse.json({
      success: true,
      saved: true,
      registered: registeredAt != null,
      registration_skipped: registrationSkipped,
      phone_info: phoneInfo,
    })
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const { error: deleteError } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', accountId)

    if (deleteError) {
      console.error('Error deleting whatsapp_config:', deleteError)
      return NextResponse.json({ error: 'Failed to delete configuration' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
