/**
 * js/admin/detalhe.js — Lógica de detalhes do sócio
 * Sessão 6: Visualizar, aprovar, recusar, excluir + URLs assinadas
 */

/**
 * Carregar dados completos do sócio
 * @param {object} supabase - Cliente Supabase
 * @param {string} id - ID do sócio
 * @returns {object} Dados do sócio
 */
export async function carregarSocio(supabase, id) {
  try {
    const { data, error } = await supabase
      .from('socios')
      .select('*')
      .eq('id', id)
      .single()

    if (error) throw error
    if (!data) throw new Error('Sócio não encontrado')

    return data
  } catch (error) {
    console.error('Erro ao carregar sócio:', error)
    throw error
  }
}

/**
 * Gerar URL assinada para arquivo privado
 * @param {object} supabase - Cliente Supabase
 * @param {string} bucket - Nome do bucket (fichas ou contracheques)
 * @param {string} path - Caminho do arquivo
 * @returns {string} URL assinada (válida por 1 hora)
 */
export async function obterURLAssinada(supabase, bucket, path) {
  try {
    if (!path) return null

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600) // 1 hora de validade

    if (error) throw error
    return data.signedUrl
  } catch (error) {
    console.error(`Erro ao gerar URL assinada para ${bucket}:`, error)
    throw error
  }
}

/**
 * Aprovar sócio
 * @param {object} supabase - Cliente Supabase
 * @param {string} id - ID do sócio
 * @param {string} emailAdmin - Email do admin que aprova
 */
export async function aprovarSocio(supabase, id, emailAdmin, socio = null) {
  try {
    const { error } = await supabase
      .from('socios')
      .update({
        status: 'aprovado',
        aprovado_por: emailAdmin,
        aprovado_em: new Date().toISOString()
      })
      .eq('id', id)

    if (error) throw error

    if (socio && socio.origem !== 'manual') {
      await notificarSocio(socio, 'aprovado')
    }
  } catch (error) {
    console.error('Erro ao aprovar sócio:', error)
    throw error
  }
}

/**
 * Recusar sócio
 * @param {object} supabase - Cliente Supabase
 * @param {string} id - ID do sócio
 * @param {string} motivo - Motivo da recusa
 * @param {string} emailAdmin - Email do admin que recusa
 */
export async function recusarSocio(supabase, id, motivo, emailAdmin, socio = null) {
  try {
    if (!motivo || !motivo.trim()) {
      throw new Error('Informe o motivo da recusa')
    }

    const { error } = await supabase
      .from('socios')
      .update({
        status: 'recusado',
        motivo_recusa: motivo.trim(),
        aprovado_por: emailAdmin,
        aprovado_em: new Date().toISOString()
      })
      .eq('id', id)

    if (error) throw error

    if (socio && socio.origem !== 'manual') {
      await notificarSocio(socio, 'recusado', motivo.trim())
    }
  } catch (error) {
    console.error('Erro ao recusar sócio:', error)
    throw error
  }
}

/**
 * Excluir sócio e seus arquivos do storage
 * @param {object} supabase - Cliente Supabase
 * @param {string} id - ID do sócio
 */
export async function excluirSocio(supabase, id) {
  try {
    // 1. Carregar sócio para obter paths dos arquivos
    const socio = await carregarSocio(supabase, id)

    // 2. Deletar arquivos do storage
    if (socio.ficha_pdf_url || socio.assinatura_url) {
      const arquivosFichas = []
      if (socio.ficha_pdf_url) arquivosFichas.push(socio.ficha_pdf_url)
      if (socio.assinatura_url) arquivosFichas.push(socio.assinatura_url)

      if (arquivosFichas.length > 0) {
        const { error: erroFichas } = await supabase.storage
          .from('fichas')
          .remove(arquivosFichas)

        if (erroFichas) console.warn('Aviso ao deletar fichas:', erroFichas)
      }
    }

    if (socio.contracheque_url) {
      const { error: erroContracheque } = await supabase.storage
        .from('contracheques')
        .remove([socio.contracheque_url])

      if (erroContracheque) console.warn('Aviso ao deletar contracheque:', erroContracheque)
    }

    // 3. Deletar registro do banco
    const { error: erroDelete } = await supabase
      .from('socios')
      .delete()
      .eq('id', id)

    if (erroDelete) throw erroDelete
  } catch (error) {
    console.error('Erro ao excluir sócio:', error)
    throw error
  }
}

