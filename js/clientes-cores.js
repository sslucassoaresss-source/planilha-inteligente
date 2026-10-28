// Contas de datas e faixas de cor da "Última compra" em Clientes.
// Sem banco e sem tela: só cálculo, para poder ser testado sozinho (tests/clientes-cores.mjs).
//
// Datas sempre no formato 'AAAA-MM-DD'. A diferença de dias é feita em UTC ao meio-dia,
// para não errar por causa de fuso ou horário de verão.

export function hojeISO(agora = new Date()) {
  const m = String(agora.getMonth() + 1).padStart(2, '0')
  const d = String(agora.getDate()).padStart(2, '0')
  return `${agora.getFullYear()}-${m}-${d}`
}

export function diasEntre(deISO, ateISO) {
  const meioDia = (iso) => {
    const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number)
    return Date.UTC(a, m - 1, d, 12)
  }
  return Math.round((meioDia(ateISO) - meioDia(deISO)) / 86400000)
}

// Verde até 15 dias, amarela de 16 a 30, vermelha depois de 30 (pedido do Caio)
export const FAIXAS = [
  { classe: 'verde', ate: 15, rotulo: 'até 15 dias' },
  { classe: 'amarela', ate: 30, rotulo: '16 a 30 dias' },
  { classe: 'vermelha', ate: Infinity, rotulo: 'mais de 30 dias' },
]

export const NUNCA = { classe: 'cinza', rotulo: 'ainda não comprou' }

// dias: quantos dias desde a última compra (null = nunca comprou). Data futura conta como hoje.
export function faixaUltimaCompra(dias) {
  if (dias === null || dias === undefined || Number.isNaN(dias)) return NUNCA
  return FAIXAS.find((f) => Math.max(0, dias) <= f.ate)
}

export function textoHaDias(dias) {
  if (dias <= 0) return 'hoje'
  if (dias === 1) return 'ontem'
  return `há ${dias} dias`
}
