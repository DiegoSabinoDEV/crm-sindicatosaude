import { supabase } from './supabase.js'
import { exportarAssinatura, canvasVazio, limparCanvas } from './assinatura.js'
import { gerarPDF } from './pdf.js'

function gerarUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

const form = document.getElementById('filiacao-form')
const submitButton = document.getElementById('submit-button')
const formMessage = document.getElementById('form-message')
const successMessage = document.getElementById('success-message')
const clearSignatureButton = document.getElementById('limpar-assinatura')
const cepInput = document.getElementById('cep')
const cepStatus = document.getElementById('cep-status')
let cepLookupTimeout = null
let ultimoCepConsultado = ''
let enviando = false

// Rate limit do formulário (anti-spam complementar ao hCaptcha):
// até RL_MAX_ENVIOS filiações bem-sucedidas por dispositivo dentro da janela;
// ao atingir o limite, bloqueia novos envios por RL_BLOQUEIO_MS.
// Persistido em localStorage (sobrevive a reload). Em localhost é ignorado.
const RL_KEY = 'sindesep_filiacao_rl'
const RL_MAX_ENVIOS = 3
const RL_JANELA_MS = 10 * 60_000
const RL_BLOQUEIO_MS = 10 * 60_000

if (clearSignatureButton) {
  clearSignatureButton.addEventListener('click', () => {
    limparCanvas()
    limparErro()
  })
}

if (cepInput) {
  cepInput.addEventListener('input', onCepInput)
  cepInput.addEventListener('change', () => preencherEnderecoPorCep(false))
  cepInput.addEventListener('blur', () => preencherEnderecoPorCep(true))

  const cepInicial = somenteDigitos(cepInput.value)
  if (cepInicial.length === 8) {
    window.setTimeout(() => preencherEnderecoPorCep(false), 0)
  }
}

const cpfInput = document.getElementById('cpf')
const whatsappInput = document.getElementById('whatsapp')

cpfInput?.addEventListener('input', () => {
  cpfInput.value = formatarCPF(cpfInput.value)
})

whatsappInput?.addEventListener('input', () => {
  whatsappInput.value = formatarTelefone(whatsappInput.value)
})

form?.addEventListener('submit', async event => {
  event.preventDefault()
  if (enviando) return
  enviando = true
  limparErro()
  setEnviando(true)

  try {
    const bloqueio = checarRateLimit()
    if (bloqueio.bloqueado) {
      throw new Error(`Você atingiu o limite de ${RL_MAX_ENVIOS} envios. Aguarde ${bloqueio.minutos} min e tente novamente.`)
    }

    const dados = coletarDadosFormulario()
    const uuid = gerarUUID()

    validarCampos(dados)

    if (!validarCPF(dados.cpf)) {
      throw new Error('CPF inválido. Verifique os números.')
    }

    const htoken = typeof hcaptcha !== 'undefined' ? hcaptcha.getResponse() : ''
    if (!htoken && window.location.hostname !== 'localhost') {
      throw new Error('Por favor, confirme que você não é um robô.')
    }

    const ip = await capturarIP()
    const assinatura = await assinarCanvas()
    const dataConsentimento = new Date().toISOString()
    const pdfBlob = await gerarPDF({
      ...dados,
      id: uuid,
      assinaturaDataUrl: assinatura.dataUrl,
      data_consentimento_lgpd: dataConsentimento,
      ip_consentimento: ip,
      geradoEm: dataConsentimento,
      assinadoEm: dataConsentimento
    })

    const contrachequePath = await uploadContracheque(uuid, dados.cpf, dados.contracheque)
    const fichaPath = await uploadFicha(uuid, dados.cpf, pdfBlob)
    const assinaturaPath = await uploadAssinatura(uuid, dados.cpf, assinatura.blob)

    await insertSocio({
      ...dados,
      id: uuid,
      status: 'pendente',
      ficha_pdf_url: fichaPath,
      contracheque_url: contrachequePath,
      assinatura_url: assinaturaPath,
      consentimento_lgpd: true,
      data_consentimento_lgpd: dataConsentimento,
      ip_consentimento: ip,
      origem: 'pagina_web',
      data_filiacao: new Date().toISOString().split('T')[0],
      forma_pagamento: 'folha'
    })

    registrarEnvio()

    try {
      await fetch('https://n8n.liftcode.com.br/webhook/pesquisa-sindicato', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao: 'nova_filiacao',
          nome: dados.nome_completo,
          whatsapp: dados.whatsapp,
          email: dados.email || null,
          empresa: dados.empresa || '',
          cargo: dados.cargo || '',
          sindicato: 'SINDESEP-PB',
          admin_whatsapp: '5583988577278',
          link_crm: 'https://crm.sindesep.org.br/dashboard.html'
        })
      })
    } catch {}

    exibirSucesso(uuid)
  } catch (error) {
    enviando = false
    setEnviando(false)
    tratarErro(error)
  }
})

