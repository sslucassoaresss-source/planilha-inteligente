// Relatório do mês e backup completo em Excel (.xlsx), pelos botões do Dashboard.
//
// SÓ LEITURA: este arquivo apenas consulta o Supabase e monta a planilha no
// navegador. Não grava, altera nem apaga nada no banco.
//
// A biblioteca que gera o .xlsx (SheetJS) só é baixada quando alguém clica num
// dos botões, então não pesa no carregamento do app.

import { buscarTodasLinhas } from './supabase.js'

const URL_XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
const SRI_XLSX = 'sha512-r22gChDnGvBylk90+2e/ycr3RVrDi8DIOkIGNhJlKfuyQM4tIRAI062MaV8sfjQKYVGjOBaZBOA87z+IhZE9DA=='

const FORMATO_MOEDA = '"R$" #,##0.00'
// Colunas do banco que guardam dinheiro (ganham formato de moeda no backup completo)
const COLUNAS_MOEDA = new Set([
  'valor', 'desconto', 'desconto_aplicado', 'comissao_manual',
  // Estoque
  'preco_custo', 'preco_venda', 'custo_unitario', 'preco_unitario',
])

const btnMes = document.getElementById('btnExcelMes')
const btnBackup = document.getElementById('btnBackupCompleto')
const selectMes = document.getElementById('selectMes')

// ── Biblioteca ────────────────────────────────────────────────

let promessaXlsx = null

function carregarBiblioteca() {
  if (window.XLSX) return Promise.resolve(window.XLSX)
  if (!promessaXlsx) {
    promessaXlsx = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = URL_XLSX
      s.integrity = SRI_XLSX
      s.crossOrigin = 'anonymous'
      s.onload = () => resolve(window.XLSX)
      s.onerror = () => {
        promessaXlsx = null // permite tentar de novo no próximo clique
        reject(new Error('Não foi possível carregar a biblioteca do Excel (sem internet?).'))
      }
      document.head.appendChild(s)
    })
  }
  return promessaXlsx
}

// ── Leitura do banco ──────────────────────────────────────────

// Ordena por "id" (único), porque ordenar por uma coluna que repete (ex.: nome)
// pode duplicar ou pular linhas entre uma página e outra. Se a tabela não tiver
// "id" (erro 42703), busca sem ordem; as telas ordenam depois, em JavaScript.
async function ler(tabela, opcoes = {}) {
  let r = await buscarTodasLinhas(tabela, { order: 'id', ...opcoes })
  if (r.error?.code === '42703') r = await buscarTodasLinhas(tabela, opcoes)
  if (r.error) {
    console.error(`Erro ao ler ${tabela}:`, r.error)
    throw new Error(`Não foi possível ler "${tabela}".`)
  }
  return r.data
}

// ── Formatação ────────────────────────────────────────────────

// "2026-10-18" -> "18/10/2026", cortando o texto (sem Date, para o fuso não "virar o dia")
const dataBR = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '')
const dataHoraBR = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR') : '')
const simNao = (b) => (b ? 'Sim' : 'Não')
const comparaTexto = (a, b) => String(a || '').localeCompare(String(b || ''), 'pt-BR')

function dataLocalStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Mesma regra de comissão do Dashboard e de Empresas: o valor digitado à mão,
// se existir; senão, valor × percentual da empresa.
function comissaoDoItem(item, percentual) {
  if (item.comissao_manual !== null && item.comissao_manual !== undefined) return item.comissao_manual
  return (item.valor || 0) * ((percentual || 0) / 100)
}

// ── Montagem das abas ─────────────────────────────────────────

// Uma célula do Excel: número de verdade (para somar/filtrar) com formato, ou texto.
function celula(valor, tipo) {
  if (valor === null || valor === undefined || valor === '') return null
  if (tipo === 'moeda') return { t: 'n', v: Number(valor) || 0, z: FORMATO_MOEDA }
  // Porcentagem: o Excel guarda 10% como 0,10 e mostra com o formato "0.0%"
  if (tipo === 'percentual') return { t: 'n', v: (Number(valor) || 0) / 100, z: '0.0%' }
  if (tipo === 'numero' || typeof valor === 'number') return { t: 'n', v: Number(valor) }
  if (typeof valor === 'boolean') return { t: 's', v: simNao(valor) }
  if (typeof valor === 'object') return { t: 's', v: JSON.stringify(valor) }
  return { t: 's', v: String(valor) }
}

