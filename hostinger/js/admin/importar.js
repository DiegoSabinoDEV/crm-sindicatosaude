/**
 * js/admin/importar.js
 * Funções de importação em lote CSV/XLSX com validação CPF e batch insert
 */

import { supabase } from '../supabase.js'

/**
 * Processa arquivo CSV ou XLSX
 * Retorna { dados: [...], original: File }
 */
export async function processarCSV(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = async (e) => {
      try {
        const conteudo = e.target.result

        let dados = []

        if (file.name.endsWith('.csv')) {
          // Parse CSV
          dados = parseCSV(conteudo)
        } else if (file.name.endsWith('.xlsx')) {
          // Parse XLSX usando SheetJS via CDN
          const workbook = await carregarXLSX(file)
          dados = extrairDadosXLSX(workbook)
        }

        resolve({ dados, original: file })
      } catch (error) {
        reject(new Error(`Erro ao processar arquivo: ${error.message}`))
      }
    }

    reader.onerror = () => {
      reject(new Error('Erro ao ler o arquivo'))
    }

    reader.readAsText(file)
  })
}

/**
 * Parse CSV simples (sem biblioteca externa)
 * Primeira linha = headers
 */
function parseCSV(conteudo) {
  const linhas = conteudo.trim().split('\n')
  if (linhas.length < 2) return []

  // Headers
  const headers = linhas[0].split(',').map(h => h.trim().toLowerCase())

  // Dados
  const dados = []
  for (let i = 1; i < linhas.length; i++) {
    const valores = parseLinhaPSV(linhas[i])
    if (valores.length !== headers.length) continue

    const obj = {}
    headers.forEach((h, idx) => {
      obj[h] = valores[idx].trim()
    })

    dados.push(obj)
  }

  return dados
}

/**
 * Parse linha CSV respeitando aspas
 */
function parseLinhaPSV(linha) {
  const resultado = []
  let atual = ''
  let dentroAspas = false

  for (let i = 0; i < linha.length; i++) {
    const char = linha[i]
    const proxChar = linha[i + 1]

    if (char === '"') {
      if (dentroAspas && proxChar === '"') {
        atual += '"'
        i++
      } else {
        dentroAspas = !dentroAspas
      }
    } else if (char === ',' && !dentroAspas) {
      resultado.push(atual)
      atual = ''
    } else {
      atual += char
    }
  }

  resultado.push(atual)
  return resultado
}

/**
 * Carregar XLSX via SheetJS CDN
 */
async function carregarXLSX(file) {
  // Carregar SheetJS se não existir
  if (typeof window.XLSX === 'undefined') {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js'
      script.onload = () => {
        const reader = new FileReader()
        reader.onload = (e) => {
          try {
            const workbook = window.XLSX.read(e.target.result, { type: 'binary' })
            resolve(workbook)
          } catch (error) {
            reject(error)
          }
        }
        reader.readAsBinaryString(file)
      }
      script.onerror = () => reject(new Error('Erro ao carregar SheetJS'))
      document.head.appendChild(script)
    })
  } else {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const workbook = window.XLSX.read(e.target.result, { type: 'binary' })
          resolve(workbook)
        } catch (error) {
          reject(error)
        }
      }
      reader.readAsBinaryString(file)
    })
  }
}

/**
 * Extrair dados da primeira sheet do XLSX
 */
function extrairDadosXLSX(workbook) {
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  const dados = window.XLSX.utils.sheet_to_json(worksheet, { defval: '' })
  return dados
}

/**
 * Validar linha CSV conforme schema socios
 * Retorna { valido: boolean, erro?: string }
 */
