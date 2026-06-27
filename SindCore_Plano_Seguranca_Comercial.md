# SindCore — Plano de Segurança para Produto Comercial
### Baseado na auditoria do projeto em produção (SINTEENP-PB) aplicado ao SindCore (SINDESEP-PB e futuros clientes)

> **Nota:** este documento trata de segurança técnica e organização para reduzir risco de incidente, multa LGPD e processo. Não é parecer jurídico — os pontos de LGPD/contrato citados são orientações práticas; para validação formal, um advogado especializado deve revisar antes de comercializar.

---

## 1. Contexto

O SindCore deixa de ser um sistema único (SINTEENP-PB) e passa a ser **produto vendido a múltiplos sindicatos**. Isso muda o perfil de risco:

- Mais instâncias = mais superfície de ataque (cada cliente é um alvo independente).
- Dados sensíveis de associados (CPF, contracheque, foto, filiação sindical) em escala — filiação sindical é categoria de dado pessoal com atenção redobrada na LGPD.
- Cliente B2B (sindicatos) tende a exigir comprovação de segurança antes de contratar.
- Um incidente em qualquer cliente pode gerar dano reputacional para todos os outros que usam a mesma base de código.

A boa notícia: o SINTEENP já está em produção há várias sessões e já passou por uma rodada de auditoria real, com problemas encontrados e corrigidos. Isso dá uma base concreta do que funciona e do que precisa de atenção antes de replicar para novos clientes.

---

## 2. O que o SINTEENP já validou em produção (herdar como padrão obrigatório)

Estas práticas já foram implementadas e testadas com sócios reais — devem ser o **mínimo obrigatório** em todo novo cliente (SINDESEP e futuros):

| Medida | Onde está | Por que importa |
|---|---|---|
| RLS ativo em 100% das tabelas (`socios`, `carteiras`, `socios_controle_counters`, `arrecadacao_mensal`) | `setup_banco_*.sql` | Sem isso, a `anon key` pública no navegador dá acesso direto às tabelas |
| **Sem policy de SELECT público em `socios`** — leitura anônima retorna vazio | mesma tabela | Era a falha mais grave (BOLA): existia uma policy `public_select_socios_aprovados` que expunha todos os dados de sócios aprovados via `anon key`. Foi removida e há comentário explícito no SQL avisando para **nunca recriar** |
| Acesso público só via RPC `SECURITY DEFINER` (`buscar_socio_carteira`, `verificar_carteira`) | mesmo arquivo | RPC valida CPF + nascimento no servidor e retorna só os campos necessários (nunca RG, endereço, telefone, contracheque) |
| Buckets `fichas` e `contracheques` privados, leitura só autenticado | `02_storage.sql` | Documentos sensíveis (contracheque, ficha assinada) não ficam acessíveis por URL direta |
| URL assinada com expiração no painel admin | `crm/js/admin/detalhe.js` (`createSignedUrl`, 3600s) | Admin acessa documento sem tornar o link permanente/público |
| CRM protegido por Supabase Auth + guard de sessão (`protegerRota`) em toda página administrativa | `auth.js` | Sem isso, qualquer um acessando a URL do dashboard veria dados de sócios |
| `.htaccess`: `Options -Indexes` + bloqueio de `.sql/.json/.md/.env` | `hostinger/.htaccess` | Impede listagem de diretório e download acidental de arquivos de configuração/schema |
| Credenciais reais (`supabase.js`) fora do Git, no `.gitignore`, verificado no histórico com `git grep` | repositório | Evita vazamento de chave por commit acidental |
| Isolamento de infraestrutura por cliente: **cada sindicato tem projeto Supabase próprio**, nunca compartilhado | Guia de Implementação SINDESEP, Fase 0 | Esta é a decisão arquitetural mais importante para o produto comercial — ver seção 5 |

---

## 3. Falhas encontradas no SINTEENP que NÃO podem se repetir no produto comercial

Estes pontos foram identificados durante o desenvolvimento do SINTEENP e ficaram registrados como pendência — ou seja, **já existe conhecimento interno do problema**, falta apenas correção sistemática antes de empacotar como produto:

### 3.1 — Bucket `fotos-carteira` permite listar todos os arquivos
Hoje o bucket é público (necessário para a carteira funcionar sem login) e tem policy de `SELECT` sem restrição. Isso permite a um atacante **enumerar e baixar a foto de todos os associados** sem autenticação — sob a LGPD, isso é uma exposição em massa de dado pessoal (foto é dado pessoal; em alguns contextos pode ser tratado como sensível). É o tipo de incidente que gera obrigação de comunicação à ANPD e risco real de multa.

**Correção recomendada (aplicável também ao SINDESEP):**
```sql
-- Hoje a foto é pública para exibição na carteira/verificação, mas não precisa ser LISTÁVEL.
-- Supabase Storage: ative "Public bucket" apenas para leitura de objeto individual por
-- caminho conhecido. Para impedir listagem, mova a leitura para detrás de uma RPC:

CREATE OR REPLACE FUNCTION obter_foto_url(p_carteira_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_path TEXT;
BEGIN
  SELECT foto_url INTO v_path FROM carteiras WHERE id = p_carteira_id;
  RETURN v_path; -- front-end monta a URL pública só com o caminho retornado
END;
$$;

GRANT EXECUTE ON FUNCTION obter_foto_url(UUID) TO anon, authenticated;
```
E, na policy de Storage, restringir `SELECT` para nunca permitir listagem por prefixo vazio (o painel do Supabase trata isso por padrão quando o bucket não está marcado como "Public" — o ideal de médio prazo é migrar para bucket **privado** com signed URL, como o Plano de Blindagem da Liftcode já recomenda).

### 3.2 — Rate limit da carteira é só client-side
A proteção de "5 tentativas → bloqueio de 60s" em `carteira.js` é uma variável em memória do navegador. Basta recarregar a página, ou chamar a RPC `buscar_socio_carteira` direto via `curl`/Postman, para contornar completamente. Isso vira uma porta de força bruta para descobrir CPF + data de nascimento válidos, ou status de adimplência de qualquer associado.

**Correção recomendada — mover o rate limit para o banco:**
```sql
CREATE TABLE IF NOT EXISTS rpc_rate_limit (
  identificador TEXT PRIMARY KEY,   -- ex.: CPF tentado, ou IP via header
  tentativas    INT NOT NULL DEFAULT 1,
  bloqueado_until TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION buscar_socio_carteira(p_cpf TEXT, p_nascimento DATE)
RETURNS TABLE (...)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bloqueado TIMESTAMPTZ;
BEGIN
  SELECT bloqueado_until INTO v_bloqueado FROM rpc_rate_limit WHERE identificador = p_cpf;
  IF v_bloqueado IS NOT NULL AND v_bloqueado > now() THEN
    RAISE EXCEPTION 'Muitas tentativas. Tente novamente mais tarde.';
  END IF;
  -- ... lógica de busca normal ...
  -- se não encontrar: INSERT/UPDATE rpc_rate_limit incrementando tentativas
  --   e setando bloqueado_until = now() + interval '60 seconds' ao chegar em 5
END;
$$;
```
Isso fecha a porta independentemente do que o front-end faça — é a única forma confiável, já que a `anon key` é pública por design e qualquer um pode chamar a RPC diretamente.

### 3.3 — Chave de teste do hCaptcha esquecida em produção
O checklist manual "trocar pela chave real antes de produção" é frágil — depende de alguém lembrar. Para um produto vendido a múltiplos clientes, isso precisa ser **parametrizado por cliente** (a sitekey vem de uma variável de configuração por instância, nunca hardcoded), e idealmente validado por um teste automatizado de deploy ("se a sitekey for a de dev e o domínio não for localhost, bloquear o deploy").

### 3.4 — Sem WAF / rate limiting de borda confirmado
O Plano de Blindagem formal já redigido pela Liftcode (ver seção 4) recomenda Cloudflare na frente, mas o próprio checklist de homologação do documento marca isso como **pendente**, não confirmado em produção. Sem isso, o endpoint público de filiação e a RPC da carteira ficam expostos a varredura em lote.

