# SindCore — Guia de Implementação para o SINDESEP-PB

**Para:** Agente de desenvolvimento (Claude Code)
**Objetivo:** Implantar uma instância do SindCore — sistema de filiação e gestão sindical — para o SINDESEP-PB, replicando a arquitetura já validada em produção no SINTEENP-PB, com adaptações de identidade e dados.

> Este guia está organizado em FASES TESTÁVEIS. Não avance para a próxima fase sem concluir e testar a anterior. Cada fase entrega algo verificável. Ao final de cada fase, pare e reporte o que foi feito para revisão antes de seguir.

---

## Princípios inegociáveis do projeto

Antes de qualquer código, internalize estes princípios — eles guiam TODAS as decisões:

1. **Mobile-first de verdade.** A maioria dos associados vai acessar pelo celular (Android de entrada/intermediário é o aparelho mais comum). Cada tela é desenhada primeiro para 360–390px de largura e depois adaptada para telas maiores — nunca o contrário. Botões com área de toque mínima de 44px, fontes legíveis sem zoom, formulários que funcionam com o teclado do celular, captura de foto e assinatura por toque.

2. **Segurança e privacidade desde o início (não como remendo).** Dados pessoais sensíveis (afiliação sindical, CPF, documentos) exigem proteção real: nenhuma leitura pública de tabela de dados, acesso só por funções validadas no servidor, documentos em armazenamento privado. Conformidade com a LGPD é requisito, não opcional.

3. **Simplicidade de stack.** HTML + JavaScript puro (sem framework pesado no front), bibliotecas via CDN, e Supabase como back-end gerenciado. Essa simplicidade é uma decisão deliberada: reduz custo, facilita manutenção e diminui superfície de bugs.

4. **Cada entidade é dona dos seus dados.** A infraestrutura (Supabase) é criada em nome do sindicato. O código é a plataforma; os dados são do cliente.

---

## Stack tecnológica (a mesma do SindCore em produção)

| Camada | Tecnologia | Observação |
|--------|-----------|------------|
| Front-end | HTML5 + CSS3 + JavaScript (ES Modules) | Sem framework. Mobile-first. |
| Geração de PDF | jsPDF (CDN, build UMD) | Ficha de filiação. NÃO importar como módulo ES. |
| QR Code | qrcodejs (CDN) | Carteira digital. |
| Planilhas | SheetJS / XLSX | Importação da base de associados. |
| Anti-bot | hCaptcha | No formulário de filiação. |
| Banco de dados | Supabase (PostgreSQL) | Com Row Level Security (RLS). |
| Autenticação | Supabase Auth | Login do painel administrativo. |
| Armazenamento | Supabase Storage | Buckets para fotos, fichas, documentos. |
| Automação | n8n | Notificações (WhatsApp/e-mail). |
| WhatsApp | Evolution API | Apenas para notificações. |
| E-mail | Resend | Transacional e lembretes. |
| Assistente IA | OpenAI (embeddings) + Claude + pgvector | RAG das convenções, integrado ao site. |
| Hospedagem | VPS (arquivos estáticos) | Subdomínio próprio do sindicato. |
| Segurança de borda | Cloudflare | Geo-restrição do painel admin. |

---

## FASE 0 — Preparação do ambiente

**Objetivo:** ter o projeto Supabase e a estrutura de pastas prontos, sem código ainda.

1. Criar um projeto Supabase NOVO e dedicado ao SINDESEP (não reaproveitar o do SINTEENP — cada cliente tem o seu, isolado).
   - Anotar a região escolhida (relevante para a cláusula de transferência internacional na política de privacidade).
   - Guardar a URL do projeto e a chave anônima (anon key) — esta é pública por design.
   - A chave de serviço (service_role) NUNCA vai para o front-end nem para o repositório.
2. Definir o subdomínio de acesso (ex.: `portal.sindesep.org.br` para o público e `crm.sindesep.org.br` para o painel — confirmar com o cliente).
3. Estrutura de pastas inicial (espelhando o SindCore):
   ```
   /                  → site público (filiação, carteira, verificação)
   /css/              → estilos (mobile-first)
   /js/               → scripts
   /fonts/            → fontes auto-hospedadas (não usar Google Fonts via CDN)
   /logo/             → identidade visual do SINDESEP
   /crm/              → painel administrativo (subdomínio isolado)
   ```

