# SindCore — SINDESEP-PB

Plataforma de filiação digital e gestão de associados.
Replicação do SindCore (SINTEENP-PB), adaptada para o SINDESEP-PB.

**Sindicato:** Sindicato dos Empregados em Estab. de Serv. de Saúde da Paraíba
**CNPJ:** 10.733.384/0001-05

## Stack

- Frontend: HTML + Vanilla JS (sem framework)
- Banco de dados: Supabase (PostgreSQL + Auth + Storage)
- Automações: n8n + Evolution API (WhatsApp) + Resend (e-mail)
- Deploy: Hostinger KVM2
- Desenvolvido por: Liftcode (https://liftcode.com.br)

## Configuração inicial

1. Criar projeto no Supabase (feito pelo cliente)
2. Copiar `supabase.example.js` → `supabase.js`
3. Preencher URL e anon key do novo projeto Supabase
4. Rodar `setup_banco_sindesep.sql` no SQL Editor do Supabase

## Fase de desenvolvimento

Seguir o **Guia de 7 Fases** (SindCore_Guia_Implementacao_SINDESEP.md).

**Próximo passo:** Criar projeto Supabase, configurar variáveis de ambiente em `supabase.js`, começar Fase 0.

## Estrutura

- `hostinger/` — site público (filiação digital, carteira, benefícios, privacidade)
- `crm/` — painel administrativo (aprovações, gestão de sócios, financeiro)
- `supabase.example.js` — template de configuração (sem chaves reais)
- `.gitignore` — protege `supabase.js` e arquivos sensíveis
