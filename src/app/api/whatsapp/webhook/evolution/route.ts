import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  findOrCreateContact,
  findOrCreateConversation,
  flagBroadcastReplyIfAny,
} from '../route'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { event, instance, data } = body

    if (!instance || !data) {
      return NextResponse.json({ error: 'Missing instance or data' }, { status: 400 })
    }

    // Buscar a conta correspondente ao instance name no whatsapp_config (salvo em texto claro)
    const { data: config, error: configError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('*')
      .eq('evolution_instance_name', instance)
      .maybeSingle()

    if (configError) {
      console.error('[webhook/evolution] Error fetching config:', configError)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    if (!config) {
      console.warn('[webhook/evolution] No config found for instance:', instance)
      return NextResponse.json({ status: 'ignored', reason: 'No config for instance' }, { status: 200 })
    }

    // ==========================================
    // 1) EVENTO: messages.upsert
    // ==========================================
    if (event === 'messages.upsert') {
      // Normalizar payload (pode vir como objeto unico, array em data ou array em data.messages)
      let item = data
      if (Array.isArray(data)) {
        item = data[0]
      } else if (data && Array.isArray(data.messages)) {
        item = data.messages[0]
      }

      if (!item) {
        return NextResponse.json({ status: 'ignored', reason: 'Empty data payload' }, { status: 200 })
      }

      const key = item.key
      if (!key || !key.remoteJid) {
        return NextResponse.json({ error: 'Invalid message key' }, { status: 200 })
      }

      // Ignora mensagens de grupo ou status
      if (key.remoteJid.includes('@g.us') || key.remoteJid.includes('status@broadcast')) {
        return NextResponse.json({ status: 'ignored', reason: 'Group/Status message' }, { status: 200 })
      }

      const senderPhone = key.remoteJid.split('@')[0]
      const contactName = item.pushName || senderPhone
      const fromMe = key.fromMe === true

      // Encontrar ou criar contato no banco de dados
      const contactOutcome = await findOrCreateContact(
        config.account_id,
        config.user_id,
        senderPhone,
        contactName
      )
      if (!contactOutcome) {
        return NextResponse.json({ error: 'Failed to resolve contact' }, { status: 200 })
      }
      const contactRecord = contactOutcome.contact

      // Encontrar ou criar conversa no banco de dados
      const convResult = await findOrCreateConversation(
        config.account_id,
        config.user_id,
        contactRecord.id
      )
      if (!convResult) {
        return NextResponse.json({ error: 'Failed to resolve conversation' }, { status: 200 })
      }
      const conversation = convResult.conversation

      // O objeto contendo os detalhes do texto/midia pode ser item.message ou o proprio item
      const msg = item.message || (item.conversation ? item : null)
      if (!msg && !item.reactionMessage) {
        return NextResponse.json({ status: 'ignored', reason: 'Empty message structure' }, { status: 200 })
      }

      // Se for reação à mensagem
      const reactionMessage = msg?.reactionMessage || item.reactionMessage
      if (reactionMessage) {
        const parentMetaId = reactionMessage.key?.id
        const emoji = reactionMessage.text

        const { data: parentMsg } = await supabaseAdmin()
          .from('messages')
          .select('id')
          .eq('message_id', parentMetaId)
          .eq('conversation_id', conversation.id)
          .maybeSingle()

        if (parentMsg) {
          if (!emoji) {
            await supabaseAdmin()
              .from('message_reactions')
              .delete()
              .eq('message_id', parentMsg.id)
              .eq('actor_type', 'customer')
              .eq('actor_id', contactRecord.id)
          } else {
            await supabaseAdmin()
              .from('message_reactions')
              .upsert({
                message_id: parentMsg.id,
                conversation_id: conversation.id,
                actor_type: 'customer',
                actor_id: contactRecord.id,
                emoji,
              }, { onConflict: 'message_id,actor_type,actor_id' })
          }
        }
        return NextResponse.json({ status: 'success' }, { status: 200 })
      }

      // Parser de tipo de mensagem e conteúdo
      let contentType = 'text'
      let contentText = ''
      let mediaUrl = null
      let interactiveReplyId = null

      if (msg) {
        if (msg.conversation) {
          contentText = msg.conversation
        } else if (msg.extendedTextMessage?.text) {
          contentText = msg.extendedTextMessage.text
        } else if (msg.imageMessage) {
          contentType = 'image'
          contentText = msg.imageMessage.caption || ''
          mediaUrl = msg.imageMessage.url || null
        } else if (msg.videoMessage) {
          contentType = 'video'
          contentText = msg.videoMessage.caption || ''
          mediaUrl = msg.videoMessage.url || null
        } else if (msg.audioMessage) {
          contentType = 'audio'
          mediaUrl = msg.audioMessage.url || null
        } else if (msg.documentMessage) {
          contentType = 'document'
          contentText = msg.documentMessage.title || msg.documentMessage.caption || ''
          mediaUrl = msg.documentMessage.url || null
        } else if (msg.buttonsResponseMessage) {
          contentType = 'interactive'
          contentText = msg.buttonsResponseMessage.selectedDisplayText || ''
          interactiveReplyId = msg.buttonsResponseMessage.selectedButtonId || null
        } else if (msg.listResponseMessage) {
          contentType = 'interactive'
          contentText = msg.listResponseMessage.title || ''
          interactiveReplyId = msg.listResponseMessage.singleSelectReply?.rowId || null
        }
      }

      const messageId = key.id
      const timestamp = data.messageTimestamp || messageData.messageTimestamp || Math.floor(Date.now() / 1000)

      // Verificar se mensagem já foi registrada
      const { data: existingMsg } = await supabaseAdmin()
        .from('messages')
        .select('id')
        .eq('message_id', messageId)
        .eq('conversation_id', conversation.id)
        .maybeSingle()

      if (!existingMsg) {
        const senderType = fromMe ? 'agent' : 'customer'

        const { error: insertErr } = await supabaseAdmin()
          .from('messages')
          .insert({
            conversation_id: conversation.id,
            sender_type: senderType,
            content_type: contentType,
            content_text: contentText,
            media_url: mediaUrl,
            message_id: messageId,
            status: 'delivered',
            created_at: new Date(timestamp * 1000).toISOString(),
            interactive_reply_id: interactiveReplyId,
          })

        if (insertErr) {
          console.error('[webhook/evolution] Error inserting message:', insertErr)
          return NextResponse.json({ error: 'Failed to insert message' }, { status: 200 })
        }

        // Atualizar última mensagem na conversa
        await supabaseAdmin()
          .from('conversations')
          .update({
            last_message_text: contentText || `[${contentType}]`,
            last_message_at: new Date().toISOString(),
            unread_count: fromMe ? conversation.unread_count : (conversation.unread_count || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', conversation.id)

        // Se for uma resposta vinda do cliente, marca broadcast como respondido
        if (!fromMe) {
          await flagBroadcastReplyIfAny(config.account_id, contactRecord.id)

          // ----------------------------------------------------
          // Motores de Fluxo e Automacoes (Somente Inbound)
          // ----------------------------------------------------
          const isFirstInboundMessage = await checkIsFirstInbound(conversation.id)

          const flowResult = await dispatchInboundToFlows({
            accountId: config.account_id,
            userId: config.user_id,
            contactId: contactRecord.id,
            conversationId: conversation.id,
            message: interactiveReplyId
              ? {
                  kind: 'interactive_reply',
                  reply_id: interactiveReplyId,
                  reply_title: contentText ?? '',
                  meta_message_id: messageId,
                }
              : {
                  kind: 'text',
                  text: contentText,
                  meta_message_id: messageId,
                },
            isFirstInboundMessage,
          })

          const flowConsumed = flowResult.consumed

          if (!flowConsumed) {
            // Executa gatilhos de automações por palavra-chave ou recebimento
            const triggers: string[] = ['new_message_received', 'keyword_match']
            if (interactiveReplyId) triggers.push('interactive_reply')
            if (contactOutcome.wasCreated) triggers.unshift('new_contact_created')
            if (isFirstInboundMessage) triggers.unshift('first_inbound_message')

            for (const triggerType of triggers) {
              runAutomationsForTrigger({
                accountId: config.account_id,
                triggerType: triggerType as any,
                contactId: contactRecord.id,
                context: {
                  message_text: contentText,
                  conversation_id: conversation.id,
                  interactive_reply_id: interactiveReplyId || undefined,
                },
              }).catch((err: any) => console.error('[webhook/evolution/automations] failed:', err))
            }

            // Reposta Automática de IA
            if (!interactiveReplyId && contentText.trim()) {
              await dispatchInboundToAiReply({
                accountId: config.account_id,
                conversationId: conversation.id,
                contactId: contactRecord.id,
                configOwnerUserId: config.user_id,
              }).catch((err: any) => console.error('[webhook/evolution/ai] failed:', err))
            }
          }

          // Disparar Webhook externo do wacrm
          await dispatchWebhookEvent(supabaseAdmin(), config.account_id, 'message.received', {
            conversation_id: conversation.id,
            contact_id: contactRecord.id,
            whatsapp_message_id: messageId,
            content_type: contentType,
            text: contentText,
          }).catch((err: any) => console.error('[webhook/evolution/dispatcher] failed:', err))
        }
      }
    }

    // ==========================================
    // 2) EVENTO: messages.update (Status)
    // ==========================================
    if (event === 'messages.update') {
      const updateData = data.update || (Array.isArray(data) ? data[0]?.update : data)
      const key = data.key || (Array.isArray(data) ? data[0]?.key : null)

      if (key && key.id && updateData && typeof updateData.status !== 'undefined') {
        const statusMap: Record<number, string> = {
          2: 'sent',
          3: 'delivered',
          4: 'read',
        }
        const mappedStatus = statusMap[updateData.status]

        if (mappedStatus) {
          const { error: updateErr } = await supabaseAdmin()
            .from('messages')
            .update({ status: mappedStatus })
            .eq('message_id', key.id)

          if (updateErr) {
            console.error('[webhook/evolution] Error updating message status:', updateErr)
          }

          // Atualizar broadcast se houver
          const { data: recipient } = await supabaseAdmin()
            .from('broadcast_recipients')
            .select('id, status')
            .eq('whatsapp_message_id', key.id)
            .maybeSingle()

          if (recipient) {
            const tsIso = new Date().toISOString()
            const update: Record<string, unknown> = { status: mappedStatus }
            if (mappedStatus === 'sent') update.sent_at = tsIso
            if (mappedStatus === 'delivered') update.delivered_at = tsIso
            if (mappedStatus === 'read') update.read_at = tsIso

            await supabaseAdmin()
              .from('broadcast_recipients')
              .update(update)
              .eq('id', recipient.id)
          }

          // Disparar Webhook de status atualizado
          await dispatchWebhookEvent(supabaseAdmin(), config.account_id, 'message.status_updated', {
            whatsapp_message_id: key.id,
            status: mappedStatus,
          }).catch((err: any) => console.error('[webhook/evolution/dispatcher/status] failed:', err))
        }
      }
    }

    return NextResponse.json({ status: 'success' }, { status: 200 })
  } catch (err: any) {
    console.error('[webhook/evolution] Fatal error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

async function checkIsFirstInbound(conversationId: string): Promise<boolean> {
  const { count } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
  return (count ?? 0) === 1 // já inserimos a mensagem atual no banco, então o contador deve ser exatamente 1 se for a primeira.
}