// colunas: [{ titulo, tipo?, valor: (linha) => ... }]
function montarAba(colunas, linhas) {
  const XLSX = window.XLSX
  const celulas = linhas.map((l) => colunas.map((c) => celula(c.valor(l), c.tipo)))
  const ws = XLSX.utils.aoa_to_sheet([colunas.map((c) => c.titulo), ...celulas])
  ws['!cols'] = colunas.map((c, i) => {
    const maior = celulas.reduce((m, linha) => {
      const v = linha[i]
      const tamanho = v ? (v.z ? 14 : String(v.v).length) : 0
      return Math.max(m, tamanho)
    }, c.titulo.length)
    return { wch: Math.min(60, maior + 2) }
  })
  return ws
}

// Backup completo: uma coluna para cada coluna do banco (menos o user_id),
// precedidas de colunas "amigáveis" (nome do cliente, da empresa, etc.).
function colunasCruas(linhas, extras = []) {
  const chaves = []
  linhas.forEach((l) => Object.keys(l).forEach((k) => {
    if (k !== 'user_id' && !chaves.includes(k)) chaves.push(k)
  }))
  return [
    ...extras,
    ...chaves.map((k) => ({
      titulo: k,
      tipo: COLUNAS_MOEDA.has(k) ? 'moeda' : undefined,
      valor: (l) => l[k],
    })),
  ]
}

function abaCrua(linhas, extras = []) {
  return montarAba(colunasCruas(linhas, extras), linhas)
}

function baixar(wb, nomeArquivo) {
  window.XLSX.writeFile(wb, nomeArquivo)
}

// ── Estoque (revenda) e Lembretes ─────────────────────────────

const TABELAS_ESTOQUE = [
  'fornecedores', 'produtos', 'compras_estoque', 'pagamentos_compra', 'vendas_estoque',
  'venda_estoque_itens', 'pagamentos_venda', 'retiradas_lucro', 'metas_estoque', 'lembretes',
]

let avisoFinal = '' // mostrado ao fim da geração (ex.: tabelas do Estoque que não puderam ser lidas)

// Lê todas as tabelas do Estoque. Se alguma falhar, `ok` fica falso e as abas do Estoque são
// puladas (o resto do arquivo sai normalmente).
async function lerEstoque() {
  const pares = await Promise.all([
    ...TABELAS_ESTOQUE.map(async (t) => {
      try { return [t, await ler(t)] } catch { return [t, null] }
    }),
    (async () => { try { return ['clientes', await ler('clientes', { select: 'id, nome' })] } catch { return ['clientes', null] } })(),
  ])
  const dados = Object.fromEntries(pares)
  const falhas = Object.keys(dados).filter((t) => dados[t] === null)
  if (falhas.length) avisoFinal = `As abas do Estoque não foram incluídas porque não consegui ler: ${falhas.join(', ')}. O restante do arquivo está completo.`
  return { ...dados, falhas, ok: falhas.length === 0 }
}

const arredonda2 = (v) => Math.round((Number(v) || 0) * 100) / 100
const somar = (lista, f) => lista.reduce((s, x) => s + f(x), 0)
const agrupar = (lista, chave) => lista.reduce((m, x) => { (m[x[chave]] = m[x[chave]] || []).push(x); return m }, {})
const porId = (lista) => Object.fromEntries(lista.map((x) => [x.id, x]))

// Dias até uma data "AAAA-MM-DD" (negativo = já passou), sem passar por UTC/fuso
function diasAte(dataStr) {
  const [a, m, d] = String(dataStr).slice(0, 10).split('-').map(Number)
  const [ha, hm, hd] = dataLocalStr(new Date()).split('-').map(Number)
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(ha, hm - 1, hd)) / 86400000)
}

function situacaoDoPrazo(vencimento) {
  if (!vencimento) return 'Sem prazo'
  const dias = diasAte(vencimento)
  if (dias < 0) return dias === -1 ? 'Venceu ontem' : `Venceu há ${-dias} dias`
  if (dias === 0) return 'Vence hoje'
  return dias === 1 ? 'Vence amanhã' : `Vence em ${dias} dias`
}

// Lucro que cada pagamento "liberou" numa venda, pela regra "primeiro o custo" (a mesma do
// Dashboard): o dinheiro que entra cobre primeiro o custo; só o excedente é lucro.
function lucroPorPagamento(venda) {
  const lucroMaximo = Math.max(0, venda.total - venda.custo)
  const pagamentos = [...venda.pagamentos].sort((a, b) =>
    comparaTexto(a.data_pagamento, b.data_pagamento) || comparaTexto(a.created_at, b.created_at))
  let acumulado = 0
  let liberado = 0
  return pagamentos.map((p) => {
    acumulado += Number(p.valor)
    const novo = Math.min(lucroMaximo, Math.max(0, acumulado - venda.custo))
    const incremento = novo - liberado
    liberado = novo
    return { pagamento: p, lucro: incremento }
  })
}

