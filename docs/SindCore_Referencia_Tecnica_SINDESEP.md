# SindCore — Referência Técnica SINDESEP-PB

> Decisões tomadas, problemas resolvidos e particularidades de implementação.
> Leia este documento antes de qualquer sessão de desenvolvimento.

---

## Supabase

| Item | Valor |
|---|---|
| URL | `https://nugwpuaoglzuazfpmoqk.supabase.co` |
| Projeto | SINDESEP-PB |
| Região | sa-east-1 (São Paulo) |
| Anon key | em `hostinger/js/supabase.js` (nunca commitar) |
| CDN cliente | `https://esm.sh/@supabase/supabase-js@2` |

**Por que esm.sh e não jsdelivr:**
`cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm` carrega sub-pacotes por URL relativa, que resolve para `localhost` quando servido localmente — causando 404 nas dependências. O esm.sh resolve tudo como URL absoluta.

---

## Schema do banco (`setup_banco_sindesep.sql`)

### Tabelas

**`socios`** — campos SINDESEP (diferenças do SINTEENP):

```
segunda_empresa    TEXT nullable         — 2º emprego saúde privada
autorizacao_desconto BOOLEAN NOT NULL DEFAULT false
whatsapp           TEXT                  — adicionado via ALTER TABLE após deploy inicial
```

Campos removidos vs SINTEENP: `sexo`, `estado_civil`, `matricula`, `setor`, `ctps_numero`, `data_admissao`.

`forma_pagamento` está no banco mas é sempre `'folha'` — hardcoded no `filiacao.js`.

**`carteiras`** — 1 por sócio (upsert por `socio_id`):
- `foto_url` — URL pública no bucket `fotos-carteira`
- `validade` — 6 meses a partir da geração
- `ativa` BOOLEAN

**`socios_controle_counters`** — contador atômico para número de controle sequencial.

### Número de controle

Formato: `SINDESEP-{ANO}-{NNNNN}` (zero-padded 5 dígitos).
Gerado pelo trigger `trg_numero_controle` no INSERT em `socios`.

### RPCs (SECURITY DEFINER)

- `buscar_socio_carteira(p_cpf, p_nascimento)` — acesso à carteira sem expor a tabela. Retorna só campos não sensíveis.
- `verificar_carteira(p_carteira_id)` — verificação pública por QR Code.
- Ambas de propriedade de `postgres`, executadas como superusuário — ignoram RLS.

### Buckets Storage

| Bucket | Visibilidade | Uso |
|---|---|---|
| `fotos-carteira` | Público | Foto da carteira (exibida no canvas e na verificação) |
| `fichas` | Privado | Ficha PDF de filiação |
| `contracheques` | Privado | Documentos enviados no passo 5 da filiação |

**RLS buckets:** anon pode INSERT/SELECT em `fotos-carteira` (necessário para gerar carteira sem login). DELETE no `fotos-carteira` também liberado para anon — necessário para troca de foto na renovação da carteira.

---

## Formulário de filiação (`hostinger/index.html` + `js/filiacao.js`)

### 6 passos do formulário

| Passo | Conteúdo | IDs principais |
|---|---|---|
| 1 | Dados pessoais | `nome_completo`, `cpf`, `rg`, `data_nascimento` |
| 2 | Contato | `whatsapp`, `email` |
| 3 | Endereço | `cep` (autopreenchimento via ViaCEP), `logradouro`, `numero`, `complemento`, `bairro`, `cidade`, `estado` |
| 4 | Profissional | `empresa`, `cargo`, `segunda_empresa` |
| 5 | Contracheque | `contracheque` (upload), zona de drag-and-drop |
| 6 | Declarações + assinatura | 3 toggles iOS (`autorizacao_desconto`, `consentimento_lgpd`, `declaracao_verdade`), canvas de assinatura, hCaptcha |

### Navegação entre passos

Controle via `irParaPasso(n)` em script inline (antes do módulo ES). Motivo: a função precisa estar disponível nos atributos `onclick` do HTML antes do módulo carregar.

**Bug conhecido e resolvido:** `animation: fadeUp .35s ease both` → `forwards`. O `both` preenche o estado inicial (`opacity:0`) fazendo o passo 1 aparecer invisível. Com `forwards` o elemento fica visível antes da animação.

### hCaptcha

- Sitekey de desenvolvimento: `18e4537e-9ef2-42c2-9226-b3703fa41f8e`
- **⚠️ Trocar pela conta do cliente antes de ir a produção**
- Bypass em `filiacao.js`: `if (!htoken && window.location.hostname !== 'localhost')` — não bloqueia em localhost

