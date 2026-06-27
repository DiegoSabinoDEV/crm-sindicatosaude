# Contexto de sessão — SindCore SINDESEP-PB

> Cole este bloco no início de cada sessão Claude Code para manter o contexto.

```bash
export PROJETO="SindCore"
export CLIENTE="SINDESEP-PB"
export STACK="Supabase + Vanilla JS + n8n"
export SUPABASE_URL="https://nugwpuaoglzuazfpmoqk.supabase.co"
export N8N_URL="n8n.liftcode.com.br"

echo "⚠️  NUNCA commita .env, API keys, ou SUPABASE_SERVICE_ROLE_KEY"
echo "⚠️  NÃO commita mudanças — o cliente faz localmente"
echo "⚠️  NÃO cria projeto Supabase — o cliente criou em 2026-06-27"
echo "⚠️  NÃO executa código — só estrutura/edição de texto"
```

## Referência rápida

| Item | Valor |
|---|---|
| Sindicato | Sindicato dos Empregados em Estab. de Serv. de Saúde da Paraíba |
| Sigla | SINDESEP-PB |
| CNPJ | 10.733.384/0001-05 |
| Endereço | Rua Padre Rolim, 9 — Tambaú, João Pessoa/PB |
| Telefone | (83) 3221-5350 · WhatsApp (83) 98857-7278 |
| Supabase URL | `https://nugwpuaoglzuazfpmoqk.supabase.co` |
| CDN Supabase | `https://esm.sh/@supabase/supabase-js@2` |
| Cores | `#1A5C22` verde · `#8A9A5B` olive · `#E07250` coral · `#F4EFE6` cream |
| Logo | `/logo/logoHD.png` |
| hCaptcha sitekey | `18e4537e-9ef2-42c2-9226-b3703fa41f8e` ← dev, trocar antes de produção |

## Status das fases (2026-06-27)

| Fase | Descrição | Status |
|---|---|---|
| 0 | Ambiente Supabase + estrutura | ✅ Concluída |
| 1 | Banco + RLS + RPCs + buckets | ✅ Concluída |
| 2 | Página de filiação pública | ✅ Concluída |
| 3 | Carteira digital | ✅ Concluída |
| — | Widget agente de dúvidas (placeholder) | ✅ Estrutura pronta |
| — | Segurança (hCaptcha + revisão RLS) | 🔜 Próxima |
| 4 | Verificação pública + CRM completo | 🔜 |
| 5 | Notificações (n8n + WhatsApp + e-mail) | 🔜 |
| 6 | Agente IA RAG (acordos coletivos) | 🔜 |
| 7 | Identidade visual final + LGPD | 🔜 |

## Arquivos sensíveis — NUNCA commitar

- `hostinger/js/supabase.js` — chaves reais do Supabase
- `crm/js/supabase.js` — idem
- `.env` / `*.env.local`

## Referência técnica completa

Ver `docs/SindCore_Referencia_Tecnica_SINDESEP.md` — decisões de implementação, bugs resolvidos, pendências antes de ir a produção.

## Guia de implementação por fases

Ver `docs/SindCore_Guia_Implementacao_SINDESEP.md` — fases testáveis e critérios de aceite.
