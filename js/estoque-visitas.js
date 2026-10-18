// Venda de produtos do ESTOQUE do Caio dentro da tela de Visitas.
//
// Na janela da visita, além dos "itens de empresa representada" (que seguem
// indo para a comissão, exatamente como antes), ele pode lançar "produtos do
// meu estoque". Esses ficam em tabelas próprias (vendas_estoque etc.), baixam o
// estoque e alimentam o Dashboard de Estoque; nunca entram na comissão.
//
// O visitas.js conversa com este arquivo por window.estoqueVisitas (poucas
// chamadas, todas opcionais: se este módulo falhar, Visitas funciona como antes).
//
// Todos os ids/classes daqui começam com "est": o visitas.js procura elementos
// por classe (.item-venda-row, .item-valor, .btn-editar...), então estes não
// podem repetir esses nomes.

import { supabase, buscarTodasLinhas } from './supabase.js'
import { mensagemErro } from './erros.js'

const $ = (id) => document.getElementById(id)

// ── Utilidades ────────────────────────────────────────────────
const fmt = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtQtd = (v) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const arredonda2 = (v) => Math.round((Number(v) || 0) * 100) / 100
const arredonda3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000
const dataBR = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '')
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function dataLocalStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// "AAAA-MM-DD" + N dias, sem passar por UTC (toISOString viraria o dia à noite)
function somarDias(dataStr, dias) {
  const [a, m, d] = dataStr.split('-').map(Number)
  return dataLocalStr(new Date(a, m - 1, d + Number(dias)))
}

// ── Estado ────────────────────────────────────────────────────
let userId = null
let produtos = []            // todos os produtos (ativos e inativos)
let estoque = {}             // produto_id -> quantidade em estoque (calculada)
let vendaExistente = null    // venda ligada à visita que está sendo editada
let carregando = false       // true enquanto busca a venda da visita em edição
let mesVendas = []           // vendas de produtos do mês exibido
let porVisita = {}           // visita_id -> venda

const pronto = (async () => {
  const { data: { session } } = await supabase.auth.getSession()
  userId = session ? session.user.id : null
  return !!userId
})()

const produtoPorId = (id) => produtos.find((p) => p.id === id)

async function atualizarProdutos() {
  const [p, c, it] = await Promise.all([
    supabase.from('produtos').select('*').order('nome'),
    buscarTodasLinhas('compras_estoque', { select: 'produto_id, quantidade', order: 'id' }),
    buscarTodasLinhas('venda_estoque_itens', { select: 'produto_id, quantidade', order: 'id' }),
  ])
  const erro = p.error || c.error || it.error
  if (erro) { console.error('Erro ao carregar produtos do estoque:', erro); return }

  produtos = p.data
  estoque = {}
  c.data.forEach((x) => { estoque[x.produto_id] = (estoque[x.produto_id] || 0) + Number(x.quantidade) })
  it.data.forEach((x) => { estoque[x.produto_id] = (estoque[x.produto_id] || 0) - Number(x.quantidade) })
  repopularSelects()
  atualizarTudo()
}

// ── Linhas de produto na janela da visita ────────────────────
function opcoesProdutos(selecionado) {
  const lista = produtos.filter((p) => p.ativo || p.id === selecionado)
  return '<option value="">Produto...</option>' +
    lista.map((p) => `<option value="${p.id}">${esc(p.nome)}${p.ativo ? '' : ' (inativo)'}</option>`).join('')
}

function repopularSelects() {
  document.querySelectorAll('#estListaLinhas .est-linha').forEach((linha) => {
    const select = linha.querySelector('.est-produto')
    const atual = select.value
    select.innerHTML = opcoesProdutos(atual)
    select.value = atual
  })
}

function adicionarLinha({ produtoId = '', quantidade = '', preco = '' } = {}) {
  const linha = $('estTemplateLinha').content.firstElementChild.cloneNode(true)
  const select = linha.querySelector('.est-produto')
  select.innerHTML = opcoesProdutos(produtoId)
  select.value = produtoId
  linha.querySelector('.est-qtd').value = quantidade
  linha.querySelector('.est-preco').value = preco

  select.addEventListener('change', () => {
    // Ao escolher o produto, já sugere o preço de venda dele (dá para mudar)
    const p = produtoPorId(select.value)
    linha.querySelector('.est-preco').value = p ? p.preco_venda : ''
    atualizarTudo()
  })
  linha.querySelector('.est-qtd').addEventListener('input', atualizarTudo)
  linha.querySelector('.est-preco').addEventListener('input', atualizarTudo)
  linha.querySelector('.est-btn-remover').addEventListener('click', () => { linha.remove(); atualizarTudo() })

  $('estListaLinhas').appendChild(linha)
  atualizarTudo()
}

