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
    fromMe?: boolean
  }): Promise<WhatsAppSendResult> {
    const toPhone = this.formatPhone(args.to)
    const cleanPhone = toPhone.replace(/\D/g, '')
    const remoteJid = toPhone.includes('@') ? toPhone : `${cleanPhone}@s.whatsapp.net`
    const fromMe = args.fromMe ?? false
    const key = { remoteJid, fromMe, id: args.targetMessageId }
    const keyPlain = { remoteJid: cleanPhone, fromMe, id: args.targetMessageId }

    const payloads = [
      // Official Evolution API schema from documentation (https://docs.evolutionfoundation.com.br/evolution-api/send-reaction#send-reaction)
      {
        reactionMessage: args.emoji,
        reactionKey: key,
      },
      {
        reactionMessage: args.emoji,
        reactionKey: keyPlain,
      },
      {
        reactionMessage: { key, reaction: args.emoji },
      },
      {
        number: cleanPhone,
        reaction: args.emoji,
        key,
      },
      {
        reaction: args.emoji,
        key,
      },
    ]

    for (const p of payloads) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (await this.request('/message/sendReaction', p, 'POST')) as any
        const messageId = data?.key?.id || data?.messageId || `evo-${Date.now()}`
        return { messageId }
      } catch {
        /* continue fallback */
      }
    }

    return { messageId: `evo-${Date.now()}` }
  }

  async deleteMessage(args: {
    to: string
    messageId: string
    fromMe?: boolean
  }): Promise<{ success: boolean }> {
    const toPhone = this.formatPhone(args.to)
    const cleanPhone = toPhone.replace(/\D/g, '')
    const remoteJid = toPhone.includes('@') ? toPhone : `${cleanPhone}@s.whatsapp.net`
    const fromMe = args.fromMe ?? true
    const key = { remoteJid, fromMe, id: args.messageId }

    const payloads = [
      { number: cleanPhone, id: args.messageId, remoteJid, fromMe, status: 'REVOKE', key },
      { remoteJid, id: args.messageId, fromMe },
      { keys: [key] },
      { key },
    ]

    for (const p of payloads) {
      try {
        await this.request('/message/delete', p, 'POST')
        return { success: true }
      } catch { /* continue */ }

      try {
        await this.request('/message/delete', p, 'DELETE')
        return { success: true }
      } catch { /* continue */ }

      try {
        await this.request('/chat/deleteMessageForEveryone', p, 'DELETE')
        return { success: true }
      } catch { /* continue */ }

      try {
        await this.request('/chat/deleteMessageForEveryone', p, 'POST')
        return { success: true }
      } catch { /* continue */ }

      try {
        await this.request('/message/deleteMessageForEveryone', p, 'POST')
        return { success: true }
      } catch { /* continue */ }
    }

    console.warn('[Evolution API] deleteMessage failed after trying all endpoints')
    return { success: false }
  }

  async editMessage(args: {
    to: string
    messageId: string
    newText: string
    fromMe?: boolean
  }): Promise<{ success: boolean }> {
    const toPhone = this.formatPhone(args.to)
    const remoteJid = toPhone.includes('@') ? toPhone : `${toPhone.replace(/\D/g, '')}@s.whatsapp.net`
    const payload = {
      number: toPhone.replace(/\D/g, ''),
      text: args.newText,
      key: {
        id: args.messageId,
        fromMe: args.fromMe ?? true,
        remoteJid,
      },
    }

    try {
      await this.request('/message/updateMessage', payload, 'POST')
      return { success: true }
    } catch {
      try {
        await this.request('/message/edit', payload, 'POST')
        return { success: true }
      } catch {
        try {
          await this.request('/chat/updateMessage', payload, 'POST')
          return { success: true }
        } catch (err) {
          console.warn('[Evolution API] editMessage failed:', err)
          return { success: false }
        }
      }
    }
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

  private lidCache = new Map<string, { phone: string; name?: string; picture?: string }>()

  public cleanJidToDigits(jid: string): string {
    if (!jid) return ''
    const withoutDevice = jid.split(':')[0]
    const withoutDomain = withoutDevice.split('@')[0]
    return withoutDomain.replace(/[^0-9]/g, '')
  }

  public async resolveLidToPhone(
    lidJid: string
  ): Promise<{ phone: string; name?: string; picture?: string } | null> {
    if (!lidJid) return null
    const cleanedLid = this.cleanJidToDigits(lidJid)
    if (!cleanedLid) return null

    if (this.lidCache.has(cleanedLid)) {
      return this.lidCache.get(cleanedLid)!
    }

    try {
      let data: Record<string, unknown> | null = null
      try {
        data = await this.request('/chat/fetchProfile', { number: lidJid }, 'POST')
      } catch {
        try {
          data = await this.request('/chat/fetchProfile', { number: lidJid }, 'GET')
        } catch {
          /* ignore */
        }
      }

      if (data) {
        const rawPhone = (data.number as string) || (data.phone as string) || this.cleanJidToDigits(data.id as string)
        const phone = rawPhone ? this.cleanJidToDigits(rawPhone) : ''
        const name = (data.name as string) || (data.pushName as string) || (data.formattedName as string) || undefined
        const picture = (data.picture as string) || (data.profilePictureUrl as string) || (data.profilePicUrl as string) || undefined

        if (phone && phone !== cleanedLid && phone.length >= 8 && phone.length <= 13) {
          const result = { phone, name, picture }
          this.lidCache.set(cleanedLid, result)
          return result
        }
      }
    } catch (err) {
      console.warn(`[evolution-provider] Failed to resolve LID ${lidJid}:`, err)
    }

    return null
  }

  private extractParticipantsFromApiData(data: unknown): any[] {
    if (!data) return []
    if (Array.isArray(data)) {
      for (const item of data) {
        const found = this.extractParticipantsFromApiData(item)
        if (found.length > 0) return found
      }
      return []
    }
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, any>
      if (Array.isArray(obj.participants)) return obj.participants
      if (Array.isArray(obj.members)) return obj.members
      if (Array.isArray(obj.groupMetadata?.participants)) return obj.groupMetadata.participants
      if (Array.isArray(obj.data?.participants)) return obj.data.participants
      if (Array.isArray(obj.data?.members)) return obj.data.members
      if (Array.isArray(obj.response?.participants)) return obj.response.participants
    }
    return []
  }

  async getGroupInfo(groupJid: string): Promise<{
    subject?: string
    description?: string
    pictureUrl?: string
    owner?: string
    participants?: Array<{
      id: string
      phone: string | null
      name?: string
      avatar_url?: string | null
      admin?: 'superadmin' | 'admin' | null
    }>
  } | null> {
    try {
      const cleanJid = groupJid.trim()
      const formattedGroupJid = cleanJid.includes('@g.us')
        ? cleanJid
        : `${cleanJid.split('@')[0]}@g.us`

      let data: Record<string, unknown> | null = null
      try {
        data = await this.request('/group/findGroupInfos', { groupJid: formattedGroupJid }, 'GET')
      } catch {
        try {
          data = await this.request('/group/findGroupInfos', { groupJid: formattedGroupJid }, 'POST')
        } catch {
          try {
            data = await this.request('/group/participants', { groupJid: formattedGroupJid }, 'GET')
          } catch {
            try {
              data = await this.request('/group/participants', { groupJid: formattedGroupJid }, 'POST')
            } catch {
              const groups = (await this.request('/group/fetchAllGroups', { getParticipants: true }, 'GET')) as unknown as Array<{
                id?: string
                subject?: string
                name?: string
                pictureUrl?: string
                participants?: unknown[]
              }>
              if (Array.isArray(groups)) {
                data = (groups.find((g) => g.id === formattedGroupJid || g.id === cleanJid) as Record<string, unknown>) || null
              }
            }
          }
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resObj = (data?.data || data?.response || data) as any
      const subject = (resObj?.subject as string) || (resObj?.name as string) || (resObj?.groupSubject as string) || undefined
      const description = (resObj?.description as string) || (resObj?.desc as string) || (typeof resObj?.desc === 'object' ? (resObj?.desc as { text?: string })?.text : undefined) || undefined
      const pictureUrl = (resObj?.pictureUrl as string) || (resObj?.profilePictureUrl as string) || (resObj?.url as string) || undefined
      const owner = typeof resObj?.owner === 'string' ? this.cleanJidToDigits(resObj.owner) : undefined

      const rawParticipants = this.extractParticipantsFromApiData(data)
      const parsedParticipants: Array<{
        id: string
        phone: string | null
        name?: string
        avatar_url?: string | null
        admin?: 'superadmin' | 'admin' | null
      }> = []

      if (Array.isArray(rawParticipants) && rawParticipants.length > 0) {
        let uncachedLidCount = 0
        const MAX_UNCACHED_LID_FETCHES = 10

        for (const p of rawParticipants) {
          const rawId = typeof p === 'string' ? p : p?.id || p?.jid || p?.number || ''
          const rawLid = typeof p === 'object' ? p?.lid || '' : ''
          const admin = typeof p === 'object' ? (p?.admin || p?.role || null) : null
          const pName = typeof p === 'object' ? (p?.pushName || p?.name || p?.formattedName || p?.notify || p?.shortName) : undefined
          const pPicture = typeof p === 'object' ? (p?.imgUrl || p?.pictureUrl || p?.profilePictureUrl) : undefined

          if (!rawId && !rawLid) continue

          const targetJid = rawLid || rawId
          const isLid = targetJid.includes('@lid') || this.cleanJidToDigits(targetJid).length > 13

          if (isLid) {
            const cleanedLid = this.cleanJidToDigits(targetJid)
            if (this.lidCache.has(cleanedLid)) {
              const cached = this.lidCache.get(cleanedLid)!
              parsedParticipants.push({
                id: targetJid,
                phone: cached.phone,
                name: pName || cached.name,
                avatar_url: pPicture || cached.picture,
                admin,
              })
            } else if (uncachedLidCount < MAX_UNCACHED_LID_FETCHES) {
              uncachedLidCount++
              const resolved = await this.resolveLidToPhone(targetJid)
              if (resolved) {
                parsedParticipants.push({
                  id: targetJid,
                  phone: resolved.phone,
                  name: pName || resolved.name,
                  avatar_url: pPicture || resolved.picture,
                  admin,
                })
              } else {
                parsedParticipants.push({
                  id: targetJid,
                  phone: null,
                  name: pName,
                  avatar_url: pPicture,
                  admin,
                })
              }
            } else {
              parsedParticipants.push({
                id: targetJid,
                phone: null,
                name: pName,
                avatar_url: pPicture,
                admin,
              })
            }
          } else {
            const cleanPhone = this.cleanJidToDigits(rawId)
            if (cleanPhone && cleanPhone.length >= 8 && cleanPhone.length <= 13) {
              parsedParticipants.push({
                id: rawId,
                phone: cleanPhone,
                name: pName,
                avatar_url: pPicture,
                admin,
              })
            }
          }
        }
      }

      return {
        subject,
        description,
        pictureUrl,
        owner,
        participants: parsedParticipants,
      }
    } catch {
      return null
    }
  }

  async getGroupParticipantsMap(groupJid: string): Promise<Map<string, { phone: string; lid?: string }>> {
    const map = new Map<string, { phone: string; lid?: string }>()
    try {
      const info = await this.getGroupInfo(groupJid)
      if (info?.participants) {
        for (const p of info.participants) {
          if (p.phone) {
            map.set(p.phone, { phone: p.phone, lid: p.id.includes('@lid') ? p.id : undefined })
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

  async syncContacts(): Promise<Array<{ id: string; name?: string; pushName?: string; pictureUrl?: string }>> {
    const contactsMap = new Map<string, { id: string; name?: string; pushName?: string; pictureUrl?: string }>()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addContact = (item: any) => {
      if (!item) return
      const rawId = typeof item === 'string' ? item : item?.id || item?.jid || item?.number || item?.remoteJid || ''
      if (!rawId || rawId.includes('@g.us')) return
      const cleanPhone = this.cleanJidToDigits(rawId)
      if (cleanPhone.length >= 8 && cleanPhone.length <= 13) {
        const name = typeof item === 'object' ? (item?.name || item?.pushName || item?.formattedName || item?.verifiedName) : undefined
        const pushName = typeof item === 'object' ? item?.pushName : undefined
        const pictureUrl = typeof item === 'object' ? (item?.profilePicUrl || item?.pictureUrl || item?.profilePictureUrl) : undefined

        if (!contactsMap.has(cleanPhone)) {
          contactsMap.set(cleanPhone, { id: cleanPhone, name, pushName, pictureUrl })
        } else {
          const existing = contactsMap.get(cleanPhone)!
          if (!existing.name || existing.name.startsWith('+')) {
            existing.name = name || existing.name
          }
          existing.pictureUrl = pictureUrl || existing.pictureUrl
        }
      }
    }

    // 1. Fetch contacts from /chat/findContacts
    try {
      let data: unknown = null
      try {
        data = await this.request('/chat/findContacts', {}, 'POST')
      } catch {
        try {
          data = await this.request('/chat/findContacts', {}, 'GET')
        } catch {
          data = await this.request('/chat/findContacts', { where: {} }, 'POST')
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = (Array.isArray(data) ? data : (data as any)?.data || (data as any)?.contacts || []) as any[]
      for (const item of list) addContact(item)
    } catch (err) {
      console.warn('[Evolution API] findContacts failed:', err)
    }

    // 2. Fetch active and archived chats from /chat/fetchChats
    try {
      let chatsData: unknown = null
      try {
        chatsData = await this.request('/chat/fetchChats', {}, 'GET')
      } catch {
        chatsData = await this.request('/chat/fetchChats', {}, 'POST')
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chatsList = (Array.isArray(chatsData) ? chatsData : (chatsData as any)?.data || (chatsData as any)?.chats || []) as any[]
      for (const chat of chatsList) addContact(chat)
    } catch (err) {
      console.warn('[Evolution API] fetchChats failed during sync:', err)
    }

    // 3. Fetch all group members from /group/fetchAllGroups
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const groups = (await this.request('/group/fetchAllGroups', { getParticipants: true }, 'GET')) as unknown as any[]
      if (Array.isArray(groups)) {
        for (const g of groups) {
          const participants = this.extractParticipantsFromApiData(g)
          for (const p of participants) addContact(p)
        }
      }
    } catch {
      /* ignore group fetch errors */
    }

    return Array.from(contactsMap.values())
  }

  private formatPhone(phone: string): string {
    if (phone.includes('@g.us')) return phone
    // A Evolution API geralmente prefere números formatados apenas com números sem '+' ou '@s.whatsapp.net'
    return phone.replace(/\D/g, '')
  }
}
