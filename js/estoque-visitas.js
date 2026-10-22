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
        <td><div class="acoes"><button type="button" class="est-btn-editar" data-est-acao="editar-venda" data-id="${v.id}">Editar</button>${receber}<button type="button" class="est-btn-excluir" data-est-acao="excluir-venda" data-id="${v.id}">Excluir</button></div></td>
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
  if (botao.dataset.estAcao === 'editar-venda') abrirEditarVenda(botao.dataset.id)
  if (botao.dataset.estAcao === 'excluir-venda') excluirVenda(botao.dataset.id)
})

// ── Excluir uma visita que tem venda de produtos do estoque ──
// O visitas.js chama perguntarExclusao() antes de excluir. Se a visita não tem venda de estoque,
// devolve 'sem-venda' e o visitas.js segue com a pergunta de sempre. Senão abre a janela e devolve:
//   'tudo' (apagar a visita e a venda), 'so-visita' (manter a venda) ou 'cancelar'.
let respostaExclusao = null

function responderExclusao(escolha) {
  fecharModal('estModalExclusao')
  const resolver = respostaExclusao
  respostaExclusao = null
  if (resolver) resolver(escolha)
}

function perguntarExclusao(visitaId) {
  const venda = porVisita[visitaId]
  if (!venda) return Promise.resolve('sem-venda')
  if (respostaExclusao) responderExclusao('cancelar')

  const produtos = venda.itens.map((i) =>
    `<span class="empresa-tag est-tag">${esc(i.produtos?.nome || '—')} × ${fmtQtd(i.quantidade)}</span>`).join('')
  $('estExcInfo').innerHTML = `
    <p>Excluir esta visita? Os itens das empresas representadas dela também serão removidos.</p>
    <div class="est-exc-venda">
      <strong>Ela tem uma venda de produtos do seu estoque</strong> (${esc(venda.clientes?.nome || '—')}):
      <strong>${fmt(venda.total)}</strong>${venda.pago > 0 ? ` · já recebido ${fmt(venda.pago)}` : ''}
      <div class="empresas-tags">${produtos}</div>
    </div>
    <p class="est-exc-nota"><strong>Excluir visita e a venda:</strong> o estoque volta, os pagamentos dessa venda são apagados e os números do Dashboard se corrigem.
    <br><strong>Excluir só a visita:</strong> a venda continua valendo e fica em "Vendas de produtos do mês".</p>`
  abrirModal('estModalExclusao')
  return new Promise((resolver) => { respostaExclusao = resolver })
}

$('estExcTudo').addEventListener('click', () => responderExclusao('tudo'))
$('estExcSo').addEventListener('click', () => responderExclusao('so-visita'))
$('estExcCancelar').addEventListener('click', () => responderExclusao('cancelar'))
$('estExcFechar').addEventListener('click', () => responderExclusao('cancelar'))

// Apaga a venda de produtos da visita (itens e pagamentos vão junto). Devolve {} ou {erro}.
async function excluirVendaDaVisita(visitaId) {
  const venda = porVisita[visitaId]
  if (!venda) return {}
  const { error } = await supabase.from('vendas_estoque').delete().eq('id', venda.id)
  if (error) { console.error('Erro ao apagar a venda de produtos da visita:', error); return { erro: mensagemErro(error, 'excluir a venda de produtos') } }
  delete porVisita[visitaId]
  await atualizarProdutos()
  return {}
}

// ── Editar uma venda de produtos (solta ou ligada a uma visita) ──
// Corrige produtos, quantidades e preços (o estoque se acerta sozinho, pois é sempre calculado) e, nas
// vendas SOLTAS, a data. O cliente não muda. Os pagamentos já feitos só mudam se o Caio marcar
// "Continua paga por inteiro" (mesmas regras da edição de compras).
let vendaEditando = null // { id, visitaId, itens, pago, totalAntigo, vencimento } enquanto a janela está aberta

const qtdAntigaEd = (produtoId, itens = vendaEditando?.itens || []) =>
  itens.filter((i) => i.produto_id === produtoId).reduce((s, i) => s + Number(i.quantidade), 0)