### 3.5 — n8n sem tratamento de erro formal
Fluxos de notificação (aprovação, WhatsApp, e-mail) sem nó de erro centralizado podem falhar silenciosamente — um associado aprovado nunca recebe a notificação e ninguém percebe. Para um produto comercial isso é risco de reclamação e de inconsistência entre o que o sindicato pensa que comunicou e o que de fato chegou ao associado.

### 3.6 — Sem log estruturado de ações administrativas
Hoje não há registro formal de quem aprovou, recusou ou excluiu um sócio no CRM, além do que fica implícito no histórico do banco. Isso é fraqueza dupla: segurança (não dá para auditar abuso de um admin) e jurídica (se um associado contestar uma recusa, não há trilha de auditoria para defender a decisão do sindicato).

---

## 4. Plano de Blindagem formal já redigido (Liftcode, 24/06/2026)

Já existe um documento técnico interno (`docs/plano_blindagem_seguranca_sindcore.pdf`) com 5 frentes de ação. Resumo:

1. **Banco de dados (BOLA/RLS)** — confirmar RLS ativo e políticas restritas por `auth.uid()` em todas as tabelas que vierem a ter relação direta usuário→registro.
2. **Privacidade de mídia (LGPD)** — bucket de fotos/documentos como **privado**, com **signed URLs de até 60 segundos** de validade na renderização do front-end (não 1 hora como está hoje no painel admin — 60s é o padrão recomendado para o fluxo público).
3. **Borda/custos (Cloudflare)** — rate limiting de 3 req/min/IP no endpoint público de cadastro, limites granulares em `/rest/v1/*` para o subdomínio admin, e **Cloudflare Turnstile** no formulário público (capcha invisível, sem atrito).
4. **Resiliência do n8n** — nó `Error Trigger` em todo fluxo de produção, gravando falhas em `public.logs_erros` e alertando a equipe via webhook.
5. **Gestão de segredos** — proibição total de chaves de API estáticas no corpo de funções JS/n8n; tudo via variáveis de ambiente injetadas pelo Easypanel.

O checklist de homologação do próprio documento (RLS mapeado, bucket blindado, WAF configurado, Turnstile integrado, n8n tratado, segredos protegidos) deve ser tratado como **gate de lançamento**: nenhum cliente novo entra em produção sem todos os itens marcados.

---

## 5. Riscos específicos de virar produto multi-cliente (além do documento técnico)

### 5.1 — Isolamento por cliente como regra contratual, não só técnica
A decisão de dar um projeto Supabase dedicado a cada sindicato (já adotada na Fase 0 do guia do SINDESEP) é a proteção mais importante do produto: ela elimina o risco mais grave de SaaS multi-tenant, que é uma falha de RLS vazar dados de um cliente para outro. **Recomendação:** formalizar isso como política inegociável do produto (documentada, não só "como sempre fizemos"), porque é tentador no futuro reaproveitar infraestrutura para reduzir custo — e é exatamente aí que nasce o incidente que vira processo.

### 5.2 — Papéis na LGPD: controlador x operador
Em geral, o sindicato-cliente é o **controlador** dos dados dos seus associados (decide a finalidade do tratamento); a Liftcode/SindCore atua como **operador** (trata os dados em nome do controlador). Isso normalmente exige um contrato de operação de dados (cláusulas de tratamento, prazo de retenção, o que acontece no fim do contrato) anexo ao contrato comercial — vale revisão jurídica antes da venda em escala.

### 5.3 — Plano de resposta a incidente
Hoje, problemas de segurança são corrigidos ad-hoc e ficam registrados em notas internas de desenvolvimento. Para um produto comercial, vale existir um processo formal: quem é avisado internamente, em quanto tempo o cliente é informado, e em que casos há obrigação de comunicar a ANPD (a LGPD prevê comunicação em prazo razoável para incidentes que possam acarretar risco relevante aos titulares).

### 5.4 — Retenção e exclusão de dados ao fim do contrato
Precisa existir um procedimento padrão de exportação dos dados do sindicato e exclusão segura (incluindo backups) quando um cliente encerra o contrato — isso é direito do titular e também proteção para a Liftcode (evita manter dados sensíveis de quem não é mais cliente).

