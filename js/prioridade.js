// Prioridade de visita por cliente: "visitar a cada N dias" (coluna clientes.visitar_a_cada_dias).
// Só cálculo, sem banco e sem tela, para poder ser testado sozinho (tests/prioridade.mjs).
//
// Atendimento = qualquer visita (mesmo "Não comprou"), venda de estoque ou entrega feita
// (a entrega feita cria uma venda). Cliente nunca atendido conta a partir do cadastro.

import { diasEntre } from './clientes-cores.js'

export const PRAZOS_PRONTOS = { 7: 'Semanal', 15: 'Quinzenal', 30: 'Mensal' }

export function nomePrazo(dias) {
  return PRAZOS_PRONTOS[dias] || `A cada ${dias} dias`
}

// Prazo válido: inteiro de 1 a 365 (a mesma trava do banco); qualquer outra coisa = sem prioridade
export function prazoValido(valor) {
  const n = Number(valor)
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null
}

// Data (AAAA-MM-DD) do último atendimento de cada cliente
export function ultimoAtendimentoPorCliente({ visitas = [], vendas = [] }) {
  const mapa = {}
  const marcar = (clienteId, data) => {
    if (!clienteId || !data) return
    const dia = String(data).slice(0, 10)
    if (!mapa[clienteId] || dia > mapa[clienteId]) mapa[clienteId] = dia
  }
  visitas.forEach((v) => marcar(v.cliente_id, v.data_visita))
  vendas.forEach((v) => marcar(v.cliente_id, v.data_venda))
  return mapa
}

// Situação de um cliente com prioridade (null se não tem prioridade).
//   estado: 'em-dia' (faltam N dias) · 'hoje' (vence hoje) · 'atrasado' (há N dias)
export function situacaoPrioridade({ prazo, ultimoAtendimento, cadastro, hoje }) {
  const p = prazoValido(prazo)
  if (!p) return null
  const base = ultimoAtendimento || (cadastro ? String(cadastro).slice(0, 10) : hoje)
  const desde = Math.max(0, diasEntre(base, hoje))
  const faltam = p - desde
  const comum = { prazo: p, nome: nomePrazo(p), desde, base, nuncaAtendido: !ultimoAtendimento }
  if (faltam < 0) return { ...comum, estado: 'atrasado', atraso: -faltam }
  if (faltam === 0) return { ...comum, estado: 'hoje', atraso: 0 }
  return { ...comum, estado: 'em-dia', faltam, atraso: 0 }
}

export function textoSituacao(s) {
  if (!s) return ''
  if (s.estado === 'atrasado') return `${s.nome} · atrasado há ${s.atraso} ${s.atraso === 1 ? 'dia' : 'dias'}`
  if (s.estado === 'hoje') return `${s.nome} · visitar hoje`
  return `${s.nome} · em dia (faltam ${s.faltam} ${s.faltam === 1 ? 'dia' : 'dias'})`
}

// Lista dos prioritários fora do prazo, do mais atrasado para o menos
export function atrasados(clientes, ultimos, hoje) {
  return clientes
    .map((c) => ({ cliente: c, situacao: situacaoPrioridade({ prazo: c.visitar_a_cada_dias, ultimoAtendimento: ultimos[c.id], cadastro: c.created_at, hoje }) }))
    .filter((x) => x.situacao?.estado === 'atrasado')
    .sort((a, b) => b.situacao.atraso - a.situacao.atraso || String(a.cliente.nome).localeCompare(String(b.cliente.nome), 'pt-BR'))
}

// "Pet Shop do Lulu, Agro Zeta e mais 2"
export function nomesResumidos(nomes, limite = 3) {
  if (nomes.length <= limite) {
    return nomes.length <= 1 ? (nomes[0] || '') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
  }
  const resto = nomes.length - limite
  return `${nomes.slice(0, limite).join(', ')} e mais ${resto}`
}
