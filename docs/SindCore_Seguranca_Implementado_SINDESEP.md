# SindCore — Segurança Implementada (SINDESEP-PB)

> **Documento-espelho.** Lista o que **já está implementado** no SINDESEP-PB, para comparar
> lado a lado com `SindCore_Plano_Seguranca_Comercial.md` (medidas recomendadas — Revisão 1)
> e `SindCore_Novas_Medidas_Seguranca.md` (achados da Revisão 2).
>
> Legenda: ✅ implementado e verificado · 🟡 parcial (precisa complemento) · 🔲 pendente · 🔴 crítico pendente

Última verificação: 2026-06-27.

---

## Resumo rápido

| Camada | Status geral |
|---|---|
| Banco (RLS + RPC) | ✅ Base sólida — sem leitura pública de `socios` |
| Storage (documentos privados) | ✅ Fichas e contracheques privados |
| Storage (foto carteira — listagem) | 🔲 Bucket público listável (Plano §3.1) |
| Autenticação CRM | ✅ Supabase Auth + guard de rota |
| `.htaccess` (público + CRM) | ✅ Ambos os subdomínios protegidos |
| Headers HTTP (base) | ✅ X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy |
| Headers HTTP (HSTS + CSP) | 🟡 Faltam HSTS e Content-Security-Policy (Novas Medidas §2) |
| XSS via `innerHTML` no CRM | ✅ Corrigido — `escapeHTML()` em `dashboard.html` e `importar.html` (`financeiro.html` adiado) |
| CSV injection no export | ✅ Corrigido — `sanitizarCelulaCSV()` em `dashboard.js` (Novas Medidas §4) |
| SRI / versão fixada nos CDNs | 🔲 jsPDF e QRCode sem `integrity`; esm.sh sem versão pinada (Novas Medidas §3) |
| QR Code anti-fraude (bypass) | 🔲 RPC não valida timestamp — print do QR continua válido (Novas Medidas §5) |
| MFA + captcha login CRM | 🔲 Só `signInWithPassword`, sem MFA nem Turnstile (Novas Medidas §6) |
| CPF em texto puro (hardening) | 🔲 Opcional — `pgcrypto` como diferencial de produto (Novas Medidas §7) |
| Rate limit filiação | 🟡 Client-side (complemento ao hCaptcha) |
| Rate limit carteira | 🟡 Client-side (Plano §3.2) |
| WAF / borda (Cloudflare) | 🔲 Depende do cliente |
| hCaptcha produção | 🔲 Chave de dev ainda em uso |
| Gestão de segredos | 🟡 `supabase.js` fora do Git; webhook n8n hardcoded |
| Tratamento de erro ao usuário | ✅ Corrigido — whitelist completo + fallback genérico com `console.error` |

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

## 3. Achados da Revisão 2 (`SindCore_Novas_Medidas_Seguranca.md`) — status no SINDESEP

Sete novos achados identificados em revisão de código. Todos pendentes de implementação.

### §N1 — ✅ XSS armazenado via `innerHTML` (CORRIGIDO)

`dashboard.html` e `importar.html` interpolavam dados de sócio direto em `innerHTML` sem escape.
Qualquer pessoa poderia se filiar com `nome_completo = <img src=x onerror="...">` e o script
executaria na sessão autenticada do admin — acesso a CPF, token, aprovações.

**Correção aplicada (2026-06-27):**
- Criado `crm/js/admin/utils.js` com `escapeHTML()` (escapa `& < > " '`; retorna `''` para null).
- `dashboard.html`: `nome_completo` e `empresa` agora passam por `escapeHTML()` na `renderizarTabela()`.
- `importar.html`: cabeçalhos e células do preview da planilha agora passam por `escapeHTML()`.
- `detalhe.html` já estava correto (`textContent`).
- `financeiro.html`: adiado — página será revisada em rodada futura.

**Status:** ✅ Corrigido nos pontos críticos (formulário público → dashboard admin).

---

### §N2 — 🟡 Headers HTTP completos (HSTS + CSP)

Dos headers recomendados, foram implementados na rodada 1: `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`. Faltam dois:

| Header | Status | Observação |
|---|---|---|
| `Strict-Transport-Security` (HSTS) | 🔲 | Força HTTPS; requer domínio de produção confirmado antes de ativar |
| `Content-Security-Policy` (CSP) | 🔲 | Segunda camada contra XSS; requer mapeamento de todas as origens (hCaptcha, esm.sh, Supabase, ipapi.is). Testar em homologação antes — exige 1-2 rodadas de ajuste fino |