function lerLinhasEd() {
  return [...document.querySelectorAll('#estEdLinhas .est-linha')].map((linha) => ({
    el: linha,
    produtoId: linha.querySelector('.est-produto').value,
    quantidade: arredonda3(linha.querySelector('.est-qtd').value),
    preco: arredonda2(linha.querySelector('.est-preco').value),
    precoVazio: linha.querySelector('.est-preco').value === '',
    mexeu: !!(linha.querySelector('.est-produto').value || linha.querySelector('.est-qtd').value || linha.querySelector('.est-preco').value),
  }))
}

const totalEd = () => arredonda2(lerLinhasEd().reduce((s, l) => s + (l.quantidade > 0 ? l.quantidade * l.preco : 0), 0))

// Situação do pagamento com o que está na janela agora. "pagoReal"/"totalAntigoReal" (opcionais) vêm do banco no momento de salvar.
function situacaoEd(pagoReal, totalAntigoReal) {
  const pago = arredonda2(pagoReal ?? vendaEditando.pago)
  const totalAntigo = arredonda2(totalAntigoReal ?? vendaEditando.totalAntigo)
  const totalNovo = totalEd()
  const estavaPaga = arredonda2(totalAntigo - pago) <= 0
  const mudouTotal = Math.abs(totalNovo - totalAntigo) > 0.004
  const mostraContinua = estavaPaga && pago > 0.004 && mudouTotal // a caixinha só faz sentido se já há pagamento e o valor mudou
  const ajustar = mostraContinua && $('estEdContinuaPaga').checked
  const pagoDepois = ajustar ? totalNovo : pago
  return { pago, pagoDepois, totalAntigo, totalNovo, mostraContinua, ajustar, falta: arredonda2(totalNovo - pagoDepois) }
}

function atualizarEd() {
  if (!vendaEditando) return
  const linhas = lerLinhasEd()
  const somaPorProduto = {}
  linhas.forEach((l) => { if (l.produtoId) somaPorProduto[l.produtoId] = (somaPorProduto[l.produtoId] || 0) + l.quantidade })
  linhas.forEach((l) => {
    const info = l.el.querySelector('.est-linha-info')
    const p = produtoPorId(l.produtoId)
    if (!p) { info.textContent = ''; info.classList.remove('est-excede'); return }
    // as quantidades desta venda já estão "descontadas" do estoque: voltam a ficar disponíveis na edição
    const disponivel = arredonda3((estoque[p.id] || 0) + qtdAntigaEd(p.id))
    const passa = (somaPorProduto[p.id] || 0) > disponivel
    info.classList.toggle('est-excede', passa)
    info.textContent = `Em estoque: ${fmtQtd(disponivel)} ${p.unidade}` +
      (l.quantidade > 0 ? ` · Total da linha: ${fmt(arredonda2(l.quantidade * l.preco))}` : '') +
      (passa ? ' · atenção: passa do que você tem em estoque' : '')
  })

  const s = situacaoEd()
  $('estEdTotal').innerHTML = `Total da venda: <strong>${fmt(s.totalNovo)}</strong>`
  $('estEdLinhaContinua').style.display = s.mostraContinua ? '' : 'none'
  $('estEdSituacao').innerHTML = `Já recebido: <strong>${fmt(s.pagoDepois)}</strong> · ` + (
    s.falta > 0.004 ? `Falta <strong>${fmt(s.falta)}</strong>`
      : s.falta < -0.004 ? `<strong>Recebido a mais: ${fmt(-s.falta)}</strong> (corrija o valor${s.mostraContinua ? ' ou marque "Continua paga por inteiro"' : ''})`
        : '<strong>Paga por inteiro</strong>')
  $('estEdCampoVenc').style.display = s.falta > 0.004 ? 'flex' : 'none'
}

