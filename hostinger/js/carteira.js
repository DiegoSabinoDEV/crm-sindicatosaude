import { supabase } from '/js/supabase.js'

// ── Estado global ──────────────────────────────────────────────
let currentSocio    = null
let currentCarteira = null
let photoBlob       = null
let cameraStream    = null

// ── Rate limit (memória de sessão) ────────────────────────────
let failedAttempts = 0
let rateLimitUntil = 0

// ── Utilitários CPF ───────────────────────────────────────────
function mascaraCPF(v) {
  return v.replace(/\D/g, '')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

function validarCPF(cpf) {
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

function mascaraCPFDisplay(cpf) {
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11) return cpf
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`
}

function formatarData(dateStr) {
  const [y, m] = dateStr.split('-')
  return `${m}/${y}`
}

// ── Navegação entre etapas ─────────────────────────────────────
function goToStep(n) {
  document.querySelectorAll('.step-panel').forEach(p => { p.style.display = 'none' })
  document.getElementById(`panel-${n}`).style.display = 'block'
  document.querySelectorAll('.step').forEach((el, i) => {
    el.classList.remove('active', 'done')
    if (i + 1 < n)  el.classList.add('done')
    if (i + 1 === n) el.classList.add('active')
  })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// ── Mensagem de feedback ───────────────────────────────────────
function showMsg(el, type, text) {
  el.className = `msg-box msg-${type}`
  el.textContent = text
  el.style.display = 'block'
}

function setLoading(btnId, spinId, textId, loading) {
  document.getElementById(textId).style.display = loading ? 'none' : 'inline'
  document.getElementById(spinId).style.display  = loading ? 'inline-block' : 'none'
  document.getElementById(btnId).disabled = loading
}

// ══════════════════════════════════════════════════════════════
// ETAPA 1 — Busca por CPF
// ══════════════════════════════════════════════════════════════
const inputCpf         = document.getElementById('input-cpf')
const inputNascimento  = document.getElementById('input-nascimento')
const btnBuscar        = document.getElementById('btn-buscar')
const msgCpf           = document.getElementById('msg-cpf')
const cardInadimplente = document.getElementById('card-inadimplente')

inputCpf.addEventListener('input', e => { e.target.value = mascaraCPF(e.target.value) })
btnBuscar.addEventListener('click', buscarSocio)
inputCpf.addEventListener('keydown', e => { if (e.key === 'Enter') buscarSocio() })
inputNascimento.addEventListener('keydown', e => { if (e.key === 'Enter') buscarSocio() })

function registrarFalha() {
  failedAttempts++
  if (failedAttempts >= 5) {
    rateLimitUntil = Date.now() + 60_000
    btnBuscar.disabled = true
    showMsg(msgCpf, 'error', 'Muitas tentativas. Aguarde 1 minuto e tente novamente.')
    setTimeout(() => {
      failedAttempts = 0
      rateLimitUntil = 0
      btnBuscar.disabled = false
    }, 60_000)
  } else {
    showMsg(msgCpf, 'error', 'CPF não encontrado ou filiação não aprovada.')
  }
}

async function buscarSocio() {
  if (Date.now() < rateLimitUntil) {
    showMsg(msgCpf, 'error', 'Muitas tentativas. Aguarde 1 minuto e tente novamente.')
    return
  }

  const cpf        = inputCpf.value.replace(/\D/g, '')
  const nascimento = inputNascimento.value
  msgCpf.style.display           = 'none'
  cardInadimplente.style.display = 'none'

  if (!validarCPF(cpf)) {
    showMsg(msgCpf, 'error', 'CPF inválido. Verifique os números.')
    return
  }

  if (!nascimento) {
    showMsg(msgCpf, 'error', 'Informe sua data de nascimento.')
    return
  }

  setLoading('btn-buscar', 'btn-buscar-spin', 'btn-buscar-text', true)

  const { data: resultado, error } = await supabase
    .rpc('buscar_socio_carteira', {
      p_cpf: cpf,
      p_nascimento: nascimento
    })

  setLoading('btn-buscar', 'btn-buscar-spin', 'btn-buscar-text', false)

  const socio = resultado && resultado.length > 0 ? resultado[0] : null

  if (error || !socio) {
    registrarFalha()
    return
  }

  failedAttempts = 0
  currentSocio = { ...socio, cpf }

  if (!currentSocio.adimplente) {
    cardInadimplente.style.display = 'flex'
    return
  }

  // Verifica se já existe carteira ativa e válida
  const hoje = new Date().toISOString().split('T')[0]
  const { data: carteira } = await supabase
    .from('carteiras')
    .select('*')
    .eq('socio_id', currentSocio.id)
    .eq('ativa', true)
    .gte('validade', hoje)
    .maybeSingle()

  if (carteira) {
    currentCarteira = carteira
    goToStep(3)
    await gerarCanvasCarteira()
    atualizarNotaValidade()
    preencherCardGlass()
  } else {
    goToStep(2)
    iniciarCamera()
  }
}

// ══════════════════════════════════════════════════════════════
// ETAPA 2 — Foto
// ══════════════════════════════════════════════════════════════
const tabCamera       = document.getElementById('tab-camera')
const tabArquivo      = document.getElementById('tab-arquivo')
const panelCamera     = document.getElementById('panel-camera')
const panelArquivo    = document.getElementById('panel-arquivo')
const cameraPreview   = document.getElementById('camera-preview')
const btnTirarFoto    = document.getElementById('btn-tirar-foto')
const inputFoto       = document.getElementById('input-foto')
const previewWrap     = document.getElementById('preview-wrap')
const previewCanvas   = document.getElementById('preview-canvas')
const fotoCanvas      = document.getElementById('foto-canvas')
const btnUsarFoto     = document.getElementById('btn-usar-foto')
const btnTirarNovamente = document.getElementById('btn-tirar-novamente')
const fileDrop        = document.getElementById('file-drop-area')

tabCamera.addEventListener('click', () => {
  tabCamera.classList.add('active')
  tabArquivo.classList.remove('active')
  panelCamera.style.display  = 'block'
  panelArquivo.style.display = 'none'
  previewWrap.style.display  = 'none'
  iniciarCamera()
})

tabArquivo.addEventListener('click', () => {
  tabArquivo.classList.add('active')
  tabCamera.classList.remove('active')
  panelArquivo.style.display = 'block'
  panelCamera.style.display  = 'none'
  previewWrap.style.display  = 'none'
  pararCamera()
})

async function iniciarCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    tabArquivo.click()
    return
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } }
    })
    cameraPreview.srcObject = cameraStream
  } catch {
    tabArquivo.click()
  }
}

function pararCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop())
    cameraStream = null
    cameraPreview.srcObject = null
  }
}

btnTirarFoto.addEventListener('click', () => {
  const vw = cameraPreview.videoWidth
  const vh = cameraPreview.videoHeight
  if (!vw || !vh) return

  const size   = Math.min(vw, vh)
  const offX   = (vw - size) / 2
  const offY   = (vh - size) / 2

  fotoCanvas.width  = size
  fotoCanvas.height = size
  fotoCanvas.getContext('2d').drawImage(cameraPreview, offX, offY, size, size, 0, 0, size, size)

  fotoCanvas.toBlob(blob => {
    photoBlob = blob
    mostrarPreview(fotoCanvas)
    pararCamera()
  }, 'image/jpeg', 0.92)
})

inputFoto.addEventListener('change', e => {
  const file = e.target.files[0]
  if (!file) return
  processarArquivoFoto(file)
})

// File drop area
fileDrop.addEventListener('click', () => inputFoto.click())
fileDrop.addEventListener('dragover', e => { e.preventDefault(); fileDrop.classList.add('drag-over') })
fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('drag-over'))
fileDrop.addEventListener('drop', e => {
  e.preventDefault()
  fileDrop.classList.remove('drag-over')
  const file = e.dataTransfer.files[0]
  if (file?.type.startsWith('image/')) processarArquivoFoto(file)
})

function processarArquivoFoto(file) {
  photoBlob = file
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => {
    const size = Math.min(img.width, img.height)
    fotoCanvas.width  = size
    fotoCanvas.height = size
    const ctx  = fotoCanvas.getContext('2d')
    ctx.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, size, size)
    mostrarPreview(fotoCanvas)
    URL.revokeObjectURL(url)
  }
  img.src = url
}

function mostrarPreview(source) {
  const pCtx = previewCanvas.getContext('2d')
  pCtx.clearRect(0, 0, 240, 240)
  pCtx.save()
  pCtx.beginPath()
  pCtx.arc(120, 120, 118, 0, Math.PI * 2)
  pCtx.clip()
  pCtx.drawImage(source, 0, 0, 240, 240)
  pCtx.restore()

  panelCamera.style.display  = 'none'
  panelArquivo.style.display = 'none'
  previewWrap.style.display  = 'flex'
}

btnTirarNovamente.addEventListener('click', () => {
  previewWrap.style.display = 'none'
  photoBlob = null

  if (tabCamera.classList.contains('active')) {
    panelCamera.style.display = 'block'
    iniciarCamera()
  } else {
    panelArquivo.style.display = 'block'
  }
})

btnUsarFoto.addEventListener('click', processarFoto)

async function processarFoto() {
  if (!photoBlob) return
  setLoading('btn-usar-foto', 'btn-usar-spin', 'btn-usar-text', true)

  try {
    const ext = photoBlob.type === 'image/png' ? 'png' : 'jpg'

    // Busca foto anterior direto na tabela: currentCarteira é undefined em renovação de
    // carteira vencida/inativa (buscarSocio() só o popula quando ativa=true e validade>=hoje)
    const { data: carteiraAtual } = await supabase
      .from('carteiras')
      .select('foto_url')
      .eq('socio_id', currentSocio.id)
      .maybeSingle()

    if (carteiraAtual?.foto_url) {
      const marcador = '/fotos-carteira/'
      const idx = carteiraAtual.foto_url.indexOf(marcador)
      if (idx !== -1) {
        const caminhoAntigo = carteiraAtual.foto_url.substring(idx + marcador.length)
        const { error } = await supabase.storage
          .from('fotos-carteira')
          .remove([caminhoAntigo])
        if (error) console.warn('Falha ao remover foto antiga:', error)
      }
    }

    const filePath = `${currentSocio.id}/${crypto.randomUUID()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('fotos-carteira')
      .upload(filePath, photoBlob, { contentType: photoBlob.type, upsert: true })

    if (uploadError) throw uploadError

    const { data: { publicUrl } } = supabase.storage
      .from('fotos-carteira')
      .getPublicUrl(filePath)

    const validade = new Date()
    validade.setMonth(validade.getMonth() + 6)
    const validadeStr = validade.toISOString().split('T')[0]

    const { data: carteira, error: upsertError } = await supabase
      .from('carteiras')
      .upsert(
        { socio_id: currentSocio.id, foto_url: publicUrl, validade: validadeStr, ativa: true },
        { onConflict: 'socio_id' }
      )
      .select()
      .single()

    if (upsertError) throw upsertError

    currentCarteira = carteira
    goToStep(3)
    await gerarCanvasCarteira()
    atualizarNotaValidade()
    preencherCardGlass()
  } catch (e) {
    console.error('[carteira] Erro ao processar foto:', e)
    alert('Erro ao gerar carteira. Verifique sua conexão e tente novamente.')
  } finally {
    setLoading('btn-usar-foto', 'btn-usar-spin', 'btn-usar-text', false)
  }
}

// ══════════════════════════════════════════════════════════════
// ETAPA 3 — Canvas da carteira
// ══════════════════════════════════════════════════════════════
function carregarImagem(url) {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload  = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function gerarQRCanvas(text, size) {
  return new Promise(resolve => {
    const div = document.getElementById('qr-container')
    div.innerHTML = ''
    try {
      new QRCode(div, {
        text,
        width: size,
        height: size,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      })
      setTimeout(() => resolve(div.querySelector('canvas') || null), 350)
    } catch {
      resolve(null)
    }
  })
}

function truncarTexto(ctx, texto, maxW) {
  if (ctx.measureText(texto).width <= maxW) return texto
  let t = texto
  while (t.length > 0 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

function arredondarRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

async function gerarCanvasCarteira() {
  const canvas = document.getElementById('card-canvas')
  const ctx    = canvas.getContext('2d')
  const W = 856, H = 540

  await document.fonts.ready

  ctx.clearRect(0, 0, W, H)

  // ── Fundo ──
  ctx.fillStyle = '#141414'
  ctx.fillRect(0, 0, W, H)

  // Pontinho de luz canto esquerdo
  const radGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 300)
  radGrad.addColorStop(0, 'rgba(255,255,255,0.04)')
  radGrad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = radGrad
  ctx.fillRect(0, 0, W, H)

  // ── Logo ──
  const logoImg = await carregarImagem('/logo/logoHD.png')
  if (logoImg) {
    const maxH  = 85
    const ratio = logoImg.naturalWidth / logoImg.naturalHeight
    const logoW = Math.min(maxH * ratio, 440)
    ctx.save()
    ctx.shadowColor   = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur    = 8
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 3
    ctx.drawImage(logoImg, 28, 14, logoW, maxH)
    ctx.restore()
  }

  // ── Título (direita) ──
  ctx.textAlign    = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'
  ctx.font      = 'bold 16px "Lexend", Arial, sans-serif'
  ctx.fillText('CARTEIRA SINDICAL', W - 28, 40)

  ctx.fillStyle = '#E07250'
  ctx.font      = 'bold 12px "Lexend", Arial, sans-serif'
  ctx.fillText('ASSOCIADO ATIVO', W - 28, 62)

  // ── Linha divisora superior ──
  ctx.strokeStyle = '#8A9A5B'
  ctx.lineWidth   = 2
  ctx.beginPath()
  ctx.moveTo(28, 116)
  ctx.lineTo(W - 28, 116)
  ctx.stroke()

  // ── Foto circular ──
  const CX = 134, CY = 210, R = 68

  // Anel externo
  ctx.strokeStyle = '#1A5C22'
  ctx.lineWidth   = 3
  ctx.beginPath()
  ctx.arc(CX, CY, R + 5, 0, Math.PI * 2)
  ctx.stroke()

  if (currentCarteira?.foto_url) {
    const fotoImg = await carregarImagem(currentCarteira.foto_url)
    if (fotoImg) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(CX, CY, R, 0, Math.PI * 2)
      ctx.clip()
      // Escalar para cobrir o círculo mantendo proporção
      const s  = (R * 2) / Math.min(fotoImg.naturalWidth, fotoImg.naturalHeight)
      const fw = fotoImg.naturalWidth  * s
      const fh = fotoImg.naturalHeight * s
      ctx.drawImage(fotoImg, CX - fw / 2, CY - fh / 2, fw, fh)
      ctx.restore()
    } else {
      desenharPlaceholderFoto(ctx, CX, CY, R)
    }
  } else {
    desenharPlaceholderFoto(ctx, CX, CY, R)
  }

  // ── Bloco de texto ──
  const TX    = 238
  const maxTW = W - TX - 140

  ctx.textAlign = 'left'

  // Nome
  ctx.fillStyle = '#ffffff'
  ctx.font      = 'bold 22px "Lexend", Arial, sans-serif'
  ctx.fillText(truncarTexto(ctx, currentSocio.nome_completo || '', maxTW), TX, 166)

  // Cargo / função
  ctx.fillStyle = '#8A9A5B'
  ctx.font      = '600 15px "Lexend", Arial, sans-serif'
  ctx.fillText(truncarTexto(ctx, currentSocio.cargo || 'Associado', maxTW), TX, 196)

  // Empresa
  ctx.fillStyle = '#9CA3AF'
  ctx.font      = '14px Arial, sans-serif'
  ctx.fillText(truncarTexto(ctx, (currentSocio.empresa || '').toUpperCase(), maxTW), TX, 220)

  // CPF mascarado
  ctx.fillStyle = '#6B7280'
  ctx.font      = '13px Arial, sans-serif'
  ctx.fillText(`CPF: ${mascaraCPFDisplay(currentSocio.cpf)}`, TX, 244)

  // Matrícula (se disponível)
  if (currentSocio.matricula) {
    ctx.fillText(`Matrícula: ${currentSocio.matricula}`, TX, 266)
  }

  // Gradiente sutil no rodapé (fundo, antes dos textos)
  const gradBottom = ctx.createLinearGradient(0, H - 150, 0, H)
  gradBottom.addColorStop(0, 'rgba(26,92,34,0)')
  gradBottom.addColorStop(1, 'rgba(26,92,34,0.18)')
  ctx.fillStyle = gradBottom
  ctx.fillRect(0, H - 150, W, 150)

  // ── Linha divisora inferior ──
  ctx.strokeStyle = '#8A9A5B'
  ctx.lineWidth   = 2
  ctx.beginPath()
  ctx.moveTo(28, 432)
  ctx.lineTo(W - 28, 432)
  ctx.stroke()

  // ── Rodapé ──
  const validadeFormatada = currentCarteira?.validade
    ? formatarData(currentCarteira.validade)
    : '---'

  ctx.fillStyle = '#9CA3AF'
  ctx.font      = '13px Arial, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(`Válida até: ${validadeFormatada}`, 32, 470)

  ctx.fillStyle = '#8A9A5B'
  ctx.font      = 'bold 13px "Lexend", Arial, sans-serif'
  ctx.fillText('SINDESEP-PB', 32, 496)

  if (currentSocio.numero_controle) {
    ctx.fillStyle = '#9CA3AF'
    ctx.font      = '12px Arial, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(`Nº ${currentSocio.numero_controle}`, 32, 514)
  }

  // ── QR Code ──
  if (currentCarteira?.id) {
    const verifyUrl = `${window.location.origin}/verificar.html?id=${currentCarteira.id}`
    const qrCvs    = await gerarQRCanvas(verifyUrl, 88)
    if (qrCvs) {
      // Fundo branco arredondado
      ctx.fillStyle = '#ffffff'
      arredondarRect(ctx, 724, 433, 100, 100, 6)
      ctx.fill()
      ctx.drawImage(qrCvs, 730, 439, 88, 88)
    }
  }
}

function desenharPlaceholderFoto(ctx, cx, cy, r) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = '#2a2a2a'
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  ctx.fillStyle    = '#6B7280'
  ctx.font         = `${r * 0.55}px Arial`
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('👤', cx, cy)
  ctx.restore()
  ctx.textBaseline = 'alphabetic'
}

function atualizarNotaValidade() {
  if (!currentCarteira?.validade) return
  const el = document.getElementById('validity-note')
  if (el) el.textContent = `Carteira válida até ${formatarData(currentCarteira.validade)}`
}

// ══════════════════════════════════════════════════════════════
// CARD GLASSMORPHISM — Anti-fraude (clock + QR dinâmico)
// ══════════════════════════════════════════════════════════════
let _clockInterval    = null
let _qrRefreshInterval = null

function preencherCardGlass() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? '' }

  set('glass-nome',     currentSocio.nome_completo)
  set('glass-cargo',    currentSocio.cargo || 'Associado')
  set('glass-empresa',  (currentSocio.empresa || '').toUpperCase())
  set('glass-cpf',      `CPF: ${mascaraCPFDisplay(currentSocio.cpf)}`)
  set('glass-controle', currentSocio.numero_controle ? `Nº ${currentSocio.numero_controle}` : '')
  set('glass-validade', currentCarteira?.validade ? formatarData(currentCarteira.validade) : '---')

  const fotoEl        = document.getElementById('glass-foto')
  const placeholderEl = document.getElementById('glass-foto-placeholder')
  if (fotoEl && currentCarteira?.foto_url) {
    fotoEl.src = currentCarteira.foto_url
    fotoEl.style.display = 'block'
    if (placeholderEl) placeholderEl.style.display = 'none'
  }

  iniciarRelogio()
  if (currentCarteira?.id) iniciarRefreshQR(currentCarteira.id)
}