// Lê as linhas do formulário
function lerLinhas() {
  return [...document.querySelectorAll('#estListaLinhas .est-linha')].map((linha) => ({
    el: linha,
    produtoId: linha.querySelector('.est-produto').value,
    quantidade: arredonda3(linha.querySelector('.est-qtd').value),
    preco: arredonda2(linha.querySelector('.est-preco').value),
    mexeu: !!(linha.querySelector('.est-produto').value || linha.querySelector('.est-qtd').value || linha.querySelector('.est-preco').value),
  }))
}

// Quanto da venda atual já está "descontado" do estoque (ao editar uma venda
// existente, as quantidades antigas voltam a ficar disponíveis).
function qtdAntiga(produtoId) {
  if (!vendaExistente) return 0
  return vendaExistente.itens.filter((i) => i.produto_id === produtoId).reduce((s, i) => s + Number(i.quantidade), 0)
}

// Recalcula totais, avisos de estoque e o que aparece na tela
function atualizarTudo() {
  const linhas = lerLinhas()

  // soma por produto (duas linhas do mesmo produto contam juntas)
  const somaPorProduto = {}
  linhas.forEach((l) => { if (l.produtoId) somaPorProduto[l.produtoId] = (somaPorProduto[l.produtoId] || 0) + l.quantidade })

  let total = 0
  let temItens = false
  linhas.forEach((l) => {
    const info = l.el.querySelector('.est-linha-info')
    const p = produtoPorId(l.produtoId)
    if (!p) { info.textContent = ''; info.classList.remove('est-excede'); return }
    const disponivel = arredonda3((estoque[p.id] || 0) + qtdAntiga(p.id))
    const valorLinha = arredonda2(l.quantidade * l.preco)
    if (l.quantidade > 0) { total += valorLinha; temItens = true }
    const passa = (somaPorProduto[p.id] || 0) > disponivel
    info.classList.toggle('est-excede', passa)
    info.textContent = `Em estoque: ${fmtQtd(disponivel)} ${p.unidade}` +
      (l.quantidade > 0 ? ` · Total da linha: ${fmt(valorLinha)}` : '') +
      (passa ? ' · atenção: passa do que você tem em estoque' : '')
  })

  $('estLinhaTotal').style.display = temItens ? 'flex' : 'none'
  $('estTotalProdutos').textContent = fmt(total)

  // Pagamento: só ao criar a venda (pagamentos seguintes são feitos em "Receber")
  $('estPagamentoBox').style.display = (temItens && !vendaExistente) ? 'block' : 'none'
  const nota = $('estNotaPagamento')
  if (vendaExistente) {
    nota.style.display = 'block'
    nota.textContent = `Esta venda já tem pagamentos registrados: pago ${fmt(vendaExistente.pago)} de ${fmt(vendaExistente.total)}. Para registrar novos pagamentos, use "Receber" na lista "Vendas de produtos do mês".`
  } else {
    nota.style.display = 'none'
  }
  atualizarCamposPagamento()
}

function atualizarCamposPagamento() {
  const tipo = $('estPagamento').value
  $('estCampoValorPago').style.display = tipo === 'parte' ? 'flex' : 'none'
  $('estCampoForma').style.display = tipo === 'fiado' ? 'none' : 'flex'
  $('estCampoPrazo').style.display = tipo === 'pago' ? 'none' : 'flex'
}

$('estPagamento').addEventListener('change', atualizarCamposPagamento)

$('estBtnAddProduto').addEventListener('click', () => {
  if (!produtos.some((p) => p.ativo)) {
    alert('Você ainda não tem produtos ativos. Cadastre em Empresas → Estoque → Produtos.')
    return
  }
  // A linha de empresa que já vem em branco ao marcar "Comprou" atrapalharia quem só
  // vende produto do estoque (os campos dela são obrigatórios): removemos se estiver vazia.
  document.querySelectorAll('.item-venda-row').forEach((row) => {
    const vazia = !row.querySelector('.item-empresa').value && !row.querySelector('.item-valor').value &&
      !row.querySelector('.item-comissao-manual').value
    if (vazia) row.remove()
  })
  adicionarLinha()
})