function adicionarLinhaEd({ produtoId = '', quantidade = '', preco = '' } = {}) {
  const linha = $('estTemplateLinha').content.firstElementChild.cloneNode(true)
  const select = linha.querySelector('.est-produto')
  select.innerHTML = opcoesProdutos(produtoId)
  select.value = produtoId
  linha.querySelector('.est-qtd').value = quantidade
  linha.querySelector('.est-preco').value = preco
  select.addEventListener('change', () => {
    const p = produtoPorId(select.value)
    linha.querySelector('.est-preco').value = p ? p.preco_venda : ''
    atualizarEd()
  })
  linha.querySelector('.est-qtd').addEventListener('input', atualizarEd)
  linha.querySelector('.est-preco').addEventListener('input', atualizarEd)
  linha.querySelector('.est-btn-remover').addEventListener('click', () => { linha.remove(); atualizarEd() })
  $('estEdLinhas').appendChild(linha)
  atualizarEd()
}

// Lê a venda COMPLETA do banco (itens e pagamentos), para não depender do que a tela guardou
async function buscarVendaCompleta(id) {
  const { data, error } = await supabase
    .from('vendas_estoque')
    .select('*, clientes(nome), venda_estoque_itens(*), pagamentos_venda(id, valor, data_pagamento, created_at)')
    .eq('id', id)
  if (error) { console.error('Erro ao carregar a venda:', error); return { erro: mensagemErro(error) } }
  const venda = data?.[0]
  if (!venda) return { naoExiste: true, erro: 'Esta venda não existe mais (ela foi apagada). A lista vai ser atualizada.' }
  const itens = venda.venda_estoque_itens || []
  const pagamentos = venda.pagamentos_venda || []
  return {
    venda,
    itens,
    pagamentos,
    totalAntigo: arredonda2(itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0)),
    pago: arredonda2(pagamentos.reduce((s, p) => s + Number(p.valor), 0)),
  }
}

async function abrirEditarVenda(id) {
  if (!(await pronto)) return
  await atualizarProdutos() // estoque atual (as quantidades desta venda já estão descontadas dele)
  const r = await buscarVendaCompleta(id)
  if (r.erro) { alert(r.erro); if (r.naoExiste) recarregarTela(); return }
  const v = r.venda

  vendaEditando = { id, visitaId: v.visita_id, itens: r.itens, pago: r.pago, totalAntigo: r.totalAntigo, vencimento: v.vencimento }
  $('estEdVendaId').value = id
  $('estEdCabecalho').innerHTML = `<strong>${esc(v.clientes?.nome || '—')}</strong> · venda de ${dataBR(v.data_venda)}` +
    (v.visita_id ? ' · ligada a uma visita (para mudar a data, edite a visita)' : ' · sem visita ligada')
  $('estEdCampoData').style.display = v.visita_id ? 'none' : 'flex'
  $('estEdData').value = String(v.data_venda).slice(0, 10)
  $('estEdVenc').value = v.vencimento ? String(v.vencimento).slice(0, 10) : ''
  $('estEdContinuaPaga').checked = false
  $('estEdLinhas').innerHTML = ''
  r.itens.forEach((i) => adicionarLinhaEd({ produtoId: i.produto_id, quantidade: Number(i.quantidade), preco: Number(i.preco_unitario) }))
  abrirModal('estModalEditarVenda')
  atualizarEd()
}

function fecharEditarVenda() {
  fecharModal('estModalEditarVenda')
  vendaEditando = null
}

$('estEdContinuaPaga').addEventListener('change', atualizarEd)
$('estModalEditarVenda').querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', fecharEditarVenda))
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('estModalEditarVenda').classList.contains('aberto')) fecharEditarVenda() })
$('estEdAddProduto').addEventListener('click', () => {
  if (!produtos.some((p) => p.ativo)) { alert('Você ainda não tem produtos ativos. Cadastre em Empresas → Estoque → Produtos.'); return }
  adicionarLinhaEd()
})