// Organiza as tabelas do Estoque: vendas e compras com totais, pagamentos, nomes e saldos
function organizarEstoque(est) {
  const produtoPorId = porId(est.produtos)
  const fornecedorPorId = porId(est.fornecedores)
  const clientePorId = porId(est.clientes)
  const itensPorVenda = agrupar(est.venda_estoque_itens, 'venda_id')
  const pagVendaPorVenda = agrupar(est.pagamentos_venda, 'venda_id')
  const pagCompraPorCompra = agrupar(est.pagamentos_compra, 'compra_id')

  const vendas = est.vendas_estoque.map((v) => {
    const itens = itensPorVenda[v.id] || []
    const pagamentos = pagVendaPorVenda[v.id] || []
    const total = arredonda2(somar(itens, (i) => Number(i.quantidade) * Number(i.preco_unitario)))
    const custo = arredonda2(somar(itens, (i) => Number(i.quantidade) * Number(i.custo_unitario)))
    const pago = arredonda2(somar(pagamentos, (p) => Number(p.valor)))
    return { ...v, itens, pagamentos, total, custo, pago, falta: arredonda2(total - pago), cliente: clientePorId[v.cliente_id]?.nome || '' }
  })

  const compras = est.compras_estoque.map((c) => {
    const pagamentos = pagCompraPorCompra[c.id] || []
    const total = arredonda2(Number(c.quantidade) * Number(c.custo_unitario))
    const pago = arredonda2(somar(pagamentos, (p) => Number(p.valor)))
    return { ...c, pagamentos, total, pago, falta: arredonda2(total - pago), produto: produtoPorId[c.produto_id], fornecedor: fornecedorPorId[c.fornecedor_id]?.nome || '' }
  })

  // Estoque atual de cada produto = comprado − vendido
  const saldo = {}
  compras.forEach((c) => { saldo[c.produto_id] = (saldo[c.produto_id] || 0) + Number(c.quantidade) })
  est.venda_estoque_itens.forEach((i) => { saldo[i.produto_id] = (saldo[i.produto_id] || 0) - Number(i.quantidade) })

  return { produtoPorId, fornecedorPorId, clientePorId, vendas, compras, saldo }
}

const textoDosProdutos = (itens, produtoPorId) =>
  itens.map((i) => `${produtoPorId[i.produto_id]?.nome || 'produto'} × ${Number(i.quantidade)}`).join('; ')

// Linhas do Resumo do mês sobre o Estoque (mesmos números dos cards do Dashboard)
function linhasResumoEstoque(est, org, inicio, fim) {
  const vendidoNoMes = somar(org.vendas.filter((v) => v.data_venda >= inicio && v.data_venda <= fim), (v) => v.total)
  let lucroDoMes = 0
  let lucroTotal = 0
  org.vendas.forEach((v) => lucroPorPagamento(v).forEach((x) => {
    lucroTotal += x.lucro
    const dia = String(x.pagamento.data_pagamento).slice(0, 10)
    if (dia >= inicio && dia <= fim) lucroDoMes += x.lucro
  }))
  const retirado = somar(est.retiradas_lucro, (r) => Number(r.valor))
  const retiradoNoMes = somar(est.retiradas_lucro.filter((r) => r.data_retirada >= inicio && r.data_retirada <= fim), (r) => Number(r.valor))
  const valorEstoque = somar(est.produtos, (p) => Math.max(0, org.saldo[p.id] || 0) * Number(p.preco_custo))

  return [
    [],
    ['Estoque (revenda)'],
    ['Mercadoria em estoque (pelo custo)', celula(arredonda2(valorEstoque), 'moeda')],
    ['Vendido de produtos no mês', celula(arredonda2(vendidoNoMes), 'moeda')],
    ['Lucro recebido no mês', celula(arredonda2(lucroDoMes), 'moeda')],
    ['Retirado no mês', celula(arredonda2(retiradoNoMes), 'moeda')],
    ['Pode retirar agora (acumulado)', celula(Math.max(0, arredonda2(lucroTotal - retirado)), 'moeda')],
    ['A receber de clientes (em aberto hoje)', celula(arredonda2(somar(org.vendas.filter((v) => v.falta > 0.004), (v) => v.falta)), 'moeda')],
    ['A pagar a fornecedores (em aberto hoje)', celula(arredonda2(somar(org.compras.filter((c) => c.falta > 0.004), (c) => c.falta)), 'moeda')],
  ]
}

