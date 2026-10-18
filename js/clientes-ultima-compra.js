// Coluna "Última compra" na tela de Clientes: a data mais recente em que cada loja
// comprou, seja de uma empresa que o Caio representa (visita marcada "Comprou") ou do
// estoque dele (venda de produtos).
//
// SÓ LEITURA, e sem mexer no clientes.js: a coluna é acrescentada por cima da tabela
// que ele desenha e se refaz sozinha toda vez que a lista é redesenhada (busca,
// edição, exclusão, desconto rápido).

import { supabase, buscarTodasLinhas } from './supabase.js'

const { data: { session } } = await supabase.auth.getSession()
// Sem sessão, o clientes.js já manda para o login.
if (session) iniciar()

function iniciar() {
  const corpo = document.getElementById('listaClientes')
  const linhaCabecalho = document.querySelector('#tabelaWrapper thead tr')
  if (!corpo || !linhaCabecalho) return

  const dataBR = (s) => String(s).slice(0, 10).split('-').reverse().join('/')

  // cliente_id -> { empresas: 'AAAA-MM-DD' | null, estoque: 'AAAA-MM-DD' | null }
  let ultimas = null    // null = ainda carregando
  let falhou = false

  // Cabeçalho da coluna, antes de "Ações"
  const th = document.createElement('th')
  th.textContent = 'Última compra'
  linhaCabecalho.insertBefore(th, linhaCabecalho.lastElementChild)

  function conteudo(clienteId) {
    if (falhou) return '<span class="est-sub">indisponível</span>'
    if (!ultimas) return '<span class="est-sub">…</span>'
    const u = ultimas[clienteId]
    if (!u) return '—'

    const e = u.empresas
    const s = u.estoque
    const data = !s || (e && e >= s) ? e : s
    const doisNoMesmoDia = e && s && e === s
    let origem = 'empresas'
    if (doisNoMesmoDia) origem = 'ambos'
    else if (data === s) origem = 'estoque'
    const rotulo = { empresas: 'empresas', estoque: 'estoque', ambos: 'empresas + estoque' }[origem]
    return `${dataBR(data)}<span class="est-ultima-origem est-origem-${origem}">${rotulo}</span>`
  }

  // Põe a célula nas linhas que ainda não têm (o clientes.js redesenha o corpo inteiro)
  function preencher() {
    corpo.querySelectorAll('tr').forEach((tr) => {
      if (tr.querySelector('.est-ultima')) return
      const id = tr.querySelector('[data-id]')?.dataset.id
      const td = document.createElement('td')
      td.className = 'est-ultima'
      td.dataset.cliente = id || ''
      td.innerHTML = conteudo(id)
      tr.insertBefore(td, tr.lastElementChild)
    })
  }

  function atualizarTodas() {
    corpo.querySelectorAll('.est-ultima').forEach((td) => { td.innerHTML = conteudo(td.dataset.cliente) })
  }

  new MutationObserver(preencher).observe(corpo, { childList: true })
  preencher()

  async function carregar() {
    const [visitas, vendas] = await Promise.all([
      buscarTodasLinhas('visitas', { select: 'cliente_id, data_visita', order: 'id', filtro: (q) => q.eq('comprou', true) }),
      buscarTodasLinhas('vendas_estoque', { select: 'cliente_id, data_venda', order: 'id' }),
    ])
    if (visitas.error || vendas.error) {
      console.error('Erro ao carregar a última compra dos clientes:', visitas.error || vendas.error)
      falhou = true
      atualizarTodas()
      return
    }

    const mapa = {}
    const marcar = (clienteId, origem, data) => {
      if (!clienteId || !data) return
      mapa[clienteId] = mapa[clienteId] || { empresas: null, estoque: null }
      const atual = mapa[clienteId][origem]
      if (!atual || data > atual) mapa[clienteId][origem] = String(data).slice(0, 10)
    }
    visitas.data.forEach((v) => marcar(v.cliente_id, 'empresas', v.data_visita))
    vendas.data.forEach((v) => marcar(v.cliente_id, 'estoque', v.data_venda))

    ultimas = mapa
    atualizarTodas()
  }

  carregar()
}
