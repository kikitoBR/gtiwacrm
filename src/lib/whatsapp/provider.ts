import type { MessageTemplate } from '@/types'
import type { SendTimeParams } from './template-send-builder'
import type { InteractiveButton, InteractiveListSection, MediaKind } from './meta-api'

export interface WhatsAppSendResult {
  messageId: string
}

export interface WhatsAppProvider {
  sendTextMessage(args: {
    to: string
    text: string
    contextMessageId?: string
    contextFromMe?: boolean
  }): Promise<WhatsAppSendResult>

  sendMediaMessage(args: {
    to: string
    kind: MediaKind
    link: string
    caption?: string
    filename?: string
    contextMessageId?: string
    contextFromMe?: boolean
  }): Promise<WhatsAppSendResult>

  sendTemplateMessage(args: {
    to: string
    templateName: string
    language?: string
    template?: MessageTemplate
    messageParams?: SendTimeParams
    contextMessageId?: string
    contextFromMe?: boolean
  }): Promise<WhatsAppSendResult>

  sendReactionMessage(args: {
    to: string
    targetMessageId: string
    emoji: string
  }): Promise<WhatsAppSendResult>

  sendInteractiveButtons(args: {
    to: string
    bodyText: string
    buttons: InteractiveButton[]
    headerText?: string
    footerText?: string
    contextMessageId?: string
    contextFromMe?: boolean
  }): Promise<WhatsAppSendResult>

  sendInteractiveList(args: {
    to: string
    bodyText: string
    buttonLabel: string
    sections: InteractiveListSection[]
    headerText?: string
    footerText?: string
    contextMessageId?: string
    contextFromMe?: boolean
  }): Promise<WhatsAppSendResult>
}