function coletarDadosFormulario() {
  const contracheque = document.getElementById('contracheque')?.files?.[0] || null

  const whatsapp = valorCampo('whatsapp')
  return {
    nome_completo: valorCampo('nome_completo'),
    cpf: somenteDigitos(valorCampo('cpf')),
    rg: valorCampo('rg'),
    data_nascimento: valorCampo('data_nascimento') || null,
    email: valorCampo('email'),
    telefone: whatsapp,
    whatsapp: whatsapp,
    cep: somenteDigitos(valorCampo('cep')),
    logradouro: valorCampo('logradouro'),
    numero: valorCampo('numero'),
    complemento: valorCampo('complemento'),
    bairro: valorCampo('bairro'),
    cidade: valorCampo('cidade'),
    estado: valorCampo('estado').toUpperCase(),
    empresa: valorCampo('empresa'),
    cargo: valorCampo('cargo'),
    segunda_empresa: valorCampo('segunda_empresa') || null,
    contracheque,
    autorizacao_desconto: document.getElementById('autorizacao_desconto')?.checked === true,
    consentimento_lgpd: document.getElementById('consentimento_lgpd')?.checked === true,
    declaracao_verdade: document.getElementById('declaracao_verdade')?.checked === true
  }
}

function validarCampos(dados) {
  if (!dados.nome_completo) {
    throw new Error('Preencha o nome completo para continuar.')
  }

  if (!dados.cpf) {
    throw new Error('Preencha o CPF para continuar.')
  }

  if (!dados.data_nascimento) {
    throw new Error('Informe sua data de nascimento.')
  }

  if (!dados.whatsapp) {
    throw new Error('Preencha o WhatsApp para continuar.')
  }

  if (!dados.email) {
    throw new Error('O e-mail é obrigatório.')
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) {
    throw new Error('Digite um e-mail válido.')
  }

  if (!dados.empresa) {
    throw new Error('O nome da empresa é obrigatório.')
  }

  if (!dados.cargo) {
    throw new Error('O cargo é obrigatório.')
  }

  if (!dados.contracheque) {
    throw new Error('Envie o contracheque para continuar.')
  }

  if (!tiposContrachequeValidos().includes(dados.contracheque.type)) {
    throw new Error('Envie um contracheque em PDF, JPG ou PNG.')
  }

  if (dados.contracheque.size > 5 * 1024 * 1024) {
    throw new Error('O contracheque deve ter no máximo 5MB. Compacte o arquivo e tente novamente.')
  }

  if (canvasVazio()) {
    throw new Error('A assinatura digital é obrigatória.')
  }

  if (!dados.autorizacao_desconto) {
    throw new Error('É necessário autorizar o desconto em contracheque para continuar.')
  }

  if (!dados.consentimento_lgpd) {
    throw new Error('Aceite a política de privacidade para continuar.')
  }

  if (!dados.declaracao_verdade) {
    throw new Error('Confirme a declaração para continuar.')
  }
}

function validarCPF(cpf) {
  cpf = cpf.replace(/\D/g, '')
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false
  let soma = 0
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i], 10) * (10 - i)
  let r = (soma * 10) % 11
  if (r === 10 || r === 11) r = 0
  if (r !== parseInt(cpf[9], 10)) return false
  soma = 0
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i], 10) * (11 - i)
  r = (soma * 10) % 11
  if (r === 10 || r === 11) r = 0
  return r === parseInt(cpf[10], 10)
}

async function capturarIP() {
  if (window.location.protocol === 'file:') {
    return ''
  }

  try {
    const resposta = await fetch('https://api.ipapi.is/?q')
    if (!resposta.ok) {
      return ''
    }

    const dados = await resposta.json()
    return dados.ip || dados.query || dados.address || ''
  } catch {
    return ''
  }
}

async function assinarCanvas() {
  const dataUrl = exportarAssinatura()
  if (!dataUrl) {
    throw new Error('Assine o formulário para continuar.')
  }

  const blob = await dataUrlParaBlob(dataUrl)
  return { dataUrl, blob }
}

