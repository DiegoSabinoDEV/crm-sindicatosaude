// jsPDF carregado via <script> UMD no HTML — não usar import (ES build tem deps @babel/runtime)
const { jsPDF, GState } = window.jspdf || {}

const COR_PRIMARIO     = [138, 154, 91]   // verde oliva SINDESEP #8A9A5B
const COR_PRETO        = [26, 26, 26]
const COR_BRANCO       = [255, 255, 255]
const COR_TEXTO        = [30, 41, 59]
const COR_MUTED        = [100, 116, 139]
const COR_BORDA        = [226, 232, 240]
const COR_FUNDO_SEC    = [245, 245, 245]
const COR_CINZA_CLARO  = [204, 204, 204]

const TEXTO_AUTORIZACAO = 'Me declaro empregado(a) filiado(a) ao SINDESEP-PB, autorizando para tanto o desconto da mensalidade social no meu contracheque, correspondente a 1% (um por cento) do meu salario base em favor do SINDESEP-PB.'
const TEXTO_LGPD = 'Declaro que li e concordo com a politica de privacidade e autorizo o tratamento dos meus dados pessoais para fins de filiacao sindical, nos termos da LGPD (Lei 13.709/2018).'

async function carregarLogoBase64(url) {
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    return new Promise(resolve => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.readAsDataURL(blob)
    })
  } catch (e) {
    console.error('[pdf.js] Falha ao carregar logo:', url, e)
    return null
  }
}

async function adicionarMarcaDagua(doc, logoBase64) {
  if (!logoBase64) return
  const pageWidth  = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  try { doc.saveGraphicsState() } catch (e) { console.error('[pdf.js] saveGraphicsState:', e) }

  try {
    if (typeof GState !== 'undefined' && GState) {
      doc.setGState(new GState({ opacity: 0.08 }))
    }
  } catch (e) {
    console.error('[pdf.js] GState opacity falhou:', e)
  }

  const imgW = 70
  const imgH = 68
  const x = (pageWidth  - imgW) / 2
  const y = (pageHeight - imgH) / 2

  try {
    doc.addImage(logoBase64, 'PNG', x, y, imgW, imgH)
  } catch (e) {
    console.error('[pdf.js] addImage marcaDagua falhou:', e)
  }

  try { doc.restoreGraphicsState() } catch (e) { console.error('[pdf.js] restoreGraphicsState:', e) }
}

function valor(value, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function formatarData(value) {
  if (!value) return '-'
  const soData = String(value).split('T')[0]
  if (/^\d{4}-\d{2}-\d{2}$/.test(soData)) {
    const [ano, mes, dia] = soData.split('-')
    return `${dia}/${mes}/${ano}`
  }
  const data = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(data.getTime())) return '-'
  return new Intl.DateTimeFormat('pt-BR').format(data)
}

function formatarDataHora(value) {
  if (!value) return '-'
  const data = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(data.getTime())) return '-'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(data)
}

