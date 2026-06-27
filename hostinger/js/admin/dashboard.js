/**
 * js/admin/dashboard.js — Lógica do dashboard de sócios
 * Sessão 5: Listagem com filtros + estatísticas
 */

/**
 * Carregar sócios com filtros
 * @param {object} supabase - Cliente Supabase
 * @param {object} filtros - { status, forma_pagamento, busca }
 * @returns {object} { socios, total, pendentes, aprovados, recusados }
 */
export async function carregarSocios(supabase, filtros) {
  try {
    // Query base
    let query = supabase
      .from('socios')
      .select('id,nome_completo,cpf,empresa,status,forma_pagamento,data_filiacao,adimplente')

    // Aplicar filtros
    if (filtros.status) {
      query = query.eq('status', filtros.status)
    }

    if (filtros.forma_pagamento) {
      query = query.eq('forma_pagamento', filtros.forma_pagamento)
    }

    if (filtros.busca) {
      query = query.or(
        `nome_completo.ilike.%${filtros.busca}%,cpf.ilike.%${filtros.busca}%`
      )
    }

    // Ordenar por data de criação (mais recente primeiro)
    query = query.order('created_at', { ascending: false })

    const { data, error } = await query

    if (error) throw error

    // Calcular estatísticas
    const estatisticas = calcularEstatisticas(data)

    return {
      socios: data || [],
      total: data?.length || 0,
      pendentes: estatisticas.pendentes,
      aprovados: estatisticas.aprovados,
      recusados: estatisticas.recusados
    }
  } catch (error) {
    console.error('Erro ao carregar sócios:', error)
    throw error
  }
}

/**
 * Calcular estatísticas de status
 * @param {array} socios - Array de sócios
 * @returns {object} Contagem por status
 */
export function calcularEstatisticas(socios) {
  if (!socios || !Array.isArray(socios)) {
    return { pendentes: 0, aprovados: 0, recusados: 0 }
  }

  const stats = {
    pendentes: 0,
    aprovados: 0,
    recusados: 0
  }

  socios.forEach(socio => {
    if (socio.status === 'pendente') stats.pendentes++
    else if (socio.status === 'aprovado') stats.aprovados++
    else if (socio.status === 'recusado') stats.recusados++
  })

  return stats
}

/**
 * Mascarar CPF para exibição (xxx.xxx.xxx-xx)
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
 * Obter total de sócios sem filtros
 * @param {object} supabase - Cliente Supabase
 * @returns {number} Total de sócios
 */
export async function obterTotalSocios(supabase) {
  try {
    const { count, error } = await supabase
      .from('socios')
      .select('*', { count: 'exact', head: true })

    if (error) throw error
    return count || 0
  } catch (error) {
    console.error('Erro ao obter total de sócios:', error)
    return 0
  }
}

/**
 * Obter sócios por status
 * @param {object} supabase - Cliente Supabase
 * @param {string} status - Status (pendente, aprovado, recusado)
 * @returns {array} Array de sócios
 */
export async function obterSociosPorStatus(supabase, status) {
  try {
    const { data, error } = await supabase
      .from('socios')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error(`Erro ao obter sócios ${status}:`, error)
    throw error
  }
}

export const obterSoiosPorStatus = obterSociosPorStatus

/**
 * Exportar sócios para CSV
 * @param {array} socios - Array de sócios
 * @param {string} nomeArquivo - Nome do arquivo a gerar
 */
export function exportarParaCSV(socios, nomeArquivo = 'socios.csv') {
  if (!socios || socios.length === 0) {
    alert('Nenhum sócio para exportar')
    return
  }

  // Headers do CSV
  const headers = ['Nome', 'CPF', 'Email', 'Whatsapp', 'Empresa', 'Status', 'Forma de Pagamento', 'Data de Filiação']
  
  // Linhas do CSV
  const linhas = socios.map(socio => [
    socio.nome_completo || '',
    mascararCPF(socio.cpf) || '',
    socio.email || '',
    socio.whatsapp || '',
    socio.empresa || '',
    socio.status === 'pendente' ? 'Pendente' : socio.status === 'aprovado' ? 'Aprovado' : 'Recusado',
    socio.forma_pagamento === 'folha' ? 'Folha' : 'Direto',
    new Date(socio.data_filiacao + 'T00:00:00').toLocaleDateString('pt-BR')
  ])

  // Montar CSV
  const csv = [
    headers.join(','),
    ...linhas.map(linha => linha.map(cell => `"${cell}"`).join(','))
  ].join('\n')

  // Download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = nomeArquivo
  link.click()
}

/**
 * Formatar data para exibição
 * @param {string} data - Data ISO
 * @returns {string} Data formatada
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