// Sempre que a janela da visita abre, atualiza produtos e estoque
new MutationObserver(() => {
  if ($('modalOverlay').classList.contains('aberto')) atualizarProdutos()
}).observe($('modalOverlay'), { attributes: true, attributeFilter: ['class'] })

// ── Chamadas feitas pelo visitas.js ──────────────────────────

// Antes de salvar a visita: valida o que foi digitado.
// Devolve null (nada de estoque), {erro}, {cancelado} ou {itens, pagamento, temItens, ...}
function coletar() {
  if (carregando) return { erro: 'Aguarde um instante: os produtos do estoque desta visita ainda estão carregando.' }

  const comprou = $('comprou').value === 'true'
  const linhas = lerLinhas().filter((l) => l.mexeu)

  const apagarVenda = (motivo) => {
    const ok = confirm(`${motivo}\nIsso apaga a venda de produtos desta visita: o estoque volta e os pagamentos dela também são apagados.\n\nContinuar?`)
    return ok ? { apagar: true, temItens: false } : { cancelado: true }
  }

  if (!comprou) {
    return vendaExistente ? apagarVenda('Você marcou "Não comprou".') : null
  }

  for (const l of linhas) {
    if (!l.produtoId || !(l.quantidade > 0)) {
      return { erro: 'Em "Produtos do meu estoque", escolha o produto e a quantidade em todas as linhas (ou remova a linha).' }
    }
    if (l.el.querySelector('.est-preco').value === '') {
      return { erro: 'Em "Produtos do meu estoque", informe o preço em todas as linhas (se for brinde, coloque 0).' }
    }
  }

  if (linhas.length === 0) {
    if (!vendaExistente) return null
    // Sem nenhum item de empresa representada, a visita "Comprou" ficaria vazia: o
    // visitas.js recusaria. Em vez de perguntar e depois dar erro, já explicamos.
    const temItemDeEmpresa = [...document.querySelectorAll('.item-venda-row')].some((r) =>
      r.querySelector('.item-empresa').value && Number(r.querySelector('.item-valor').value) > 0)
    if (!temItemDeEmpresa) {
      return { erro: 'Você tirou todos os produtos do estoque, mas a visita está como "Comprou" e ficaria sem nenhum item.\nPara apagar a venda de produtos, mude o status para "Não comprou".' }
    }
    return apagarVenda('Você tirou todos os produtos do estoque.')
  }

  const total = arredonda2(linhas.reduce((s, l) => s + l.quantidade * l.preco, 0))
  let pagamento = null

  if (!vendaExistente) {
    const tipo = $('estPagamento').value
    const prazoTexto = $('estPrazo').value
    const prazo = prazoTexto === '' ? null : Math.round(Number($('estPrazo').value))
    if (tipo !== 'pago' && prazo !== null && !(prazo >= 0)) return { erro: 'O prazo para pagar precisa ser um número de dias (0 ou mais).' }

    let valorPago = total
    if (tipo === 'fiado') valorPago = 0
    if (tipo === 'parte') {
      valorPago = arredonda2($('estValorPago').value)
      if (!(valorPago > 0)) return { erro: 'Informe quanto o cliente pagou agora.' }
      if (valorPago >= total) return { erro: 'O valor pago é igual ou maior que o total. Escolha "Pago agora".' }
    }
    pagamento = { tipo, valorPago, forma: $('estForma').value || null, prazo: tipo === 'pago' ? null : prazo }
  }

  return {
    itens: linhas.map((l) => ({ produto_id: l.produtoId, quantidade: l.quantidade, preco_unitario: l.preco })),
    pagamento,
    total,
    temItens: true,
  }
}

// Depois que a visita foi salva: grava, atualiza ou apaga a venda de produtos.
// Devolve {} se deu certo ou {erro} (a visita já está salva nesse ponto).
async function salvar({ visitaId, clienteId, data, venda }) {
  try {
    if (!venda || venda.cancelado) return {}
    if (!(await pronto)) return {}
    if (venda.apagar) return await apagarVendaDaVisita()
    return vendaExistente
      ? await atualizarVenda({ clienteId, data, venda })
      : await criarVenda({ visitaId, clienteId, data, venda })
  } catch (err) {
    console.error('Erro inesperado ao salvar a venda de produtos:', err)
    return { erro: 'Erro inesperado ao salvar a venda de produtos.' }
  } finally {
    await atualizarProdutos()
  }
}