**Teste da fase:** projeto Supabase acessível, credenciais guardadas com segurança, estrutura de pastas criada.

---

## FASE 1 — Banco de dados e segurança (a base de tudo)

**Objetivo:** criar o schema completo com segurança ativa ANTES de qualquer tela. Segurança nasce aqui, não depois.

### 1.1. Tabelas principais
- `socios` — cadastro completo do associado (dados pessoais, contato, profissional, status [pendente/aprovado/recusado], adimplência, número de controle, campos de consentimento LGPD: `consentimento_lgpd`, `data_consentimento_lgpd`, `ip_consentimento`).
- `carteiras` — 1 por sócio: foto, validade, situação ativa.
- `pagamentos` — registro de pagamentos/mensalidades.
- `socios_controle_counters` — contador atômico para gerar número de controle sequencial sem repetição.

### 1.2. Row Level Security (RLS) — OBRIGATÓRIO
- Ativar RLS em TODAS as tabelas.
- A tabela `socios` NÃO pode ter leitura pública (anon). Confirmar com teste: uma requisição anônima a `/rest/v1/socios` deve retornar vazio `[]`.
- O acesso público aos dados necessários acontece SOMENTE via funções RPC `SECURITY DEFINER` (abaixo), nunca por SELECT direto.
- Criar policies por OPERAÇÃO (INSERT, UPDATE, DELETE, SELECT separadamente) — uma policy de INSERT não cobre UPDATE. Atenção a isto: é uma fonte comum de bugs.

### 1.3. Funções RPC (acesso público controlado)
- `buscar_socio_carteira(cpf, nascimento)` — valida identidade e retorna SÓ campos não sensíveis, para a carteira. SECURITY DEFINER, dono postgres.
- `verificar_carteira(carteira_id)` — retorna dados de validação para a página pública de verificação. SECURITY DEFINER.
- `gerar_numero_controle()` — número de controle único por ano (trigger no INSERT).

### 1.4. Storage (buckets)
- `fotos-carteira` — PÚBLICO (a foto é feita para ser exibida na carteira). Policies de INSERT/UPDATE/DELETE/SELECT para anon, restritas a este bucket.
- `fichas` — PRIVADO. Leitura só por admin autenticado (URL assinada).
- `documentos` (ou `contracheques`) — PRIVADO. Mesmo critério.
- Confirmar privacidade com teste: acesso público direto a um arquivo de bucket privado deve falhar (400/403).

**Teste da fase:** RLS ativo e confirmado (leitura anônima de `socios` retorna vazio); RPCs funcionando; buckets criados com a visibilidade correta testada.

---

## FASE 2 — Página de filiação (mobile-first)

**Objetivo:** o formulário público de filiação, funcionando perfeitamente no celular.

- Formulário completo: dados pessoais, contato, endereço (com autopreenchimento por CEP), dados profissionais.
- Validação de CPF (dígito verificador) no cliente.
- **Captura de assinatura eletrônica** em canvas, funcionando por toque (touch events), com botão de limpar. Atenção: testar em tela de celular real, não só no desktop.
- Upload de documentos e foto — usando a câmera do celular nativamente quando possível.
- **Registro de consentimento LGPD:** checkbox de aceite + captura de data/hora + IP do titular (via serviço de IP), gravados junto ao cadastro. Texto de consentimento com linguagem LGPD ("autorizo o tratamento dos meus dados pessoais").
- hCaptcha antes do envio (anti-robô).
- Geração automática da ficha de filiação em PDF (jsPDF) com os dados + assinatura + texto de consentimento.
- Ao enviar: cria o sócio com status `pendente`, sobe ficha e documentos aos buckets, dispara notificação.
- Tratamento de erros amigável (ex.: CPF já cadastrado → mensagem clara, não erro técnico).