// Abas do Estoque no relatório do mês
function abasEstoqueDoMes(est, org, inicio, fim) {
  const noMes = (d) => d >= inicio && d <= fim
  const vendasDoMes = org.vendas.filter((v) => noMes(v.data_venda)).sort((a, b) => comparaTexto(a.data_venda, b.data_venda))
  const comprasDoMes = org.compras.filter((c) => noMes(c.data_compra)).sort((a, b) => comparaTexto(a.data_compra, b.data_compra))

  const wsVendas = montarAba([
    { titulo: 'Data', valor: (v) => dataBR(v.data_venda) },
    { titulo: 'Cliente', valor: (v) => v.cliente },
    { titulo: 'Produtos', valor: (v) => textoDosProdutos(v.itens, org.produtoPorId) },
    { titulo: 'Total', tipo: 'moeda', valor: (v) => v.total },
    { titulo: 'Custo da mercadoria', tipo: 'moeda', valor: (v) => v.custo },
    { titulo: 'Lucro máximo (total − custo)', tipo: 'moeda', valor: (v) => Math.max(0, v.total - v.custo) },
    { titulo: 'Pago até hoje', tipo: 'moeda', valor: (v) => v.pago },
    { titulo: 'Falta receber', tipo: 'moeda', valor: (v) => Math.max(0, v.falta) },
    { titulo: 'Vencimento', valor: (v) => dataBR(v.vencimento) },
    { titulo: 'Observação da cobrança', valor: (v) => v.observacao_cobranca },
  ], vendasDoMes)

  const itens = []
  vendasDoMes.forEach((v) => v.itens.forEach((i) => itens.push({ v, i })))
  const wsItens = montarAba([
    { titulo: 'Data', valor: (x) => dataBR(x.v.data_venda) },
    { titulo: 'Cliente', valor: (x) => x.v.cliente },
    { titulo: 'Produto', valor: (x) => org.produtoPorId[x.i.produto_id]?.nome },
    { titulo: 'Quantidade', valor: (x) => Number(x.i.quantidade) },
    { titulo: 'Preço unitário', tipo: 'moeda', valor: (x) => Number(x.i.preco_unitario) },
    { titulo: 'Total', tipo: 'moeda', valor: (x) => arredonda2(Number(x.i.quantidade) * Number(x.i.preco_unitario)) },
    { titulo: 'Custo unitário (do dia da venda)', tipo: 'moeda', valor: (x) => Number(x.i.custo_unitario) },
    { titulo: 'Lucro bruto', tipo: 'moeda', valor: (x) => arredonda2(Number(x.i.quantidade) * (Number(x.i.preco_unitario) - Number(x.i.custo_unitario))) },
  ], itens)

  // Dinheiro recebido no mês (qualquer venda) e o lucro que cada recebimento liberou
  const recebimentos = []
  org.vendas.forEach((v) => lucroPorPagamento(v).forEach((x) => {
    if (noMes(String(x.pagamento.data_pagamento).slice(0, 10))) recebimentos.push({ v, p: x.pagamento, lucro: x.lucro })
  }))
  recebimentos.sort((a, b) => comparaTexto(a.p.data_pagamento, b.p.data_pagamento))
  const wsRecebimentos = montarAba([
    { titulo: 'Dia do recebimento', valor: (x) => dataBR(x.p.data_pagamento) },
    { titulo: 'Cliente', valor: (x) => x.v.cliente },
    { titulo: 'Valor recebido', tipo: 'moeda', valor: (x) => Number(x.p.valor) },
    { titulo: 'Forma', valor: (x) => ({ pix: 'Pix', dinheiro: 'Dinheiro' }[x.p.forma] || '') },
    { titulo: 'Lucro liberado (primeiro o custo)', tipo: 'moeda', valor: (x) => arredonda2(x.lucro) },
    { titulo: 'Data da venda', valor: (x) => dataBR(x.v.data_venda) },
  ], recebimentos)

  const wsCompras = montarAba([
    { titulo: 'Data', valor: (c) => dataBR(c.data_compra) },
    { titulo: 'Produto', valor: (c) => c.produto?.nome },
    { titulo: 'Fornecedor', valor: (c) => c.fornecedor },
    { titulo: 'Quantidade', valor: (c) => Number(c.quantidade) },
    { titulo: 'Custo unitário', tipo: 'moeda', valor: (c) => Number(c.custo_unitario) },
    { titulo: 'Total', tipo: 'moeda', valor: (c) => c.total },
    { titulo: 'Pago até hoje', tipo: 'moeda', valor: (c) => c.pago },
    { titulo: 'Falta pagar', tipo: 'moeda', valor: (c) => Math.max(0, c.falta) },
    { titulo: 'Vencimento', valor: (c) => dataBR(c.vencimento) },
    { titulo: 'Observação da cobrança', valor: (c) => c.observacao_cobranca },
  ], comprasDoMes)

  // Fotografia de hoje (de qualquer mês): quem deve e a quem se deve
  const emAberto = (lista) => lista.filter((x) => x.falta > 0.004)
    .sort((a, b) => comparaTexto(a.vencimento || '9999', b.vencimento || '9999') || comparaTexto(a.data_venda || a.data_compra, b.data_venda || b.data_compra))
  const wsReceber = montarAba([
    { titulo: 'Cliente', valor: (v) => v.cliente },
    { titulo: 'Data da venda', valor: (v) => dataBR(v.data_venda) },
    { titulo: 'Produtos', valor: (v) => textoDosProdutos(v.itens, org.produtoPorId) },
    { titulo: 'Total', tipo: 'moeda', valor: (v) => v.total },
    { titulo: 'Já pago', tipo: 'moeda', valor: (v) => v.pago },
    { titulo: 'Falta', tipo: 'moeda', valor: (v) => v.falta },
    { titulo: 'Vencimento', valor: (v) => dataBR(v.vencimento) },
    { titulo: 'Situação', valor: (v) => situacaoDoPrazo(v.vencimento) },
    { titulo: 'Observação da cobrança', valor: (v) => v.observacao_cobranca },
  ], emAberto(org.vendas))
  const wsPagar = montarAba([
    { titulo: 'Fornecedor', valor: (c) => c.fornecedor || 'Sem fornecedor' },
    { titulo: 'Data da compra', valor: (c) => dataBR(c.data_compra) },
    { titulo: 'Produto', valor: (c) => c.produto?.nome },
    { titulo: 'Total', tipo: 'moeda', valor: (c) => c.total },
    { titulo: 'Já pago', tipo: 'moeda', valor: (c) => c.pago },
    { titulo: 'Falta', tipo: 'moeda', valor: (c) => c.falta },
    { titulo: 'Vencimento', valor: (c) => dataBR(c.vencimento) },
    { titulo: 'Situação', valor: (c) => situacaoDoPrazo(c.vencimento) },
    { titulo: 'Observação da cobrança', valor: (c) => c.observacao_cobranca },
  ], emAberto(org.compras))

  return [
    [wsVendas, 'Estoque - Vendas'],
    [wsItens, 'Estoque - Itens vendidos'],
    [wsRecebimentos, 'Estoque - Recebimentos'],
    [wsCompras, 'Estoque - Compras'],
    [wsReceber, 'A receber (hoje)'],
    [wsPagar, 'A pagar (hoje)'],
  ]
}

