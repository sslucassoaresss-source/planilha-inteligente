// Coluna "Última compra" na tela de Clientes: a data mais recente em que cada loja
// comprou, seja de uma empresa que o Caio representa (visita marcada "Comprou") ou do
// estoque dele (venda de produtos).
//
// Cada linha ganha uma bolinha de cor pela distância da última compra (verde até 15 dias,
// amarela até 30, vermelha depois; cinza = ainda não comprou; regras em clientes-cores.js),
// e acima da tabela aparece o resumo por cor, que também serve de filtro.
//
// SÓ LEITURA, e sem mexer no clientes.js: a coluna é acrescentada por cima da tabela
// que ele desenha e se refaz sozinha toda vez que a lista é redesenhada (busca,
// edição, exclusão, desconto rápido).

import { supabase, buscarTodasLinhas } from './supabase.js'
import { hojeISO, diasEntre, faixaUltimaCompra, textoHaDias, FAIXAS, NUNCA } from './clientes-cores.js'

const { data: { session } } = await supabase.auth.getSession()
// Sem sessão, o clientes.js já manda para o login.
if (session) iniciar()

function iniciar() {
  const corpo = document.getElementById('listaClientes')
  const linhaCabecalho = document.querySelector('#tabelaWrapper thead tr')
  const tabelaWrapper = document.getElementById('tabelaWrapper')
  if (!corpo || !linhaCabecalho) return

  const dataBR = (s) => String(s).slice(0, 10).split('-').reverse().join('/')
  const hoje = hojeISO()

  // cliente_id -> { empresas: 'AAAA-MM-DD' | null, estoque: 'AAAA-MM-DD' | null }
  let ultimas = null    // null = ainda carregando
  let idsClientes = []  // todos os clientes, para contar quem ainda não comprou
  let falhou = false
  let filtro = null     // classe da faixa escolhida no resumo (null = todos)

  // Cabeçalho da coluna, antes de "Ações"
  const th = document.createElement('th')
  th.textContent = 'Última compra'
  linhaCabecalho.insertBefore(th, linhaCabecalho.lastElementChild)

  // Resumo por cor (acima da tabela); aparece quando os dados chegam
  const resumo = document.createElement('div')
  resumo.className = 'cc-resumo'
  resumo.style.display = 'none'
  tabelaWrapper.parentNode.insertBefore(resumo, tabelaWrapper)

  // Data e origem da última compra de um cliente (ou null se nunca comprou)
  function ultimaDe(clienteId) {
    const u = ultimas?.[clienteId]
    if (!u) return null
    const e = u.empresas
    const s = u.estoque
    const data = !s || (e && e >= s) ? e : s
    let origem = 'empresas'
    if (e && s && e === s) origem = 'ambos'
    else if (data === s) origem = 'estoque'
    return { data, origem }
  }

  function faixaDe(clienteId) {
    const u = ultimaDe(clienteId)
    return faixaUltimaCompra(u ? diasEntre(u.data, hoje) : null)
  }

  function conteudo(clienteId) {
    if (falhou) return '<span class="est-sub">indisponível</span>'
    if (!ultimas) return '<span class="est-sub">…</span>'
    const u = ultimaDe(clienteId)
    if (!u) return `<span class="cc-bolinha cc-${NUNCA.classe}" title="Ainda não comprou"></span>—`

    const dias = diasEntre(u.data, hoje)
    const faixa = faixaUltimaCompra(dias)
    const rotulo = { empresas: 'empresas', estoque: 'estoque', ambos: 'empresas + estoque' }[u.origem]
    return `<span class="cc-bolinha cc-${faixa.classe}" title="Última compra ${textoHaDias(dias)}"></span>${dataBR(u.data)}` +
      `<span class="est-ultima-origem est-origem-${u.origem}">${textoHaDias(dias)} · ${rotulo}</span>`
  }

  // Marca a linha com a cor (para o filtro) e põe a bolinha também ao lado do nome,
  // que só aparece no celular, onde a coluna "Última compra" fica fora da tela
  function marcarLinha(tr, id) {
    if (!ultimas || !id) return
    const faixa = faixaDe(id)
    tr.dataset.faixa = faixa.classe
    const celulaNome = tr.querySelector('td')
    let bolinha = celulaNome?.querySelector('.cc-no-nome')
    if (celulaNome && !bolinha) {
      bolinha = document.createElement('span')
      celulaNome.prepend(bolinha)
    }
    if (bolinha) bolinha.className = `cc-bolinha cc-${faixa.classe} cc-no-nome`
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
      marcarLinha(tr, id)
    })
  }

  function atualizarTodas() {
    corpo.querySelectorAll('.est-ultima').forEach((td) => {
      td.innerHTML = conteudo(td.dataset.cliente)
      marcarLinha(td.closest('tr'), td.dataset.cliente)
    })
  }

  function desenharResumo() {
    const contagem = { verde: 0, amarela: 0, vermelha: 0, cinza: 0 }
    idsClientes.forEach((id) => { contagem[faixaDe(id).classe]++ })
    const faixas = [...FAIXAS, NUNCA]
    resumo.innerHTML = '<span class="cc-resumo-titulo">Última compra</span>' + faixas.map((f) =>
      `<button type="button" class="cc-filtro${filtro === f.classe ? ' ativo' : ''}" data-faixa="${f.classe}" aria-pressed="${filtro === f.classe}">` +
      `<span class="cc-bolinha cc-${f.classe}"></span>${f.rotulo}<strong>${contagem[f.classe]}</strong></button>`
    ).join('') + (filtro ? '<button type="button" class="cc-limpar" data-faixa="">Mostrar todos</button>' : '')
    resumo.style.display = idsClientes.length ? 'flex' : 'none'
  }

  // Clicar numa cor mostra só aqueles clientes; clicar de novo (ou "Mostrar todos") volta tudo
  resumo.addEventListener('click', (e) => {
    const botao = e.target.closest('[data-faixa]')
    if (!botao) return
    const escolhida = botao.dataset.faixa || null
    filtro = filtro === escolhida ? null : escolhida
    if (filtro) corpo.dataset.filtroFaixa = filtro
    else delete corpo.dataset.filtroFaixa
    desenharResumo()
  })

  new MutationObserver(preencher).observe(corpo, { childList: true })
  preencher()

  async function carregar() {
    const [visitas, vendas, clientes] = await Promise.all([
      buscarTodasLinhas('visitas', { select: 'cliente_id, data_visita', order: 'id', filtro: (q) => q.eq('comprou', true) }),
      buscarTodasLinhas('vendas_estoque', { select: 'cliente_id, data_venda', order: 'id' }),
      buscarTodasLinhas('clientes', { select: 'id', order: 'id' }),
    ])
    if (visitas.error || vendas.error || clientes.error) {
      console.error('Erro ao carregar a última compra dos clientes:', visitas.error || vendas.error || clientes.error)
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
    idsClientes = clientes.data.map((c) => c.id)
    atualizarTodas()
    desenharResumo()
  }

  carregar()
}