export function validarLinhaCSV(linha) {
  // Mapear headers padronizados (case-insensitive)
  const dados = normalizarCampos(linha)

  // Obrigatórios
  if (!dados.nome_completo || !dados.nome_completo.trim()) {
    return { valido: false, erro: 'Nome completo obrigatório' }
  }

  if (!dados.cpf) {
    return { valido: false, erro: 'CPF obrigatório' }
  }

  // Validar CPF
  const cpfLimpo = dados.cpf.replace(/\D/g, '')
  if (!validarCPF(cpfLimpo)) {
    return { valido: false, erro: `CPF inválido: ${dados.cpf}` }
  }

  if (!dados.whatsapp || !dados.whatsapp.trim()) {
    return { valido: false, erro: 'WhatsApp obrigatório' }
  }

  if (!dados.forma_pagamento || !['folha', 'direto'].includes(dados.forma_pagamento.toLowerCase())) {
    return { valido: false, erro: 'Forma pagamento deve ser "folha" ou "direto"' }
  }

  // Validar datas (se preenchidas)
  if (dados.data_nascimento && !isValidDate(dados.data_nascimento)) {
    return { valido: false, erro: `Data nascimento inválida: ${dados.data_nascimento}` }
  }

  if (dados.data_admissao && !isValidDate(dados.data_admissao)) {
    return { valido: false, erro: `Data admissão inválida: ${dados.data_admissao}` }
  }

  // Validar email (se preenchido)
  if (dados.email && !isValidEmail(dados.email)) {
    return { valido: false, erro: `Email inválido: ${dados.email}` }
  }

  return { valido: true }
}

/**
 * Normalizar campos CSV para schema socios
 * Aceita variações de nomes de coluna
 */
function normalizarCampos(linha) {
  const mapa = {
    nome: 'nome_completo',
    name: 'nome_completo',
    'nome completo': 'nome_completo',
    'full name': 'nome_completo',
    cpf_number: 'cpf',
    cpfnumber: 'cpf',
    document: 'cpf',
    rg_number: 'rg',
    rgnumber: 'rg',
    'data de nascimento': 'data_nascimento',
    'date of birth': 'data_nascimento',
    birthdate: 'data_nascimento',
    'data nasc': 'data_nascimento',
    sexo: 'sexo',
    gender: 'sexo',
    'estado civil': 'estado_civil',
    'marital status': 'estado_civil',
    email_address: 'email',
    'e-mail': 'email',
    telefone_number: 'telefone',
    phone: 'telefone',
    'telefone celular': 'whatsapp',
    whatsapp_number: 'whatsapp',
    'cel whatsapp': 'whatsapp',
    'cep': 'cep',
    'zip code': 'cep',
    'logradouro': 'logradouro',
    address: 'logradouro',
    street: 'logradouro',
    'número': 'numero',
    number: 'numero',
    'house number': 'numero',
    'complemento': 'complemento',
    'apt/suite': 'complemento',
    'bairro': 'bairro',
    neighborhood: 'bairro',
    'distrito': 'bairro',
    'cidade': 'cidade',
    city: 'cidade',
    'estado': 'estado',
    state: 'estado',
    'uf': 'estado',
    'empresa': 'empresa',
    company: 'empresa',
    'employer': 'empresa',
    'cargo': 'cargo',
    position: 'cargo',
    job_title: 'cargo',
    'matrícula': 'matricula',
    'matricula': 'matricula',
    'employee id': 'matricula',
    'setor': 'setor',
    department: 'setor',
    sector: 'setor',
    'data de admissão': 'data_admissao',
    'admission date': 'data_admissao',
    'data admissão': 'data_admissao',
    'hire date': 'data_admissao',
    'forma de pagamento': 'forma_pagamento',
    'payment method': 'forma_pagamento',
    'valor mensalidade': 'valor_mensalidade',
    'monthly fee': 'valor_mensalidade',
    valor: 'valor_mensalidade'
  }

  const dados = {}

  // Iterar sobre cada campo do input
  Object.keys(linha).forEach(chaveOriginal => {
    const chaveLower = chaveOriginal.toLowerCase().trim()
    const chaveNormalizada = mapa[chaveLower] || chaveLower

    // Se encontrou no mapa, usar valor normalizado
    if (mapa[chaveLower]) {
      dados[mapa[chaveLower]] = linha[chaveOriginal]
    } else {
      // Caso contrário, usar original em minúsculas
      dados[chaveLower] = linha[chaveOriginal]
    }
  })

  // Limpar e normalizar valores
  if (dados.cpf) {
    dados.cpf = dados.cpf.replace(/\D/g, '')
  }

  if (dados.forma_pagamento) {
    dados.forma_pagamento = dados.forma_pagamento.toLowerCase()
  }

  if (dados.sexo && ['m', 'f', 'o'].includes(dados.sexo.charAt(0).toLowerCase())) {
    dados.sexo = dados.sexo.charAt(0).toUpperCase()
  }

  // Converter valor para número
  if (dados.valor_mensalidade) {
    const valor = parseFloat(String(dados.valor_mensalidade).replace(',', '.'))
    dados.valor_mensalidade = isNaN(valor) ? null : valor
  }

  // Setar valores padrão
  dados.status = 'pendente'
  dados.origem = 'importacao'
  dados.consentimento_lgpd = false // Confirmar depois manualmente
  dados.created_at = new Date().toISOString()
  dados.updated_at = new Date().toISOString()

  return dados
}