### Tela de sucesso

`#success-message` fica **fora do `<form>`** (irmão dentro de `.form-shell`). Se estiver dentro, `form.style.display = 'none'` esconde o sucesso junto.

---

## Carteira digital (`hostinger/carteira.html` + `js/carteira.js`)

### Fluxo

1. CPF + data nascimento → RPC `buscar_socio_carteira` (nunca SELECT direto)
2. Rate limit: 5 tentativas → bloqueio 60s (client-side)
3. Se adimplente = false → card de aviso (sem carteira)
4. Se carteira ativa e válida → pula para Etapa 3 (card glassmorphism + canvas oculto)
5. Se sem carteira → Etapa 2 (foto)

### Troca de foto (renovação)

Busca a carteira anterior por `socio_id`, extrai o caminho do `foto_url` após `/fotos-carteira/`, faz DELETE do Storage antes de subir a nova. Usa `upsert` com `onConflict: 'socio_id'`.

### Etapa 3 — Arquitetura dual (display HTML + canvas para download)

**Card glassmorphism (`#card-glass`)** — exibição ao vivo:
- HTML/CSS com `backdrop-filter: blur(20px)`, `background: linear-gradient(verde/preto)`
- Renderiza: logo, badge, foto circular, nome, cargo, empresa, CPF mascarado, número de controle, validade, relógio e QR Code
- **Anti-fraude #1 — Feixe de luz (`#card-glass::before`):** pseudo-elemento que varre o card na diagonal a cada 4s (`@keyframes glassBeam`) → prova imediata que é tela ao vivo, não screenshot
- **Anti-fraude #2 — Relógio (`#glass-clock`):** `setInterval` a cada 1s, formato `DD/MM/AAAA — HH:MM:SS`, fonte monospace olive `#8A9A5B`
- **Anti-fraude #3 — QR dinâmico (`#glass-qr-container`):** regenerado a cada 60s com `?t={Date.now()}` na URL; `verificar.html` usa só o param `id`, o `t` é ignorado — verificação continua funcionando

**Canvas oculto (`#card-canvas`, 856×540)** — exportação PNG:
- `display: none` — nunca visível ao usuário
- Gerado por `gerarCanvasCarteira()` (sem alterações na lógica)
- Download via `canvas.toDataURL('image/png')` → `carteira-sindesep-{CPF}.png`
- Compartilhamento via Web Share API (mesmo canvas)

### Funções JS adicionadas (após `atualizarNotaValidade`)

| Função | O que faz |
|---|---|
| `preencherCardGlass()` | Popula todos os campos HTML do card e chama clock + QR |
| `iniciarRelogio()` | `setInterval` 1s → `#glass-clock` |
| `iniciarRefreshQR(id)` | Gera QR imediato + `setInterval` 60s regenerando com `?t=` |

**Call sites:** ambos os pontos onde `gerarCanvasCarteira()` é chamado (busca CPF existente e após upload de foto) agora chamam `preencherCardGlass()` em seguida.

### Canvas da carteira (856×540) — referência de cores

| Elemento | Cor / detalhe |
|---|---|
| Fundo | `#141414` |
| Logo | `/logo/logoHD.png` |
| Badge "ASSOCIADO ATIVO" | coral `#E07250` |
| Divisores | olive `#8A9A5B` |
| Anel da foto | verde `#1A5C22` |
| Cargo | olive `#8A9A5B` |
| "SINDESEP-PB" rodapé | olive `#8A9A5B` |
| QR Code | fundo branco arredondado, URL dinâmica por `window.location.origin` |

### PWA

**`hostinger/manifest.json`** (novo):
- `display: standalone` — remove barra do browser ao instalar
- `theme_color: #1A5C22`, `background_color: #111111`
- Ícones: `faviSINDESEP.png` (192px) + `logoHD.png` (512px)

**`hostinger/sw.js`** (novo):
- Estratégia **network-first** para HTML (sempre busca versão fresca)
- Estratégia **cache-first** para assets estáticos (CSS, JS, imagens, fontes, QRCode.js CDN)
- Supabase, esm.sh e hCaptcha passam direto sem interceptação
- Cache nomeado `sindesep-carteira-v1` — atualizar versão ao fazer deploy com mudanças de assets

**Registro do SW** em `carteira.html`, script inline antes de `</body>`:
```js
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
}
```

---

## Verificação pública (`hostinger/verificar.html`)

Script inline (não módulo ES separado) para manter o arquivo autossuficiente.