export async function gerarPDF(dados = {}) {
  const [logoIcone, logoMarca] = await Promise.all([
    carregarLogoBase64('/logo/faviSINDESEP.png'),
    carregarLogoBase64('/logo/logoHD.png')
  ])

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const largura      = doc.internal.pageSize.getWidth()   // 210mm
  const altura       = doc.internal.pageSize.getHeight()  // 297mm
  const margemX      = 12
  const larguraTexto = largura - margemX * 2              // 186mm

  const registroId = dados.id || dados.uuid || globalThis.crypto?.randomUUID?.() || `temp-${Date.now()}`
  const geradoEm   = dados.geradoEm   || new Date().toISOString()
  const assinadoEm = dados.assinadoEm || geradoEm

  // ── MARCA D'ÁGUA ───────────────────────────────────────────────────────────
  try {
    await adicionarMarcaDagua(doc, logoMarca)
  } catch (e) {
    console.error('[pdf.js] Marca d\'água abortou:', e)
  }

  // ── CABEÇALHO ──────────────────────────────────────────────────────────────
  const alturaHeader = 28

  doc.setFillColor(...COR_PRETO)
  doc.rect(0, 0, largura, alturaHeader, 'F')

  if (logoIcone) {
    try { doc.addImage(logoIcone, 'PNG', margemX, 5, 18, 18) } catch (e) { console.error('[pdf.js] addImage header:', e) }
  }

  const xTexto = logoIcone ? margemX + 22 : margemX

  doc.setTextColor(...COR_BRANCO)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text('FICHA DE FILIACAO', xTexto, 12)

  doc.setTextColor(...COR_PRIMARIO)
  doc.setFontSize(10)
  doc.text('SINDESEP-PB', xTexto, 19)

  doc.setTextColor(...COR_CINZA_CLARO)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text(
    'Sindicato dos Empregados em Estab. de Serv. de Saude da Paraiba',
    xTexto, 25,
    { maxWidth: largura - xTexto - margemX }
  )

  // Linha divisória (verde oliva)
  doc.setFillColor(...COR_PRIMARIO)
  doc.rect(0, alturaHeader, largura, 1, 'F')

  let y = alturaHeader + 1 + 7  // 36mm

  // ── HELPERS ────────────────────────────────────────────────────────────────
  function garantirEspaco(h) {
    if (y + h <= altura - 20) return
    doc.addPage()
    y = 14
  }

  function escreverLabelValor(label, val, xBase, largMax) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...COR_PRIMARIO)
    doc.text(label + ':', xBase, y)

    const lw = doc.getTextWidth(label + ':') + 1.5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COR_TEXTO)
    const linhas = doc.splitTextToSize(String(val), largMax - lw)
    doc.text(linhas, xBase + lw, y)
    return linhas.length
  }

  function escreverCampoSimples(label, val) {
    garantirEspaco(5)
    escreverLabelValor(label, val, margemX, larguraTexto)
    y += 4.5
  }

  function escreverCampoDuplo(label1, val1, label2, val2) {
    garantirEspaco(5)
    const metade = larguraTexto / 2 - 3
    escreverLabelValor(label1, val1, margemX, metade)
    if (label2 !== null) {
      escreverLabelValor(label2, val2, margemX + larguraTexto / 2 + 3, metade)
    }
    y += 4.5
  }

  function escreverTextoBloco(texto) {
    garantirEspaco(12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...COR_TEXTO)
    const linhas = doc.splitTextToSize(texto, larguraTexto)
    doc.text(linhas, margemX, y)
    y += linhas.length * 3.5 + 2
  }

  function iniciarSecao(titulo) {
    garantirEspaco(14)

    doc.setFillColor(...COR_FUNDO_SEC)
    doc.rect(0, y - 5, largura, 8, 'F')

    doc.setFillColor(...COR_PRIMARIO)
    doc.rect(0, y - 5, 3, 8, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...COR_PRIMARIO)
    doc.text(titulo, margemX + 2, y)
    y += 6
  }

  function fecharSecao() {
    y += 4
  }

  // ── SEÇÃO 1: DADOS PESSOAIS ───────────────────────────────────────────────
  iniciarSecao('1. DADOS PESSOAIS')
  escreverCampoSimples('Nome completo', valor(dados.nome_completo))
  escreverCampoDuplo('CPF', valor(dados.cpf), 'RG', valor(dados.rg))
  escreverCampoSimples('Nascimento', formatarData(dados.data_nascimento))
  fecharSecao()

  // ── SEÇÃO 2: CONTATO ──────────────────────────────────────────────────────
  iniciarSecao('2. CONTATO')
  escreverCampoSimples('Email', valor(dados.email))
  escreverCampoSimples('Telefone/WhatsApp', valor(dados.whatsapp))
  fecharSecao()

  // ── SEÇÃO 3: ENDEREÇO ─────────────────────────────────────────────────────
  iniciarSecao('3. ENDERECO')
  const endLinha1 = [dados.logradouro, dados.numero, dados.complemento].filter(Boolean).join(', ') || '-'
  escreverCampoSimples('Logradouro', endLinha1)
  escreverCampoSimples('Bairro', valor(dados.bairro))
  escreverCampoDuplo('CEP', valor(dados.cep), 'Estado', valor(dados.estado))
  escreverCampoSimples('Cidade', valor(dados.cidade))
  fecharSecao()

  // ── SEÇÃO 4: DADOS PROFISSIONAIS ──────────────────────────────────────────
  iniciarSecao('4. DADOS PROFISSIONAIS')
  escreverCampoSimples('Local de Trabalho', valor(dados.empresa))
  escreverCampoSimples('Cargo', valor(dados.cargo))
  if (dados.segunda_empresa) {
    escreverCampoSimples('Outra empresa na area da saude', valor(dados.segunda_empresa))
  }
  fecharSecao()

  // ── SEÇÃO 5: CONTRIBUIÇÃO SINDICAL ───────────────────────────────────────
  iniciarSecao('5. CONTRIBUICAO SINDICAL')
  escreverCampoSimples('Data de Filiacao', formatarData(dados.data_filiacao))
  escreverCampoSimples('Forma', '[X] Desconto em contracheque')
  escreverCampoSimples('Valor', '1% (um por cento) do salario base')
  fecharSecao()

  // ── SEÇÃO 6: DECLARAÇÕES ──────────────────────────────────────────────────
  iniciarSecao('6. DECLARACOES')

  garantirEspaco(12)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...COR_PRIMARIO)
  doc.text('Autorizacao de desconto:', margemX, y)
  y += 4
  escreverTextoBloco(TEXTO_AUTORIZACAO)

  garantirEspaco(12)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...COR_PRIMARIO)
  doc.text('Consentimento LGPD:', margemX, y)
  y += 4
  escreverTextoBloco(TEXTO_LGPD)

  escreverCampoSimples(
    'Consentido em',
    `${formatarDataHora(dados.data_consentimento_lgpd || geradoEm)} - IP: ${valor(dados.ip_consentimento)}`
  )
  fecharSecao()

  // ── SEÇÃO 7: ASSINATURA ───────────────────────────────────────────────────
  garantirEspaco(38)

  doc.setFillColor(...COR_FUNDO_SEC)
  doc.rect(0, y - 5, largura, 8, 'F')
  doc.setFillColor(...COR_PRIMARIO)
  doc.rect(0, y - 5, 3, 8, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...COR_PRIMARIO)
  doc.text('7. ASSINATURA DIGITAL', margemX + 2, y)
  y += 6

  if (dados.assinaturaDataUrl) {
    try {
      doc.addImage(dados.assinaturaDataUrl, 'PNG', margemX, y, 75, 25)
      y += 28
    } catch (e) {
      console.error('[pdf.js] addImage assinatura:', e)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...COR_MUTED)
      doc.text('Assinatura digital nao pode ser renderizada.', margemX, y)
      y += 6
    }
  } else {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COR_MUTED)
    doc.text('Assinatura digital nao informada.', margemX, y)
    y += 6
  }

  doc.setFont('helvetica', 'italic')
  doc.setFontSize(7.5)
  doc.setTextColor(...COR_MUTED)
  doc.text(`Assinado digitalmente em ${formatarDataHora(assinadoEm)}`, margemX, y)
  y += 4.5

  if (y > 280) {
    console.warn(`[pdf.js] yPos final = ${y.toFixed(1)}mm — excede 280mm`)
  }

  // ── RODAPÉ ─────────────────────────────────────────────────────────────────
  const yRodape = altura - 14

  doc.setDrawColor(...COR_BORDA)
  doc.setLineWidth(0.3)
  doc.line(margemX, yRodape - 4, largura - margemX, yRodape - 4)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...COR_MUTED)

  const protocolo = registroId.substring(0, 8).toUpperCase()
  doc.text(`Protocolo: ${protocolo}`, margemX, yRodape)
  doc.text('sindesep.org.br', largura / 2, yRodape, { align: 'center' })
  doc.text(`Gerado em: ${formatarDataHora(geradoEm)}`, largura - margemX, yRodape, { align: 'right' })

  doc.setFontSize(6)
  doc.setTextColor(180, 180, 180)
  doc.text(`ID: ${registroId}`, margemX, yRodape + 5)

  return doc.output('blob')
}
