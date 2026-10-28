// Dashboard: aviso no bloco Representação com os clientes prioritários sem visita no prazo
// (regras em prioridade.js). Só aparece quando há atrasados; o link abre Clientes já filtrado.

import { supabase, buscarTodasLinhas } from './supabase.js'
import { hojeISO } from './clientes-cores.js'
import { ultimoAtendimentoPorCliente, atrasados, nomesResumidos } from './prioridade.js'
import { esc } from './seguranca.js'

const { data: { session } } = await supabase.auth.getSession()
// Sem sessão, o dashboard.js já manda para o login.
if (session) carregar()

async function carregar() {
  const cards = document.querySelector('.frente-azul .cards')
  if (!cards) return

  const [clientes, visitas, vendas] = await Promise.all([
    buscarTodasLinhas('clientes', { select: 'id, nome, visitar_a_cada_dias, created_at', order: 'id' }),
    buscarTodasLinhas('visitas', { select: 'cliente_id, data_visita', order: 'id' }),
    buscarTodasLinhas('vendas_estoque', { select: 'cliente_id, data_venda', order: 'id' }),
  ])
  if (clientes.error || visitas.error || vendas.error) {
    console.error('Erro ao carregar os clientes prioritários:', clientes.error || visitas.error || vendas.error)
    return
  }

  const lista = atrasados(clientes.data, ultimoAtendimentoPorCliente({ visitas: visitas.data, vendas: vendas.data }), hojeISO())
  if (!lista.length) return

  const n = lista.length
  const nomes = nomesResumidos(lista.map((x) => esc(x.cliente.nome)))
  const faixa = document.createElement('a')
  faixa.href = 'clientes.html?prioridade=atrasados'
  faixa.className = 'est-faixa dp-faixa'
  faixa.innerHTML =
    '<span aria-hidden="true">⚠</span>' +
    `<span>${n} ${n === 1 ? 'cliente prioritário' : 'clientes prioritários'} sem visita no prazo: ${nomes}</span>` +
    '<span class="est-faixa-ir">Abrir Clientes ›</span>'
  cards.parentNode.insertBefore(faixa, cards)
}
