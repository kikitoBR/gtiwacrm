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
    body: Record<string, unknown>
  ): Promise<{ key?: { id?: string }; messageId?: string }> {
    const url = `${this.apiUrl}${endpoint}/${this.instanceName}`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.apiKey,
      },
      body: JSON.stringify(body),
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

  async sendTextMessage(args: {
    to: string
    text: string
    contextMessageId?: string
  }): Promise<WhatsAppSendResult> {
    const toPhone = this.formatPhone(args.to)
    const body: Record<string, unknown> = {
      number: toPhone,
      text: args.text,
      linkPreview: true,
    }

    if (args.contextMessageId) {
      body.options = {
        quoted: {
          key: {
            id: args.contextMessageId,
          },
        },
      }
    }

    const data = await this.request('/message/sendText', body)
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
  }): Promise<WhatsAppSendResult> {
    const toPhone = this.formatPhone(args.to)
    
    // Map media types: Meta audio is voice note, Evolution handles image, video, document, audio
    let mediaType = args.kind as string
    if (mediaType === 'audio') {
      mediaType = 'audio'
    }

    const body: Record<string, unknown> = {
      number: toPhone,
      mediatype: mediaType,
      media: args.link,
      caption: args.caption || '',
    }

    if (args.kind === 'document' && args.filename) {
      body.fileName = args.filename
    }

    if (args.contextMessageId) {
      body.options = {
        quoted: {
          key: {
            id: args.contextMessageId,
          },
        },
      }
    }

    const data = await this.request('/message/sendMedia', body)
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
      number: toPhone,
      reaction: args.emoji,
      messageId: args.targetMessageId,
    }

    const data = await this.request('/message/sendReaction', body)
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
    }

    if (!body.title) delete body.title
    if (!body.footer) delete body.footer

    if (args.contextMessageId) {
      body.options = {
        quoted: {
          key: {
            id: args.contextMessageId,
          },
        },
      }
    }

    try {
      const data = await this.request('/message/sendButtons', body)
      const messageId = data?.key?.id || data?.messageId || `evo-${Date.now()}`
      return { messageId }
    } catch (err) {
      console.warn('[Evolution API] sendButtons failed, falling back to formatted text message:', err)
      const fallbackText = this.formatButtonsAsText(args)
      return this.sendTextMessage({
        to: toPhone,
        text: fallbackText,
        contextMessageId: args.contextMessageId,
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
    }

    if (!body.title) delete body.title
    if (!body.footer) delete body.footer

    if (args.contextMessageId) {
      body.options = {
        quoted: {
          key: {
            id: args.contextMessageId,
          },
        },
      }
    }

    try {
      const data = await this.request('/message/sendList', body)
      const messageId = data?.key?.id || data?.messageId || `evo-${Date.now()}`
      return { messageId }
    } catch (err) {
      console.warn('[Evolution API] sendList failed, falling back to formatted text message:', err)
      const fallbackText = this.formatListAsText(args)
      return this.sendTextMessage({
        to: toPhone,
        text: fallbackText,
        contextMessageId: args.contextMessageId,
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

  private formatPhone(phone: string): string {
    // A Evolution API geralmente prefere números formatados apenas com números sem '+' ou '@s.whatsapp.net'
    return phone.replace(/\D/g, '')
  }
}