### 5.5 — Backup e recuperação de desastre por cliente
Confirmar política de backup do Supabase por plano contratado e ter isso documentado para cada cliente — sindicato pode perguntar isso na due diligence antes de assinar.

---

## 6. Checklist de homologação recomendado por cliente (antes de ir ao ar)

Combinando o checklist oficial do Plano de Blindagem com os pontos específicos encontrados na auditoria do SINTEENP:

- [ ] RLS ativo e validado em 100% das tabelas — leitura anônima de `socios` retorna `[]`
- [ ] Nenhuma policy de SELECT público em tabelas com dado sensível
- [ ] RPCs `SECURITY DEFINER` retornando só campos necessários (nunca documento/endereço/telefone)
- [ ] Rate limit anti-força-bruta implementado **no banco**, não só no front-end
- [ ] Buckets de documento privados; bucket de foto sem policy de listagem; signed URL ≤ 60s no fluxo público
- [ ] Cloudflare: rate limiting no endpoint de cadastro + Turnstile no formulário público
- [ ] `.htaccess` bloqueando extensões sensíveis e listagem de diretório, em ambos subdomínios (público e CRM)
- [ ] hCaptcha/Turnstile com chave de produção própria do cliente, nunca a de desenvolvimento
- [ ] n8n com `Error Trigger` + tabela `logs_erros` + alerta de equipe
- [ ] Nenhuma chave de API estática no código — tudo via variável de ambiente
- [ ] Log estruturado de ações administrativas (aprovar/recusar/editar/excluir) com usuário e timestamp
- [ ] Confirmado: este cliente tem projeto Supabase próprio, não reaproveitado
- [ ] Procedimento de exclusão/exportação de dados documentado para o fim de contrato

---

## 7. Plano de ação priorizado

**Antes do próximo cliente comercial (curto prazo):**
1. Fechar a listagem do bucket `fotos-carteira` (3.1) — é a falha mais grave aberta hoje.
2. Mover o rate limit da carteira para o banco (3.2) — segunda falha mais explorável.
3. Implementar Cloudflare Turnstile + rate limiting de borda (item 3 do Plano de Blindagem) — hoje é o item de maior risco financeiro (estouro de custo por varredura) sem nenhuma camada confirmada.
4. Adicionar log estruturado de ações administrativas no CRM.

**Para maturidade de produto (médio prazo):**
5. Padronizar gestão de segredos por cliente (variáveis de ambiente, nunca hardcode).
6. Formalizar `Error Trigger` em todos os fluxos n8n de produção.
7. Redigir e formalizar contrato de operação de dados (DPA) padrão para todo novo cliente, com revisão jurídica.
8. Documentar e testar o procedimento de exclusão/exportação de dados ao fim de contrato.

---

## 8. Boas práticas gerais de backend aplicadas ao SindCore

Cinco práticas comuns de hardening de API (rate limiting na borda, tratamento de erro assíncrono, configuração por ambiente, mensagens de erro genéricas, fluxo de Git com revisão) — todas se aplicam ao SindCore. Como o SindCore não tem um backend tradicional (é front-end + Supabase + n8n), a forma de implementar cada uma muda um pouco, mas o princípio é o mesmo. Evidências concretas encontradas no SINTEENP para cada ponto:

### 8.1 — Rate limiting deve ficar na borda, não no código da aplicação
Já coberto em detalhe na seção 3.2 — o rate limit da carteira é uma variável em memória do navegador, ou seja, está **dentro do código da aplicação** (no pior lugar possível, porque o "código da aplicação" aqui roda no navegador do atacante). Como o SindCore não tem um servidor próprio nem Redis, os dois lugares certos para isso são:
- **Cloudflare Rate Limiting Rules** na frente do domínio público (o "API Gateway" do SindCore) — bloqueia antes de a requisição chegar ao Supabase. É o item 3 do Plano de Blindagem.
- **Token bucket dentro do Postgres** (RPC `SECURITY DEFINER`) como mostrado na seção 3.2 — serve como segunda camada, porque a RPC pode ser chamada direto, sem passar pelo Cloudflare, se alguém descobrir a URL do Supabase.

