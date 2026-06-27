# SindCore — Segurança Implementada (SINDESEP-PB)

> **Documento-espelho.** Lista o que **já está implementado** no SINDESEP-PB, para comparar
> lado a lado com o `SindCore_Plano_Seguranca_Comercial.md` (que lista o que é **recomendado**).
> Cada item referencia a seção correspondente do plano.
>
> Legenda: ✅ implementado e verificado · 🟡 parcial (precisa complemento server-side/borda) · 🔲 pendente

Última verificação: 2026-06-27.

---

## Resumo rápido

| Camada | Status geral |
|---|---|
| Banco (RLS + RPC) | ✅ Base sólida — sem leitura pública de `socios` |
| Storage (documentos privados) | ✅ Fichas e contracheques privados |
| Storage (foto carteira — listagem) | 🔲 Bucket público listável (ver Plano 3.1) |
| Autenticação CRM | ✅ Supabase Auth + guard de rota |
| `.htaccess` (público + CRM) | ✅ Ambos os subdomínios protegidos |
| Headers de segurança HTTP | ✅ Adicionados nesta rodada |
| Rate limit filiação | 🟡 Client-side (complemento ao hCaptcha) |
| Rate limit carteira | 🟡 Client-side (ver Plano 3.2) |
| WAF / borda (Cloudflare) | 🔲 Depende do cliente |
| hCaptcha produção | 🔲 Chave de dev ainda em uso |
| Gestão de segredos | 🟡 `supabase.js` fora do Git; webhook n8n hardcoded |
| Tratamento de erro ao usuário | 🟡 `mapearMensagemErro` ainda pode vazar msg crua |

---

## 1. Base herdada e validada (Plano §2 — "mínimo obrigatório")

Itens que o plano marca como padrão obrigatório de todo cliente. Status no SINDESEP:

| # | Medida (Plano §2) | Status | Onde / evidência |
|---|---|---|---|
| 1 | RLS ativo em 100% das tabelas | ✅ | `setup_banco_sindesep.sql:203` — `ALTER TABLE socios ENABLE ROW LEVEL SECURITY` (e demais tabelas) |
| 2 | Sem policy de SELECT público em `socios` | ✅ | `setup_banco_sindesep.sql:219` — comentário explícito "NÃO recriar policy de SELECT para anon". Policies: `public_insert`, `auth_select`, `auth_update`, `auth_delete` |
| 3 | Acesso público só via RPC `SECURITY DEFINER` | ✅ | `buscar_socio_carteira`, `verificar_carteira` — retornam só campos não sensíveis |
| 4 | Buckets `fichas` e `contracheques` privados | ✅ | Leitura só por admin autenticado |
| 5 | URL assinada com expiração no painel | 🟡 | `crm/js/admin/detalhe.js:43` — `createSignedUrl(path, 3600)` = **1 hora**. Plano §4 recomenda **≤ 60s** para o fluxo público |
| 6 | CRM com Supabase Auth + guard de sessão | ✅ | `crm/js/admin/auth.js:44` — `protegerRota(supabase)` em toda página |
| 7 | `.htaccess` no público (Indexes off + bloqueio de extensões) | ✅ | `hostinger/.htaccess` |
| 8 | Credenciais reais fora do Git | ✅ | `.gitignore` cobre `hostinger/js/supabase.js`, `crm/js/supabase.js`, `supabase.js` |
| 9 | Isolamento: projeto Supabase próprio por cliente | ✅ | SINDESEP tem projeto dedicado (`nugwpuaoglzuazfpmoqk`) |

---

## 2. Implementado nesta rodada de segurança (2026-06-27)

Três medidas concluídas nesta sessão. Detalhe do que mudou:

### 2.1 — Headers de segurança HTTP no `hostinger/.htaccess` ✅
Não havia nenhum header de segurança no arquivo (só `Options -Indexes` e bloqueio de extensões).
Adicionados:

| Header | Proteção |
|---|---|
| `X-Frame-Options: DENY` | Anti-clickjacking (site não embutível em iframe) |
| `X-Content-Type-Options: nosniff` | Bloqueia MIME sniffing |
| `Referrer-Policy: strict-origin-when-cross-origin` | Não vaza URL completa a terceiros |
| `Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()` | Desativa APIs não usadas; **câmera liberada só no próprio domínio** (foto da carteira) |

**Bug corrigido junto:** a regra antiga bloqueava **todos** os `.json`, incluindo o `manifest.json` do PWA. Separada a regra com exceção explícita para `manifest.json`.

> Não mapeia diretamente a um item do plano — é hardening adicional além do checklist §6.

### 2.2 — `crm/.htaccess` criado ✅
O painel administrativo **não tinha `.htaccess`**. Cobre o item do checklist §6 que pede `.htaccess`
"em ambos subdomínios (público e CRM)" — antes só o público tinha.