**Cuidados mobile-first nesta fase:**
- Inputs com `type` correto (`tel`, `email`, `number`) para abrir o teclado certo no celular.
- Canvas de assinatura responsivo, ocupando a largura disponível.
- Botões grandes, espaçamento generoso, nenhuma rolagem horizontal.

**Teste da fase:** filiação completa funcionando em um celular real (não emulador), do preenchimento à geração do PDF e gravação no banco.

---

## FASE 3 — Carteira digital do associado

**Objetivo:** o associado acessa e gera sua carteira pelo celular.

- Acesso por CPF + data de nascimento, validados no servidor via `buscar_socio_carteira` (NÃO expor a tabela).
- **Rate limit anti-força-bruta** no cliente (ex.: 5 tentativas → bloqueio temporário) — importante porque é um ponto de entrada público.
- Captura/seleção de foto, upload ao bucket `fotos-carteira`.
  - Nome de arquivo aleatório (UUID), não previsível.
  - Na renovação, remover a foto antiga antes de subir a nova (requer policy de DELETE no storage — confirmar que existe).
- Geração da carteira em canvas: foto, dados, QR Code, validade (6 meses), situação de adimplência.
- O QR Code aponta para a página de verificação pública.

**Teste da fase:** gerar carteira nova (sócio sem carteira) E renovar carteira (sócio que já tem uma, com troca de foto) — ambos no celular.

---

## FASE 4 — Verificação pública e painel administrativo

**Objetivo:** verificação por QR + o CRM para a secretaria.

### 4.1. Página de verificação (pública)
- Acessada via QR Code. Recebe o ID da carteira, consulta `verificar_carteira`, exibe só dados não sensíveis (nome, cargo, situação, validade). Sem menu de navegação (é página de resultado para terceiros).

### 4.2. Painel administrativo (CRM)
- Servido em subdomínio isolado, protegido por login (Supabase Auth) e geo-restrição (Cloudflare, Brasil).
- Login + guard de sessão em todas as páginas.
- Dashboard: lista de sócios com filtros (status, pagamento, busca por nome/CPF) e estatísticas.
- Detalhe do sócio: aprovar/recusar/excluir, editar contato/endereço/profissional (proteger campos de identidade), ver documentos (via URL assinada temporária), controlar adimplência, registrar pagamento.
- Cadastro manual e importação em lote (CSV/XLSX) — esta última essencial para carregar a base existente de associados.
- `.htaccess` no painel bloqueando acesso pelo domínio público.

**Teste da fase:** login funcionando; aprovar uma filiação de teste; verificação por QR exibindo dados corretos; importação de um CSV de teste.

---

## FASE 5 — Notificações automáticas (n8n)

**Objetivo:** comunicação automática com os associados.

- Fluxos no n8n: confirmação de filiação, lembrete de mensalidade, aviso de vencimento de carteira.
- Envio por WhatsApp (Evolution API) e/ou e-mail (Resend).
- Envios em massa com intervalo controlado entre mensagens (anti-bloqueio).
- **Boas práticas de segurança:** chaves de API em variáveis de ambiente / credentials do n8n (NUNCA hardcoded no nó). O número de WhatsApp das notificações deve avisar que não responde mensagens, indicando o contato da secretaria.
- Formato de número: limpar com `[^0-9]`.

**Teste da fase:** disparar cada notificação de teste e confirmar recebimento.

---

## FASE 6 — Assistente de IA (RAG) integrado ao site

**Objetivo:** o agente que responde dúvidas sobre convenções coletivas, JÁ integrado na página de filiação (não no WhatsApp).

- Widget de chat flutuante na página de filiação (HTML/CSS/JS, mobile-first).
- Back-end: webhook HTTP no n8n recebendo `{sessionId, mensagem}`, reaproveitando o pipeline RAG: embeddings (OpenAI) → busca vetorial (pgvector no Supabase) → geração da resposta (Claude).
- As convenções coletivas das categorias da saúde privada são indexadas (vetorizadas) uma vez na base.
- Tom formal, respostas baseadas SOMENTE no conteúdo recuperado (nunca inventar cláusulas/valores/datas). Quando não souber, encaminhar à secretaria.
- Aviso de fase de testes nas respostas.
- **Proteção de custo:** como o agente fica aberto ao público e cada pergunta consome API paga, aplicar rate limit (por sessão/IP) — pode usar a regra gratuita da Cloudflare no domínio do n8n (que é domínio próprio).
- ID de sessão gerado no navegador (sessionStorage) para contexto multi-turn.
- CORS liberado apenas para o domínio do site do sindicato.

