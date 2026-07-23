import type { WhatsAppProvider, WhatsAppSendResult } from './provider'
import type { MessageTemplate } from '@/types'
import type { SendTimeParams } from './template-send-builder'
import type { InteractiveButton, InteractiveListSection, MediaKind } from './meta-api'

export class EvolutionWhatsAppProvider implements WhatsAppProvider {
  private apiUrl: string
  private apiKey: string
  private instanceName: string

  constructor(apiUrl: string, apiKey: string, instanceName: string) {
    this.apiUrl = apiUrl.replace(/\/$/, '') // remove trailing slash
    this.apiKey = apiKey
    this.instanceName = instanceName
  }

  private async request(
    endpoint: string,
    body?: Record<string, unknown>,
    method: string = 'POST'
  ): Promise<Record<string, unknown>> {
    let url = `${this.apiUrl}${endpoint}/${this.instanceName}`
    if (method === 'GET' && body) {
      const params = new URLSearchParams()
      for (const [key, val] of Object.entries(body)) {
        if (val !== undefined && val !== null) params.append(key, String(val))
      }
      const qs = params.toString()
      if (qs) url += `?${qs}`
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: this.apiKey,
      },
      body: method !== 'GET' && body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      let errMessage = `Evolution API error: ${response.status}`
      try {
        const errData = await response.json()
        if (errData?.message) errMessage = errData.message
      } catch {
        /* ignore */
      }
      throw new Error(errMessage)
    }