// Abas do Estoque no backup completo (todas as colunas do banco + nomes ao lado dos ids)
function abasEstoqueCompletas(est, org) {
  const { produtoPorId, fornecedorPorId, clientePorId } = org
  const vendaPorId = porId(org.vendas)
  const compraPorId = porId(org.compras)
  const nomeProduto = (id) => produtoPorId[id]?.nome
  const nomeCliente = (id) => clientePorId[id]?.nome

  const ordenaPorData = (lista, campo) => [...lista].sort((a, b) => comparaTexto(b[campo], a[campo]))
  const vendasOrdenadas = ordenaPorData(est.vendas_estoque, 'data_venda')
  const comprasOrdenadas = ordenaPorData(est.compras_estoque, 'data_compra')

  return [
    [abaCrua([...est.fornecedores].sort((a, b) => comparaTexto(a.nome, b.nome))), 'Fornecedores'],
    [abaCrua([...est.produtos].sort((a, b) => comparaTexto(a.nome, b.nome)), [
      { titulo: 'Fornecedor', valor: (l) => fornecedorPorId[l.fornecedor_id]?.nome },
    ]), 'Produtos'],
    [abaCrua(comprasOrdenadas, [
      { titulo: 'Produto', valor: (l) => nomeProduto(l.produto_id) },
      { titulo: 'Fornecedor', valor: (l) => fornecedorPorId[l.fornecedor_id]?.nome },
      { titulo: 'Total', tipo: 'moeda', valor: (l) => compraPorId[l.id]?.total },
      { titulo: 'Pago', tipo: 'moeda', valor: (l) => compraPorId[l.id]?.pago },
      { titulo: 'Falta pagar', tipo: 'moeda', valor: (l) => Math.max(0, compraPorId[l.id]?.falta || 0) },
    ]), 'Compras (estoque)'],
    [abaCrua(ordenaPorData(est.pagamentos_compra, 'data_pagamento'), [
      { titulo: 'Produto da compra', valor: (l) => nomeProduto(compraPorId[l.compra_id]?.produto_id) },
      { titulo: 'Fornecedor', valor: (l) => compraPorId[l.compra_id]?.fornecedor },
      { titulo: 'Data da compra', valor: (l) => dataBR(compraPorId[l.compra_id]?.data_compra) },
    ]), 'Pagamentos de compras'],
    [abaCrua(vendasOrdenadas, [
      { titulo: 'Cliente', valor: (l) => nomeCliente(l.cliente_id) },
      { titulo: 'Produtos', valor: (l) => textoDosProdutos(vendaPorId[l.id]?.itens || [], produtoPorId) },
      { titulo: 'Total', tipo: 'moeda', valor: (l) => vendaPorId[l.id]?.total },
      { titulo: 'Custo da mercadoria', tipo: 'moeda', valor: (l) => vendaPorId[l.id]?.custo },
      { titulo: 'Pago', tipo: 'moeda', valor: (l) => vendaPorId[l.id]?.pago },
      { titulo: 'Falta receber', tipo: 'moeda', valor: (l) => Math.max(0, vendaPorId[l.id]?.falta || 0) },
    ]), 'Vendas (estoque)'],
    [abaCrua(est.venda_estoque_itens, [
      { titulo: 'Cliente', valor: (l) => nomeCliente(vendaPorId[l.venda_id]?.cliente_id) },
      { titulo: 'Data da venda', valor: (l) => dataBR(vendaPorId[l.venda_id]?.data_venda) },
      { titulo: 'Produto', valor: (l) => nomeProduto(l.produto_id) },
      { titulo: 'Total da linha', tipo: 'moeda', valor: (l) => arredonda2(Number(l.quantidade) * Number(l.preco_unitario)) },
    ]), 'Itens das vendas'],
    [abaCrua(ordenaPorData(est.pagamentos_venda, 'data_pagamento'), [
      { titulo: 'Cliente', valor: (l) => nomeCliente(vendaPorId[l.venda_id]?.cliente_id) },
      { titulo: 'Data da venda', valor: (l) => dataBR(vendaPorId[l.venda_id]?.data_venda) },
    ]), 'Pagamentos de vendas'],
    [abaCrua(ordenaPorData(est.retiradas_lucro, 'data_retirada')), 'Retiradas de lucro'],
    [abaCrua(est.metas_estoque, [
      { titulo: 'Produto', valor: (l) => nomeProduto(l.produto_id) },
      { titulo: 'Subtotal', tipo: 'moeda', valor: (l) => arredonda2(Number(l.quantidade) * Number(l.preco_unitario)) },
    ]), 'Metas (próxima compra)'],
    [abaCrua(ordenaPorData(est.lembretes, 'created_at'), [
      { titulo: 'Cliente', valor: (l) => nomeCliente(l.cliente_id) },
    ]), 'Lembretes'],
  ]
}