CSP parcialmente mapeada (bases das origens usadas):
```
default-src 'self';
script-src 'self' https://js.hcaptcha.com https://esm.sh;
style-src 'self' 'unsafe-inline';
img-src 'self' data: https://*.supabase.co;
connect-src 'self' https://*.supabase.co https://api.ipapi.is https://viacep.com.br;
frame-src https://*.hcaptcha.com
```
> `'unsafe-inline'` em `style-src` é necessário enquanto houver estilos inline no HTML; idealmente
> eliminar os inlines ou usar `nonce`. Testar sempre com a extensão do browser antes de ativar em produção.

**Status:** 🟡 Parcial — base implementada, faltam HSTS e CSP.

---

### §N3 — 🔲 CDN sem versão fixada e sem SRI

| Problema | Arquivo | Correção |
|---|---|---|
| `esm.sh/@supabase/supabase-js` sem versão | `supabase.js` | Pinar ex.: `@supabase/supabase-js@2.45.0` |
| `jspdf@2.5.1` sem `integrity` | HTML pages | Adicionar `integrity="sha384-..."` + `crossorigin="anonymous"` |
| `qrcodejs@1.0.0` sem `integrity` | HTML pages | Idem |

hCaptcha fica de fora (script muda dinamicamente por design, SRI não se aplica).
Hash SRI gerado pelo próprio jsdelivr: acessar URL com `?sri` ou usar srihash.org.

**Status:** 🔲 Pendente — risco de supply chain se CDN for comprometido.

---

### §N4 — ✅ CSV injection no export (CORRIGIDO)

`dashboard.js → exportarParaCSV()` montava CSV sem sanitizar valores. Sócio com `nome_completo`
começando em `=`, `+`, `-` ou `@` poderia injetar fórmula executável no Excel/Sheets.

