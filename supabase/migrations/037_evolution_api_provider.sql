-- ============================================================
-- Migração: Suporte à Evolution API como Provedor de WhatsApp
-- ============================================================

-- 1. Adicionar o tipo de provedor (meta ou evolution)
ALTER TABLE whatsapp_config 
  ADD COLUMN IF NOT EXISTS provider_type TEXT NOT NULL DEFAULT 'meta' 
  CHECK (provider_type IN ('meta', 'evolution'));

-- 2. Adicionar campos específicos para a Evolution API
ALTER TABLE whatsapp_config 
  ADD COLUMN IF NOT EXISTS evolution_api_url TEXT,
  ADD COLUMN IF NOT EXISTS evolution_api_key TEXT,
  ADD COLUMN IF NOT EXISTS evolution_instance_name TEXT;

-- 3. Permitir valores NULL nas colunas da Meta API
-- Quando o provedor for 'evolution', esses campos não serão obrigatórios.
ALTER TABLE whatsapp_config ALTER COLUMN phone_number_id DROP NOT NULL;
ALTER TABLE whatsapp_config ALTER COLUMN access_token DROP NOT NULL;
