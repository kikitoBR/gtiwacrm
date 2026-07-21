import { decrypt } from '@/lib/whatsapp/encryption'
import type { WhatsAppProvider } from './provider'
import { MetaWhatsAppProvider } from './meta-provider'
import { EvolutionWhatsAppProvider } from './evolution-provider'

/**
 * Instancia o provedor de WhatsApp correto com base nas configurações da conta.
 * Descriptografa as chaves de API necessárias dinamicamente.
 */
export function getWhatsAppProvider(config: any): WhatsAppProvider {
  const providerType = config.provider_type || 'meta'

  if (providerType === 'evolution') {
    if (!config.evolution_api_url) {
      throw new Error('Evolution API URL is not configured.')
    }
    const decryptedApiKey = config.evolution_api_key ? decrypt(config.evolution_api_key) : ''
    const instanceName = config.evolution_instance_name || ''
    return new EvolutionWhatsAppProvider(
      config.evolution_api_url,
      decryptedApiKey,
      instanceName
    )
  }

  // Provedor Meta padrão
  if (!config.phone_number_id || !config.access_token) {
    throw new Error('Meta WhatsApp is not configured correctly.')
  }
  const accessToken = decrypt(config.access_token)
  return new MetaWhatsAppProvider(config.phone_number_id, accessToken)
}