async function apagarVendaDaVisita() {
  const { error } = await supabase.from('vendas_estoque').delete().eq('id', vendaExistente.id)
  if (error) { console.error('Erro ao apagar a venda de produtos:', error); return { erro: mensagemErro(error, 'apagar') } }
  return {}
}

async function criarVenda({ visitaId, clienteId, data, venda }) {
  const { pagamento } = venda
  const vencimento = pagamento.prazo !== null && pagamento.prazo !== undefined ? somarDias(data, pagamento.prazo) : null

  const { data: nova, error } = await supabase.from('vendas_estoque').insert({
    user_id: userId,
    cliente_id: clienteId,
    visita_id: visitaId,
    data_venda: data,
    prazo_dias: pagamento.prazo,
    vencimento,
  }).select().single()
  if (error) { console.error('Erro ao criar a venda de produtos:', error); return { erro: mensagemErro(error) } }

  const itens = venda.itens.map((i) => ({
    user_id: userId,
    venda_id: nova.id,
    produto_id: i.produto_id,
    quantidade: i.quantidade,
    preco_unitario: i.preco_unitario,
    custo_unitario: Number(produtoPorId(i.produto_id)?.preco_custo) || 0, // custo do dia, copiado
  }))
  const resItens = await supabase.from('venda_estoque_itens').insert(itens)
  if (resItens.error) {
    console.error('Erro ao salvar os itens da venda de produtos:', resItens.error)
    await supabase.from('vendas_estoque').delete().eq('id', nova.id) // não deixa venda vazia pela metade
    return { erro: mensagemErro(resItens.error) }
  }

  if (pagamento.valorPago > 0) {
    const resPag = await supabase.from('pagamentos_venda').insert({
      user_id: userId,
      venda_id: nova.id,
      valor: pagamento.valorPago,
      data_pagamento: data,
      forma: pagamento.forma,
    })
    if (resPag.error) {
      console.error('Erro ao registrar o pagamento da venda de produtos:', resPag.error)
      return { erro: 'A venda foi salva, mas o pagamento não. Registre-o em "Receber", na lista de vendas de produtos.' }
    }
  }
  return {}
}

async function atualizarVenda({ clienteId, data, venda }) {
  const ex = vendaExistente
  // Linhas que já existiam mantêm o custo que tinham; só produto novo usa o custo de hoje.
  const custoAntigo = {}
  ex.itens.forEach((i) => { if (custoAntigo[i.produto_id] === undefined) custoAntigo[i.produto_id] = Number(i.custo_unitario) })

  const novos = venda.itens.map((i) => ({
    user_id: userId,
    venda_id: ex.id,
    produto_id: i.produto_id,
    quantidade: i.quantidade,
    preco_unitario: i.preco_unitario,
    custo_unitario: custoAntigo[i.produto_id] ?? (Number(produtoPorId(i.produto_id)?.preco_custo) || 0),
  }))

  const resVenda = await supabase.from('vendas_estoque').update({
    cliente_id: clienteId,
    data_venda: data,
    vencimento: ex.prazo_dias !== null && ex.prazo_dias !== undefined ? somarDias(data, ex.prazo_dias) : null,
  }).eq('id', ex.id)
  if (resVenda.error) { console.error('Erro ao atualizar a venda de produtos:', resVenda.error); return { erro: mensagemErro(resVenda.error) } }

  // Insere os novos ANTES de apagar os antigos: se algo falhar, a venda antiga continua inteira.
  const resNovos = await supabase.from('venda_estoque_itens').insert(novos)
  if (resNovos.error) { console.error('Erro ao salvar os itens da venda de produtos:', resNovos.error); return { erro: mensagemErro(resNovos.error) } }

  const resAntigos = await supabase.from('venda_estoque_itens').delete().in('id', ex.itens.map((i) => i.id))
  if (resAntigos.error) {
    console.error('Erro ao remover os itens antigos da venda:', resAntigos.error)
    return { erro: 'Os produtos novos foram salvos, mas não consegui remover os antigos: a venda pode estar com itens repetidos. Confira em "Vendas de produtos do mês".' }
  }
  return {}
}

