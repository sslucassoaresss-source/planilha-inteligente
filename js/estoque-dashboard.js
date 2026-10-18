// Seção "Estoque" do Dashboard: 4 cards da revenda do Caio, separados da
// representação (que continua sendo calculada só pelo dashboard.js).
//
//   Mercadoria em estoque = Σ (estoque de cada produto × custo)
//   Vendido no mês        = Σ total das vendas de produtos do mês (entra na hora, mesmo no fiado)
//   Meu lucro             = lucro JÁ RECEBIDO no mês, pela regra "primeiro o custo":
//                           numa venda, o dinheiro que entra cobre primeiro o custo da
//                           mercadoria; só o que passar disso é lucro.
//   Pode retirar agora    = todo o lucro já recebido (desde sempre) − retiradas registradas
//   Próxima meta          = Σ (quantidade × preço) das linhas montadas pelo Caio
//
// Nada é guardado como saldo: tudo é calculado a partir de compras, vendas,
// pagamentos e retiradas. Todos os ids/classes começam com "est".

import { supabase, buscarTodasLinhas } from './supabase.js'
import { mensagemErro } from './erros.js'

// Ponte com o gráfico "Vendas por dia" do dashboard.js: devolve, para um mês, o quanto
// foi vendido de produtos do estoque em cada dia (a parte VERDE das barras). Existe desde
// já (antes de qualquer espera) e só responde depois que os dados carregaram; se algo
// falhar, responde vazio e o gráfico fica só azul, como sempre foi.
let definirCalculoPorDia
const calculoPorDiaPronto = new Promise((resolver) => { definirCalculoPorDia = resolver })
window.estoqueDashboard = {
  vendasPorDia: async (ano, mes) => (await calculoPorDiaPronto)(ano, mes),
}

const { data: { session } } = await supabase.auth.getSession()
// Sem sessão, o dashboard.js já manda para o login.
if (session) iniciar(session.user.id)
else definirCalculoPorDia(() => ({}))