/**
 * Mascarar CPF para exibição
 * @param {string} cpf - CPF sem máscara
 * @returns {string} CPF mascarado
 */
export function mascararCPF(cpf) {
  if (!cpf) return '-'
  const limpo = cpf.replace(/\D/g, '')
  if (limpo.length !== 11) return cpf
  return `${limpo.substring(0, 3)}.${limpo.substring(3, 6)}.${limpo.substring(6, 9)}-${limpo.substring(9)}`
}

/**
 * Formatar data para exibição
 * @param {string} data - Data ISO
 * @returns {string} Data formatada (dd/mm/aaaa)
 */
export function formatarData(data) {
  if (!data) return '-'
  try {
    return new Date(data + 'T00:00:00').toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
  } catch {
    return '-'
  }
}

/**
 * Formatar data e hora
 * @param {string} data - Data ISO
 * @returns {string} Data e hora formatada
 */
export function formatarDataHora(data) {
  if (!data) return '-'
  try {
    return new Date(data).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    return '-'
  }
}

/**
 * Formatar telefone para exibição
 * @param {string} telefone - Telefone
 * @returns {string} Telefone formatado
 */
export function formatarTelefone(telefone) {
  if (!telefone) return '-'
  const limpo = telefone.replace(/\D/g, '')
  if (limpo.length === 11) {
    return `(${limpo.substring(0, 2)}) ${limpo.substring(2, 7)}-${limpo.substring(7)}`
  } else if (limpo.length === 10) {
    return `(${limpo.substring(0, 2)}) ${limpo.substring(2, 6)}-${limpo.substring(6)}`
  }
  return telefone
}

/**
 * Formatar CEP para exibição
 * @param {string} cep - CEP
 * @returns {string} CEP formatado (xxxxx-xxx)
 */
export function formatarCEP(cep) {
  if (!cep) return '-'
  const limpo = cep.replace(/\D/g, '')
  if (limpo.length !== 8) return cep
  return `${limpo.substring(0, 5)}-${limpo.substring(5)}`
}

/**
 * Traduzir status para português
 * @param {string} status - Status (pendente, aprovado, recusado)
 * @returns {string} Status traduzido
 */
export function traduzirStatus(status) {
  const mapa = {
    'pendente': 'Pendente',
    'aprovado': 'Aprovado',
    'recusado': 'Recusado'
  }
  return mapa[status] || status
}

/**
 * Traduzir forma de pagamento
 * @param {string} forma - Forma (folha, direto)
 * @returns {string} Forma traduzida
 */
export function traduzirFormaPagamento(forma) {
  const mapa = {
    'folha': 'Folha de Pagamento',
    'direto': 'Pagamento Direto'
  }
  return mapa[forma] || forma
}

/**
 * Traduzir sexo
 * @param {string} sexo - Sexo (M, F, O)
 * @returns {string} Sexo traduzido
 */
export function traduzirSexo(sexo) {
  const mapa = {
    'M': 'Masculino',
    'F': 'Feminino',
    'O': 'Outro'
  }
  return mapa[sexo] || sexo
}

/**
 * Obter informações resumidas do sócio
 * @param {object} socio - Dados do sócio
 * @returns {string} Resumo formatado
 */
export function obterResumoSocio(socio) {
  const linha1 = `${socio.nome_completo} (${mascararCPF(socio.cpf)})`
  const linha2 = socio.empresa ? `${socio.empresa} - ${socio.cargo || 'Sem cargo'}` : '-'
  const linha3 = `Status: ${traduzirStatus(socio.status)}`
  return `${linha1}\n${linha2}\n${linha3}`
}

/**
 * Carregar pagamentos do último ano (12 meses)
 * @param {object} supabase - Cliente Supabase
 * @param {string} socioId - ID do sócio
 * @returns {array} Lista de pagamentos ordenados por mes_referencia DESC
 */
export async function carregarPagamentos(supabase, socioId) {
  try {
    // Calcular data 12 meses atrás
    const dataLimite = new Date()
    dataLimite.setMonth(dataLimite.getMonth() - 12)
    const mesLimite = dataLimite.toISOString().substring(0, 7) // YYYY-MM

    const { data, error } = await supabase
      .from('pagamentos')
      .select('*')
      .eq('socio_id', socioId)
      .gte('mes_referencia', mesLimite)
      .order('mes_referencia', { ascending: false })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Erro ao carregar pagamentos:', error)
    throw error
  }
}