Fluxo: `?id={carteira_id}` → RPC `verificar_carteira` → exibe card verde (válido), amarelo (inadimplente) ou vermelho (inválido/expirado/cancelado).

Logo em 3 ocorrências: `/logo/logoHD.png`.

---

## Widget Agente de Dúvidas (`index.html`)

- Botão flutuante fixo, canto inferior direito (`z-index: 9999`)
- Abre painel de chat com primeira mensagem pedindo o estabelecimento
- **Para ativar:** substituir `const AGENTE_WEBHOOK_URL = ''` pela URL do webhook n8n
- **Protocolo de comunicação:** `POST { message: "texto do usuário" }` → `{ reply: "resposta" }` ou `{ text: "resposta" }`
- Enquanto sem webhook: mostra animação "digitando" e responde placeholder
- RAG planejado: embeddings OpenAI + pgvector Supabase + Claude — acordos coletivos por estabelecimento

---

## CRM admin (`crm/`)

- Protegido por Supabase Auth (guard em todas as páginas)
- Campos atualizados para SINDESEP: removidos `sexo`, `estado_civil`, `matricula`, `setor`, `ctps_numero`, `data_admissao`; adicionados `segunda_empresa`, `autorizacao_desconto`, `whatsapp`
- Importação CSV/XLSX: colunas do modelo gerado por `gerarModeloCSV()` em `importar.js`
- URL de assets do Supabase: `nugwpuaoglzuazfpmoqk.supabase.co`

---

## Problemas encontrados e resolvidos

| Problema | Causa | Solução |
|---|---|---|
| Coluna `whatsapp` não existia | `setup_banco_sindesep.sql` tinha só `telefone` | `ALTER TABLE socios ADD COLUMN IF NOT EXISTS whatsapp TEXT` |
| CDN Supabase com 404 em sub-pacotes | jsdelivr usa URLs relativas | Trocado para `esm.sh` |
| hCaptcha bloqueava localhost | Token não gerado em dev | Bypass com `hostname !== 'localhost'` |
| Passos do form invisíveis | `animation: both` preenche estado inicial `opacity:0` | Trocado para `forwards` |
| Tela de sucesso não aparecia | `#success-message` dentro do `<form>` que era ocultado | Movido para fora do form (irmão dentro de `.form-shell`) |
| Logo errada no `carteira.html` | Referenciava `logoSINDESEP.png` (não existe) | Trocado para `logoHD.png` |
| Logo SINTEENP no canvas da carteira | Referenciava `logoSinteenp_transparente.png` | Trocado para `logoHD.png` |
| Cores vermelhas `#CC0000` na carteira | Cores do template SINTEENP não substituídas | Trocado para palette SINDESEP (`#8A9A5B`, `#1A5C22`, `#E07250`) |
| URL QR Code hardcoded `portalsinteenp.org` | Herdado do template | Trocado para `window.location.origin` |

---

## Pendências antes de ir a produção

- [ ] Criar conta hCaptcha do cliente e substituir sitekey em `index.html`
- [ ] Confirmar domínio de produção e atualizar CORS no Supabase
- [ ] Configurar Cloudflare na frente do CRM (geo-restrição Brasil)
- [ ] Revisar RLS completo após o CRM estar em uso
- [ ] Configurar n8n: fluxo de aprovação + notificações WhatsApp/e-mail
- [ ] Indexar acordos coletivos no pgvector (Fase 6 — agente IA)
- [ ] Colar `AGENTE_WEBHOOK_URL` em `index.html` após criar o webhook n8n
- [ ] Ao fazer deploy com mudanças de CSS/JS, incrementar versão do cache no `sw.js` (`sindesep-carteira-v2`, etc.) para forçar atualização nos dispositivos que instalaram o PWA
- [ ] Gerar ícones PWA nos tamanhos corretos (192×192 e 512×512 px exatos) para evitar aviso no DevTools

---

## Histórico de mudanças significativas

| Data | Mudança |
|---|---|
| 2026-06-27 | Setup inicial: Supabase, schema SQL, RLS, RPCs, buckets |
| 2026-06-27 | Fase 2: formulário de filiação (6 passos, design mockup aprovado) |
| 2026-06-27 | Fase 3: carteira digital (canvas + upload foto + verificar.html) |
| 2026-06-27 | Widget agente de dúvidas (placeholder, aguarda n8n) |
| 2026-06-27 | Carteira premium: card glassmorphism + anti-fraude + PWA |

---

*Referência técnica SindCore — Liftcode. Atualizado em 2026-06-27.*