    return response.json()
  }

  private buildQuotedPayload(
    toPhone: string,
    contextMessageId?: string,
    contextFromMe?: boolean
  ): Record<string, unknown> {
    if (!contextMessageId) return {}
    let remoteJid = toPhone
    if (!remoteJid.includes('@')) {
      remoteJid = `${toPhone}@s.whatsapp.net`
    }
    const quotedObj = {
      key: {
        id: contextMessageId,
        remoteJid,
        fromMe: contextFromMe ?? false,
      },
    }
    return {
      quoted: quotedObj,
      options: { quoted: quotedObj },
      quotedMessageId: contextMessageId,
    }
  }

  async sendTextMessage(args: {
    to: string
    text: string
    contextMessageId?: string
    contextFromMe?: boolean
  }): Promise<WhatsAppSendResult> {
    const toPhone = this.formatPhone(args.to)
    const body: Record<string, unknown> = {
      number: toPhone,
      text: args.text,
      linkPreview: true,
      ...this.buildQuotedPayload(toPhone, args.contextMessageId, args.contextFromMe),
    }

    const data = (await this.request('/message/sendText', body)) as {
      key?: { id?: string }
      messageId?: string
    }
    // Evolution API typically returns message status inside data.key.id
    const messageId = data?.key?.id || data?.messageId || `evo-${Date.now()}`
    return { messageId }
  }

  async sendMediaMessage(args: {
    to: string
    kind: MediaKind
    link: string
    caption?: string
    filename?: string
    contextMessageId?: string
    contextFromMe?: boolean
  }): Promise<WhatsAppSendResult> {
    const toPhone = this.formatPhone(args.to)
    const quotedPayload = this.buildQuotedPayload(toPhone, args.contextMessageId, args.contextFromMe)

    // For audio/voice note, try /message/sendWhatsAppAudio first or fallback to /message/sendMedia
    if (args.kind === 'audio') {
      try {
        const pttBody: Record<string, unknown> = {
          number: toPhone,
          audio: args.link,
          ...quotedPayload,
        }
        const data = (await this.request('/message/sendWhatsAppAudio', pttBody)) as {
          key?: { id?: string }
          messageId?: string
        }
        const messageId = data?.key?.id || data?.messageId || `evo-${Date.now()}`
        return { messageId }
      } catch (err) {
        console.warn('[Evolution API] sendWhatsAppAudio failed, falling back to sendMedia:', err)
      }
    }

    const body: Record<string, unknown> = {
      number: toPhone,
      mediatype: args.kind,
      media: args.link,
      caption: args.caption || '',
      ...quotedPayload,
    }

    if (args.kind === 'document' && args.filename) {
      body.fileName = args.filename
    }

    const data = (await this.request('/message/sendMedia', body)) as {
      key?: { id?: string }
      messageId?: string
    }
    const messageId = data?.key?.id || data?.messageId || `evo-${Date.now()}`
    return { messageId }
  }

  async sendTemplateMessage(args: {
    to: string
    templateName: string
    language?: string
    template?: MessageTemplate
    messageParams?: SendTimeParams
    contextMessageId?: string
  }): Promise<WhatsAppSendResult> {
    // Como a Evolution API roda sobre conexões normais (web/QR), ela não precisa registrar templates
    // oficiais no painel da Meta para enviar mensagens.
    // Nós emulamos os templates interpolando as variáveis diretamente na mensagem de texto ou mídia.
    const toPhone = this.formatPhone(args.to)

    const { templateName, template, messageParams } = args

    if (!template) {
      // Fallback simples para caso não haja o objeto do template: envia como texto simples listando os parametros
      const textParams = messageParams?.body || []
      const fallbackText = `[Template: ${templateName}] ${textParams.join(', ')}`
      return this.sendTextMessage({
        to: toPhone,
        text: fallbackText,
        contextMessageId: args.contextMessageId,
      })
    }

    // Interpolar variáveis do corpo (body)
    let bodyText = template.body_text
    const variables = messageParams?.body || []
    variables.forEach((val: string, idx: number) => {
      // Meta variables are 1-based, e.g. {{1}}, {{2}}
      bodyText = bodyText.replace(new RegExp(`\\{\\{${idx + 1}\\}\\}`, 'g'), String(val))
    })

    // Caso o template exija cabeçalho de mídia (ex: imagem, documento)
    const headerType = template.header_type
    if (headerType && headerType !== 'text') {
      const mediaUrl = messageParams?.headerMediaUrl || ''
      if (mediaUrl) {
        let kind: MediaKind = 'document'
        if (headerType === 'image') kind = 'image'
        if (headerType === 'video') kind = 'video'
        
        return this.sendMediaMessage({
          to: toPhone,
          kind,
          link: mediaUrl,
          caption: bodyText,
          contextMessageId: args.contextMessageId,
        })
      }
    }

    // Interpolar cabeçalho de texto
    let headerText = ''
    if (headerType === 'text' && template.header_content) {
      headerText = template.header_content
      const headerVar = messageParams?.headerText
      if (headerVar) {
        headerText = headerText.replace(/\{\{1\}\}/g, headerVar)
      }
    }

    // Tratar rodapé opcional
    const footerText = template.footer_text || undefined

    // Se o template contiver botões interativos
    if (template.buttons && template.buttons.length > 0) {
      // Converter os botões do formato de template para InteractiveButton
      const interactiveButtons: InteractiveButton[] = template.buttons.map((btn, idx) => {
        return {
          id: btn.type === 'QUICK_REPLY' ? btn.text : `btn-${idx}`,
          title: btn.text,
        }
      })

      return this.sendInteractiveButtons({
        to: toPhone,
        bodyText,
        buttons: interactiveButtons,
        headerText: headerText || undefined,
        footerText,
        contextMessageId: args.contextMessageId,
      })
    }

    // Envio padrão como texto simples com cabeçalho opcional
    const finalText = headerText ? `*${headerText}*\n\n${bodyText}` : bodyText
    return this.sendTextMessage({
      to: toPhone,
      text: finalText,
      contextMessageId: args.contextMessageId,
    })
  }

  async sendReactionMessage(args: {
    to: string
    targetMessageId: string
    emoji: string
  }): Promise<WhatsAppSendResult> {
    const toPhone = this.formatPhone(args.to)
    const body = {
      reactionMessage: {
        key: {
          remoteJid: toPhone,
          id: args.targetMessageId,
        },
        reaction: args.emoji,
      },
      reaction: args.emoji,
      messageId: args.targetMessageId,
      key: {
        remoteJid: toPhone,
        id: args.targetMessageId,
      },
    }

    const data = (await this.request('/message/sendReaction', body)) as {
      key?: { id?: string }
      messageId?: string
    }
    const messageId = data?.key?.id || data?.messageId || `evo-${Date.now()}`
    return { messageId }
  }

  async sendInteractiveButtons(args: {
    to: string
    bodyText: string
    buttons: InteractiveButton[]
    headerText?: string
    footerText?: string
    contextMessageId?: string
    contextFromMe?: boolean
  }): Promise<WhatsAppSendResult> {
    const toPhone = this.formatPhone(args.to)
    const body: Record<string, unknown> = {
      number: toPhone,
      title: args.headerText || '',
      description: args.bodyText,
      footer: args.footerText || '',
      buttons: args.buttons.map((btn) => ({
        id: btn.id,
        label: btn.title,
      })),
      ...this.buildQuotedPayload(toPhone, args.contextMessageId, args.contextFromMe),
    }

    if (!body.title) delete body.title
    if (!body.footer) delete body.footer

    try {
      const data = (await this.request('/message/sendButtons', body)) as {
        key?: { id?: string }
        messageId?: string
      }
      const messageId = data?.key?.id || data?.messageId || `evo-${Date.now()}`
      return { messageId }
    } catch (err) {
      console.warn('[Evolution API] sendButtons failed, falling back to formatted text message:', err)
      const fallbackText = this.formatButtonsAsText(args)
      return this.sendTextMessage({
        to: toPhone,
        text: fallbackText,
        contextMessageId: args.contextMessageId,
        contextFromMe: args.contextFromMe,
      })
    }
  }

  async sendInteractiveList(args: {
    to: string
    bodyText: string
    buttonLabel: string
    sections: InteractiveListSection[]
    headerText?: string
    footerText?: string
    contextMessageId?: string
    contextFromMe?: boolean
  }): Promise<WhatsAppSendResult> {
    const toPhone = this.formatPhone(args.to)
    const body: Record<string, unknown> = {
      number: toPhone,
      title: args.headerText || '',
      description: args.bodyText,
      footer: args.footerText || '',
      buttonText: args.buttonLabel,
      sections: args.sections.map((sec) => ({
        title: sec.title || 'Opções',
        rows: sec.rows.map((row) => ({
          title: row.title,
          description: row.description || '',
          rowId: row.id,
        })),
      })),
      ...this.buildQuotedPayload(toPhone, args.contextMessageId, args.contextFromMe),
    }

    if (!body.title) delete body.title
    if (!body.footer) delete body.footer

    try {
      const data = (await this.request('/message/sendList', body)) as {
        key?: { id?: string }
        messageId?: string
      }
      const messageId = data?.key?.id || data?.messageId || `evo-${Date.now()}`
      return { messageId }
    } catch (err) {
      console.warn('[Evolution API] sendList failed, falling back to formatted text message:', err)
      const fallbackText = this.formatListAsText(args)
      return this.sendTextMessage({
        to: toPhone,
        text: fallbackText,
        contextMessageId: args.contextMessageId,
        contextFromMe: args.contextFromMe,
      })
    }
  }

  private formatButtonsAsText(args: {
    bodyText: string
    buttons: InteractiveButton[]
    headerText?: string
    footerText?: string
  }): string {
    const parts: string[] = []
    if (args.headerText?.trim()) {
      parts.push(`*${args.headerText.trim()}*`)
    }
    parts.push(args.bodyText)

    parts.push('\n🔘 *Opções:*')
    args.buttons.forEach((btn, idx) => {
      parts.push(`${idx + 1}. *${btn.title}*`)
    })

    if (args.footerText?.trim()) {
      parts.push(`\n_${args.footerText.trim()}_`)
    }

    return parts.join('\n')
  }

  private formatListAsText(args: {
    bodyText: string
    buttonLabel: string
    sections: InteractiveListSection[]
    headerText?: string
    footerText?: string
  }): string {
    const parts: string[] = []
    if (args.headerText?.trim()) {
      parts.push(`*${args.headerText.trim()}*`)
    }
    parts.push(args.bodyText)

    args.sections.forEach((sec) => {
      if (sec.title?.trim()) {
        parts.push(`\n📋 *${sec.title.trim()}*`)
      }
      sec.rows.forEach((row, idx) => {
        const desc = row.description ? ` - ${row.description}` : ''
        parts.push(`${idx + 1}. *${row.title}*${desc}`)
      })
    })

    if (args.footerText?.trim()) {
      parts.push(`\n_${args.footerText.trim()}_`)
    }

    return parts.join('\n')
  }

  async getProfilePictureUrl(phoneOrJid: string): Promise<string | null> {
    try {
      const number = this.formatPhone(phoneOrJid)
      let data: Record<string, unknown> | null = null
      try {
        data = await this.request('/chat/fetchProfilePictureUrl', { number }, 'POST')
      } catch {
        try {
          data = await this.request('/chat/fetchProfilePictureUrl', { number: `${number}@s.whatsapp.net` }, 'POST')
        } catch {
          data = await this.request('/chat/fetchProfilePictureUrl', { number }, 'GET')
        }
      }
      return (
        (data?.profilePictureUrl as string) ||
        (data?.pictureUrl as string) ||
        (data?.url as string) ||
        (data?.picture as string) ||
        null
      )
    } catch {
      return null
    }
  }

  async getGroupInfo(groupJid: string): Promise<{ subject?: string; pictureUrl?: string } | null> {
    try {
      let data: Record<string, unknown> | null = null
      try {
        data = await this.request('/group/findGroupInfos', { groupJid }, 'GET')
      } catch {
        try {
          data = await this.request('/group/findGroupInfos', { groupJid }, 'POST')
        } catch {
          // Fallback to fetchAllGroups
          const groups = (await this.request('/group/fetchAllGroups', { getParticipants: false }, 'GET')) as unknown as Array<{
            id?: string
            subject?: string
            name?: string
            pictureUrl?: string
          }>
          if (Array.isArray(groups)) {
            data = (groups.find((g) => g.id === groupJid) as Record<string, unknown>) || null
          }
        }
      }
      return {
        subject: (data?.subject as string) || (data?.name as string) || (data?.groupSubject as string) || undefined,
        pictureUrl: (data?.pictureUrl as string) || (data?.profilePictureUrl as string) || (data?.url as string) || undefined,
      }
    } catch {
      return null
    }
  }

  async getGroupParticipantsMap(groupJid: string): Promise<Map<string, { phone: string; lid?: string }>> {
    const map = new Map<string, { phone: string; lid?: string }>()
    try {
      let data: Record<string, unknown> | null = null
      try {
        data = await this.request('/group/findGroupInfos', { groupJid }, 'GET')
      } catch {
        try {
          data = await this.request('/group/findGroupInfos', { groupJid }, 'POST')
        } catch {
          /* ignore */
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const participants = (data?.participants || data?.members) as any[]
      if (Array.isArray(participants)) {
        for (const p of participants) {
          const rawId = typeof p === 'string' ? p : p?.id || p?.jid || ''
          const rawLid = typeof p === 'object' ? p?.lid || '' : ''
          const phone = rawId.split('@')[0].split(':')[0]
          const cleanPhone = phone.replace(/\D/g, '')
          if (cleanPhone) {
            map.set(cleanPhone, { phone: cleanPhone, lid: rawLid })
            if (rawLid) {
              const cleanLid = rawLid.split('@')[0].split(':')[0].replace(/\D/g, '')
              if (cleanLid) {
                map.set(cleanLid, { phone: cleanPhone, lid: cleanLid })
              }
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
    return map
  }

  async getBase64FromMedia(messageItem: Record<string, unknown>): Promise<{ base64?: string; mimeType?: string } | null> {
    try {
      const data = (await this.request('/chat/getBase64FromMediaMessage', {
        message: messageItem,
        convertToMp4: false,
      })) as { base64?: string; mimetype?: string; mimeType?: string }

      if (data?.base64) {
        return {
          base64: data.base64,
          mimeType: data.mimetype || data.mimeType || undefined,
        }
      }
      return null
    } catch {
      return null
    }
  }

  private formatPhone(phone: string): string {
    if (phone.includes('@g.us')) return phone
    // A Evolution API geralmente prefere números formatados apenas com números sem '+' ou '@s.whatsapp.net'
    return phone.replace(/\D/g, '')
  }
}
