-- ============================================================================
-- SETUP COMPLETO DO BANCO DE DADOS — Plataforma Digital SINDESEP-PB
-- ============================================================================
-- Projeto: CRM de Filiação Sindical (SINDESEP-PB)
-- Banco:   Supabase (PostgreSQL)
-- Uso:     Rodar este script no SQL Editor do Supabase para recriar todo o
--          schema do zero (tabelas, triggers, funções, RLS, policies).
--
-- ORDEM DE EXECUÇÃO: rode o arquivo inteiro de uma vez, ou seção por seção
--          na ordem em que aparecem (as dependências respeitam essa ordem).
--
-- ATENÇÃO — passos MANUAIS (fazer no Dashboard do Supabase ANTES de rodar):
--   1. Criar os buckets de Storage (ver SEÇÃO 7):
--        - 'fichas'          → Private
--        - 'contracheques'   → Private
--        - 'fotos-carteira'  → Public
--   2. As credenciais (anon key, etc.) já são gerenciadas pelo Supabase.
-- ============================================================================


-- ============================================================================
-- SEÇÃO 1 — EXTENSÕES
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- para gen_random_uuid()


-- ============================================================================
-- SEÇÃO 2 — FUNÇÃO UTILITÁRIA: auto-update do campo updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- SEÇÃO 3 — TABELA PRINCIPAL: socios
-- Campos baseados no formulário oficial do SINDESEP-PB + campos SindCore.
-- Diferenças em relação ao SINTEENP:
--   + segunda_empresa      → "Trabalha em outra empresa privada na saúde?"
--   + autorizacao_desconto → declaração de autorização do desconto de 1% no contracheque
--   - sexo / estado_civil  → não estão no formulário SINDESEP
--   - matricula / setor    → não estão no formulário SINDESEP
-- ============================================================================
CREATE TABLE IF NOT EXISTS socios (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Dados pessoais
  nome_completo            TEXT NOT NULL,
  cpf                      TEXT NOT NULL UNIQUE,
  rg                       TEXT,
  data_nascimento          DATE NOT NULL,

  -- Contato
  email                    TEXT,
  telefone                 TEXT,          -- também usado como WhatsApp

  -- Endereço
  cep                      TEXT,
  logradouro               TEXT,
  numero                   TEXT,
  complemento              TEXT,
  bairro                   TEXT,
  cidade                   TEXT,
  estado                   TEXT,

  -- Dados profissionais
  empresa                  TEXT,          -- "Local de Trabalho" no formulário
  cargo                    TEXT,
  data_admissao            DATE,
  segunda_empresa          TEXT,          -- "Trabalha em outra empresa privada na área da saúde?"

  -- Pagamento (SINDESEP: sempre desconto em contracheque — 1% do salário base)
  forma_pagamento          TEXT NOT NULL DEFAULT 'folha'
                             CHECK (forma_pagamento IN ('folha','direto')),
  valor_mensalidade        NUMERIC(10,2),

  -- Controle de adimplência (toggle manual pelo admin)
  adimplente               BOOLEAN NOT NULL DEFAULT true,

  -- Filiação
  status                   TEXT NOT NULL DEFAULT 'pendente'
                             CHECK (status IN ('pendente','aprovado','recusado')),
  motivo_recusa            TEXT,
  data_filiacao            DATE DEFAULT CURRENT_DATE,
  numero_controle          TEXT UNIQUE,   -- SINDESEP-{ANO}-{SEQ}
  aprovado_por             TEXT,
  aprovado_em              TIMESTAMPTZ,

  -- Arquivos (paths no Storage)
  ficha_pdf_url            TEXT,
  contracheque_url         TEXT,
  assinatura_url           TEXT,

  -- LGPD
  consentimento_lgpd       BOOLEAN NOT NULL DEFAULT false,
  data_consentimento_lgpd  TIMESTAMPTZ,
  ip_consentimento         TEXT,

  -- Autorização SINDESEP: desconto de 1% do salário base no contracheque
  -- "Me declaro empregado filiado ao SINDESEP-PB, autorizando o desconto
  --  da mensalidade social no meu contracheque, correspondente a 1% (um
  --  por cento) do meu salário base em favor do SINDESEP-PB."
  autorizacao_desconto     BOOLEAN NOT NULL DEFAULT false,

  -- Metadados
  origem                   TEXT NOT NULL DEFAULT 'pagina_web'
                             CHECK (origem IN ('pagina_web','manual','importacao')),
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_socios_updated_at
  BEFORE UPDATE ON socios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================================
-- SEÇÃO 4 — NÚMERO DE CONTROLE AUTOMÁTICO
-- Formato: SINDESEP-{ANO}-{SEQUENCIAL 5 dígitos}, reinicia a cada ano.
-- Baseado no ano da data_filiacao. Gerado via trigger BEFORE INSERT.
-- ============================================================================
CREATE TABLE IF NOT EXISTS socios_controle_counters (
  ano    INT PRIMARY KEY,
  ultimo INT NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION gerar_numero_controle()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_ano INT;
  v_seq INT;
BEGIN
  IF NEW.numero_controle IS NULL THEN
    v_ano := EXTRACT(YEAR FROM COALESCE(NEW.data_filiacao, CURRENT_DATE))::INT;

    INSERT INTO socios_controle_counters (ano, ultimo) VALUES (v_ano, 1)
    ON CONFLICT (ano) DO UPDATE
      SET ultimo = socios_controle_counters.ultimo + 1
    RETURNING ultimo INTO v_seq;

    NEW.numero_controle := 'SINDESEP-' || v_ano || '-' || LPAD(v_seq::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_numero_controle
  BEFORE INSERT ON socios
  FOR EACH ROW EXECUTE FUNCTION gerar_numero_controle();


-- ============================================================================
-- SEÇÃO 5 — TABELA: carteiras (carteira digital, uma por sócio)
-- ============================================================================
CREATE TABLE IF NOT EXISTS carteiras (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  socio_id    UUID NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
  foto_url    TEXT,
  validade    DATE NOT NULL,
  ativa       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(socio_id)
);

CREATE TRIGGER trg_carteiras_updated_at
  BEFORE UPDATE ON carteiras
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================================
-- SEÇÃO 6 — TABELA: arrecadacao_mensal (controle financeiro)
-- ============================================================================
CREATE TABLE IF NOT EXISTS arrecadacao_mensal (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mes_referencia   TEXT NOT NULL UNIQUE,        -- 'YYYY-MM'
  valor_esperado   NUMERIC(10,2),
  valor_arrecadado NUMERIC(10,2),
  observacoes      TEXT,
  registrado_por   TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_arrecadacao_updated_at
  BEFORE UPDATE ON arrecadacao_mensal
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================================
-- SEÇÃO 7 — ROW LEVEL SECURITY (RLS) + POLICIES
-- ============================================================================

-- ---- Tabela socios ----
ALTER TABLE socios ENABLE ROW LEVEL SECURITY;

-- Filiação pública: qualquer um pode inserir (formulário sem login)
CREATE POLICY "public_insert" ON socios
  FOR INSERT WITH CHECK (true);

-- Leitura/escrita administrativa: somente autenticado
CREATE POLICY "auth_select" ON socios
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_update" ON socios
  FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "auth_delete" ON socios
  FOR DELETE USING (auth.role() = 'authenticated');

-- SEGURANÇA: NÃO existe leitura pública de socios.
-- Todo acesso público ocorre EXCLUSIVAMENTE pelas RPCs da SEÇÃO 8.
-- NÃO recriar policy de SELECT para anon — reabriria brecha de segurança.

GRANT UPDATE ON socios TO authenticated;

-- ---- Tabela carteiras ----
ALTER TABLE carteiras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_select_carteiras" ON carteiras
  FOR SELECT USING (true);
CREATE POLICY "public_insert_carteiras" ON carteiras
  FOR INSERT WITH CHECK (true);
CREATE POLICY "auth_write_carteiras" ON carteiras
  FOR ALL USING (auth.role() = 'authenticated');

GRANT SELECT, INSERT ON carteiras TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON carteiras TO authenticated;

-- ---- Tabela socios_controle_counters ----
-- Acesso exclusivo via gerar_numero_controle() SECURITY DEFINER.
ALTER TABLE socios_controle_counters ENABLE ROW LEVEL SECURITY;

-- ---- Tabela arrecadacao_mensal ----
ALTER TABLE arrecadacao_mensal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_arrecadacao" ON arrecadacao_mensal
  FOR ALL USING (auth.role() = 'authenticated');

GRANT SELECT, INSERT, UPDATE, DELETE ON arrecadacao_mensal TO authenticated;


-- ============================================================================
-- SEÇÃO 8 — FUNÇÕES RPC (acesso público controlado, server-side)
-- ============================================================================

-- ---- 8.1 — Busca de sócio para a CARTEIRA (CPF + data de nascimento) ----
CREATE OR REPLACE FUNCTION buscar_socio_carteira(
  p_cpf        TEXT,
  p_nascimento DATE
)
RETURNS TABLE (
  id              UUID,
  nome_completo   TEXT,
  cargo           TEXT,
  empresa         TEXT,
  adimplente      BOOLEAN,
  numero_controle TEXT,
  status          TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.nome_completo, s.cargo, s.empresa,
         s.adimplente, s.numero_controle, s.status
  FROM public.socios s
  WHERE s.cpf = p_cpf
    AND s.data_nascimento = p_nascimento
    AND s.status = 'aprovado';
END;
$$;

ALTER FUNCTION buscar_socio_carteira(TEXT, DATE) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION buscar_socio_carteira(TEXT, DATE) TO anon, authenticated;


-- ---- 8.2 — Verificação pública da carteira (via QR Code, por id) ----
CREATE OR REPLACE FUNCTION verificar_carteira(p_carteira_id UUID)
RETURNS TABLE (
  carteira_id   UUID,
  validade      DATE,
  ativa         BOOLEAN,
  foto_url      TEXT,
  nome_completo TEXT,
  cargo         TEXT,
  empresa       TEXT,
  adimplente    BOOLEAN,
  status        TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT c.id AS carteira_id, c.validade, c.ativa, c.foto_url,
         s.nome_completo, s.cargo, s.empresa, s.adimplente, s.status
  FROM carteiras c
  JOIN socios s ON s.id = c.socio_id
  WHERE c.id = p_carteira_id;
$$;

ALTER FUNCTION verificar_carteira(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION verificar_carteira(UUID) TO anon, authenticated;


-- ============================================================================
-- SEÇÃO 9 — STORAGE (POLICIES)
-- IMPORTANTE: criar os buckets ANTES, manualmente, no Dashboard do Supabase:
--   - 'fichas'          → Private
--   - 'contracheques'   → Private
--   - 'fotos-carteira'  → Public
-- ============================================================================

-- ---- Buckets privados ----
CREATE POLICY "public_upload_fichas"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'fichas');

CREATE POLICY "public_upload_contracheques"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'contracheques');

CREATE POLICY "auth_read_fichas"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'fichas' AND auth.role() = 'authenticated');

CREATE POLICY "auth_read_contracheques"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'contracheques' AND auth.role() = 'authenticated');

-- ---- Bucket público: fotos-carteira ----
CREATE POLICY "public_upload_fotos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'fotos-carteira');

CREATE POLICY "public_read_fotos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'fotos-carteira');

CREATE POLICY "public_update_fotos"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'fotos-carteira')
  WITH CHECK (bucket_id = 'fotos-carteira');


-- ============================================================================
-- FIM DO SETUP
-- ============================================================================
-- Tabelas:   socios, carteiras, arrecadacao_mensal,
--            socios_controle_counters
-- Funções:   update_updated_at, gerar_numero_controle (SECURITY DEFINER),
--            buscar_socio_carteira, verificar_carteira
-- Triggers:  trg_socios_updated_at, trg_numero_controle,
--            trg_carteiras_updated_at, trg_arrecadacao_updated_at
-- RLS:       habilitado em todas as tabelas
-- Storage:   policies para fichas, contracheques, fotos-carteira
--
-- Campos SINDESEP específicos (vs SINTEENP):
--   + segunda_empresa      → segunda empresa no setor de saúde
--   + autorizacao_desconto → autorização de desconto de 1% no contracheque
--   - sexo, estado_civil, matricula, setor (não no formulário SINDESEP)
--   Número de controle: formato SINDESEP-{ANO}-{NNNNN}
--
-- Lembrete: criar os 3 buckets no Dashboard antes de usar o sistema.
-- ============================================================================
