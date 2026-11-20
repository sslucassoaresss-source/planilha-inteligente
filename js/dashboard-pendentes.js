// Dashboard: aviso no bloco Representação com os pedidos esperando liberação da distribuidora
// (visitas com aguardando_liberacao). Ainda não contam como venda nem comissão; o link abre
// Visitas no mês do pedido mais antigo, onde ficam os botões Aprovado / Não aprovado.
// Sem a coluna no banco (antes do SQL rodar), a consulta falha e o aviso simplesmente não aparece.

import { supabase } from './supabase.js'

const { data: { session } } = await supabase.auth.getSession()
// Sem sessão, o dashboard.js já manda para o login.
if (session) carregar()

async function carregar() {
  const cards = document.querySelector('.frente-azul .cards')
  if (!cards) return

  const { data: pedidos, error } = await supabase
    .from('visitas')
    .select('id, data_visita, desconto_aplicado, itens_venda(valor)')
    .eq('aguardando_liberacao', true)
    .order('data_visita')
  if (error) {
    if (error.code !== '42703') console.error('Erro ao carregar os pedidos esperando liberação:', error)
    return
  }
  if (!pedidos.length) return

  const total = pedidos.reduce((soma, v) => {
    const subtotal = (v.itens_venda || []).reduce((s, it) => s + (it.valor || 0), 0)
    return soma + Math.max(0, subtotal - (v.desconto_aplicado || 0))
  }, 0)
  const n = pedidos.length

  const faixa = document.createElement('a')
  faixa.href = `visitas.html?mes=${pedidos[0].data_visita.slice(0, 7)}`
  faixa.className = 'est-faixa dp-faixa'
  faixa.innerHTML =
    '<span class="bolinha-espera" aria-hidden="true"></span>' +
    `<span>${n} ${n === 1 ? 'pedido esperando liberação' : 'pedidos esperando liberação'} · ` +
    `${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (ainda não conta como venda)</span>` +
    '<span class="est-faixa-ir">Abrir Visitas ›</span>'
  cards.parentNode.insertBefore(faixa, cards)
}
