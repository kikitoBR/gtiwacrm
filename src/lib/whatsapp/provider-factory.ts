import { decrypt } from '@/lib/whatsapp/encryption'
import type { WhatsAppProvider } from './provider'
import { MetaWhatsAppProvider } from './meta-provider'
import { EvolutionWhatsAppProvider } from './evolution-provider'

/**
 * Instancia o provedor de WhatsApp correto com base nas configurações da conta.
 * Descriptografa as chaves de API necessárias dinamicamente.
 */
export function getWhatsAppProvider(config: Record<string, unknown>): WhatsAppProvider {
  const providerType = (config.provider_type as string) || 'meta'

  if (providerType === 'evolution') {
    if (!config.evolution_api_url) {
      throw new Error('Evolution API URL is not configured.')
    }
    const decryptedApiKey = config.evolution_api_key ? decrypt(config.evolution_api_key as string) : ''
    const instanceName = (config.evolution_instance_name as string) || ''
    return new EvolutionWhatsAppProvider(
      config.evolution_api_url as string,
      decryptedApiKey,
      instanceName
    )
  }

  // Provedor Meta padrão
  if (!config.phone_number_id || !config.access_token) {
    throw new Error('Meta WhatsApp is not configured correctly.')
  }
  const accessToken = decrypt(config.access_token as string)
  return new MetaWhatsAppProvider(config.phone_number_id as string, accessToken)
}