### 8.2 — Erros assíncronos sem tratamento falham em silêncio
O fluxo principal de filiação (`filiacao.js`) já está bem coberto: o submit inteiro roda dentro de um único `try/catch` e qualquer erro cai em `tratarErro()`. **Mas o `catch` de captura de IP é um `catch {}` vazio** — se a API de IP falhar, o cadastro segue sem o IP de consentimento LGPD gravado, e ninguém é avisado. Para um campo que serve de prova de consentimento, isso merece pelo menos um log (mesmo que o cadastro continue):
```js
try {
  const ip = await capturarIP()
} catch (e) {
  console.warn('Falha ao capturar IP de consentimento:', e)
  // seguir mesmo assim, mas registrar — não falhar silenciosamente
}
```
No n8n (que é 100% assíncrono por natureza), o nó `Error Trigger` da seção 4 resolve exatamente este ponto.

### 8.3 — Configuração de ambiente hardcoded no código
O princípio "nunca hardcode URL/config que muda por ambiente" já é seguido para a credencial mais crítica (`supabase.js` fica de fora do Git, um arquivo por cliente). **Mas o webhook do n8n está hardcoded direto no `filiacao.js`:**
```js
await fetch('https://n8n.liftcode.com.br/webhook/pesquisa-sindicato', { ... })
```
Para um produto vendido a vários sindicatos, isso é um risco real: se um novo cliente for criado copiando o código e alguém esquecer de trocar essa URL, **as notificações de um sindicato podem ir para o webhook configurado para outro** (mistura de dados entre clientes — exatamente o tipo de incidente que a separação de projetos Supabase por cliente foi desenhada para evitar, mas aqui escaparia por uma porta diferente). Recomendação: tratar esse webhook como configuração por cliente, do mesmo jeito que a URL/chave do Supabase — num arquivo de config não commitado, ou pelo menos com o `nome_sindicato` enviado no payload e validado/roteado do lado do n8n.

### 8.4 — Nunca devolver erro técnico cru para o usuário final
Encontrado diretamente em `mapearMensagemErro()` (`filiacao.js`): toda a função é uma lista de mapeamentos para mensagens amigáveis, mas a última linha é:
```js
return mensagemOriginal || 'Erro ao enviar. Tente novamente.'
```
Ou seja, **qualquer erro que não esteja na lista mapeada aparece cru na tela do associado** — pode ser uma mensagem do PostgREST citando nome de tabela/coluna, um erro de policy do Storage, ou um erro de rede com URL interna. É exatamente o padrão "mandando stack trace pro usuário": deixa de ser só falta de polimento e passa a ser informação de mapa interno do sistema exposta a qualquer um que force um erro não previsto.

**Correção (aplicável a todo `catch` que termina em mensagem ao usuário, em qualquer página):**
```js
function mapearMensagemErro(error) {
  // ... mapeamentos específicos continuam iguais ...

  // Nunca devolver error.message bruto — sempre cair num genérico
  console.error('Erro não mapeado:', error) // log interno, não vai pra tela
  return 'Não foi possível concluir. Tente novamente em alguns instantes.'
}
```

### 8.5 — Commit direto na `main`, sem revisão
O repositório do SINTEENP tem só a branch `main` (confirmado: `git branch -a` não retorna nenhuma outra branch, local ou remota) — ou seja, todo o histórico foi desenvolvido e enviado direto na `main`, sem branch de feature nem revisão por PR. Para um projeto único isso é um risco controlável; para um **produto-base replicado em vários clientes**, um push com bug na `main` do repositório-modelo pode se propagar para a próxima cópia/cliente que for criado a partir dele. Recomendação ao virar produto comercial: branch `main` protegida (sem push direto), todo ajuste em branch própria com revisão antes do merge — mesmo que a revisão seja feita pela própria equipe da Liftcode.

---

*Documento de apoio técnico — Liftcode / SindCore. Baseado na auditoria real do SINTEENP-PB em produção, aplicado ao roadmap de comercialização do SindCore para múltiplos sindicatos (a partir do SINDESEP-PB).*