Postura mais rígida que o público:
- `Options -Indexes` + bloqueio de `.sql .md .env .json`
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`
- `X-Robots-Tag: noindex, nofollow` (reforça no HTTP o `noindex` já presente nas metatags)
- `Permissions-Policy` bloqueando **câmera também** (nenhuma página do admin usa)

> Verificado: nenhuma página servida do CRM (login, dashboard, detalhe, financeiro, importar, novo) usa câmera.

### 2.3 — Rate limit anti-spam no formulário de filiação 🟡
`hostinger/js/filiacao.js` — complemento client-side ao hCaptcha.

| Aspecto | Valor |
|---|---|
| Limite | 3 filiações bem-sucedidas / 10 min por dispositivo |
| Bloqueio | 10 min ao atingir o limite |
| Persistência | `localStorage` (`sindesep_filiacao_rl`) — sobrevive a reload |
| Conta | Só envios que criam registro (após `insertSocio`) |
| localhost | Ignorado (igual bypass do hCaptcha) |
| Fail-open | Se `localStorage` indisponível, não trava o usuário |

**Limitação (consciente):** é client-side — contornável limpando `localStorage` ou trocando de
navegador/chamando a RPC direto. Cobre abuso casual; a proteção forte contra criação em massa
continua dependendo de rate limit **server-side** (Plano §3.2 / §8.1).

---

## 3. Lacunas conhecidas (Plano §3 e §8) — status no SINDESEP

| Ref. Plano | Lacuna | Status SINDESEP | Observação |
|---|---|---|---|
| §3.1 | Bucket `fotos-carteira` listável | 🔲 Aberto | Migrar para leitura por RPC / bucket privado com signed URL ≤ 60s |
| §3.2 | Rate limit carteira só client-side | 🟡 | `carteira.js` em memória (5 tent. → 60s). Precisa de `rpc_rate_limit` no banco |
| §3.3 | hCaptcha com chave de dev | 🔲 | `18e4537e-...` — trocar pela conta do cliente antes de produção |
| §3.4 | Sem WAF / borda confirmado | 🔲 | Depende de Cloudflare na conta do cliente |
| §3.5 | n8n sem `Error Trigger` | 🔲 | Fase 5 (notificações) |
| §3.6 | Sem log de ações administrativas | 🔲 | Falta trilha de auditoria de aprovar/recusar/excluir no CRM |
| §8.2 | `catch` de captura de IP silencioso | 🔲 | `filiacao.js:271` — `catch { return '' }` sem log; IP é prova de consentimento LGPD |
| §8.3 | Webhook n8n hardcoded | 🔲 | `filiacao.js` — `https://n8n.liftcode.com.br/webhook/...` deveria ser config por cliente |
| §8.4 | Erro cru pode chegar ao usuário | 🟡 | `mapearMensagemErro` termina em `return mensagemOriginal` — pode vazar msg do PostgREST |
| §8.5 | Commit direto na `main` | 🟡 | Repositório só com `main`; aceitável fase atual, revisar ao virar produto |

---

## 4. Checklist de homologação (Plano §6) — progresso SINDESEP

- [x] RLS ativo e validado — leitura anônima de `socios` retorna `[]`
- [x] Nenhuma policy de SELECT público em tabela com dado sensível
- [x] RPCs `SECURITY DEFINER` retornando só campos necessários
- [ ] Rate limit anti-força-bruta **no banco** (hoje só client-side) 🟡
- [ ] Buckets: documento privados ✅ / foto sem listagem 🔲 / signed URL ≤ 60s 🔲
- [ ] Cloudflare: rate limiting + Turnstile no formulário
- [x] `.htaccess` bloqueando extensões e listagem **em ambos subdomínios** ← concluído nesta rodada
- [ ] hCaptcha/Turnstile com chave de produção do cliente
- [ ] n8n com `Error Trigger` + `logs_erros` + alerta
- [ ] Nenhuma chave de API estática no código (webhook n8n ainda hardcoded) 🟡
- [ ] Log estruturado de ações administrativas no CRM
- [x] Cliente tem projeto Supabase próprio
- [ ] Procedimento de exclusão/exportação de dados ao fim de contrato

**Itens fechados nesta rodada:** `.htaccess` em ambos os subdomínios + headers de segurança HTTP.

---

## 5. Próximas prioridades de segurança (ordem sugerida)

Seguindo o plano de ação priorizado (Plano §7), o que dá para atacar a seguir **sem depender de terceiros**:

1. **Rate limit server-side** (carteira + filiação) — tabela `rpc_rate_limit` + lógica nas RPCs. Depende de rodar SQL no Supabase (tarefa do cliente). Fecha §3.2 e a parte forte da §2.3.
2. **Mensagem de erro genérica** em `mapearMensagemErro` — não devolver `error.message` cru (§8.4). Edição local, sem dependência.
3. **Log no `catch` da captura de IP** (§8.2) — edição local simples.
4. **Fechar listagem do bucket `fotos-carteira`** (§3.1) — exige ajuste de policy/SQL no Supabase.
5. **Webhook n8n por configuração** (§8.3) — mover para arquivo de config não commitado.

Dependem do cliente / infra externa: hCaptcha produção (§3.3), Cloudflare WAF + Turnstile (§3.4),
log de auditoria do CRM (§3.6), DPA e procedimentos de fim de contrato (§5).

---

## Histórico

| Data | Mudança |
|---|---|
| 2026-06-27 | Criação do documento. Implementado: headers de segurança HTTP (`hostinger/.htaccess`), `crm/.htaccess` (novo), rate limit client-side no formulário de filiação. Corrigido bloqueio indevido do `manifest.json` |

---

*Documento-espelho de segurança SindCore — Liftcode. Comparar com `SindCore_Plano_Seguranca_Comercial.md`.*
