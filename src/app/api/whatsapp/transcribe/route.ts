import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentAccount } from '@/lib/auth/account'

export async function POST(req: Request) {
  try {
    const db = await createClient()
    const account = await getCurrentAccount()
    if (!account) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const body = await req.json()
    const { mediaUrl, messageId } = body || {}

    if (!mediaUrl || typeof mediaUrl !== 'string') {
      return NextResponse.json(
        { error: 'URL do áudio é obrigatória' },
        { status: 400 }
      )
    }

    // Determine Groq / OpenAI API key
    const groqKey = process.env.GROQ_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY

    let apiKey = groqKey || openaiKey
    let provider: 'groq' | 'openai' = groqKey ? 'groq' : 'openai'

    if (!apiKey) {
      // Fallback to ai_configs table in DB
      const { data: aiConfig } = await db
        .from('ai_configs')
        .select('api_key')
        .eq('account_id', account.accountId)
        .maybeSingle()

      if (aiConfig?.api_key) {
        try {
          const { decrypt } = await import('@/lib/whatsapp/encryption')
          apiKey = decrypt(aiConfig.api_key)
          provider = 'openai'
        } catch {
          /* ignore decrypt failure */
        }
      }
    }

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'Chave da API do Groq não configurada. Adicione GROQ_API_KEY no arquivo .env para ativar a transcrição.',
        },
        { status: 400 }
      )
    }

    // Resolve audio URL (if relative local proxy path, construct absolute URL or fetch)
    let fetchUrl = mediaUrl
    if (mediaUrl.startsWith('/')) {
      const origin = new URL(req.url).origin
      fetchUrl = `${origin}${mediaUrl}`
    }

    const audioRes = await fetch(fetchUrl)
    if (!audioRes.ok) {
      return NextResponse.json(
        { error: 'Não foi possível baixar o arquivo de áudio' },
        { status: 400 }
      )
    }

    const audioBlob = await audioRes.blob()
    const formData = new FormData()

    // Determine filename extension
    const extension = mediaUrl.includes('.mp3')
      ? 'mp3'
      : mediaUrl.includes('.m4a')
      ? 'm4a'
      : mediaUrl.includes('.wav')
      ? 'wav'
      : 'ogg'

    formData.append('file', audioBlob, `audio.${extension}`)
    formData.append(
      'model',
      provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1'
    )
    formData.append('language', 'pt')
    formData.append('response_format', 'json')

    const endpoint =
      provider === 'groq'
        ? 'https://api.groq.com/openai/v1/audio/transcriptions'
        : 'https://api.openai.com/v1/audio/transcriptions'

    const groqRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    })

    if (!groqRes.ok) {
      const errText = await groqRes.text()
      console.error('[transcribe] API error:', errText)
      return NextResponse.json(
        { error: `Erro na transcrição: ${groqRes.statusText}` },
        { status: groqRes.status }
      )
    }

    const result = await groqRes.json()
    const text = (result.text || '').trim()

    // Cache transcription in DB if messageId provided
    if (messageId && text) {
      try {
        const { data: msgRow } = await db
          .from('messages')
          .select('metadata')
          .eq('id', messageId)
          .maybeSingle()

        const currentMetadata = (msgRow?.metadata as Record<string, unknown>) || {}
        await db
          .from('messages')
          .update({
            metadata: {
              ...currentMetadata,
              transcription: text,
            },
          })
          .eq('id', messageId)
      } catch (err) {
        console.warn('[transcribe] Could not cache transcription in DB:', err)
      }
    }

    return NextResponse.json({ success: true, text })
  } catch (err) {
    console.error('[transcribe] Internal error:', err)
    return NextResponse.json(
      { error: 'Erro interno ao processar a transcrição' },
      { status: 500 }
    )
  }
}