// Ajusta os pagamentos para a soma bater com o novo total (venda que continua paga por inteiro):
// total maior -> registra a diferença; total menor -> tira dos pagamentos mais recentes.
async function ajustarPagamentosVenda(vendaId, pagamentos, pago, totalNovo, dataPagamento) {
  const diferenca = arredonda2(totalNovo - pago)
  if (Math.abs(diferenca) < 0.004) return {}
  if (diferenca > 0) {
    const r = await supabase.from('pagamentos_venda').insert({ user_id: userId, venda_id: vendaId, valor: diferenca, data_pagamento: dataPagamento, forma: null })
    return r.error ? { erro: r.error } : {}
  }
  let restante = -diferenca
  const recentes = [...pagamentos].sort((a, b) =>
    String(b.data_pagamento).localeCompare(String(a.data_pagamento)) || String(b.created_at).localeCompare(String(a.created_at)))
  for (const p of recentes) {
    if (restante <= 0.004) break
    const valor = Number(p.valor)
    const r = valor <= restante + 0.004
      ? await supabase.from('pagamentos_venda').delete().eq('id', p.id)
      : await supabase.from('pagamentos_venda').update({ valor: arredonda2(valor - restante) }).eq('id', p.id)
    if (r.error) return { erro: r.error }
    restante = arredonda2(restante - valor)
  }
  return {}
}

