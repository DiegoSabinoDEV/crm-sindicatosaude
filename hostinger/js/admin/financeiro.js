export async function carregarResumo(supabase) {
  const { data, error } = await supabase
    .from('socios')
    .select('adimplente, forma_pagamento, valor_mensalidade')
    .eq('status', 'aprovado')

  if (error) throw error

  const total        = data.length
  const adimplentes  = data.filter(s => s.adimplente !== false).length
  const inadimplentes = data.filter(s => s.adimplente === false).length

  const diretos = data.filter(s => s.forma_pagamento === 'direto' && s.valor_mensalidade)
  const media   = diretos.length > 0
    ? diretos.reduce((acc, s) => acc + parseFloat(s.valor_mensalidade), 0) / diretos.length
    : 0
  const esperado = diretos.length > 0 ? diretos.length * media : null

  return { total, adimplentes, inadimplentes, esperado, totalDireto: diretos.length }
}

export async function carregarHistorico(supabase) {
  const { data, error } = await supabase
    .from('arrecadacao_mensal')
    .select('*')
    .order('mes_referencia', { ascending: false })
    .limit(12)

  if (error) throw error
  return data
}

export async function registrarArrecadacao(supabase, mes, arrecadado, esperado, observacoes) {
  const { error } = await supabase
    .from('arrecadacao_mensal')
    .upsert(
      {
        mes_referencia:   mes,
        valor_arrecadado: arrecadado,
        valor_esperado:   esperado,
        observacoes,
        updated_at:       new Date().toISOString()
      },
      { onConflict: 'mes_referencia' }
    )

  if (error) throw error
}

export async function carregarInadimplentes(supabase) {
  const { data, error } = await supabase
    .from('socios')
    .select('id, nome_completo, whatsapp, empresa, cargo, forma_pagamento')
    .eq('status', 'aprovado')
    .eq('adimplente', false)
    .order('nome_completo')

  if (error) throw error
  return data
}