// ── Relatório do mês ──────────────────────────────────────────

async function gerarRelatorioMes() {
  const XLSX = window.XLSX
  const [ano, mes] = selectMes.value.split('-')
  const inicio = `${ano}-${mes}-01`
  const fim = `${ano}-${mes}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}`

  const [visitas, empresas, recebidos] = await Promise.all([
    ler('visitas', {
      select: '*, clientes(nome, cidade), itens_venda(id, valor, empresa_id, comissao_manual)',
      filtro: (q) => q.gte('data_visita', inicio).lte('data_visita', fim),
    }),
    ler('empresas'),
    ler('comissoes_recebidas', { filtro: (q) => q.eq('mes', parseInt(mes)).eq('ano', parseInt(ano)) }),
  ])

  // Estoque (revenda): se não der para ler, as abas dele são puladas e o resto sai normalmente
  avisoFinal = ''
  const est = await lerEstoque()
  const org = est.ok ? organizarEstoque(est) : null

  const empresaPorId = {}
  empresas.forEach((e) => { empresaPorId[e.id] = e })
  const recebidoPorEmpresa = {}
  recebidos.forEach((r) => { recebidoPorEmpresa[r.empresa_id] = r })

  visitas.sort((a, b) => comparaTexto(a.data_visita, b.data_visita) || comparaTexto(a.clientes?.nome, b.clientes?.nome))

  // Totais no mesmo formato do Dashboard (vendido líquido do desconto da visita)
  let totalVendido = 0
  let totalComissao = 0
  const porEmpresa = {}
  const itensDeVenda = []

  const linhasVisitas = visitas.map((v) => {
    const itens = v.itens_venda || []
    const subtotal = itens.reduce((s, it) => s + (it.valor || 0), 0)
    const desconto = v.comprou ? (v.desconto_aplicado || 0) : 0
    const total = v.comprou ? Math.max(0, subtotal - desconto) : 0

    if (v.comprou) {
      totalVendido += total
      itens.forEach((it) => {
        const empresa = empresaPorId[it.empresa_id]
        const comissao = comissaoDoItem(it, empresa?.percentual_comissao)
        totalComissao += comissao
        itensDeVenda.push({ visita: v, item: it, empresa, comissao })
        if (it.empresa_id) {
          porEmpresa[it.empresa_id] = porEmpresa[it.empresa_id] || { vendido: 0, comissao: 0 }
          porEmpresa[it.empresa_id].vendido += it.valor || 0
          porEmpresa[it.empresa_id].comissao += comissao
        }
      })
    }
    return { v, subtotal, desconto, total }
  })

  const compraram = visitas.filter((v) => v.comprou).length
  let comissaoRecebida = 0
  let comissaoAReceber = 0
  empresas.forEach((e) => {
    const c = porEmpresa[e.id]?.comissao || 0
    if (c <= 0) return
    if (recebidoPorEmpresa[e.id]?.recebido) comissaoRecebida += c
    else comissaoAReceber += c
  })

  // Aba Resumo
  const nomeMes = new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const resumo = [
    ['Relatório do mês', celula(nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1))],
    [],
    ['Visitas no mês', celula(visitas.length, 'numero')],
    ['Visitas em que comprou', celula(compraram, 'numero')],
    ['Taxa de conversão', celula(visitas.length ? (compraram / visitas.length) * 100 : 0, 'percentual')],
    ['Total vendido (já sem o desconto da visita)', celula(totalVendido, 'moeda')],
    ['Comissão estimada', celula(totalComissao, 'moeda')],
    ['Comissão já recebida', celula(comissaoRecebida, 'moeda')],
    ['Comissão ainda a receber', celula(comissaoAReceber, 'moeda')],
    ...(org ? linhasResumoEstoque(est, org, inicio, fim) : []),
    [],
    ['Gerado em', celula(new Date().toLocaleString('pt-BR'))],
  ]
  const wsResumo = XLSX.utils.aoa_to_sheet(resumo)
  wsResumo['!cols'] = [{ wch: 44 }, { wch: 24 }]

  // Aba Comissão por empresa (todas as empresas, como na tela Empresas)
  const empresasOrdenadas = [...empresas].sort((a, b) => comparaTexto(a.nome, b.nome))
  const linhasEmpresas = empresasOrdenadas.map((e) => ({
    empresa: e,
    vendido: porEmpresa[e.id]?.vendido || 0,
    comissao: porEmpresa[e.id]?.comissao || 0,
    recebido: recebidoPorEmpresa[e.id],
  }))
  const wsEmpresas = montarAba([
    { titulo: 'Empresa', valor: (l) => l.empresa.nome },
    { titulo: '% de comissão', tipo: 'percentual', valor: (l) => l.empresa.percentual_comissao },
    { titulo: 'Vendido', tipo: 'moeda', valor: (l) => l.vendido },
    { titulo: 'Comissão', tipo: 'moeda', valor: (l) => l.comissao },
    { titulo: 'Recebida?', valor: (l) => (l.comissao > 0 ? simNao(l.recebido?.recebido) : '') },
    { titulo: 'Recebida em', valor: (l) => (l.recebido?.recebido ? dataHoraBR(l.recebido.recebido_em) : '') },
  ], linhasEmpresas)

  // Aba Vendas (uma linha por item vendido)
  const wsVendas = montarAba([
    { titulo: 'Data', valor: (l) => dataBR(l.visita.data_visita) },
    { titulo: 'Cliente', valor: (l) => l.visita.clientes?.nome },
    { titulo: 'Cidade', valor: (l) => l.visita.clientes?.cidade },
    { titulo: 'Empresa', valor: (l) => l.empresa?.nome },
    { titulo: 'Valor', tipo: 'moeda', valor: (l) => l.item.valor },
    { titulo: 'Comissão', tipo: 'moeda', valor: (l) => l.comissao },
    { titulo: 'Como foi calculada', valor: (l) => (
      l.item.comissao_manual !== null && l.item.comissao_manual !== undefined
        ? 'Valor digitado'
        : `${l.empresa?.percentual_comissao || 0}% do valor`
    ) },
  ], itensDeVenda)

  // Aba Visitas (todas, inclusive as sem compra)
  const wsVisitas = montarAba([
    { titulo: 'Data', valor: (l) => dataBR(l.v.data_visita) },
    { titulo: 'Cliente', valor: (l) => l.v.clientes?.nome },
    { titulo: 'Cidade', valor: (l) => l.v.clientes?.cidade },
    { titulo: 'Comprou?', valor: (l) => simNao(l.v.comprou) },
    { titulo: 'Subtotal', tipo: 'moeda', valor: (l) => (l.v.comprou ? l.subtotal : null) },
    { titulo: 'Desconto', tipo: 'moeda', valor: (l) => (l.v.comprou ? l.desconto : null) },
    { titulo: 'Total', tipo: 'moeda', valor: (l) => (l.v.comprou ? l.total : null) },
    { titulo: 'Observação', valor: (l) => l.v.observacao },
  ], linhasVisitas)

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo')
  XLSX.utils.book_append_sheet(wb, wsEmpresas, 'Comissão por empresa')
  XLSX.utils.book_append_sheet(wb, wsVendas, 'Vendas')
  XLSX.utils.book_append_sheet(wb, wsVisitas, 'Visitas')
  if (org) abasEstoqueDoMes(est, org, inicio, fim).forEach(([ws, nome]) => XLSX.utils.book_append_sheet(wb, ws, nome))
  baixar(wb, `relatorio-${ano}-${mes}.xlsx`)
}

