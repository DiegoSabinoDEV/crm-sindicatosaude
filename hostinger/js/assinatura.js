let canvas = null
let ctx = null
let desenhando = false
let inicializado = false

function garantirCanvas() {
  if (canvas && ctx) return true

  canvas = document.getElementById('canvas-assinatura')
  if (!canvas) return false

  ctx = canvas.getContext('2d')
  if (!ctx) return false

  ajustarCanvas()
  configurarPincel()

  return true
}

function ajustarCanvas() {
  if (!canvas || !ctx) return

  const rect = canvas.getBoundingClientRect()
  const escala = window.devicePixelRatio || 1
  const largura = Math.max(Math.round(rect.width), 280)
  const altura = Math.max(Math.round(rect.height), 220)

  if (canvas.width === Math.round(largura * escala) && canvas.height === Math.round(altura * escala)) {
    return
  }

  canvas.width = Math.round(largura * escala)
  canvas.height = Math.round(altura * escala)
  ctx.setTransform(escala, 0, 0, escala, 0, 0)
}

function configurarPincel() {
  if (!ctx) return
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#111827'
}

function pos(e) {
  const r = canvas.getBoundingClientRect()
  return [e.clientX - r.left, e.clientY - r.top]
}

function iniciarDesenho(x, y) {
  desenhando = true
  ctx.beginPath()
  ctx.moveTo(x, y)
}

function continuarDesenho(x, y) {
  if (!desenhando) return
  ctx.lineTo(x, y)
  ctx.stroke()
}

function finalizarDesenho() {
  desenhando = false
}

function inicializarAssinatura() {
  if (inicializado || !garantirCanvas()) return

  canvas.style.touchAction = 'none'

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault()
    canvas.setPointerCapture?.(e.pointerId)
    iniciarDesenho(...pos(e))
  })

  canvas.addEventListener('pointermove', e => {
    e.preventDefault()
    continuarDesenho(...pos(e))
  })

  canvas.addEventListener('pointerup', finalizarDesenho)
  canvas.addEventListener('pointerleave', finalizarDesenho)
  canvas.addEventListener('pointercancel', finalizarDesenho)

  window.addEventListener('resize', () => {
    ajustarCanvas()
    configurarPincel()
  })

  inicializado = true
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inicializarAssinatura, { once: true })
} else {
  inicializarAssinatura()
}

export function canvasVazio() {
  if (!garantirCanvas()) return true
  return !ctx.getImageData(0, 0, canvas.width, canvas.height).data.some(x => x !== 0)
}

export function exportarAssinatura() {
  if (!garantirCanvas()) return ''
  return canvas.toDataURL('image/png')
}

export function limparCanvas() {
  if (!garantirCanvas()) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}