function iniciar(userId) {
  const $ = (id) => document.getElementById(id)

  // ── Utilidades ──────────────────────────────────────────────
  const fmt = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const fmtQtd = (v) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
  const arredonda2 = (v) => Math.round((Number(v) || 0) * 100) / 100
  const arredonda3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000
  const dataBR = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '')
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  function dataLocalStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  // ── Dados (recarregados depois de cada alteração) ────────────
  let produtos = []
  let vendas = []     // todas as vendas de produtos, com itens e pagamentos
  let compras = []
  let retiradas = []
  let metas = []
  let entregas = []   // só para o aviso de "entrega sem dia" / atrasada

  async function carregar() {
    const [p, v, c, r, m, en] = await Promise.all([
      supabase.from('produtos').select('*').order('nome'),
      buscarTodasLinhas('vendas_estoque', {
        select: '*, clientes(nome), venda_estoque_itens(produto_id, quantidade, preco_unitario, custo_unitario, produtos(nome, unidade)), pagamentos_venda(valor, data_pagamento, created_at)',
        order: 'id',
      }),
      buscarTodasLinhas('compras_estoque', {
        select: '*, fornecedores(nome), produtos(nome, unidade), pagamentos_compra(valor)',
        order: 'id',
      }),
      supabase.from('retiradas_lucro').select('*').order('data_retirada', { ascending: false }),
      supabase.from('metas_estoque').select('*').order('created_at'),
      // Entregas (só o necessário para o aviso). Se falhar, o resto do Dashboard segue normal.
      supabase.from('entregas').select('id, data_entrega, entrega_paradas(feita)'),
    ])
    const erro = p.error || v.error || c.error || r.error || m.error
    if (erro) {
      console.error('Erro ao carregar o Dashboard de Estoque:', erro)
      $('estValorEstoque').textContent = '—'
      $('estSubEstoque').textContent = 'não foi possível carregar'
      return false
    }
    produtos = p.data
    vendas = v.data
    compras = c.data
    retiradas = r.data
    metas = m.data
    if (en.error) console.error('Erro ao carregar as entregas para o aviso:', en.error)
    entregas = en.error ? [] : en.data
    return true
  }

  // ── Cálculos ────────────────────────────────────────────────
  function mesSelecionado() {
    const valor = $('selectMes').value
    if (valor) return valor
    const h = new Date()
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`
  }

  function limitesDoMes(mes) {
    const [ano, m] = mes.split('-').map(Number)
    return { inicio: `${mes}-01`, fim: dataLocalStr(new Date(ano, m, 0)) }
  }

  // Estoque atual de cada produto = comprado − vendido
  function estoquePorProduto() {
    const est = {}
    compras.forEach((c) => { est[c.produto_id] = (est[c.produto_id] || 0) + Number(c.quantidade) })
    vendas.forEach((v) => (v.venda_estoque_itens || []).forEach((i) => {
      est[i.produto_id] = (est[i.produto_id] || 0) - Number(i.quantidade)
    }))
    return est
  }

  // Lucro que cada pagamento "liberou" numa venda, pela regra "primeiro o custo".
  // Devolve [{ data, valor }] (um por pagamento, na ordem em que o dinheiro entrou).
  function lucroLiberadoPorPagamento(venda) {
    const itens = venda.venda_estoque_itens || []
    const custo = itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.custo_unitario), 0)
    const total = itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0)
    const lucroMaximo = Math.max(0, total - custo) // venda no prejuízo nunca gera lucro

    const pagamentos = [...(venda.pagamentos_venda || [])].sort((a, b) =>
      String(a.data_pagamento).localeCompare(String(b.data_pagamento)) ||
      String(a.created_at).localeCompare(String(b.created_at)))

    let acumulado = 0
    let liberado = 0
    return pagamentos.map((p) => {
      acumulado += Number(p.valor)
      const novoLiberado = Math.min(lucroMaximo, Math.max(0, acumulado - custo))
      const incremento = novoLiberado - liberado
      liberado = novoLiberado
      return { data: String(p.data_pagamento).slice(0, 10), valor: incremento }
    })
  }

  function calcular() {
    const { inicio, fim } = limitesDoMes(mesSelecionado())
    const est = estoquePorProduto()

    const valorEstoque = produtos.reduce((s, p) => s + Math.max(0, est[p.id] || 0) * Number(p.preco_custo), 0)

    const vendasDoMes = vendas.filter((v) => v.data_venda >= inicio && v.data_venda <= fim)
    const vendido = vendasDoMes.reduce((s, v) =>
      s + (v.venda_estoque_itens || []).reduce((t, i) => t + Number(i.quantidade) * Number(i.preco_unitario), 0), 0)

    let lucroDoMes = 0
    let lucroTotal = 0
    vendas.forEach((v) => lucroLiberadoPorPagamento(v).forEach((x) => {
      lucroTotal += x.valor
      if (x.data >= inicio && x.data <= fim) lucroDoMes += x.valor
    }))
    const retirado = retiradas.reduce((s, r) => s + Number(r.valor), 0)
    const retiravel = Math.max(0, arredonda2(lucroTotal - retirado))

    const meta = metas.reduce((s, m) => s + Number(m.quantidade) * Number(m.preco_unitario), 0)

    return {
      valorEstoque: arredonda2(valorEstoque),
      vendido: arredonda2(vendido),
      nVendas: vendasDoMes.length,
      lucroDoMes: arredonda2(lucroDoMes),
      retiravel,
      meta: arredonda2(meta),
    }
  }

  // ── Desenho dos cards ───────────────────────────────────────
  function desenhar() {
    const c = calcular()
    const porProduto = Object.fromEntries(produtos.map((p) => [p.id, p]))

    $('estValorEstoque').textContent = fmt(c.valorEstoque)
    $('estSubEstoque').textContent = 'pelo preço de custo'

    $('estVendido').textContent = fmt(c.vendido)
    $('estSubVendido').textContent = c.nVendas === 1 ? '1 venda de produtos' : `${c.nVendas} vendas de produtos`

    $('estLucro').textContent = fmt(c.lucroDoMes)
    $('estRetiravel').textContent = fmt(c.retiravel)

    $('estMeta').textContent = fmt(c.meta)
    if (metas.length === 0) {
      $('estSubMeta').textContent = 'clique em "Editar meta" para montar'
    } else {
      const resumo = metas.slice(0, 2).map((m) => {
        const p = porProduto[m.produto_id]
        return `${fmtQtd(m.quantidade)} ${p?.unidade || ''} ${p?.nome || ''}`.replace(/\s+/g, ' ').trim()
      })
      const resto = metas.length - resumo.length
      $('estSubMeta').textContent = resumo.join(' + ') + (resto > 0 ? ` + ${resto} mais` : '')
    }
    desenharCobrancas()
    desenharFaixaEntregas()
    return c
  }

  // Aviso das entregas (o "rota sem dia" do Caio, só para entregas): sem dia marcado ou atrasadas
  function desenharFaixaEntregas() {
    const hoje = dataLocalStr(new Date())
    const pendentes = entregas.filter((e) => (e.entrega_paradas || []).some((p) => !p.feita))
    const semDia = pendentes.filter((e) => !e.data_entrega).length
    const atrasadas = pendentes.filter((e) => e.data_entrega && e.data_entrega < hoje).length
    const partes = []
    if (semDia) partes.push(`${semDia} ${semDia === 1 ? 'entrega sem dia marcado' : 'entregas sem dia marcado'}`)
    if (atrasadas) partes.push(`${atrasadas} ${atrasadas === 1 ? 'entrega atrasada' : 'entregas atrasadas'}`)
    $('estFaixaEntregas').style.display = partes.length ? 'flex' : 'none'
    $('estFaixaEntregasTexto').textContent = partes.join(' · ')
  }

  async function recarregar() {
    if (await carregar()) desenhar()
  }

  // Total vendido de produtos em cada dia do mês: { 1: 260, 12: 10, ... } (dia -> valor)
  function vendasPorDia(ano, mes) {
    const mesTexto = `${ano}-${String(mes).padStart(2, '0')}`
    const porDia = {}
    vendas.forEach((v) => {
      if (String(v.data_venda).slice(0, 7) !== mesTexto) return
      const dia = Number(String(v.data_venda).slice(8, 10))
      const total = (v.venda_estoque_itens || []).reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0)
      porDia[dia] = arredonda2((porDia[dia] || 0) + total)
    })
    return porDia
  }

  $('selectMes').addEventListener('change', desenhar)

  // ── Quem me deve / Quem eu devo (e a faixa de alerta) ────────
  // Só a revenda: vendas de produtos ainda não pagas por completo (clientes) e compras
  // ainda não pagas por completo (fornecedores). A comissão das empresas representadas
  // continua na tela Empresas.
  function diasAte(dataStr) { // negativo = já passou
    const [a, m, d] = String(dataStr).slice(0, 10).split('-').map(Number)
    const [ha, hm, hd] = dataLocalStr(new Date()).split('-').map(Number)
    return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(ha, hm - 1, hd)) / 86400000)
  }

  function situacaoDoPrazo(vencimento) {
    if (!vencimento) return { tipo: 'semprazo', ordem: 3, texto: 'sem prazo' }
    const dias = diasAte(vencimento)
    if (dias < 0) return { tipo: 'atraso', ordem: 0, texto: dias === -1 ? 'venceu ontem' : `venceu há ${-dias} dias` }
    if (dias === 0) return { tipo: 'hoje', ordem: 1, texto: 'vence hoje' }
    if (dias <= 3) return { tipo: 'breve', ordem: 2, texto: dias === 1 ? 'vence amanhã' : `vence em ${dias} dias` }
    return { tipo: 'futuro', ordem: 2, texto: `vence em ${dias} dias` }
  }

  // Vencidas primeiro, depois as de hoje, as próximas e, por último, as sem prazo
  const ordenarCobrancas = (lista) => lista.sort((a, b) =>
    a.situacao.ordem - b.situacao.ordem ||
    String(a.vencimento || '9999').localeCompare(String(b.vencimento || '9999')) ||
    String(a.data).localeCompare(String(b.data)))

  function quemMeDeve() {
    return ordenarCobrancas(vendas.map((v) => {
      const itens = v.venda_estoque_itens || []
      const total = arredonda2(itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0))
      const pago = arredonda2((v.pagamentos_venda || []).reduce((s, p) => s + Number(p.valor), 0))
      return {
        tipo: 'venda',
        id: v.id,
        nome: v.clientes?.nome || '—',
        descricao: itens.map((i) => `${i.produtos?.nome || 'produto'} × ${fmtQtd(i.quantidade)}`).join(' · '),
        data: v.data_venda,
        vencimento: v.vencimento,
        total,
        pago,
        falta: arredonda2(total - pago),
        obs: v.observacao_cobranca,
        situacao: situacaoDoPrazo(v.vencimento),
      }
    }).filter((x) => x.falta > 0.004))
  }

  function quemEuDevo() {
    return ordenarCobrancas(compras.map((c) => {
      const total = arredonda2(Number(c.quantidade) * Number(c.custo_unitario))
      const pago = arredonda2((c.pagamentos_compra || []).reduce((s, p) => s + Number(p.valor), 0))
      return {
        tipo: 'compra',
        id: c.id,
        nome: c.fornecedores?.nome || 'Sem fornecedor',
        descricao: `${c.produtos?.nome || 'produto'} × ${fmtQtd(c.quantidade)}`,
        data: c.data_compra,
        vencimento: c.vencimento,
        total,
        pago,
        falta: arredonda2(total - pago),
        obs: c.observacao_cobranca,
        situacao: situacaoDoPrazo(c.vencimento),
      }
    }).filter((x) => x.falta > 0.004))
  }

  function htmlCobranca(x) {
    const pct = x.total > 0 ? Math.min(100, Math.round((x.pago / x.total) * 100)) : 0
    const classeSelo = { atraso: 'badge-nao', hoje: 'badge-parcial', breve: 'badge-parcial', futuro: 'est-selo-neutro', semprazo: 'est-selo-neutro' }[x.situacao.tipo]
    const verbo = x.tipo === 'venda' ? 'Receber' : 'Pagar'
    return `
      <div class="est-cob est-cob-${x.situacao.tipo}">
        <div class="est-cob-topo"><strong>${esc(x.nome)}</strong><span class="est-cob-falta">${fmt(x.falta)}</span></div>
        <div class="est-cob-sub">${esc(x.descricao)} · ${dataBR(x.data)}</div>
        <div class="est-progresso" title="${pct}% pago"><span style="width:${pct}%"></span></div>
        <div class="est-cob-meta">
          <span class="badge ${classeSelo}">${x.situacao.texto}</span>
          ${x.vencimento ? `<span class="est-sub">${dataBR(x.vencimento)}</span>` : ''}
          <span class="est-sub">pago ${fmt(x.pago)} de ${fmt(x.total)}</span>
        </div>
        ${x.obs ? `<div class="est-cob-obs">📝 ${esc(x.obs)}</div>` : ''}
        <div class="est-cob-acoes">
          <button type="button" class="est-btn-editar" data-est-cob="pagar" data-tipo="${x.tipo}" data-id="${x.id}">${verbo}</button>
          <button type="button" class="est-btn-card est-btn-obs" data-est-cob="obs" data-tipo="${x.tipo}" data-id="${x.id}">${x.obs ? 'Editar observação' : '+ Observação'}</button>
        </div>
      </div>`
  }

  function desenharCobrancas() {
    const deve = quemMeDeve()
    const devo = quemEuDevo()
    const soma = (lista) => arredonda2(lista.reduce((s, x) => s + x.falta, 0))

    $('estTotalDeve').textContent = deve.length ? `${fmt(soma(deve))} em aberto` : ''
    $('estListaDeve').innerHTML = deve.length
      ? deve.map(htmlCobranca).join('')
      : '<p class="est-cob-vazio">Ninguém está devendo nada para você agora.</p>'

    $('estTotalDevo').textContent = devo.length ? `${fmt(soma(devo))} em aberto` : ''
    $('estListaDevo').innerHTML = devo.length
      ? devo.map(htmlCobranca).join('')
      : '<p class="est-cob-vazio">Você não deve nada aos fornecedores agora.</p>'

    // Faixa amarela: só o que já venceu ou vence hoje
    const conta = (lista, tipo) => lista.filter((x) => x.situacao.tipo === tipo).length
    const partes = []
    const adiciona = (n, singular, plural) => { if (n > 0) partes.push(`${n} ${n === 1 ? singular : plural}`) }
    adiciona(conta(deve, 'atraso'), 'cobrança vencida', 'cobranças vencidas')
    adiciona(conta(deve, 'hoje'), 'cobrança vence hoje', 'cobranças vencem hoje')
    adiciona(conta(devo, 'atraso'), 'conta a pagar vencida', 'contas a pagar vencidas')
    adiciona(conta(devo, 'hoje'), 'conta a pagar vence hoje', 'contas a pagar vencem hoje')
    $('estFaixa').style.display = partes.length ? 'flex' : 'none'
    $('estFaixaTexto').textContent = partes.join(' · ')
  }

  const achar = (tipo, id) => (tipo === 'venda' ? quemMeDeve() : quemEuDevo()).find((x) => x.id === id)

  // Receber / Pagar (em partes)
  let cobrancaAberta = null

  function abrirPagamento(tipo, id) {
    const x = achar(tipo, id)
    if (!x) return
    cobrancaAberta = x
    $('estPagTitulo').textContent = tipo === 'venda' ? 'Receber pagamento' : 'Pagar fornecedor'
    $('estPagInfo').innerHTML = `<strong>${esc(x.nome)}</strong> · total ${fmt(x.total)} · já pago ${fmt(x.pago)} · <strong>falta ${fmt(x.falta)}</strong>`
    $('estPagValor').value = x.falta
    $('estPagData').value = dataLocalStr(new Date())
    $('estPagForma').value = ''
    $('estBtnSalvarPag').textContent = tipo === 'venda' ? 'Salvar recebimento' : 'Salvar pagamento'
    abrir('estModalPag')
    $('estPagValor').focus()
  }

  $('estFormPag').addEventListener('submit', async (e) => {
    e.preventDefault()
    const x = cobrancaAberta
    if (!x) return
    const valor = arredonda2($('estPagValor').value)
    if (!(valor > 0)) return
    if (valor > x.falta + 0.004) {
      alert(`O valor é maior do que falta (${fmt(x.falta)}).`)
      return
    }
    const botao = $('estBtnSalvarPag')
    const rotulo = botao.textContent
    botao.disabled = true
    botao.textContent = 'Salvando...'
    const tabela = x.tipo === 'venda' ? 'pagamentos_venda' : 'pagamentos_compra'
    const coluna = x.tipo === 'venda' ? 'venda_id' : 'compra_id'
    const { error } = await supabase.from(tabela).insert({
      user_id: userId,
      [coluna]: x.id,
      valor,
      data_pagamento: $('estPagData').value || dataLocalStr(new Date()),
      forma: $('estPagForma').value || null,
    })
    botao.disabled = false
    botao.textContent = rotulo
    if (error) { console.error('Erro ao registrar pagamento:', error); alert(mensagemErro(error)); return }
    fechar('estModalPag')
    await recarregar()
  })

  // Observação dentro da cobrança ("cobrar por Pix na sexta")
  function abrirObservacao(tipo, id) {
    const x = achar(tipo, id)
    if (!x) return
    cobrancaAberta = x
    $('estObsInfo').innerHTML = `<strong>${esc(x.nome)}</strong> · falta ${fmt(x.falta)}`
    $('estObsTexto').value = x.obs || ''
    abrir('estModalObs')
    $('estObsTexto').focus()
  }

  $('estFormObs').addEventListener('submit', async (e) => {
    e.preventDefault()
    const x = cobrancaAberta
    if (!x) return
    const botao = $('estBtnSalvarObs')
    botao.disabled = true
    botao.textContent = 'Salvando...'
    const tabela = x.tipo === 'venda' ? 'vendas_estoque' : 'compras_estoque'
    const { error } = await supabase.from(tabela).update({ observacao_cobranca: $('estObsTexto').value.trim() || null }).eq('id', x.id)
    botao.disabled = false
    botao.textContent = 'Salvar'
    if (error) { console.error('Erro ao salvar a observação:', error); alert(mensagemErro(error)); return }
    fechar('estModalObs')
    await recarregar()
  })

  $('estCobrancas').addEventListener('click', (e) => {
    const botao = e.target.closest('[data-est-cob]')
    if (!botao) return
    if (botao.dataset.estCob === 'pagar') abrirPagamento(botao.dataset.tipo, botao.dataset.id)
    if (botao.dataset.estCob === 'obs') abrirObservacao(botao.dataset.tipo, botao.dataset.id)
  })

  // ── Janelinhas ──────────────────────────────────────────────
  const MODAIS = ['estModalRetirada', 'estModalMeta', 'estModalPag', 'estModalObs']
  const abrir = (id) => $(id).classList.add('aberto')
  const fechar = (id) => $(id).classList.remove('aberto')
  MODAIS.forEach((id) => {
    $(id).addEventListener('click', (e) => { if (e.target === $(id)) fechar(id) })
    $(id).querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', () => fechar(id)))
  })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') MODAIS.forEach(fechar) })

  // ── Registrar retirada ──────────────────────────────────────
  function desenharRetiradas() {
    const lista = $('estListaRetiradas')
    const recentes = retiradas.slice(0, 5)
    if (recentes.length === 0) {
      lista.innerHTML = '<div class="est-retirada-linha"><span class="est-sub">Nenhuma retirada registrada ainda.</span></div>'
      return
    }
    lista.innerHTML = recentes.map((r) => `
      <div class="est-retirada-linha">
        <span><strong>${fmt(r.valor)}</strong> · ${dataBR(r.data_retirada)}${r.observacao ? `<span class="est-sub">${esc(r.observacao)}</span>` : ''}</span>
        <button type="button" class="est-btn-excluir" data-est-retirada="${r.id}">Excluir</button>
      </div>`).join('')
  }

  $('estBtnRetirada').addEventListener('click', () => {
    const c = calcular()
    $('estRetInfo').innerHTML = `Lucro que você pode retirar agora: <strong>${fmt(c.retiravel)}</strong>`
    $('estRetValor').value = c.retiravel > 0 ? c.retiravel : ''
    $('estRetData').value = dataLocalStr(new Date())
    $('estRetObs').value = ''
    desenharRetiradas()
    abrir('estModalRetirada')
    $('estRetValor').focus()
  })

  $('estFormRetirada').addEventListener('submit', async (e) => {
    e.preventDefault()
    const valor = arredonda2($('estRetValor').value)
    if (!(valor > 0)) return
    const disponivel = calcular().retiravel
    if (valor > disponivel + 0.004 &&
        !confirm(`Você está retirando ${fmt(valor)}, mas o lucro disponível é ${fmt(disponivel)}.\nO excedente sai do dinheiro que deveria ficar para repor o estoque.\n\nRegistrar mesmo assim?`)) {
      return
    }
    const botao = $('estBtnSalvarRetirada')
    botao.disabled = true
    botao.textContent = 'Salvando...'
    const { error } = await supabase.from('retiradas_lucro').insert({
      user_id: userId,
      valor,
      data_retirada: $('estRetData').value || dataLocalStr(new Date()),
      observacao: $('estRetObs').value.trim() || null,
    })
    botao.disabled = false
    botao.textContent = 'Registrar retirada'
    if (error) { console.error('Erro ao registrar retirada:', error); alert(mensagemErro(error)); return }
    fechar('estModalRetirada')
    await recarregar()
  })

  $('estListaRetiradas').addEventListener('click', async (e) => {
    const botao = e.target.closest('[data-est-retirada]')
    if (!botao) return
    if (!confirm('Excluir esta retirada? O valor volta para "pode retirar agora".')) return
    const { error } = await supabase.from('retiradas_lucro').delete().eq('id', botao.dataset.estRetirada)
    if (error) { console.error('Erro ao excluir retirada:', error); alert(mensagemErro(error, 'excluir')); return }
    await recarregar()
    const c = calcular()
    $('estRetInfo').innerHTML = `Lucro que você pode retirar agora: <strong>${fmt(c.retiravel)}</strong>`
    desenharRetiradas()
  })

  // ── Editar meta ─────────────────────────────────────────────
  function opcoesProdutos(selecionado) {
    return '<option value="">Produto...</option>' +
      produtos.filter((p) => p.ativo || p.id === selecionado)
        .map((p) => `<option value="${p.id}">${esc(p.nome)}${p.ativo ? '' : ' (inativo)'}</option>`).join('')
  }

  function atualizarTotalMeta() {
    let total = 0
    document.querySelectorAll('#estListaMeta .est-linha').forEach((linha) => {
      const subtotal = arredonda2(Number(linha.querySelector('.est-qtd').value) * Number(linha.querySelector('.est-preco').value))
      total += subtotal
      linha.querySelector('.est-linha-info').textContent = subtotal > 0 ? `Subtotal: ${fmt(subtotal)}` : ''
    })
    $('estMetaTotal').innerHTML = `Total da meta (dinheiro que você precisa ter): <strong>${fmt(total)}</strong>`
  }

  function adicionarLinhaMeta({ produtoId = '', quantidade = '', preco = '' } = {}) {
    const linha = $('estTemplateMeta').content.firstElementChild.cloneNode(true)
    const select = linha.querySelector('.est-produto')
    select.innerHTML = opcoesProdutos(produtoId)
    select.value = produtoId
    linha.querySelector('.est-qtd').value = quantidade
    linha.querySelector('.est-preco').value = preco

    select.addEventListener('change', () => {
      // Ao escolher o produto, sugere o custo dele como preço (dá para mudar)
      const p = produtos.find((x) => x.id === select.value)
      linha.querySelector('.est-preco').value = p ? p.preco_custo : ''
      atualizarTotalMeta()
    })
    linha.querySelector('.est-qtd').addEventListener('input', atualizarTotalMeta)
    linha.querySelector('.est-preco').addEventListener('input', atualizarTotalMeta)
    linha.querySelector('.est-btn-remover').addEventListener('click', () => { linha.remove(); atualizarTotalMeta() })
    $('estListaMeta').appendChild(linha)
    atualizarTotalMeta()
  }

  $('estBtnMeta').addEventListener('click', () => {
    $('estListaMeta').innerHTML = ''
    metas.forEach((m) => adicionarLinhaMeta({ produtoId: m.produto_id, quantidade: Number(m.quantidade), preco: Number(m.preco_unitario) }))
    if (metas.length === 0) adicionarLinhaMeta()
    abrir('estModalMeta')
  })

  $('estBtnAddMeta').addEventListener('click', () => {
    if (!produtos.some((p) => p.ativo)) {
      alert('Você ainda não tem produtos ativos. Cadastre em Empresas → Estoque → Produtos.')
      return
    }
    adicionarLinhaMeta()
  })

  $('estFormMeta').addEventListener('submit', async (e) => {
    e.preventDefault()
    const linhas = [...document.querySelectorAll('#estListaMeta .est-linha')]
      .map((l) => ({
        produto_id: l.querySelector('.est-produto').value,
        quantidade: arredonda3(l.querySelector('.est-qtd').value),
        preco_unitario: arredonda2(l.querySelector('.est-preco').value),
        precoVazio: l.querySelector('.est-preco').value === '',
        mexeu: !!(l.querySelector('.est-produto').value || l.querySelector('.est-qtd').value || l.querySelector('.est-preco').value),
      }))
      .filter((l) => l.mexeu)

    for (const l of linhas) {
      if (!l.produto_id || !(l.quantidade > 0) || l.precoVazio) {
        alert('Em todas as linhas da meta, escolha o produto e informe a quantidade e o preço (ou remova a linha).')
        return
      }
    }

    const botao = $('estBtnSalvarMeta')
    botao.disabled = true
    botao.textContent = 'Salvando...'
    try {
      // Insere as linhas novas ANTES de apagar as antigas: se algo falhar, a meta antiga continua.
      const antigos = metas.map((m) => m.id)
      if (linhas.length > 0) {
        const { error } = await supabase.from('metas_estoque').insert(
          linhas.map((l) => ({ user_id: userId, produto_id: l.produto_id, quantidade: l.quantidade, preco_unitario: l.preco_unitario })))
        if (error) { console.error('Erro ao salvar a meta:', error); alert(mensagemErro(error)); return }
      }
      if (antigos.length > 0) {
        const { error } = await supabase.from('metas_estoque').delete().in('id', antigos)
        if (error) {
          console.error('Erro ao remover a meta antiga:', error)
          alert('A meta nova foi salva, mas não consegui remover a antiga: os valores podem estar somados em dobro. Abra "Editar meta" e confira.')
        }
      }
      fechar('estModalMeta')
      await recarregar()
    } finally {
      botao.disabled = false
      botao.textContent = 'Salvar meta'
    }
  })

  // Libera o gráfico assim que os dados chegarem (mesmo se o carregamento falhar: aí vem vazio)
  recarregar().finally(() => definirCalculoPorDia(vendasPorDia))
}