$('estFormEditarVenda').addEventListener('submit', async (e) => {
  e.preventDefault()
  if (!vendaEditando) return
  const id = vendaEditando.id

  // Linhas digitadas: validação básica (a mesma da visita)
  const linhas = lerLinhasEd().filter((l) => l.mexeu)
  for (const l of linhas) {
    if (!l.produtoId || !(l.quantidade > 0)) { alert('Escolha o produto e a quantidade em todas as linhas (ou remova a linha).'); return }
    if (l.precoVazio) { alert('Informe o preço em todas as linhas (se for brinde, coloque 0).'); return }
  }
  if (linhas.length === 0) { alert('Uma venda precisa de pelo menos um produto. Para apagar a venda inteira, use "Excluir" na lista.'); return }

  const botao = $('estBtnSalvarEdVenda')
  const rotulo = botao.textContent
  botao.disabled = true
  botao.textContent = 'Salvando...'
  try {
    // Venda lida do banco AGORA (a tela pode estar desatualizada) e estoque atual
    const r = await buscarVendaCompleta(id)
    if (r.erro) { alert(r.erro); if (r.naoExiste) { fecharEditarVenda(); recarregarTela() } return }
    await atualizarProdutos()
    const s = situacaoEd(r.pago, r.totalAntigo)

    // 1) O novo total não pode ficar abaixo do que já foi recebido (a menos que o pagamento seja ajustado junto)
    if (!s.ajustar && s.totalNovo < r.pago - 0.004) {
      alert(s.mostraContinua
        ? `O novo total (${fmt(s.totalNovo)}) ficou menor do que já foi recebido (${fmt(r.pago)}).\n\nSe a venda continua paga por inteiro, marque "Continua paga por inteiro" para o pagamento ser ajustado. Se não, corrija as quantidades ou os preços.`
        : `O novo total (${fmt(s.totalNovo)}) ficou menor do que já foi recebido (${fmt(r.pago)}). Corrija as quantidades ou os preços.`)
      return
    }

    // 2) Lembrete: estava paga por inteiro, mudou de valor e a caixinha está desmarcada
    if (s.mostraContinua && !s.ajustar && s.totalNovo > r.pago + 0.004) {
      if (!confirm(`Atenção: esta venda estava paga por inteiro (${fmt(r.pago)}) e o total mudou para ${fmt(s.totalNovo)}.\n\nSe ela continua paga, clique em Cancelar e marque "Continua paga por inteiro".\n\nSe salvar assim, ficará "Falta ${fmt(s.totalNovo - r.pago)}" em "Quem me deve".\n\nSalvar mesmo assim?`)) return
    }

    // 3) Estoque: avisa (sem bloquear) se a edição deixar algum produto negativo
    const novaPorProduto = {}
    linhas.forEach((l) => { novaPorProduto[l.produtoId] = (novaPorProduto[l.produtoId] || 0) + l.quantidade })
    const idsAfetados = [...new Set([...r.itens.map((i) => i.produto_id), ...Object.keys(novaPorProduto)])]
    const avisosEstoque = idsAfetados.map((pid) => {
      const antes = arredonda3(estoque[pid] || 0)
      const depois = arredonda3(antes + qtdAntigaEd(pid, r.itens) - (novaPorProduto[pid] || 0))
      const p = produtoPorId(pid)
      return depois < 0 && depois < antes - 0.0005 ? `${p?.nome || 'produto'}: ficará com ${fmtQtd(depois)} ${p?.unidade || ''} (hoje: ${fmtQtd(antes)})` : null
    }).filter(Boolean)
    if (avisosEstoque.length && !confirm(`Depois desta edição o estoque ficará negativo (vai sair mais do que entrou):\n\n${avisosEstoque.join('\n')}\n\nSalvar mesmo assim? (Depois é só lançar a compra que falta.)`)) return

    // 4) Grava: itens novos ANTES de apagar os antigos (se algo falhar, a venda original continua inteira)
    const custoAntigo = {}
    r.itens.forEach((i) => { if (custoAntigo[i.produto_id] === undefined) custoAntigo[i.produto_id] = Number(i.custo_unitario) })
    const novos = linhas.map((l) => ({
      user_id: userId,
      venda_id: id,
      produto_id: l.produtoId,
      quantidade: l.quantidade,
      preco_unitario: l.preco,
      // linha que já existia mantém o custo que tinha; produto novo usa o custo de hoje
      custo_unitario: custoAntigo[l.produtoId] ?? (Number(produtoPorId(l.produtoId)?.preco_custo) || 0),
    }))
    const resNovos = await supabase.from('venda_estoque_itens').insert(novos)
    if (resNovos.error) { console.error('Erro ao salvar os itens da venda:', resNovos.error); alert(mensagemErro(resNovos.error) + '\nNada foi alterado.'); return }

    let aviso = ''
    const resAntigos = await supabase.from('venda_estoque_itens').delete().in('id', r.itens.map((i) => i.id))
    if (resAntigos.error) {
      console.error('Erro ao remover os itens antigos da venda:', resAntigos.error)
      aviso += 'Os produtos novos foram salvos, mas não consegui remover os antigos: a venda pode estar com itens repetidos. Confira em "Vendas de produtos do mês".\n'
    }

    const dataFinal = r.venda.visita_id ? String(r.venda.data_venda).slice(0, 10) : ($('estEdData').value || String(r.venda.data_venda).slice(0, 10))
    const atualizacao = { vencimento: s.falta > 0.004 ? ($('estEdVenc').value || null) : (r.venda.vencimento || null) }
    if (!r.venda.visita_id) atualizacao.data_venda = dataFinal
    const resVenda = await supabase.from('vendas_estoque').update(atualizacao).eq('id', id)
    if (resVenda.error) {
      console.error('Erro ao atualizar a data/vencimento da venda:', resVenda.error)
      aviso += 'Os produtos foram atualizados, mas não consegui salvar a data ou o vencimento.\n'
    }

    if (s.ajustar) {
      const ra = await ajustarPagamentosVenda(id, r.pagamentos, r.pago, s.totalNovo, dataFinal)
      if (ra.erro) {
        console.error('Erro ao ajustar o pagamento da venda:', ra.erro)
        aviso += 'A venda foi alterada, mas não consegui ajustar o pagamento. Confira "Pago" e "Situação" na lista.\n'
      }
    }

    fecharEditarVenda()
    await atualizarProdutos()
    recarregarTela()
    if (aviso) alert(aviso)
  } finally {
    botao.disabled = false
    botao.textContent = rotulo
  }
})

// ── API para o visitas.js ────────────────────────────────────
window.estoqueVisitas = { coletar, salvar, carregar, limpar, carregarMes, temVenda, perguntarExclusao, excluirVendaDaVisita }

pronto.then((ok) => { if (ok) atualizarProdutos() })
