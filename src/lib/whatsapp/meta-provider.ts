import type { WhatsAppProvider, WhatsAppSendResult } from './provider'
import type { MessageTemplate } from '@/types'
import type { SendTimeParams } from './template-send-builder'
import type { InteractiveButton, InteractiveListSection, MediaKind } from './meta-api'
import * as metaApi from './meta-api'

export class MetaWhatsAppProvider implements WhatsAppProvider {
  private phoneNumberId: string
  private accessToken: string

  constructor(phoneNumberId: string, accessToken: string) {
    this.phoneNumberId = phoneNumberId
    this.accessToken = accessToken
  }

  async sendTextMessage(args: {
    to: string
    text: string
    contextMessageId?: string
    contextFromMe?: boolean
  }): Promise<WhatsAppSendResult> {
    return metaApi.sendTextMessage({
      phoneNumberId: this.phoneNumberId,
      accessToken: this.accessToken,
      to: args.to,
      text: args.text,
      contextMessageId: args.contextMessageId,
    })
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
    return metaApi.sendMediaMessage({
      phoneNumberId: this.phoneNumberId,
      accessToken: this.accessToken,
      to: args.to,
      kind: args.kind,
      link: args.link,
      caption: args.caption,
      filename: args.filename,
      contextMessageId: args.contextMessageId,
    })
  }

  async sendTemplateMessage(args: {
    to: string
    templateName: string
    language?: string
    template?: MessageTemplate
    messageParams?: SendTimeParams
    contextMessageId?: string
    contextFromMe?: boolean
  }): Promise<WhatsAppSendResult> {
    return metaApi.sendTemplateMessage({
      phoneNumberId: this.phoneNumberId,
      accessToken: this.accessToken,
      to: args.to,
      templateName: args.templateName,
      language: args.language,
      template: args.template,
      messageParams: args.messageParams,
      contextMessageId: args.contextMessageId,
    })
  }

  async sendReactionMessage(args: {
    to: string
    targetMessageId: string
    emoji: string
  }): Promise<WhatsAppSendResult> {
    return metaApi.sendReactionMessage({
      phoneNumberId: this.phoneNumberId,
      accessToken: this.accessToken,
      to: args.to,
      targetMessageId: args.targetMessageId,
      emoji: args.emoji,
    })
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
    return metaApi.sendInteractiveButtons({
      phoneNumberId: this.phoneNumberId,
      accessToken: this.accessToken,
      to: args.to,
      bodyText: args.bodyText,
      buttons: args.buttons,
      headerText: args.headerText,
      footerText: args.footerText,
      contextMessageId: args.contextMessageId,
    })
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
    return metaApi.sendInteractiveList({
      phoneNumberId: this.phoneNumberId,
      accessToken: this.accessToken,
      to: args.to,
      bodyText: args.bodyText,
      buttonLabel: args.buttonLabel,
      sections: args.sections,
      headerText: args.headerText,
      footerText: args.footerText,
      contextMessageId: args.contextMessageId,
    })
  }
}
