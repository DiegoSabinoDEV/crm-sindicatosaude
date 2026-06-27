/**
 * js/admin/auth.js — Autenticação e proteção de rotas
 * Sessão 4: Fluxo de login do admin + guard de sessão
 */

export async function fazerLogin(email, senha, supabase) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: senha
  })

  if (error) {
    if (error.message.includes('Invalid login credentials')) {
      throw new Error('Email ou senha incorretos.')
    }
    if (error.message.includes('Email not confirmed')) {
      throw new Error('Email não confirmado. Verifique sua caixa de entrada.')
    }
    throw new Error(error.message || 'Erro ao fazer login.')
  }

  if (!data.session) {
    throw new Error('Sessão não criada. Tente novamente.')
  }

  // Redirecionar para dashboard
  window.location.href = './dashboard.html'
}

export async function fazerLogout(supabase) {
  const { error } = await supabase.auth.signOut()

  if (error) {
    throw new Error(error.message || 'Erro ao fazer logout.')
  }

  window.location.href = './index.html'
}

/**
 * Guard: verificar autenticação no topo de páginas protegidas
 * Uso: await protegerRota(supabase)
 */
export async function protegerRota(supabase) {
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    window.location.href = './index.html'
    throw new Error('não autenticado')
  }

  return session
}

/**
 * Exibir alerta ao usuário
 * Uso: exibirAlerta(elemento, mensagem, tipo)
 */
export function exibirAlerta(elemento, mensagem, tipo = 'erro') {
  if (!elemento) return

  elemento.textContent = mensagem
  elemento.className = `alert show ${tipo}`

  // Ocultar alertas de sucesso automaticamente
  if (tipo === 'sucesso') {
    setTimeout(() => {
      elemento.classList.remove('show')
    }, 3000)
  }
}

/**
 * Obter informações do usuário autenticado
 */
export async function obterUsuarioAtual(supabase) {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

/**
 * Formatar erro para mensagem legível
 */
export function formatarMensagemErro(erro) {
  if (typeof erro === 'string') return erro

  const mensagem = erro?.message || erro?.detail || 'Erro desconhecido'

  // Mapa de erros comuns do Supabase
  const mapaErros = {
    'Invalid login credentials': 'Email ou senha incorretos.',
    'Email not confirmed': 'Email não confirmado.',
    'User not found': 'Usuário não encontrado.',
    'JWT expired': 'Sessão expirada. Faça login novamente.',
    'no rows updated': 'Nenhum registro foi atualizado.',
    'no rows deleted': 'Nenhum registro foi deletado.'
  }

  for (const [chave, valor] of Object.entries(mapaErros)) {
    if (mensagem.includes(chave)) {
      return valor
    }
  }

  return mensagem
}
