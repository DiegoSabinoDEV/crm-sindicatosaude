/**
 * js/admin/novo.js — Cadastro manual de sócio
 * Sessão 7: Validação, busca CEP, inserção no banco
 */

/**
 * Validar formulário
 * @param {HTMLFormElement} formulario - Elemento do formulário
 * @returns {array} Array de erros encontrados
 */
export function validarFormulario(formulario) {
  const erros = []

  // Validar nome
  const nome = document.getElementById('nome').value.trim()
  if (!nome) {
    erros.push('Nome completo é obrigatório')
  }

  // Validar CPF
  const cpf = document.getElementById('cpf').value
  if (!cpf) {
    erros.push('CPF é obrigatório')
  } else if (!validarCPF(cpf)) {
    erros.push('CPF inválido')
  }

  // Validar data de nascimento
  const nascimento = document.getElementById('nascimento').value
  if (!nascimento) {
    erros.push('Data de nascimento é obrigatória')
  }

  // Validar WhatsApp
  const whatsapp = document.getElementById('whatsapp').value.trim()
  if (!whatsapp) {
    erros.push('WhatsApp é obrigatório')
  }

  return erros
}

/**
 * Validar CPF (algoritmo mod11)
 * @param {string} cpf - CPF com ou sem máscara
 * @returns {boolean} CPF válido
 */
export function validarCPF(cpf) {
  cpf = cpf.replace(/\D/g, '')
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false

  let soma = 0
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i]) * (10 - i)
  let r = (soma * 10) % 11
  if (r === 10 || r === 11) r = 0
  if (r !== parseInt(cpf[9])) return false

  soma = 0
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i]) * (11 - i)
  r = (soma * 10) % 11
  if (r === 10 || r === 11) r = 0
  return r === parseInt(cpf[10])
}

/**
 * Buscar endereço via ViaCEP API
 * @param {string} cep - CEP sem máscara
 * @returns {object} Endereço encontrado
 */
export async function buscarCEP(cep) {
  try {
    const cepLimpo = cep.replace(/\D/g, '')
    if (cepLimpo.length !== 8) {
      throw new Error('CEP deve ter 8 dígitos')
    }

    const response = await fetch(
      `https://viacep.com.br/ws/${cepLimpo}/json/`,
      { method: 'GET' }
    )

    if (!response.ok) {
      throw new Error('Erro ao buscar CEP')
    }

    const dados = await response.json()

    if (dados.erro) {
      throw new Error('CEP não encontrado')
    }

    return dados
  } catch (error) {
    console.error('Erro ao buscar CEP:', error)
    throw error
  }
}

/**
 * Cadastrar novo sócio no banco
 * @param {object} supabase - Cliente Supabase
 * @param {object} dados - Dados do sócio
 * @returns {object} Sócio criado
 */
export async function cadastrarSocio(supabase, dados) {
  try {
    // Validar dados mínimos
    if (!dados.nome_completo) throw new Error('Nome completo é obrigatório')
    if (!dados.cpf) throw new Error('CPF é obrigatório')
    if (!validarCPF(dados.cpf)) throw new Error('CPF inválido')
    if (!dados.whatsapp) throw new Error('WhatsApp é obrigatório')
    dados.forma_pagamento = dados.forma_pagamento || 'folha'

    // Inserir no banco
    const { data, error } = await supabase
      .from('socios')
      .insert([dados])
      .select()
      .single()

    if (error) {
      if (error.message.includes('duplicate key')) {
        throw new Error('Este CPF já está cadastrado')
      }
      throw error
    }

    return data
  } catch (error) {
    console.error('Erro ao cadastrar sócio:', error)
    throw error
  }
}

/**
 * Verificar se CPF já está cadastrado
 * @param {object} supabase - Cliente Supabase
 * @param {string} cpf - CPF sem máscara
 * @returns {boolean} CPF já existe
 */
export async function cpfJaExiste(supabase, cpf) {
  try {
    const { data, error } = await supabase
      .from('socios')
      .select('id')
      .eq('cpf', cpf)
      .single()

    if (error && error.code === 'PGRST116') {
      // Não encontrado
      return false
    }

    if (error) throw error
    return !!data
  } catch (error) {
    console.error('Erro ao verificar CPF:', error)
    throw error
  }
}

/**
 * Formatar CPF para visualização
 * @param {string} cpf - CPF sem máscara
 * @returns {string} CPF formatado (XXX.XXX.XXX-XX)
 */