// Ao abrir uma visita para editar: carrega a venda de produtos ligada a ela
async function carregar(visitaId) {
  carregando = true
  vendaExistente = null
  try {
    await pronto
    await atualizarProdutos()
    const { data, error } = await supabase
      .from('vendas_estoque')
      .select('*, venda_estoque_itens(*), pagamentos_venda(valor)')
      .eq('visita_id', visitaId)
    if (error) {
      console.error('Erro ao carregar a venda de produtos da visita:', error)
      alert('Não consegui carregar os produtos do estoque desta visita. Se for lançar produtos aqui, feche e abra a visita de novo.')
      return
    }
    const venda = data?.[0]
    if (!venda) return

    const itens = venda.venda_estoque_itens || []
    const total = arredonda2(itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0))
    const pago = arredonda2((venda.pagamentos_venda || []).reduce((s, p) => s + Number(p.valor), 0))
    vendaExistente = { id: venda.id, prazo_dias: venda.prazo_dias, itens, total, pago }

    $('estListaLinhas').innerHTML = ''
    itens.forEach((i) => adicionarLinha({ produtoId: i.produto_id, quantidade: Number(i.quantidade), preco: Number(i.preco_unitario) }))
  } finally {
    carregando = false
    atualizarTudo()
  }
}

// Ao fechar a janela da visita
function limpar() {
  vendaExistente = null
  carregando = false
  $('estListaLinhas').innerHTML = ''
  $('estPagamento').value = 'pago'
  $('estValorPago').value = ''
  $('estForma').value = ''
  $('estPrazo').value = ''
  atualizarTudo()
}

// ── Lista "Vendas de produtos do mês" ────────────────────────
function calcularVenda(v) {
  const itens = v.venda_estoque_itens || []
  const total = arredonda2(itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0))
  const pago = arredonda2((v.pagamentos_venda || []).reduce((s, p) => s + Number(p.valor), 0))
  return { ...v, itens, total, pago, falta: arredonda2(total - pago) }
}

async function carregarMes(visitas, inicio, fim) {
  try {
    await pronto
    const { data, error } = await supabase
      .from('vendas_estoque')
      .select('*, clientes(nome), venda_estoque_itens(quantidade, preco_unitario, produtos(nome, unidade)), pagamentos_venda(valor)')
      .gte('data_venda', inicio)
      .lte('data_venda', fim)
      .order('data_venda', { ascending: false })

    if (error) {
      console.error('Erro ao carregar as vendas de produtos do mês:', error)
      mesVendas = []
      porVisita = {}
      $('estListaVendas').innerHTML = '<tr><td colspan="7" class="est-vazio-linha">Não foi possível carregar as vendas de produtos.</td></tr>'
      return
    }

    mesVendas = data.map(calcularVenda)
    porVisita = {}
    mesVendas.forEach((v) => { if (v.visita_id) porVisita[v.visita_id] = v })
    ;(visitas || []).forEach((v) => { v.venda_estoque = porVisita[v.id] || null })
    desenharLista()
  } catch (err) {
    console.error('Erro inesperado nas vendas de produtos:', err)
  }
}

function temVenda(visitaId) {
  return !!porVisita[visitaId]
}

function desenharLista() {
  const corpo = $('estListaVendas')
  const resumo = $('estResumoVendas')
  if (mesVendas.length === 0) {
    resumo.style.display = 'none'
    corpo.innerHTML = '<tr><td colspan="7" class="est-vazio-linha">Nenhuma venda de produtos neste mês.</td></tr>'
    return
  }

  const hoje = dataLocalStr(new Date())
  const vendido = mesVendas.reduce((s, v) => s + v.total, 0)
  const aReceber = mesVendas.reduce((s, v) => s + Math.max(0, v.falta), 0)
  resumo.style.display = 'block'
  resumo.innerHTML = `Vendido de produtos no mês: <strong>${fmt(vendido)}</strong> · A receber: <strong>${fmt(aReceber)}</strong>`

  corpo.innerHTML = mesVendas.map((v) => {
    const tags = v.itens.map((i) =>
      `<span class="empresa-tag est-tag">${esc(i.produtos?.nome || '—')} × ${fmtQtd(i.quantidade)}</span>`).join('')

    let situacao
    if (v.falta <= 0.004) {
      situacao = '<span class="badge badge-sim">Pago</span>'
    } else {
      const atrasada = v.vencimento && v.vencimento < hoje
      const rotulo = v.pago > 0 ? `Falta ${fmt(v.falta)}` : `A pagar ${fmt(v.falta)}`
      situacao = `<span class="badge ${v.pago > 0 ? 'badge-parcial' : 'badge-nao'}">${rotulo}</span>` +
        (v.vencimento ? `<span class="est-sub">${atrasada ? '⚠ venceu em' : 'vence em'} ${dataBR(v.vencimento)}</span>` : '')
    }

    const receber = v.falta > 0.004
      ? `<button type="button" class="est-btn-editar" data-est-acao="receber" data-id="${v.id}">Receber</button>` : ''
    return `
      <tr>
        <td>${dataBR(v.data_venda).slice(0, 5)}</td>
        <td><strong>${esc(v.clientes?.nome || '—')}</strong>${v.visita_id ? '' : '<span class="est-sub">sem visita ligada</span>'}</td>
        <td><div class="empresas-tags">${tags}</div></td>
        <td>${fmt(v.total)}</td>
        <td>${fmt(v.pago)}</td>
        <td>${situacao}</td>
        <td><div class="acoes">${receber}<button type="button" class="est-btn-excluir" data-est-acao="excluir-venda" data-id="${v.id}">Excluir</button></div></td>
      </tr>`
  }).join('')
}