async function uploadContracheque(uuid, cpf, arquivo) {
  if (!arquivo) return null

  const path = `${uuid}-${cpf}`
  const { error } = await supabase.storage
    .from('contracheques')
    .upload(path, arquivo, {
      cacheControl: '3600',
      contentType: arquivo.type,
      upsert: false
    })

  if (error) {
    throw error
  }

  return path
}

async function uploadFicha(uuid, cpf, pdfBlob) {
  const path = `${uuid}-${cpf}.pdf`
  const { error } = await supabase.storage
    .from('fichas')
    .upload(path, pdfBlob, {
      cacheControl: '3600',
      contentType: 'application/pdf',
      upsert: false
    })

  if (error) {
    throw error
  }

  return path
}

async function uploadAssinatura(uuid, cpf, blob) {
  const path = `${uuid}-${cpf}-ass.png`
  const { error } = await supabase.storage
    .from('fichas')
    .upload(path, blob, {
      cacheControl: '3600',
      contentType: 'image/png',
      upsert: false
    })

  if (error) {
    throw error
  }

  return path
}

async function insertSocio(payload) {
  const { contracheque, declaracao_verdade, ...dadosSocio } = payload
  const { error } = await supabase.from('socios').insert(dadosSocio)

  if (error) {
    throw error
  }
}

async function preencherEnderecoPorCep(force = false) {
  if (!cepInput) return

  const cep = somenteDigitos(cepInput.value)
  if (!cep) {
    setCepStatus('')
    return
  }

  if (cep.length !== 8) {
    setCepStatus('CEP incompleto.')
    return
  }

  if (!force && cep === ultimoCepConsultado) {
    return
  }

  setCepStatus('Buscando endereço...')

  try {
    const dados = await consultarCep(cep)

    if (dados.erro) {
      setCepStatus('CEP não encontrado.')
      return
    }

    preencherCampo('logradouro', dados.logradouro || '')
    preencherCampo('bairro', dados.bairro || '')
    preencherCampo('cidade', dados.localidade || '')
    preencherCampo('estado', (dados.uf || '').toUpperCase())
    preencherCampo('complemento', valorCampo('complemento') || dados.complemento || '')
    ultimoCepConsultado = cep
    setCepStatus('Endereço preenchido com sucesso.')
  } catch {
    setCepStatus('Não foi possível consultar o CEP agora.')
  }
}

function consultarCep(cep) {
  return new Promise((resolve, reject) => {
    const callbackName = `viacepCallback_${Date.now()}_${Math.random().toString(16).slice(2)}`
    const script = document.createElement('script')
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('timeout'))
    }, 8000)

    function cleanup() {
      window.clearTimeout(timeout)
      delete window[callbackName]
      script.remove()
    }

    window[callbackName] = dados => {
      cleanup()
      resolve(dados)
    }

    script.onerror = () => {
      cleanup()
      reject(new Error('script-error'))
    }

    script.src = `https://viacep.com.br/ws/${cep}/json/?callback=${callbackName}`
    document.body.appendChild(script)
  })
}

function tratarErro(error) {
  const mensagem = mapearMensagemErro(error)
  exibirErro(mensagem)
}

function mapearMensagemErro(error) {
  const mensagemOriginal = error?.message || ''
  const codigo = error?.code || ''

  if (mensagemOriginal === 'CPF inválido. Verifique os números.') {
    return mensagemOriginal
  }

  if (mensagemOriginal === 'Envie o contracheque para continuar.') {
    return mensagemOriginal
  }

  if (mensagemOriginal === 'A assinatura digital é obrigatória.') {
    return mensagemOriginal
  }

  if (mensagemOriginal === 'É necessário autorizar o desconto em contracheque para continuar.') {
    return mensagemOriginal
  }

  if (mensagemOriginal === 'Aceite a política de privacidade para continuar.') {
    return mensagemOriginal
  }

  if (mensagemOriginal === 'Por favor, confirme que você não é um robô.') {
    return mensagemOriginal
  }

  if (mensagemOriginal.includes('Compacte o arquivo')) {
    return mensagemOriginal
  }

  if (codigo === '23505') {
    if (mensagemOriginal.includes('socios_cpf_key')) {
      return 'Este CPF já possui cadastro.'
    }
    if (mensagemOriginal.includes('socios_numero_controle_key')) {
      return 'Erro interno ao gerar número de controle. Tente novamente em alguns segundos.'
    }
    return 'Erro ao processar cadastro. Tente novamente.'
  }

  return mensagemOriginal || 'Erro ao enviar. Tente novamente.'
}