/**
 * Registrar ou atualizar pagamento (upsert)
 * @param {object} supabase - Cliente Supabase
 * @param {string} socioId - ID do sócio
 * @param {string} mesReferencia - Mês (YYYY-MM)
 * @param {number} valor - Valor do pagamento
 */
export async function registrarPagamento(supabase, socioId, mesReferencia, valor, forma, registradoPor, dataPagamento) {
  try {
    if (!mesReferencia || !mesReferencia.match(/^\d{4}-\d{2}$/)) {
      throw new Error('Mês de referência inválido (deve ser YYYY-MM)')
    }

    if (valor <= 0) {
      throw new Error('Valor deve ser maior que zero')
    }

    const payload = {
      socio_id: socioId,
      mes_referencia: mesReferencia,
      valor: parseFloat(valor),
      data_pagamento: dataPagamento || new Date().toISOString().split('T')[0],
      forma: forma || null,
      registrado_por: registradoPor || null
    }

    console.log('payload pagamento:', payload)

    const { error } = await supabase
      .from('pagamentos')
      .upsert(payload, { onConflict: 'socio_id,mes_referencia' })

    if (error) throw error
  } catch (error) {
    console.error('Erro ao registrar pagamento:', error)
    throw error
  }
}

/**
 * Verificar adimplência do sócio
 * Regra:
 * - Se forma_pagamento = 'folha' → sempre adimplente
 * - Se forma_pagamento = 'direto' → verificar últimos 2 meses com pagamentos
 * @param {object} supabase - Cliente Supabase
 * @param {string} socioId - ID do sócio
 * @param {string} formaPagamento - Forma (folha ou direto)
 * @returns {object} { adimplente: boolean, detalhes: string }
 */
export async function verificarAdimplencia(supabase, socioId, formaPagamento) {
  try {
    // Se forma de pagamento é folha, sempre adimplente
    if (formaPagamento === 'folha') {
      return {
        adimplente: true,
        detalhes: 'Pagamento via Folha de Pagamento (automático)'
      }
    }

    // Para pagamento direto, verificar apenas o mês atual
    const mesAtual = new Date().toISOString().slice(0, 7)

    const { data, error } = await supabase
      .from('pagamentos')
      .select('mes_referencia')
      .eq('socio_id', socioId)
      .eq('mes_referencia', mesAtual)

    if (error) throw error

    const adimplente = (data || []).length >= 1

    return {
      adimplente,
      detalhes: adimplente
        ? `Pagamento registrado em: ${mesAtual}`
        : `Sem pagamento registrado em ${mesAtual}`
    }
  } catch (error) {
    console.error('Erro ao verificar adimplência:', error)
    throw error
  }
}

/**
 * Alternar adimplência do sócio (toggle direto no campo socios.adimplente)
 */
export async function toggleAdimplente(supabase, id, valorAtual) {
  const { error } = await supabase
    .from('socios')
    .update({ adimplente: !valorAtual })
    .eq('id', id)
  if (error) throw error
}

/**
 * Editar dados cadastrais do sócio — somente campos permitidos
 */
export async function editarSocio(supabase, id, dados) {
  const { error } = await supabase
    .from('socios')
    .update(dados)
    .eq('id', id)
  if (error) throw error
}

/**
 * Notificar sócio via webhook n8n (WhatsApp + e-mail opcional)
 * Não bloqueia o fluxo em caso de falha
 */
export async function notificarSocio(socio, acao, motivo = '') {
  const payload = {
    acao,
    nome: socio.nome_completo,
    whatsapp: socio.whatsapp,
    email: socio.email || null,
    motivo: motivo || '',
    sindicato: 'SINDESEPPB-PB',
    telefone_sindicato: '(83) 0000-0000',
    link_filiacao: 'https://portalsinteenp.org/index.html'
  }

  console.log('Disparando webhook notificação...', payload)

  try {
    const response = await fetch('https://n8n.liftcode.com.br/webhook/pesquisa-sindicato', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    console.log('Resposta webhook:', response.status)
  } catch (e) {
    console.error('ERRO webhook notificação:', e)
  }
}