// ── Backup completo ───────────────────────────────────────────

async function gerarBackupCompleto() {
  const XLSX = window.XLSX

  const [clientes, empresas, visitas, itens, rotas, rotaClientes, agendamentos, cidadesOrdem, recebidas] = await Promise.all([
    ler('clientes'),
    ler('empresas'),
    ler('visitas'),
    ler('itens_venda'),
    ler('rotas'),
    ler('rota_clientes'),
    ler('rota_agendamentos'),
    ler('cidades_ordem'),
    ler('comissoes_recebidas'),
  ])

  const clientePorId = {}
  clientes.forEach((c) => { clientePorId[c.id] = c })
  const empresaPorId = {}
  empresas.forEach((e) => { empresaPorId[e.id] = e })
  const visitaPorId = {}
  visitas.forEach((v) => { visitaPorId[v.id] = v })
  const rotaPorId = {}
  rotas.forEach((r) => { rotaPorId[r.id] = r })
  const nomeRota = (id) => {
    const r = rotaPorId[id]
    return r ? `${r.cidade || ''} — ${r.nome || ''}` : ''
  }

  clientes.sort((a, b) => comparaTexto(a.nome, b.nome))
  empresas.sort((a, b) => comparaTexto(a.nome, b.nome))
  visitas.sort((a, b) => comparaTexto(b.data_visita, a.data_visita)) // mais recentes primeiro
  rotas.sort((a, b) => comparaTexto(a.cidade, b.cidade) || comparaTexto(a.nome, b.nome))
  agendamentos.sort((a, b) => comparaTexto(a.data, b.data))
  cidadesOrdem.sort((a, b) => (a.ordem || 0) - (b.ordem || 0))

  const wb = XLSX.utils.book_new()
  const add = (ws, nome) => XLSX.utils.book_append_sheet(wb, ws, nome)

  add(abaCrua(clientes), 'Clientes')
  add(abaCrua(empresas), 'Empresas')
  add(abaCrua(visitas, [
    { titulo: 'Cliente', valor: (l) => clientePorId[l.cliente_id]?.nome },
    { titulo: 'Cidade', valor: (l) => clientePorId[l.cliente_id]?.cidade },
  ]), 'Visitas')
  add(abaCrua(itens, [
    { titulo: 'Data da visita', valor: (l) => dataBR(visitaPorId[l.visita_id]?.data_visita) },
    { titulo: 'Cliente', valor: (l) => clientePorId[visitaPorId[l.visita_id]?.cliente_id]?.nome },
    { titulo: 'Empresa', valor: (l) => empresaPorId[l.empresa_id]?.nome },
  ]), 'Itens de venda')
  add(abaCrua(rotas), 'Rotas')
  add(abaCrua(rotaClientes, [
    { titulo: 'Rota', valor: (l) => nomeRota(l.rota_id) },
    { titulo: 'Cliente', valor: (l) => clientePorId[l.cliente_id]?.nome },
  ]), 'Clientes das rotas')
  add(abaCrua(agendamentos, [
    { titulo: 'Rota', valor: (l) => nomeRota(l.rota_id) },
  ]), 'Datas das rotas')
  add(abaCrua(cidadesOrdem), 'Ordem das cidades')
  add(abaCrua(recebidas, [
    { titulo: 'Empresa', valor: (l) => empresaPorId[l.empresa_id]?.nome },
  ]), 'Comissões recebidas')

  // Estoque (revenda) e Lembretes: se não der para ler, são pulados e o aviso aparece no fim
  avisoFinal = ''
  const est = await lerEstoque()
  if (est.ok) abasEstoqueCompletas(est, organizarEstoque(est)).forEach(([ws, nome]) => add(ws, nome))

  baixar(wb, `backup-${dataLocalStr(new Date())}.xlsx`)
}

// ── Botões ────────────────────────────────────────────────────

async function executar(botao, tarefa) {
  const textoOriginal = botao.textContent
  btnMes.disabled = true
  btnBackup.disabled = true
  botao.textContent = 'Gerando…'
  try {
    await carregarBiblioteca()
    await tarefa()
    if (avisoFinal) alert(avisoFinal)
  } catch (err) {
    console.error('Erro ao gerar o Excel:', err)
    alert(`Não foi possível gerar o arquivo Excel. ${err.message || ''} Confira a conexão e tente de novo.`)
  } finally {
    botao.textContent = textoOriginal
    btnMes.disabled = false
    btnBackup.disabled = false
  }
}

btnMes?.addEventListener('click', () => executar(btnMes, gerarRelatorioMes))
btnBackup?.addEventListener('click', () => executar(btnBackup, gerarBackupCompleto))
