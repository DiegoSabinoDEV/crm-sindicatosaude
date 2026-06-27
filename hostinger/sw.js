const CACHE = 'sindesep-carteira-v1'

const STATIC_ASSETS = [
  '/carteira.html',
  '/css/carteira.css',
  '/css/fonts.css',
  '/js/carteira.js',
  '/js/supabase.js',
  '/logo/logoHD.png',
  '/logo/faviSINDESEP.png',
  '/manifest.json',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'
]

// Instala e pré-cacheia assets estáticos
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC_ASSETS))
      .catch(err => console.warn('[SW] Cache parcial (alguns assets podem falhar):', err))
  )
  self.skipWaiting()
})

// Remove caches antigos ao ativar
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)

  // Supabase e CDN externo de JS (ESM/APIs): sempre network, sem interceptar
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('esm.sh') ||
    url.hostname.includes('hcaptcha.com')
  ) {
    return
  }

  // HTML: network-first — garante versão atualizada; fallback para cache offline
  if (e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
          return res
        })
        .catch(() => caches.match(e.request))
    )
    return
  }

  // Assets estáticos (CSS, JS, imagens, fontes): cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
        }
        return res
      })
    })
  )
})