**Correção aplicada (2026-06-27):**
```js
function sanitizarCelulaCSV(valor) {
  const str = String(valor ?? '')
  const escapado = str.replace(/"/g, '""')           // escapa aspas internas (RFC 4180)
  return /^[=+\-@\t\r\n]/.test(escapado) ? `'${escapado}` : escapado
}
```
Aplicada em `linha.map(cell => \`"${sanitizarCelulaCSV(cell)}"\`)`.
Também corrige aspas duplas internas nos valores (`"` → `""`) que antes quebravam o CSV.

**Status:** ✅ Corrigido.

---

### §N5 — 🔲 QR Code dinâmico não valida timestamp na RPC

A RPC `verificar_carteira(p_carteira_id)` aceita o mesmo UUID indefinidamente até a carteira
vencer. Um print do QR continua validando como "ativo" — o mecanismo anti-fraude existe só
visualmente (feixe de luz + relógio na tela).

Para fechar: RPC precisaria validar um token de curta duração (ex.: HMAC com expiração de 60s),
não só o UUID fixo da carteira. Exige redesenho do fluxo de geração + verificação.

**Status:** 🔲 Pendente — revisar se o nível de segurança atual é suficiente para o uso real
antes de investir no redesenho (baixo risco relativo aos itens 1, 4).

---

### §N6 — 🔲 Login do CRM sem segundo fator nem captcha

`auth.js` usa só `signInWithPassword`. O painel concentra CPF, contracheque e documento de todos
os sócios — é alvo natural de credential stuffing assim que o subdomínio for descoberto.

Ações recomendadas:
1. Habilitar **MFA (TOTP)** no Supabase Auth para contas admin (configurado no painel Supabase — cliente).
2. Adicionar **Cloudflare Turnstile** invisível na tela de login do CRM (`crm/index.html`).

**Status:** 🔲 Pendente — item 1 depende do cliente no Supabase; item 2 é edição local.

---

### §N7 — 🔲 CPF em texto puro (hardening opcional)

`cpf` é `TEXT` simples, protegido por RLS. Em caso de dump de backup ou vazamento de
`service_role key`, o CPF fica exposto em claro. Criptografia via `pgcrypto`
(`pgp_sym_encrypt`/`pgp_sym_decrypt`) é diferencial de produto para clientes que exigem
comprovação de segurança em due diligence.

Impacto de implementar: toda busca por CPF passa pela função de descriptografia na RPC
(a `buscar_socio_carteira` já não retorna o CPF, então o impacto é baixo).

**Status:** 🔲 Opcional — fazer por último, após todos os itens críticos fechados.

---

## 4. Lacunas conhecidas (Plano §3 e §8) — status no SINDESEP

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
| §8.4 | Erro cru pode chegar ao usuário | ✅ | Whitelist completo das 17 mensagens seguras + `console.error` + fallback genérico no lugar do `return mensagemOriginal` |
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

## 6. Próximas prioridades consolidadas (Plano §7 + Novas Medidas)

Ordem combinando os dois documentos de referência. Itens locais = editáveis sem dependência externa.

| Prioridade | Item | Fonte | Dependência |
|---|---|---|---|
| ✅ 1 | ~~**XSS via `innerHTML`**~~ — corrigido em `dashboard.html` e `importar.html` | Novas Medidas §1 | — |
| ✅ 2 | ~~**CSV injection**~~ — `sanitizarCelulaCSV()` em `dashboard.js` | Novas Medidas §4 | — |
| ✅ 3 | ~~**Erro cru ao usuário**~~ — whitelist completo + fallback genérico em `filiacao.js` | Plano §8.4 | — |
| 🔴 2 | **CSV injection** — `sanitizarCelulaCSV()` em `dashboard.js` | Novas Medidas §4 | Local |
| 🔴 3 | **Erro cru ao usuário** — `mapearMensagemErro` com fallback genérico | Plano §8.4 | Local |
| 🟠 4 | **Log no `catch` de IP** — `console.warn` em `filiacao.js:271` | Plano §8.2 | Local |
| 🟠 5 | **Rate limit server-side** (carteira + filiação) — tabela `rpc_rate_limit` nas RPCs | Plano §3.2 | SQL no Supabase (cliente) |
| 🟠 6 | **Fechar listagem do bucket `fotos-carteira`** — policy ou bucket privado + signed URL | Plano §3.1 | SQL/painel Supabase (cliente) |
| 🟠 7 | **CSP + HSTS** nos `.htaccess` (após mapear origens em homologação) | Novas Medidas §2 | Local — requer teste |
| 🟡 8 | **Turnstile no login do CRM** (`crm/index.html`) | Novas Medidas §6 | Local + conta Cloudflare |
| 🟡 9 | **SRI + versão fixada nos CDNs** (`jspdf`, `qrcodejs`, `esm.sh`) | Novas Medidas §3 | Local |
| 🟡 10 | **Webhook n8n por configuração** — fora do código, em arquivo não commitado | Plano §8.3 | Local |
| ⚪ 11 | **MFA (TOTP) para admins** no Supabase Auth | Novas Medidas §6 | Painel Supabase (cliente) |
| ⚪ 12 | **QR Code com token de curta duração** — redesenho da RPC + geração | Novas Medidas §5 | Local + SQL |
| ⚪ 13 | **CPF criptografado** (`pgcrypto`) | Novas Medidas §7 | SQL (opcional) |

Dependem do cliente / infra externa e não têm data definida: hCaptcha produção (§3.3),
Cloudflare WAF + Turnstile no formulário público (§3.4), n8n Error Trigger (§3.5),
log de auditoria do CRM (§3.6), DPA / procedimentos de fim de contrato (Plano §5).

---

## Histórico

| Data | Mudança |
|---|---|
| 2026-06-27 | Criação do documento. Implementado: headers de segurança HTTP (`hostinger/.htaccess`), `crm/.htaccess` (novo), rate limit client-side no formulário de filiação. Corrigido bloqueio indevido do `manifest.json` |
| 2026-06-27 | Incorporados 7 achados de `SindCore_Novas_Medidas_Seguranca.md` (Revisão 2). Prioridades consolidadas com os dois documentos de referência. XSS via `innerHTML` elevado para prioridade crítica |
| 2026-06-27 | XSS §N1 corrigido: criado `crm/js/admin/utils.js` com `escapeHTML()`; aplicado em `dashboard.html` (`nome_completo`, `empresa`) e `importar.html` (preview planilha). `financeiro.html` adiado |
| 2026-06-27 | CSV injection §N4 corrigido: `sanitizarCelulaCSV()` em `dashboard.js`; neutraliza `= + - @` e escapa aspas internas (RFC 4180) |
| 2026-06-27 | Erro cru §8.4 corrigido: `mapearMensagemErro` em `filiacao.js` com whitelist completo (17 mensagens) + `console.error` + fallback genérico |

---

*Documento-espelho de segurança SindCore — Liftcode. Comparar com `SindCore_Plano_Seguranca_Comercial.md`.*