// Depois de receber/excluir: recarrega a tela de Visitas (o seletor de mês já faz isso)
function recarregarTela() {
  $('selectMes').dispatchEvent(new Event('change'))
}

// ── Receber (pagamento em partes) ────────────────────────────
const abrirModal = (id) => $(id).classList.add('aberto')
const fecharModal = (id) => $(id).classList.remove('aberto')

$('estModalPagamento').addEventListener('click', (e) => { if (e.target === $('estModalPagamento')) fecharModal('estModalPagamento') })
$('estModalPagamento').querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', () => fecharModal('estModalPagamento')))
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharModal('estModalPagamento') })

function abrirReceber(venda) {
  $('estPagVendaId').value = venda.id
  $('estPagInfo').innerHTML = `<strong>${esc(venda.clientes?.nome || '')}</strong> · total ${fmt(venda.total)} · já pago ${fmt(venda.pago)} · <strong>falta ${fmt(venda.falta)}</strong>`
  $('estPagValor').value = venda.falta
  $('estPagData').value = dataLocalStr(new Date())
  $('estPagForma').value = ''
  abrirModal('estModalPagamento')
  $('estPagValor').focus()
}

$('estFormPagamento').addEventListener('submit', async (e) => {
  e.preventDefault()
  const venda = mesVendas.find((v) => v.id === $('estPagVendaId').value)
  if (!venda) return
  const valor = arredonda2($('estPagValor').value)
  if (!(valor > 0)) return
  if (valor > venda.falta + 0.004) {
    alert(`O valor é maior do que falta receber (${fmt(venda.falta)}).`)
    return
  }
  const botao = $('estBtnSalvarPagamento')
  botao.disabled = true
  botao.textContent = 'Salvando...'
  const { error } = await supabase.from('pagamentos_venda').insert({
    user_id: userId,
    venda_id: venda.id,
    valor,
    data_pagamento: $('estPagData').value || dataLocalStr(new Date()),
    forma: $('estPagForma').value || null,
  })
  botao.disabled = false
  botao.textContent = 'Salvar pagamento'
  if (error) { console.error('Erro ao registrar pagamento:', error); alert(mensagemErro(error)); return }
  fecharModal('estModalPagamento')
  recarregarTela()
})

async function excluirVenda(id) {
  const venda = mesVendas.find((v) => v.id === id)
  if (!confirm(`Excluir esta venda de produtos${venda ? ` (${venda.clientes?.nome || ''}, ${fmt(venda.total)})` : ''}?\nO estoque volta e os pagamentos dela também são apagados.`)) return
  const { error } = await supabase.from('vendas_estoque').delete().eq('id', id)
  if (error) { console.error('Erro ao excluir a venda de produtos:', error); alert(mensagemErro(error, 'excluir')); return }
  await atualizarProdutos()
  recarregarTela()
}

$('estSecaoVendas').addEventListener('click', (e) => {
  const botao = e.target.closest('[data-est-acao]')
  if (!botao) return
  const venda = mesVendas.find((v) => v.id === botao.dataset.id)
  if (botao.dataset.estAcao === 'receber' && venda) abrirReceber(venda)
  if (botao.dataset.estAcao === 'excluir-venda') excluirVenda(botao.dataset.id)
})

// ── API para o visitas.js ────────────────────────────────────
window.estoqueVisitas = { coletar, salvar, carregar, limpar, carregarMes, temVenda }

pronto.then((ok) => { if (ok) atualizarProdutos() })