function iniciarRelogio() {
  if (_clockInterval) clearInterval(_clockInterval)
  function tick() {
    const n  = new Date()
    const dd = String(n.getDate()).padStart(2, '0')
    const mm = String(n.getMonth() + 1).padStart(2, '0')
    const hh = String(n.getHours()).padStart(2, '0')
    const mi = String(n.getMinutes()).padStart(2, '0')
    const ss = String(n.getSeconds()).padStart(2, '0')
    const el = document.getElementById('glass-clock')
    if (el) el.textContent = `${dd}/${mm}/${n.getFullYear()} — ${hh}:${mi}:${ss}`
  }
  tick()
  _clockInterval = setInterval(tick, 1000)
}

function iniciarRefreshQR(carteiraId) {
  if (_qrRefreshInterval) clearInterval(_qrRefreshInterval)
  function gerarQR() {
    const container = document.getElementById('glass-qr-container')
    if (!container) return
    container.innerHTML = ''
    const url = `${window.location.origin}/verificar.html?id=${carteiraId}&t=${Date.now()}`
    try {
      new QRCode(container, {
        text: url,
        width: 90,
        height: 90,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      })
    } catch (e) { console.warn('[glass] QR falhou:', e) }
  }
  gerarQR()
  _qrRefreshInterval = setInterval(gerarQR, 60_000)
}

// ── Download ──
document.getElementById('btn-download').addEventListener('click', () => {
  const canvas = document.getElementById('card-canvas')
  const link   = document.createElement('a')
  link.download = `carteira-sindesep-${(currentSocio?.cpf || '').replace(/\D/g, '')}.png`
  link.href     = canvas.toDataURL('image/png')
  link.click()
})

// ── Compartilhar (Web Share API) ──
const btnShare = document.getElementById('btn-share')
if (navigator.share && navigator.canShare) {
  btnShare.style.display = 'inline-flex'
  btnShare.addEventListener('click', () => {
    document.getElementById('card-canvas').toBlob(async blob => {
      const file = new File([blob], 'carteira-sindesep.png', { type: 'image/png' })
      if (!navigator.canShare({ files: [file] })) return
      try {
        await navigator.share({ files: [file], title: 'Carteira Sindical — SINDESEP-PB' })
      } catch (e) {
        if (e.name !== 'AbortError') console.error('[share]', e)
      }
    }, 'image/png')
  })
}