/**
 * Validar CPF (algoritmo mod-11)
 */
export function validarCPF(cpf) {
  cpf = cpf.replace(/\D/g, '')
  
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
    return false
  }

  let soma = 0
  for (let i = 0; i < 9; i++) {
    soma += parseInt(cpf[i]) * (10 - i)
  }

  let resto = (soma * 10) % 11
  if (resto === 10 || resto === 11) resto = 0
  if (resto !== parseInt(cpf[9])) return false

  soma = 0
  for (let i = 0; i < 10; i++) {
    soma += parseInt(cpf[i]) * (11 - i)
  }

  resto = (soma * 10) % 11
  if (resto === 10 || resto === 11) resto = 0
  return resto === parseInt(cpf[10])
}

/**
 * Validar data (YYYY-MM-DD ou DD/MM/YYYY)
 */
function isValidDate(dateString) {
  if (!dateString) return true

  let date
  if (dateString.includes('-')) {
    date = new Date(dateString)
  } else if (dateString.includes('/')) {
    const [dia, mes, ano] = dateString.split('/').map(Number)
    date = new Date(ano, mes - 1, dia)
  } else {
    return false
  }

  return date instanceof Date && !isNaN(date.getTime())
}

/**
 * Validar email
 */
function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return regex.test(email)
}

/**
 * Gerar modelo CSV para download
 */
export function gerarModeloCSV() {
  const headers = [
    'Nome Completo',
    'CPF',
    'RG',
    'Data Nascimento (YYYY-MM-DD)',
    'Sexo (M/F/O)',
    'Estado Civil',
    'Email',
    'Telefone',
    'WhatsApp',
    'CEP',
    'Logradouro',
    'Número',
    'Complemento',
    'Bairro',
    'Cidade',
    'Estado',
    'Empresa',
    'Cargo',
    'Matrícula',
    'Setor',
    'Data Admissão (YYYY-MM-DD)',
    'Forma Pagamento (folha/direto)',
    'Valor Mensalidade'
  ]

  const exemplos = [
    [
      'João da Silva',
      '12345678901',
      '1234567',
      '1985-03-15',
      'M',
      'Casado',
      'joao@email.com',
      '1133334444',
      '11987654321',
      '01311100',
      'Avenida Paulista',
      '1000',
      'Apto 42',
      'Bela Vista',
      'São Paulo',
      'SP',
      'ABC Indústria',
      'Gerente de Operações',
      'MAT123456',
      'Produção',
      '2020-05-10',
      'folha',
      '150.00'
    ]
  ]

  let csv = headers.join(',') + '\n'
  exemplos.forEach(linha => {
    csv += linha.map(v => `"${v}"`).join(',') + '\n'
  })

  // Trigger download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.setAttribute('href', url)
  link.setAttribute('download', `modelo_importacao_socios_${new Date().toISOString().split('T')[0]}.csv`)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