function exibirErro(mensagem) {
  if (!formMessage) return
  formMessage.textContent = mensagem
  formMessage.className = 'form-error is-visible'
  formMessage.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function limparErro() {
  if (!formMessage) return
  formMessage.textContent = ''
  formMessage.className = 'form-error'
}

function exibirSucesso(socioId) {
  const protocolo = socioId ? socioId.substring(0, 8).toUpperCase() : ''
  const protocoloEl = document.getElementById('protocolo-numero')
  if (protocoloEl && protocolo) {
    protocoloEl.textContent = `Protocolo: ${protocolo}`
  }
  if (form) form.style.display = 'none'
  if (successMessage) {
    successMessage.style.display = 'block'
    successMessage.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

function setEnviando(ativo) {
  if (!form || !submitButton) return

  for (const elemento of form.elements) {
    if ('disabled' in elemento) {
      elemento.disabled = ativo
    }
  }

  submitButton.disabled = ativo
  submitButton.textContent = ativo ? 'Enviando filiação...' : 'Enviar filiação'
}

// --- Rate limit anti-spam (localStorage) -----------------------------------

function lerEstadoRL() {
  try {
    const bruto = localStorage.getItem(RL_KEY)
    if (!bruto) return { timestamps: [], bloqueadoAte: 0 }
    const dados = JSON.parse(bruto)
    return {
      timestamps: Array.isArray(dados.timestamps) ? dados.timestamps : [],
      bloqueadoAte: Number(dados.bloqueadoAte) || 0
    }
  } catch {
    return { timestamps: [], bloqueadoAte: 0 }
  }
}

function checarRateLimit() {
  // Em desenvolvimento não bloqueia, igual ao bypass do hCaptcha.
  if (window.location.hostname === 'localhost') return { bloqueado: false, minutos: 0 }
  try {
    const agora = Date.now()
    const estado = lerEstadoRL()
    if (estado.bloqueadoAte > agora) {
      return { bloqueado: true, minutos: Math.ceil((estado.bloqueadoAte - agora) / 60_000) }
    }
    return { bloqueado: false, minutos: 0 }
  } catch {
    return { bloqueado: false, minutos: 0 } // fail-open: localStorage indisponível
  }
}

function registrarEnvio() {
  if (window.location.hostname === 'localhost') return
  try {
    const agora = Date.now()
    const estado = lerEstadoRL()
    const recentes = estado.timestamps.filter(t => agora - t < RL_JANELA_MS)
    recentes.push(agora)
    const novo = { timestamps: recentes, bloqueadoAte: estado.bloqueadoAte }
    if (recentes.length >= RL_MAX_ENVIOS) {
      novo.bloqueadoAte = agora + RL_BLOQUEIO_MS
    }
    localStorage.setItem(RL_KEY, JSON.stringify(novo))
  } catch {
    // localStorage indisponível (modo privado): rate limit simplesmente não persiste.
  }
}

function valorCampo(id) {
  return document.getElementById(id)?.value.trim() || ''
}

function preencherCampo(id, valor) {
  const campo = document.getElementById(id)
  if (campo) {
    campo.value = valor
  }
}

function somenteDigitos(valor) {
  return valor.replace(/\D/g, '')
}

function formatarCPF(valor) {
  const digits = somenteDigitos(valor).slice(0, 11)
  return digits
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

function formatarTelefone(valor) {
  const digits = somenteDigitos(valor).slice(0, 11)

  if (digits.length <= 10) {
    return digits
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d)/, '$1-$2')
  }

  return digits
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d)/, '$1-$2')
}

function onCepInput() {
  if (!cepInput) return

  const digits = somenteDigitos(cepInput.value).slice(0, 8)
  cepInput.value = digits.replace(/(\d{5})(\d)/, '$1-$2')

  if (cepLookupTimeout) {
    clearTimeout(cepLookupTimeout)
  }

  if (digits.length < 8) {
    ultimoCepConsultado = ''
    setCepStatus('')
    return
  }

  cepLookupTimeout = setTimeout(() => {
    preencherEnderecoPorCep(false)
  }, 250)
}

function setCepStatus(mensagem) {
  if (cepStatus) {
    cepStatus.textContent = mensagem
  }
}

function tiposContrachequeValidos() {
  return ['application/pdf', 'image/png', 'image/jpeg']
}

async function dataUrlParaBlob(dataUrl) {
  const resposta = await fetch(dataUrl)
  return resposta.blob()
}

// Shrink topbar ao rolar
const _topbar = document.querySelector('.topbar')
if (_topbar) {
  window.addEventListener('scroll', () => {
    _topbar.classList.toggle('scrolled', window.scrollY > 60)
  }, { passive: true })
}