export function formatarCPF(cpf) {
  if (!cpf) return ''
  const limpo = cpf.replace(/\D/g, '')
  if (limpo.length !== 11) return cpf
  return `${limpo.substring(0, 3)}.${limpo.substring(3, 6)}.${limpo.substring(6, 9)}-${limpo.substring(9)}`
}

/**
 * Formatar CEP para visualização
 * @param {string} cep - CEP sem máscara
 * @returns {string} CEP formatado (XXXXX-XXX)
 */
export function formatarCEP(cep) {
  if (!cep) return ''
  const limpo = cep.replace(/\D/g, '')
  if (limpo.length !== 8) return cep
  return `${limpo.substring(0, 5)}-${limpo.substring(5)}`
}

/**
 * Formatar telefone para visualização
 * @param {string} telefone - Telefone
 * @returns {string} Telefone formatado
 */
export function formatarTelefone(telefone) {
  if (!telefone) return ''
  const limpo = telefone.replace(/\D/g, '')
  if (limpo.length === 11) {
    return `(${limpo.substring(0, 2)}) ${limpo.substring(2, 7)}-${limpo.substring(7)}`
  } else if (limpo.length === 10) {
    return `(${limpo.substring(0, 2)}) ${limpo.substring(2, 6)}-${limpo.substring(6)}`
  }
  return telefone
}

/**
 * Obter lista de estados brasileiros
 * @returns {array} Estados com siglas
 */
export function obterEstados() {
  return [
    { sigla: 'AC', nome: 'Acre' },
    { sigla: 'AL', nome: 'Alagoas' },
    { sigla: 'AP', nome: 'Amapá' },
    { sigla: 'AM', nome: 'Amazonas' },
    { sigla: 'BA', nome: 'Bahia' },
    { sigla: 'CE', nome: 'Ceará' },
    { sigla: 'DF', nome: 'Distrito Federal' },
    { sigla: 'ES', nome: 'Espírito Santo' },
    { sigla: 'GO', nome: 'Goiás' },
    { sigla: 'MA', nome: 'Maranhão' },
    { sigla: 'MT', nome: 'Mato Grosso' },
    { sigla: 'MS', nome: 'Mato Grosso do Sul' },
    { sigla: 'MG', nome: 'Minas Gerais' },
    { sigla: 'PA', nome: 'Pará' },
    { sigla: 'PB', nome: 'Paraíba' },
    { sigla: 'PR', nome: 'Paraná' },
    { sigla: 'PE', nome: 'Pernambuco' },
    { sigla: 'PI', nome: 'Piauí' },
    { sigla: 'RJ', nome: 'Rio de Janeiro' },
    { sigla: 'RN', nome: 'Rio Grande do Norte' },
    { sigla: 'RS', nome: 'Rio Grande do Sul' },
    { sigla: 'RO', nome: 'Rondônia' },
    { sigla: 'RR', nome: 'Roraima' },
    { sigla: 'SC', nome: 'Santa Catarina' },
    { sigla: 'SP', nome: 'São Paulo' },
    { sigla: 'SE', nome: 'Sergipe' },
    { sigla: 'TO', nome: 'Tocantins' }
  ]
}

/**
 * Formatar data para ISO string
 * @param {string} data - Data em formato dd/mm/aaaa ou aaaa-mm-dd
 * @returns {string} Data em ISO string
 */
export function formatarDataParaISO(data) {
  if (!data) return null
  
  // Se já está em ISO (aaaa-mm-dd), apenas retorna
  if (/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return `${data}T00:00:00Z`
  }

  // Converter de dd/mm/aaaa para ISO
  const [dia, mes, ano] = data.split('/')
  if (!dia || !mes || !ano) return null
  
  const dataObj = new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia))
  return dataObj.toISOString()
}

/**
 * Obter resumo dos dados para confirmação
 * @returns {string} Resumo formatado
 */
export function obterResumoFormulario() {
  const nome = document.getElementById('nome').value
  const cpf = formatarCPF(document.getElementById('cpf').value)
  const empresa = document.getElementById('empresa').value
  const whatsapp = document.getElementById('whatsapp').value

  return `
Nome: ${nome}
CPF: ${cpf}
WhatsApp: ${whatsapp}
Local de Trabalho: ${empresa || '-'}
  `.trim()
}