Como fica na página de filiação (acessível a não-sócios), funciona também como incentivo à sindicalização: a pessoa tira a dúvida e é convidada a se filiar ali mesmo.

**Teste da fase:** fazer perguntas reais sobre as convenções e confirmar respostas corretas, fundamentadas nos documentos, com o limite de uso funcionando.

---

## FASE 7 — Identidade visual, fontes e finalização

**Objetivo:** aparência própria do SINDESEP e ajustes finais de segurança/privacidade.

- Aplicar identidade visual do SINDESEP: cores (verde oliva claro e branco), logotipo, em todas as páginas.
- **Fontes auto-hospedadas** (baixar .woff2 e servir do próprio domínio) — NÃO carregar Google Fonts via CDN (evita transferir o IP do visitante ao Google, ponto de conformidade LGPD).
- Cabeçalho consistente em todas as páginas públicas (com botão de voltar à filiação onde fizer sentido).
- **Política de privacidade** completa e adequada à LGPD: identificação do controlador (CNPJ, endereço, canal de contato), base legal (arts. 7º e 11), direitos do titular (art. 18 completo), compartilhamento com prestadores nomeados, transferência internacional (conforme a região do Supabase), retenção, registro de consentimento. Texto em linguagem simples. Recomenda-se revisão por advogado.
- Favicon em todas as páginas.
- PWA opcional (manifest + service worker) para permitir "instalar" o site como app, sem loja de aplicativos.

**Teste da fase:** varredura completa — todas as páginas no celular (sem overflow horizontal), zero requisições a fontes externas, console limpo, política de privacidade completa, segurança (leitura de `socios` bloqueada) sem regressão.

---

## Convenções e armadilhas conhecidas (aprendidas em produção)

Registre e respeite estes pontos — cada um custou tempo de debugging no projeto original:

- **Datas:** ao formatar datas `YYYY-MM-DD`, usar `new Date(data + 'T00:00:00')` para evitar deslocamento de fuso (UTC-3 volta um dia).
- **RLS por operação:** uma policy de INSERT não cobre UPDATE/DELETE/SELECT. Criar cada uma separadamente conforme o fluxo precisar.
- **Teste de upload:** testar INSERT via SQL Editor NÃO reproduz o upload via Storage API do navegador (camadas diferentes). Testar sempre pelo fluxo real.
- **jsPDF:** carregar via `<script>` UMD no HTML, não como módulo ES.
- **Número de WhatsApp:** limpar com `[^0-9]`, não `\D`.
- **n8n On Error:** o padrão é "Stop Workflow" — mudar para "Continue" onde apropriado.
- **Cache:** após deploy, validar com hard refresh / aba anônima. Cloudflare pode cachear CSS sem parâmetro de versão — usar versionamento (`?v=N`) nos links de CSS e purge específico quando necessário.
- **Credenciais:** nunca commitar chaves; manter `supabase.js` (com a config) fora do versionamento, usando um `supabase.example.js` como modelo.

---

## Resumo das fases

| Fase | Entrega | Pré-requisito |
|------|---------|---------------|
| 0 | Ambiente Supabase + estrutura | — |
| 1 | Banco + RLS + RPCs + buckets | Fase 0 |
| 2 | Filiação mobile-first | Fase 1 |
| 3 | Carteira digital | Fase 2 |
| 4 | Verificação + painel admin | Fase 3 |
| 5 | Notificações (n8n) | Fase 4 |
| 6 | Assistente de IA (RAG) no site | Fase 5 |
| 7 | Identidade visual + LGPD + finalização | Fase 6 |

Cada fase é testável e independente. Não pule etapas. Ao concluir cada fase, pare e reporte para revisão.

---

*Guia de implementação SindCore — Liftcode. Baseado no sistema em produção, adaptado para o SINDESEP-PB.*
