// Relatório do mês e cópia de segurança em Excel (.xlsx), pelos botões do Dashboard.
//
// SÓ LEITURA: este arquivo apenas consulta o Supabase e monta a planilha no
// navegador. Não grava, altera nem apaga nada no banco.
//
// A biblioteca que gera o .xlsx (ExcelJS) só é baixada quando alguém clica num dos
// botões, então não pesa no carregamento do app.
//
// Os dois arquivos são feitos para SEREM LIDOS por uma pessoa:
//   • Relatório do mês: resumo claro + vendas, recebimentos, compras e o que está em aberto.
//   • Cópia de segurança: tudo o que está cadastrado, com nomes em português, datas
//     dd/mm/aaaa e sem códigos técnicos, com uma aba "Leia-me" explicando cada aba.
// Cores das abas: azul = empresas que ele representa · verde = estoque (revenda) · cinza = clientes e rotas.

import { buscarTodasLinhas } from './supabase.js'
import { calcularCarteira, sobraDaMeta } from './carteira.js'

const URL_EXCELJS = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js'
const SRI_EXCELJS = 'sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw=='

const btnMes = document.getElementById('btnExcelMes')
const btnBackup = document.getElementById('btnBackupCompleto')
const selectMes = document.getElementById('selectMes')

// ── Biblioteca ────────────────────────────────────────────────

let promessaExcelJS = null

function carregarBiblioteca() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS)
  if (!promessaExcelJS) {
    promessaExcelJS = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = URL_EXCELJS
      s.integrity = SRI_EXCELJS
      s.crossOrigin = 'anonymous'
      s.onload = () => resolve(window.ExcelJS)
      s.onerror = () => {
        promessaExcelJS = null // permite tentar de novo no próximo clique
        reject(new Error('Não foi possível carregar a biblioteca do Excel (sem internet?).'))
      }
      document.head.appendChild(s)
    })
  }
  return promessaExcelJS
}

// ── Leitura do banco ──────────────────────────────────────────

// Ordena por "id" (único), porque ordenar por uma coluna que repete (ex.: nome)
// pode duplicar ou pular linhas entre uma página e outra. Se a tabela não tiver
// "id" (erro 42703), busca sem ordem; as abas ordenam depois, em JavaScript.
async function ler(tabela, opcoes = {}) {
  let r = await buscarTodasLinhas(tabela, { order: 'id', ...opcoes })
  if (r.error?.code === '42703') r = await buscarTodasLinhas(tabela, opcoes)
  if (r.error) {
    console.error(`Erro ao ler ${tabela}:`, r.error)
    throw new Error(`Não foi possível ler "${tabela}".`)
  }
  return r.data
}

// ── Utilidades ────────────────────────────────────────────────

const comparaTexto = (a, b) => String(a || '').localeCompare(String(b || ''), 'pt-BR')
const arredonda2 = (v) => Math.round((Number(v) || 0) * 100) / 100
const somar = (lista, f) => lista.reduce((s, x) => s + f(x), 0)
const agrupar = (lista, chave) => lista.reduce((m, x) => { (m[x[chave]] = m[x[chave]] || []).push(x); return m }, {})
const porId = (lista) => Object.fromEntries(lista.map((x) => [x.id, x]))
const FORMA = { pix: 'Pix', dinheiro: 'Dinheiro' }
const dataBR = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '')

function dataLocalStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Mesma regra de comissão do Dashboard e de Empresas: o valor digitado à mão,
// se existir; senão, valor × percentual da empresa.
function comissaoDoItem(item, percentual) {
  if (item.comissao_manual !== null && item.comissao_manual !== undefined) return item.comissao_manual
  return (item.valor || 0) * ((percentual || 0) / 100)
}

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

// ── Visual do Excel ───────────────────────────────────────────

const COR = { azul: 'FF3D7EA6', verde: 'FF2E8B6A', cinza: 'FF6C8A9C' }
const TEXTO_ESCURO = 'FF1F3B4D'
const TEXTO_SUAVE = 'FF6C8A9C'
const LINHA_ZEBRA = 'FFF5FAFD'
const BORDA = { style: 'thin', color: { argb: 'FFD5E3EE' } }
const FORMATO_MOEDA = '"R$" #,##0.00'

// Data "AAAA-MM-DD" (ou um carimbo de data/hora) -> Date em UTC à meia-noite, para o Excel
// mostrar exatamente o mesmo dia (sem "virar o dia" por fuso) e poder ordenar/filtrar por data.
function paraDataExcel(valor) {
  const texto = String(valor)
  const m = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  const d = new Date(texto)
  if (Number.isNaN(d.getTime())) return null
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) // dia no fuso local
}

// Escreve um valor numa célula, conforme o tipo da coluna
function escreverCelula(cell, tipo, valor) {
  if (valor === null || valor === undefined || valor === '') { cell.value = null; return }
  switch (tipo) {
    case 'moeda':
      cell.value = Number(valor) || 0
      cell.numFmt = FORMATO_MOEDA
      break
    case 'percentual':
      cell.value = (Number(valor) || 0) / 100 // o Excel guarda 10% como 0,10
      cell.numFmt = '0.0%'
      break
    case 'data': {
      const d = paraDataExcel(valor)
      if (d) { cell.value = d; cell.numFmt = 'dd/mm/yyyy' } else cell.value = String(valor)
      cell.alignment = { vertical: 'top', horizontal: 'left' }
      break
    }
    case 'numero':
      cell.value = Number(valor)
      break
    case 'simnao':
      cell.value = valor ? 'Sim' : 'Não'
      cell.alignment = { vertical: 'top', horizontal: 'center' }
      break
    default:
      cell.value = String(valor)
      cell.alignment = { vertical: 'top', wrapText: true }
  }
}

function larguraDoTexto(tipo, valor) {
  if (valor === null || valor === undefined || valor === '') return 0
  if (tipo === 'moeda') return 14
  if (tipo === 'data') return 11
  if (tipo === 'simnao') return 5
  if (tipo === 'percentual') return 8
  return String(valor).length
}

function letraDaColuna(n) { // 1 -> A, 27 -> AA
  let s = ''
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}

// Uma aba de tabela: título, descrição, cabeçalho colorido, linhas com listras, linha fixa
// no topo, filtro, larguras certas e (opcional) linha de total.
// colunas: [{ titulo, valor: (linha) => ..., tipo?, soma?, opcional? }]
//   tipo: 'moeda' | 'percentual' | 'data' | 'numero' | 'simnao' | texto (padrão)
//   soma: mostra o total da coluna no fim (com SUBTOTAL, que respeita o filtro)
//   opcional: a coluna some se estiver vazia em todas as linhas
function adicionarAba(wb, { nome, cor, titulo, descricao, colunas, linhas, aposLinha }) {
  const todas = colunas
  colunas = todas.filter((c) => !c.opcional || linhas.some((l) => {
    const v = c.valor(l)
    return v !== null && v !== undefined && v !== ''
  }))
  const nCol = Math.max(colunas.length, 1)
  const ws = wb.addWorksheet(nome, {
    properties: { tabColor: { argb: COR[cor] } },
    views: [{ state: 'frozen', ySplit: 3, showGridLines: false }],
  })

  // Título e descrição (linhas 1 e 2)
  const largura = Math.max(nCol, 4)
  ws.mergeCells(1, 1, 1, largura)
  ws.getCell(1, 1).value = titulo
  ws.getCell(1, 1).font = { bold: true, size: 15, color: { argb: TEXTO_ESCURO } }
  ws.getCell(1, 1).alignment = { vertical: 'middle' }
  ws.getRow(1).height = 26
  ws.mergeCells(2, 1, 2, largura)
  ws.getCell(2, 1).value = descricao || ''
  ws.getCell(2, 1).font = { italic: true, size: 10, color: { argb: TEXTO_SUAVE } }
  ws.getCell(2, 1).alignment = { vertical: 'top', wrapText: true }
  ws.getRow(2).height = 30

  // Cabeçalho (linha 3)
  const cab = ws.getRow(3)
  cab.height = 32
  colunas.forEach((c, i) => {
    const cell = cab.getCell(i + 1)
    cell.value = c.titulo
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR[cor] } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = { bottom: BORDA }
  })

  // Linhas
  const maiores = colunas.map((c) => c.titulo.length)
  linhas.forEach((l, idx) => {
    const row = ws.getRow(4 + idx)
    colunas.forEach((c, i) => {
      const valor = c.valor(l)
      const cell = row.getCell(i + 1)
      escreverCelula(cell, c.tipo, valor)
      cell.border = { bottom: BORDA }
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LINHA_ZEBRA } }
      maiores[i] = Math.max(maiores[i], larguraDoTexto(c.tipo, valor))
    })
    if (aposLinha) aposLinha(row, l, colunas)
  })

  const primeira = 4
  const ultima = 3 + linhas.length

  if (linhas.length === 0) {
    ws.mergeCells(4, 1, 4, largura)
    ws.getCell(4, 1).value = 'Nenhum registro.'
    ws.getCell(4, 1).font = { italic: true, color: { argb: TEXTO_SUAVE } }
  } else {
    // Total no fim (SUBTOTAL 109 = soma só do que está visível depois de filtrar)
    if (colunas.some((c) => c.soma)) {
      const linhaTotal = ws.getRow(ultima + 1)
      const rotulo = linhaTotal.getCell(1)
      rotulo.value = 'Total'
      rotulo.font = { bold: true }
      colunas.forEach((c, i) => {
        const cell = linhaTotal.getCell(i + 1)
        cell.border = { top: { style: 'medium', color: { argb: COR[cor] } } }
        if (!c.soma) return
        const letra = letraDaColuna(i + 1)
        cell.value = { formula: `SUBTOTAL(109,${letra}${primeira}:${letra}${ultima})`, result: arredonda2(somar(linhas, (l) => Number(c.valor(l)) || 0)) }
        cell.numFmt = FORMATO_MOEDA
        cell.font = { bold: true }
      })
    }
    // Filtro em cada coluna do cabeçalho
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: colunas.length } }
  }

  // Larguras (com limite, para colunas de texto comprido quebrarem a linha)
  colunas.forEach((c, i) => { ws.getColumn(i + 1).width = Math.min(48, Math.max(11, maiores[i] + 3)) })

  // Impressão: paisagem, cabendo na largura da folha, cabeçalho repetido em cada página
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '3:3' }
  return ws
}

// Aba de resumo: blocos coloridos com "rótulo · valor · explicação"
// blocos: [{ titulo, cor, linhas: [{ rotulo, valor?, tipo?, nota? }] }]
function adicionarResumo(wb, { nome, titulo, subtitulo, blocos, rodape, cor = 'azul' }) {
  const ws = wb.addWorksheet(nome, {
    properties: { tabColor: { argb: COR[cor] } },
    views: [{ showGridLines: false }],
  })
  ws.getColumn(1).width = 44
  ws.getColumn(2).width = 22
  ws.getColumn(3).width = 70

  ws.mergeCells(1, 1, 1, 3)
  ws.getCell(1, 1).value = titulo
  ws.getCell(1, 1).font = { bold: true, size: 18, color: { argb: TEXTO_ESCURO } }
  ws.getRow(1).height = 32
  if (subtitulo) {
    ws.mergeCells(2, 1, 2, 3)
    ws.getCell(2, 1).value = subtitulo
    ws.getCell(2, 1).font = { italic: true, size: 10, color: { argb: TEXTO_SUAVE } }
  }

  let linha = 4
  blocos.forEach((bloco) => {
    ws.mergeCells(linha, 1, linha, 3)
    const faixa = ws.getCell(linha, 1)
    faixa.value = bloco.titulo
    faixa.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
    faixa.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR[bloco.cor] } }
    faixa.alignment = { vertical: 'middle', indent: 1 }
    ws.getRow(linha).height = 24
    linha += 1

    bloco.linhas.forEach((l, idx) => {
      const rotulo = ws.getCell(linha, 1)
      rotulo.value = l.rotulo
      rotulo.alignment = { vertical: 'middle', indent: 1, wrapText: true }
      // Linha só de explicação (sem valor): o texto ocupa as colunas 2 e 3
      const soExplicacao = l.valor === undefined && !l.tipo
      if (soExplicacao) {
        ws.mergeCells(linha, 2, linha, 3)
        const texto = ws.getCell(linha, 2)
        texto.value = l.nota || ''
        texto.font = { size: 10, color: { argb: TEXTO_ESCURO } }
        texto.alignment = { vertical: 'middle', wrapText: true, indent: 1 }
      } else {
        const valor = ws.getCell(linha, 2)
        escreverCelula(valor, l.tipo, l.valor)
        valor.font = { bold: true, size: 12, color: { argb: TEXTO_ESCURO } }
        valor.alignment = { vertical: 'middle', horizontal: 'right' }
        const nota = ws.getCell(linha, 3)
        nota.value = l.nota || ''
        nota.font = { italic: true, size: 10, color: { argb: TEXTO_SUAVE } }
        nota.alignment = { vertical: 'middle', wrapText: true, indent: 1 }
      }
      for (let c = 1; c <= 3; c++) {
        const cell = ws.getCell(linha, c)
        cell.border = { bottom: BORDA }
        if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LINHA_ZEBRA } }
      }
      const limite = soExplicacao ? 100 : 75
      ws.getRow(linha).height = l.nota && l.nota.length > limite ? 32 : 22
      linha += 1
    })
    linha += 1 // linha em branco entre os blocos
  })

  if (rodape) {
    ws.mergeCells(linha, 1, linha, 3)
    ws.getCell(linha, 1).value = rodape
    ws.getCell(linha, 1).font = { italic: true, size: 10, color: { argb: TEXTO_SUAVE } }
  }
  ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  return ws
}

async function baixar(wb, nomeArquivo) {
  const buffer = await wb.xlsx.writeBuffer()
  if (window.__salvarArquivo) { window.__salvarArquivo(buffer, nomeArquivo); return } // gancho dos testes
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// ── Estoque (revenda) e Lembretes ─────────────────────────────

const TABELAS_ESTOQUE = [
  'fornecedores', 'produtos', 'compras_estoque', 'pagamentos_compra', 'vendas_estoque',
  'venda_estoque_itens', 'pagamentos_venda', 'retiradas_lucro', 'metas_estoque', 'lembretes',
  'entregas', 'entrega_paradas', 'entrega_itens',
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
    // Acertos da carteira: se não der para ler, só as linhas da carteira ficam de fora (o resto sai normal)
    (async () => { try { return ['carteira_acertos', await ler('carteira_acertos')] } catch { return ['carteira_acertos', []] } })(),
  ])
  const dados = Object.fromEntries(pares)
  const falhas = Object.keys(dados).filter((t) => dados[t] === null)
  if (falhas.length) avisoFinal = `As abas do Estoque não foram incluídas porque não consegui ler: ${falhas.join(', ')}. O restante do arquivo está completo.`
  return { ...dados, falhas, ok: falhas.length === 0 }
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

  // Entregas: cada uma com as suas paradas (clientes) e o que levar em cada
  const paradasPorEntrega = agrupar(est.entrega_paradas, 'entrega_id')
  const itensPorParada = agrupar(est.entrega_itens, 'parada_id')
  const entregas = est.entregas.map((e) => ({
    ...e,
    paradas: [...(paradasPorEntrega[e.id] || [])]
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
      .map((p) => ({ ...p, cliente: clientePorId[p.cliente_id]?.nome || '', itens: itensPorParada[p.id] || [] })),
  }))
  const entregaPorVenda = {}
  entregas.forEach((e) => e.paradas.forEach((p) => { if (p.venda_id) entregaPorVenda[p.venda_id] = e }))
  // De onde veio cada venda: de uma visita, de uma entrega ou "avulsa"
  vendas.forEach((v) => {
    v.origem = v.visita_id ? 'Visita' : entregaPorVenda[v.id] ? `Entrega: ${entregaPorVenda[v.id].nome || 'sem nome'}` : 'Avulsa'
  })

  return { produtoPorId, fornecedorPorId, clientePorId, vendas, compras, saldo, entregas }
}

// Situação de uma entrega: concluída, sem dia marcado, atrasada, hoje ou com dia marcado
function situacaoDaEntrega(ent) {
  if (!ent.paradas.some((p) => !p.feita)) return 'Concluída'
  if (!ent.data_entrega) return 'Sem dia marcado'
  const dias = diasAte(ent.data_entrega)
  if (dias < 0) return 'Atrasada'
  return dias === 0 ? 'É hoje' : 'Dia marcado'
}

const textoDosItensDaParada = (itens, produtoPorId) =>
  itens.map((i) => `${produtoPorId[i.produto_id]?.nome || 'produto'} × ${Number(i.quantidade)}`).join('; ')

const textoDosProdutos = (itens, produtoPorId) =>
  itens.map((i) => `${produtoPorId[i.produto_id]?.nome || 'produto'} × ${Number(i.quantidade)}`).join('; ')

// Números do Estoque no mês (os mesmos dos cards do Dashboard)
function numerosDoEstoque(est, org, inicio, fim) {
  const vendidoNoMes = somar(org.vendas.filter((v) => v.data_venda >= inicio && v.data_venda <= fim), (v) => v.total)
  let lucroDoMes = 0
  org.vendas.forEach((v) => lucroPorPagamento(v).forEach((x) => {
    const dia = String(x.pagamento.data_pagamento).slice(0, 10)
    if (dia >= inicio && dia <= fim) lucroDoMes += x.lucro
  }))
  const retiradoNoMes = somar(est.retiradas_lucro.filter((r) => r.data_retirada >= inicio && r.data_retirada <= fim), (r) => Number(r.valor))
  // Carteira e "pode retirar": a mesma conta dos cards do Dashboard (js/carteira.js)
  const meta = arredonda2(somar(est.metas_estoque, (m) => Number(m.quantidade) * Number(m.preco_unitario)))
  const carteira = calcularCarteira({
    acertos: est.carteira_acertos || [],
    pagamentosVenda: est.pagamentos_venda,
    pagamentosCompra: est.pagamentos_compra,
    retiradas: est.retiradas_lucro,
  })
  const sobra = carteira ? sobraDaMeta(carteira.saldo, meta) : null
  return {
    carteira,
    podeRetirar: sobra ? sobra.podeRetirar : 0,
    faltaParaMeta: sobra ? sobra.falta : 0,
    valorEstoque: arredonda2(somar(est.produtos, (p) => Math.max(0, org.saldo[p.id] || 0) * Number(p.preco_custo))),
    vendidoNoMes: arredonda2(vendidoNoMes),
    lucroDoMes: arredonda2(lucroDoMes),
    retiradoNoMes: arredonda2(retiradoNoMes),
    aReceber: arredonda2(somar(org.vendas.filter((v) => v.falta > 0.004), (v) => v.falta)),
    aPagar: arredonda2(somar(org.compras.filter((c) => c.falta > 0.004), (c) => c.falta)),
    entregasPendentes: org.entregas.filter((e) => situacaoDaEntrega(e) !== 'Concluída').length,
    entregasSemDia: org.entregas.filter((e) => situacaoDaEntrega(e) === 'Sem dia marcado').length,
    entregasAtrasadas: org.entregas.filter((e) => situacaoDaEntrega(e) === 'Atrasada').length,
  }
}

// Destaca em cores a coluna "Situação" (vencida em vermelho, vence hoje em laranja)
function destacarSituacao(indice) {
  return (row) => {
    const cell = row.getCell(indice + 1)
    const texto = String(cell.value || '')
    if (texto.startsWith('Venceu')) cell.font = { bold: true, color: { argb: 'FFB03A3A' } }
    else if (texto === 'Vence hoje') cell.font = { bold: true, color: { argb: 'FFA24F00' } }
  }
}

// Cores da coluna "Situação" das entregas (sem dia ou atrasada em destaque)
function destacarSituacaoEntrega(indice) {
  return (row) => {
    const cell = row.getCell(indice + 1)
    const texto = String(cell.value || '')
    if (texto === 'Atrasada') cell.font = { bold: true, color: { argb: 'FFB03A3A' } }
    else if (texto === 'Sem dia marcado' || texto === 'É hoje') cell.font = { bold: true, color: { argb: 'FFA24F00' } }
  }
}

// ── Relatório do mês ──────────────────────────────────────────

async function gerarRelatorioMes() {
  const ExcelJS = window.ExcelJS
  const [ano, mes] = selectMes.value.split('-')
  const inicio = `${ano}-${mes}-01`
  const fim = `${ano}-${mes}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}`
  const noMes = (d) => d >= inicio && d <= fim

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

  const empresaPorId = porId(empresas)
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

  const nomeMes = new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const nomeMesBonito = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Planilha Inteligente'
  wb.created = new Date()

  // ── Resumo ──
  const guia = [
    { rotulo: 'Resumo', nota: 'Esta página.' },
    { rotulo: 'Comissão por empresa', nota: 'Quanto vendeu e quanto tem de comissão em cada empresa que você representa, e se já recebeu.' },
    { rotulo: 'Vendas das empresas', nota: 'Cada item vendido das empresas que você representa, com a comissão dele.' },
    { rotulo: 'Visitas', nota: 'Todas as visitas do mês, compraram ou não.' },
  ]
  if (org) {
    guia.push(
      { rotulo: 'Estoque - Vendas', nota: 'Cada venda de produto do seu estoque no mês: total, quanto já foi pago e quanto falta.' },
      { rotulo: 'Estoque - Recebimentos', nota: 'O dinheiro que entrou no mês das vendas de estoque e o lucro que cada recebimento liberou.' },
      { rotulo: 'Estoque - Compras', nota: 'O que você comprou dos fornecedores no mês, o que já pagou e o que falta.' },
      { rotulo: 'Em aberto', nota: 'Fotografia de HOJE: quem ainda te deve e o que você ainda deve (de qualquer mês).' },
      { rotulo: 'Entregas pendentes', nota: 'As entregas que ainda faltam fazer, com o que levar para cada cliente e se estão sem dia ou atrasadas.' },
    )
  }
  const blocos = [
    {
      titulo: 'Empresas que eu represento', cor: 'azul', linhas: [
        { rotulo: 'Visitas no mês', valor: visitas.length, tipo: 'numero' },
        { rotulo: 'Visitas em que a loja comprou', valor: compraram, tipo: 'numero' },
        { rotulo: 'Taxa de conversão', valor: visitas.length ? (compraram / visitas.length) * 100 : 0, tipo: 'percentual', nota: 'Das visitas, quantas viraram compra.' },
        { rotulo: 'Total vendido', valor: totalVendido, tipo: 'moeda', nota: 'Já sem o desconto fixo do cliente.' },
        { rotulo: 'Comissão estimada', valor: totalComissao, tipo: 'moeda' },
        { rotulo: 'Comissão já recebida', valor: comissaoRecebida, tipo: 'moeda' },
        { rotulo: 'Comissão ainda a receber', valor: comissaoAReceber, tipo: 'moeda' },
      ],
    },
  ]
  if (org) {
    const n = numerosDoEstoque(est, org, inicio, fim)
    blocos.push({
      titulo: 'Meu estoque (revenda)', cor: 'verde', linhas: [
        { rotulo: 'Mercadoria em estoque', valor: n.valorEstoque, tipo: 'moeda', nota: 'O que você tem parado hoje, pelo preço de custo.' },
        { rotulo: 'Vendido de produtos no mês', valor: n.vendidoNoMes, tipo: 'moeda', nota: 'Conta na hora da venda, mesmo que o cliente ainda não tenha pago.' },
        { rotulo: 'Lucro recebido no mês', valor: n.lucroDoMes, tipo: 'moeda', nota: 'Só do dinheiro que já entrou. O pagamento cobre primeiro o custo; o que passar disso é lucro.' },
        { rotulo: 'Retirado no mês', valor: n.retiradoNoMes, tipo: 'moeda', nota: 'Lucro que você tirou para você neste mês.' },
        ...(n.carteira ? [
          { rotulo: 'Na carteira (dinheiro + Pix)', valor: n.carteira.saldo, tipo: 'moeda', nota: 'O valor do último "Acertar", mais as vendas recebidas, menos as compras pagas e as retiradas depois dele.' },
          {
            rotulo: 'Pode retirar agora', valor: n.podeRetirar, tipo: 'moeda',
            nota: n.faltaParaMeta > 0
              ? `Nada sobra: faltam ${n.faltaParaMeta.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} para a próxima meta.`
              : 'O que a carteira tem acima da próxima meta.',
          },
        ] : []),
        { rotulo: 'Clientes ainda me devem', valor: n.aReceber, tipo: 'moeda', nota: 'Em aberto hoje, de qualquer mês.' },
        { rotulo: 'Eu ainda devo aos fornecedores', valor: n.aPagar, tipo: 'moeda', nota: 'Em aberto hoje, de qualquer mês.' },
        {
          rotulo: 'Entregas pendentes', valor: n.entregasPendentes, tipo: 'numero',
          nota: [n.entregasSemDia ? `${n.entregasSemDia} sem dia marcado` : '', n.entregasAtrasadas ? `${n.entregasAtrasadas} ${n.entregasAtrasadas === 1 ? 'atrasada' : 'atrasadas'}` : ''].filter(Boolean).join(' · ') || 'Todas com dia marcado.',
        },
      ],
    })
  }
  blocos.push({ titulo: 'O que tem em cada aba', cor: 'cinza', linhas: guia })
  adicionarResumo(wb, {
    nome: 'Resumo',
    titulo: `Relatório do mês: ${nomeMesBonito}`,
    subtitulo: `Gerado em ${new Date().toLocaleString('pt-BR')}. Os valores são os reais do seu cadastro; não compartilhe este arquivo.`,
    blocos,
  })

  // ── Empresas que representa ──
  adicionarAba(wb, {
    nome: 'Comissão por empresa', cor: 'azul',
    titulo: `Comissão por empresa: ${nomeMesBonito}`,
    descricao: 'Todas as empresas que você representa, mesmo as sem venda no mês. "Recebida" aparece quando você marca na tela Empresas.',
    linhas: [...empresas].sort((a, b) => comparaTexto(a.nome, b.nome)).map((e) => ({
      empresa: e, vendido: porEmpresa[e.id]?.vendido || 0, comissao: porEmpresa[e.id]?.comissao || 0, recebido: recebidoPorEmpresa[e.id],
    })),
    colunas: [
      { titulo: 'Empresa', valor: (l) => l.empresa.nome },
      { titulo: '% de comissão', tipo: 'percentual', valor: (l) => l.empresa.percentual_comissao },
      { titulo: 'Vendido', tipo: 'moeda', soma: true, valor: (l) => l.vendido },
      { titulo: 'Comissão', tipo: 'moeda', soma: true, valor: (l) => l.comissao },
      { titulo: 'Já recebi?', tipo: 'texto', valor: (l) => (l.comissao > 0 ? (l.recebido?.recebido ? 'Sim' : 'Não') : '') },
      { titulo: 'Recebida em', tipo: 'data', valor: (l) => (l.recebido?.recebido ? l.recebido.recebido_em : '') },
    ],
  })

  adicionarAba(wb, {
    nome: 'Vendas das empresas', cor: 'azul',
    titulo: `Vendas das empresas: ${nomeMesBonito}`,
    descricao: 'Um item por linha. A comissão é o valor digitado na visita ou, se não houve, o percentual da empresa sobre o valor.',
    linhas: itensDeVenda,
    colunas: [
      { titulo: 'Data', tipo: 'data', valor: (l) => l.visita.data_visita },
      { titulo: 'Cliente', valor: (l) => l.visita.clientes?.nome },
      { titulo: 'Cidade', valor: (l) => l.visita.clientes?.cidade },
      { titulo: 'Empresa', valor: (l) => l.empresa?.nome },
      { titulo: 'Valor', tipo: 'moeda', soma: true, valor: (l) => l.item.valor },
      { titulo: 'Comissão', tipo: 'moeda', soma: true, valor: (l) => l.comissao },
      { titulo: 'Como a comissão foi calculada', valor: (l) => (
        l.item.comissao_manual !== null && l.item.comissao_manual !== undefined
          ? 'Valor digitado'
          : `${l.empresa?.percentual_comissao || 0}% do valor`) },
    ],
  })

  adicionarAba(wb, {
    nome: 'Visitas', cor: 'azul',
    titulo: `Visitas: ${nomeMesBonito}`,
    descricao: 'Todas as visitas do mês, inclusive as em que a loja não comprou. O desconto é o desconto fixo do cliente.',
    linhas: linhasVisitas,
    colunas: [
      { titulo: 'Data', tipo: 'data', valor: (l) => l.v.data_visita },
      { titulo: 'Cliente', valor: (l) => l.v.clientes?.nome },
      { titulo: 'Cidade', valor: (l) => l.v.clientes?.cidade },
      { titulo: 'Comprou?', tipo: 'simnao', valor: (l) => l.v.comprou },
      { titulo: 'Subtotal', tipo: 'moeda', soma: true, valor: (l) => (l.v.comprou ? l.subtotal : null) },
      { titulo: 'Desconto', tipo: 'moeda', soma: true, valor: (l) => (l.v.comprou ? l.desconto : null) },
      { titulo: 'Total', tipo: 'moeda', soma: true, valor: (l) => (l.v.comprou ? l.total : null) },
      { titulo: 'Observação', valor: (l) => l.v.observacao },
    ],
  })

  // ── Estoque ──
  if (org) {
    const vendasDoMes = org.vendas.filter((v) => noMes(v.data_venda)).sort((a, b) => comparaTexto(a.data_venda, b.data_venda))
    adicionarAba(wb, {
      nome: 'Estoque - Vendas', cor: 'verde',
      titulo: `Vendas do meu estoque: ${nomeMesBonito}`,
      descricao: 'Uma venda por linha. "Lucro máximo" é o que sobra se o cliente pagar tudo (total menos o custo da mercadoria).',
      linhas: vendasDoMes,
      colunas: [
        { titulo: 'Data', tipo: 'data', valor: (v) => v.data_venda },
        { titulo: 'Cliente', valor: (v) => v.cliente },
        { titulo: 'Origem', valor: (v) => v.origem },
        { titulo: 'Produtos', valor: (v) => textoDosProdutos(v.itens, org.produtoPorId) },
        { titulo: 'Total', tipo: 'moeda', soma: true, valor: (v) => v.total },
        { titulo: 'Custo da mercadoria', tipo: 'moeda', soma: true, valor: (v) => v.custo },
        { titulo: 'Lucro máximo', tipo: 'moeda', soma: true, valor: (v) => Math.max(0, v.total - v.custo) },
        { titulo: 'Já pago', tipo: 'moeda', soma: true, valor: (v) => v.pago },
        { titulo: 'Falta receber', tipo: 'moeda', soma: true, valor: (v) => Math.max(0, v.falta) },
        { titulo: 'Vencimento', tipo: 'data', valor: (v) => v.vencimento },
        { titulo: 'Observação da cobrança', valor: (v) => v.observacao_cobranca },
      ],
    })

    const recebimentos = []
    org.vendas.forEach((v) => lucroPorPagamento(v).forEach((x) => {
      if (noMes(String(x.pagamento.data_pagamento).slice(0, 10))) recebimentos.push({ v, p: x.pagamento, lucro: x.lucro })
    }))
    recebimentos.sort((a, b) => comparaTexto(a.p.data_pagamento, b.p.data_pagamento))
    adicionarAba(wb, {
      nome: 'Estoque - Recebimentos', cor: 'verde',
      titulo: `Dinheiro recebido do estoque: ${nomeMesBonito}`,
      descricao: 'Cada pagamento recebido no mês, de vendas de qualquer mês. "Lucro liberado" é a parte que virou lucro depois de cobrir o custo da venda.',
      linhas: recebimentos,
      colunas: [
        { titulo: 'Dia do recebimento', tipo: 'data', valor: (x) => x.p.data_pagamento },
        { titulo: 'Cliente', valor: (x) => x.v.cliente },
        { titulo: 'Valor recebido', tipo: 'moeda', soma: true, valor: (x) => Number(x.p.valor) },
        { titulo: 'Forma', valor: (x) => FORMA[x.p.forma] || '' },
        { titulo: 'Lucro liberado', tipo: 'moeda', soma: true, valor: (x) => arredonda2(x.lucro) },
        { titulo: 'Data da venda', tipo: 'data', valor: (x) => x.v.data_venda },
      ],
    })

    const comprasDoMes = org.compras.filter((c) => noMes(c.data_compra)).sort((a, b) => comparaTexto(a.data_compra, b.data_compra))
    adicionarAba(wb, {
      nome: 'Estoque - Compras', cor: 'verde',
      titulo: `Compras de mercadoria: ${nomeMesBonito}`,
      descricao: 'O que você comprou dos fornecedores no mês. "Falta pagar" é o saldo de hoje.',
      linhas: comprasDoMes,
      colunas: [
        { titulo: 'Data', tipo: 'data', valor: (c) => c.data_compra },
        { titulo: 'Produto', valor: (c) => c.produto?.nome },
        { titulo: 'Fornecedor', valor: (c) => c.fornecedor || 'Sem fornecedor' },
        { titulo: 'Quantidade', tipo: 'numero', valor: (c) => Number(c.quantidade) },
        { titulo: 'Custo unitário', tipo: 'moeda', valor: (c) => Number(c.custo_unitario) },
        { titulo: 'Total', tipo: 'moeda', soma: true, valor: (c) => c.total },
        { titulo: 'Já pago', tipo: 'moeda', soma: true, valor: (c) => c.pago },
        { titulo: 'Falta pagar', tipo: 'moeda', soma: true, valor: (c) => Math.max(0, c.falta) },
        { titulo: 'Vencimento', tipo: 'data', valor: (c) => c.vencimento },
        { titulo: 'Observação da cobrança', valor: (c) => c.observacao_cobranca },
      ],
    })

    // Fotografia de hoje: o que clientes devem e o que ele deve, de qualquer mês
    const emAberto = []
    org.vendas.filter((v) => v.falta > 0.004).forEach((v) => emAberto.push({
      tipo: 'Cliente me deve', quem: v.cliente, data: v.data_venda, oque: textoDosProdutos(v.itens, org.produtoPorId),
      total: v.total, pago: v.pago, falta: v.falta, vencimento: v.vencimento, obs: v.observacao_cobranca,
    }))
    org.compras.filter((c) => c.falta > 0.004).forEach((c) => emAberto.push({
      tipo: 'Eu devo', quem: c.fornecedor || 'Sem fornecedor', data: c.data_compra, oque: `${c.produto?.nome || 'produto'} × ${Number(c.quantidade)}`,
      total: c.total, pago: c.pago, falta: c.falta, vencimento: c.vencimento, obs: c.observacao_cobranca,
    }))
    emAberto.sort((a, b) => comparaTexto(a.tipo, b.tipo) || comparaTexto(a.vencimento || '9999', b.vencimento || '9999') || comparaTexto(a.data, b.data))
    const colunasAberto = [
      { titulo: 'Quem', valor: (x) => x.quem },
      { titulo: 'Tipo', valor: (x) => x.tipo },
      { titulo: 'Data', tipo: 'data', valor: (x) => x.data },
      { titulo: 'O quê', valor: (x) => x.oque },
      { titulo: 'Total', tipo: 'moeda', valor: (x) => x.total },
      { titulo: 'Já pago', tipo: 'moeda', valor: (x) => x.pago },
      { titulo: 'Falta', tipo: 'moeda', soma: true, valor: (x) => x.falta },
      { titulo: 'Vencimento', tipo: 'data', valor: (x) => x.vencimento },
      { titulo: 'Situação', valor: (x) => situacaoDoPrazo(x.vencimento) },
      { titulo: 'Observação', valor: (x) => x.obs },
    ]
    adicionarAba(wb, {
      nome: 'Em aberto', cor: 'verde',
      titulo: `Em aberto hoje (${new Date().toLocaleDateString('pt-BR')})`,
      descricao: 'Tudo que ainda não foi pago por completo, de qualquer mês: o que clientes te devem e o que você deve aos fornecedores. Use o filtro de "Tipo" para ver um lado de cada vez; o total "Falta" respeita o filtro.',
      linhas: emAberto,
      colunas: colunasAberto,
      aposLinha: destacarSituacao(colunasAberto.findIndex((c) => c.titulo === 'Situação')),
    })

    // Entregas que ainda faltam fazer (um cliente por linha): sem dia e atrasadas primeiro
    const paradasPendentes = []
    org.entregas.forEach((e) => {
      const situacao = situacaoDaEntrega(e)
      if (situacao === 'Concluída') return
      e.paradas.filter((p) => !p.feita).forEach((p) => paradasPendentes.push({ e, p, situacao }))
    })
    const pesoSituacao = { 'Sem dia marcado': 0, Atrasada: 1, 'É hoje': 2, 'Dia marcado': 3 }
    paradasPendentes.sort((a, b) =>
      pesoSituacao[a.situacao] - pesoSituacao[b.situacao] ||
      comparaTexto(a.e.data_entrega || '', b.e.data_entrega || '') ||
      comparaTexto(a.e.created_at, b.e.created_at))
    const colunasEntregas = [
      { titulo: 'Situação', valor: (x) => x.situacao },
      { titulo: 'Entrega', valor: (x) => x.e.nome || 'Entrega' },
      { titulo: 'Dia', tipo: 'data', valor: (x) => x.e.data_entrega },
      { titulo: 'Cliente', valor: (x) => x.p.cliente },
      { titulo: 'O que levar', valor: (x) => textoDosItensDaParada(x.p.itens, org.produtoPorId) },
      { titulo: 'Observação da entrega', valor: (x) => x.e.observacao },
    ]
    adicionarAba(wb, {
      nome: 'Entregas pendentes', cor: 'verde',
      titulo: `Entregas que faltam fazer (hoje, ${new Date().toLocaleDateString('pt-BR')})`,
      descricao: 'Um cliente por linha, de qualquer mês. "Sem dia marcado" e "Atrasada" vêm primeiro.',
      linhas: paradasPendentes,
      colunas: colunasEntregas,
      aposLinha: destacarSituacaoEntrega(0),
    })
  }

  await baixar(wb, `relatorio-${ano}-${mes}.xlsx`)
}

// ── Cópia de segurança (backup completo) ──────────────────────

// Colunas que são "código interno" e não vão para a cópia legível
const TECNICAS = new Set(['id', 'user_id', 'created_at'])
const ehTecnica = (k) => TECNICAS.has(k) || k.endsWith('_id')

// Se o banco tiver alguma coluna que não está nas abas abaixo, ela vai para o fim com o nome
// original, para a cópia nunca perder informação.
function colunasExtras(linhas, conhecidas) {
  const chaves = []
  linhas.forEach((l) => Object.keys(l).forEach((k) => {
    if (!ehTecnica(k) && !conhecidas.includes(k) && !chaves.includes(k)) chaves.push(k)
  }))
  return chaves.map((k) => ({ titulo: k, valor: (l) => (typeof l[k] === 'boolean' ? (l[k] ? 'Sim' : 'Não') : l[k]) }))
}

async function gerarBackupCompleto() {
  const ExcelJS = window.ExcelJS

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

  const clientePorId = porId(clientes)
  const empresaPorId = porId(empresas)
  const visitaPorId = porId(visitas)
  const rotaPorId = porId(rotas)
  const nomeRota = (id) => {
    const r = rotaPorId[id]
    return r ? `${r.cidade || ''} - ${r.nome || ''}` : ''
  }

  clientes.sort((a, b) => comparaTexto(a.nome, b.nome))
  empresas.sort((a, b) => comparaTexto(a.nome, b.nome))
  visitas.sort((a, b) => comparaTexto(b.data_visita, a.data_visita)) // mais recentes primeiro
  rotas.sort((a, b) => comparaTexto(a.cidade, b.cidade) || comparaTexto(a.nome, b.nome))
  agendamentos.sort((a, b) => comparaTexto(a.data, b.data))
  cidadesOrdem.sort((a, b) => (a.ordem || 0) - (b.ordem || 0))

  // Estoque (revenda) e Lembretes: se não der para ler, são pulados e o aviso aparece no fim
  avisoFinal = ''
  const est = await lerEstoque()
  const org = est.ok ? organizarEstoque(est) : null

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Planilha Inteligente'
  wb.created = new Date()

  // A aba "Leia-me" é criada primeiro (fica na frente) e preenchida no fim, quando já se sabe as abas
  const abasCriadas = []
  const aba = (config) => {
    const extras = config.conhecidas ? colunasExtras(config.linhas, config.conhecidas) : []
    adicionarAba(wb, { ...config, colunas: [...config.colunas, ...extras] })
    abasCriadas.push({ nome: config.nome, cor: config.cor, nota: config.descricao })
  }

  // ── Clientes e rotas (cinza) ──
  aba({
    nome: 'Clientes', cor: 'cinza', titulo: 'Clientes',
    descricao: 'Todas as lojas cadastradas. Use o filtro (setinha no cabeçalho) para procurar por nome ou cidade.',
    linhas: clientes,
    conhecidas: ['nome', 'endereco', 'bairro', 'cidade', 'estado', 'telefone', 'desconto', 'observacoes', 'latitude', 'longitude'],
    colunas: [
      { titulo: 'Nome', valor: (l) => l.nome },
      { titulo: 'Cidade', valor: (l) => l.cidade },
      { titulo: 'Estado', valor: (l) => l.estado },
      { titulo: 'Bairro', valor: (l) => l.bairro },
      { titulo: 'Endereço', valor: (l) => l.endereco },
      { titulo: 'Telefone', valor: (l) => l.telefone },
      { titulo: 'Desconto fixo', tipo: 'moeda', valor: (l) => (l.desconto > 0 ? l.desconto : null) },
      { titulo: 'Observações', valor: (l) => l.observacoes },
      { titulo: 'Coordenadas', valor: (l) => (l.latitude !== null && l.latitude !== undefined && l.longitude !== null && l.longitude !== undefined ? `${l.latitude}, ${l.longitude}` : '') },
      { titulo: 'Cadastrado em', tipo: 'data', opcional: true, valor: (l) => l.created_at },
    ],
  })

  // ── Empresas que representa (azul) ──
  aba({
    nome: 'Empresas', cor: 'azul', titulo: 'Empresas que você representa',
    descricao: 'As empresas e o percentual de comissão de cada uma.',
    linhas: empresas, conhecidas: ['nome', 'percentual_comissao'],
    colunas: [
      { titulo: 'Empresa', valor: (l) => l.nome },
      { titulo: '% de comissão', tipo: 'percentual', valor: (l) => l.percentual_comissao },
    ],
  })
  aba({
    nome: 'Visitas', cor: 'azul', titulo: 'Visitas',
    descricao: 'Todas as visitas registradas, da mais recente para a mais antiga. "Comprou?" se refere às empresas que você representa.',
    linhas: visitas, conhecidas: ['data_visita', 'comprou', 'desconto_aplicado', 'observacao'],
    colunas: [
      { titulo: 'Data', tipo: 'data', valor: (l) => l.data_visita },
      { titulo: 'Cliente', valor: (l) => clientePorId[l.cliente_id]?.nome },
      { titulo: 'Cidade', valor: (l) => clientePorId[l.cliente_id]?.cidade },
      { titulo: 'Comprou?', tipo: 'simnao', valor: (l) => l.comprou },
      { titulo: 'Desconto aplicado', tipo: 'moeda', soma: true, valor: (l) => (l.desconto_aplicado > 0 ? l.desconto_aplicado : null) },
      { titulo: 'Observação', valor: (l) => l.observacao },
    ],
  })
  aba({
    nome: 'Vendas das empresas', cor: 'azul', titulo: 'Itens vendidos das empresas que você representa',
    descricao: 'Cada item vendido numa visita. A comissão só aparece aqui quando foi digitada à mão; senão vale o percentual da empresa.',
    linhas: itens, conhecidas: ['valor', 'comissao_manual'],
    colunas: [
      { titulo: 'Data da visita', tipo: 'data', valor: (l) => visitaPorId[l.visita_id]?.data_visita },
      { titulo: 'Cliente', valor: (l) => clientePorId[visitaPorId[l.visita_id]?.cliente_id]?.nome },
      { titulo: 'Empresa', valor: (l) => empresaPorId[l.empresa_id]?.nome },
      { titulo: 'Valor', tipo: 'moeda', soma: true, valor: (l) => l.valor },
      { titulo: 'Comissão digitada', tipo: 'moeda', valor: (l) => l.comissao_manual },
    ],
  })
  aba({
    nome: 'Comissões recebidas', cor: 'azul', titulo: 'Comissões recebidas',
    descricao: 'O que você marcou como recebido na tela Empresas, mês a mês.',
    linhas: recebidas, conhecidas: ['mes', 'ano', 'recebido', 'recebido_em'],
    colunas: [
      { titulo: 'Empresa', valor: (l) => empresaPorId[l.empresa_id]?.nome },
      { titulo: 'Mês', tipo: 'numero', valor: (l) => l.mes },
      { titulo: 'Ano', tipo: 'numero', valor: (l) => l.ano },
      { titulo: 'Recebida?', tipo: 'simnao', valor: (l) => l.recebido },
      { titulo: 'Recebida em', tipo: 'data', valor: (l) => l.recebido_em },
    ],
  })

  // ── Rotas (cinza) ──
  aba({
    nome: 'Rotas', cor: 'cinza', titulo: 'Rotas',
    descricao: 'As rotas salvas, por cidade. As colunas "antigas" são de uma versão anterior do sistema.',
    linhas: rotas, conhecidas: ['cidade', 'nome', 'observacao', 'mes', 'ano', 'data_visita'],
    colunas: [
      { titulo: 'Cidade', valor: (l) => l.cidade },
      { titulo: 'Rota', valor: (l) => l.nome },
      { titulo: 'Observação', valor: (l) => l.observacao },
      { titulo: 'Mês (antigo)', tipo: 'numero', opcional: true, valor: (l) => l.mes },
      { titulo: 'Ano (antigo)', tipo: 'numero', opcional: true, valor: (l) => l.ano },
      { titulo: 'Data (antiga)', tipo: 'data', opcional: true, valor: (l) => l.data_visita },
    ],
  })
  aba({
    nome: 'Clientes das rotas', cor: 'cinza', titulo: 'Clientes de cada rota',
    descricao: 'Quais lojas fazem parte de cada rota e em que ordem.',
    linhas: [...rotaClientes].sort((a, b) => comparaTexto(nomeRota(a.rota_id), nomeRota(b.rota_id)) || (a.ordem || 0) - (b.ordem || 0)),
    conhecidas: ['ordem'],
    colunas: [
      { titulo: 'Rota', valor: (l) => nomeRota(l.rota_id) },
      { titulo: 'Ordem', tipo: 'numero', valor: (l) => l.ordem },
      { titulo: 'Cliente', valor: (l) => clientePorId[l.cliente_id]?.nome },
      { titulo: 'Cidade', valor: (l) => clientePorId[l.cliente_id]?.cidade },
    ],
  })
  aba({
    nome: 'Datas das rotas', cor: 'cinza', titulo: 'Datas agendadas das rotas',
    descricao: 'Em quais dias cada rota está marcada no calendário.',
    linhas: agendamentos, conhecidas: ['data'],
    colunas: [
      { titulo: 'Data', tipo: 'data', valor: (l) => l.data },
      { titulo: 'Rota', valor: (l) => nomeRota(l.rota_id) },
    ],
  })
  aba({
    nome: 'Ordem das cidades', cor: 'cinza', titulo: 'Ordem das cidades',
    descricao: 'A ordem em que você prefere percorrer as cidades na tela Rotas.',
    linhas: cidadesOrdem, conhecidas: ['cidade_chave', 'ordem'],
    colunas: [
      { titulo: 'Ordem', tipo: 'numero', valor: (l) => l.ordem },
      { titulo: 'Cidade', valor: (l) => l.cidade_chave },
    ],
  })

  // ── Estoque e Lembretes (verde) ──
  if (org) {
    const { produtoPorId, fornecedorPorId, clientePorId: clienteEstoque } = org
    const vendaPorId = porId(org.vendas)
    const compraPorId = porId(org.compras)
    const nomeProduto = (id) => produtoPorId[id]?.nome
    const nomeCliente = (id) => clienteEstoque[id]?.nome
    const maisRecentes = (lista, campo) => [...lista].sort((a, b) => comparaTexto(b[campo], a[campo]))

    aba({
      nome: 'Fornecedores', cor: 'verde', titulo: 'Fornecedores',
      descricao: 'De quem você compra a mercadoria da revenda.',
      linhas: [...est.fornecedores].sort((a, b) => comparaTexto(a.nome, b.nome)), conhecidas: ['nome', 'observacao'],
      colunas: [
        { titulo: 'Fornecedor', valor: (l) => l.nome },
        { titulo: 'Observação', valor: (l) => l.observacao },
      ],
    })
    aba({
      nome: 'Produtos', cor: 'verde', titulo: 'Produtos',
      descricao: 'Os produtos da revenda, com o custo (quanto você paga) e o preço de venda.',
      linhas: [...est.produtos].sort((a, b) => comparaTexto(a.nome, b.nome)), conhecidas: ['nome', 'unidade', 'descricao', 'preco_custo', 'preco_venda', 'ativo'],
      colunas: [
        { titulo: 'Produto', valor: (l) => l.nome },
        { titulo: 'Fornecedor', valor: (l) => fornecedorPorId[l.fornecedor_id]?.nome },
        { titulo: 'Vendido por', valor: (l) => l.unidade },
        { titulo: 'Descrição', valor: (l) => l.descricao },
        { titulo: 'Custo', tipo: 'moeda', valor: (l) => l.preco_custo },
        { titulo: 'Preço de venda', tipo: 'moeda', valor: (l) => l.preco_venda },
        { titulo: 'Em estoque agora', tipo: 'numero', valor: (l) => Math.round((org.saldo[l.id] || 0) * 1000) / 1000 },
        { titulo: 'Ativo?', tipo: 'simnao', valor: (l) => l.ativo },
      ],
    })
    aba({
      nome: 'Compras (estoque)', cor: 'verde', titulo: 'Compras de mercadoria',
      descricao: 'Tudo que você comprou dos fornecedores, da mais recente para a mais antiga.',
      linhas: maisRecentes(est.compras_estoque, 'data_compra'), conhecidas: ['data_compra', 'quantidade', 'custo_unitario', 'vencimento', 'observacao', 'observacao_cobranca'],
      colunas: [
        { titulo: 'Data', tipo: 'data', valor: (l) => l.data_compra },
        { titulo: 'Produto', valor: (l) => nomeProduto(l.produto_id) },
        { titulo: 'Fornecedor', valor: (l) => fornecedorPorId[l.fornecedor_id]?.nome || 'Sem fornecedor' },
        { titulo: 'Quantidade', tipo: 'numero', valor: (l) => Number(l.quantidade) },
        { titulo: 'Custo unitário', tipo: 'moeda', valor: (l) => l.custo_unitario },
        { titulo: 'Total', tipo: 'moeda', soma: true, valor: (l) => compraPorId[l.id]?.total },
        { titulo: 'Já pago', tipo: 'moeda', soma: true, valor: (l) => compraPorId[l.id]?.pago },
        { titulo: 'Falta pagar', tipo: 'moeda', soma: true, valor: (l) => Math.max(0, compraPorId[l.id]?.falta || 0) },
        { titulo: 'Vencimento', tipo: 'data', valor: (l) => l.vencimento },
        { titulo: 'Observação', valor: (l) => l.observacao },
        { titulo: 'Observação da cobrança', valor: (l) => l.observacao_cobranca },
      ],
    })
    aba({
      nome: 'Pagamentos de compras', cor: 'verde', titulo: 'Pagamentos feitos aos fornecedores',
      descricao: 'Cada pagamento, inclusive os parciais.',
      linhas: maisRecentes(est.pagamentos_compra, 'data_pagamento'), conhecidas: ['valor', 'data_pagamento', 'forma'],
      colunas: [
        { titulo: 'Dia do pagamento', tipo: 'data', valor: (l) => l.data_pagamento },
        { titulo: 'Fornecedor', valor: (l) => compraPorId[l.compra_id]?.fornecedor || 'Sem fornecedor' },
        { titulo: 'Produto da compra', valor: (l) => nomeProduto(compraPorId[l.compra_id]?.produto_id) },
        { titulo: 'Data da compra', tipo: 'data', valor: (l) => compraPorId[l.compra_id]?.data_compra },
        { titulo: 'Valor', tipo: 'moeda', soma: true, valor: (l) => l.valor },
        { titulo: 'Forma', valor: (l) => FORMA[l.forma] || '' },
      ],
    })
    aba({
      nome: 'Vendas (estoque)', cor: 'verde', titulo: 'Vendas do meu estoque',
      descricao: 'Cada venda de produto, da mais recente para a mais antiga. "Falta receber" é o saldo de hoje.',
      linhas: maisRecentes(est.vendas_estoque, 'data_venda'), conhecidas: ['data_venda', 'prazo_dias', 'vencimento', 'observacao', 'observacao_cobranca'],
      colunas: [
        { titulo: 'Data', tipo: 'data', valor: (l) => l.data_venda },
        { titulo: 'Cliente', valor: (l) => nomeCliente(l.cliente_id) },
        { titulo: 'Origem', valor: (l) => vendaPorId[l.id]?.origem },
        { titulo: 'Produtos', valor: (l) => textoDosProdutos(vendaPorId[l.id]?.itens || [], produtoPorId) },
        { titulo: 'Total', tipo: 'moeda', soma: true, valor: (l) => vendaPorId[l.id]?.total },
        { titulo: 'Custo da mercadoria', tipo: 'moeda', soma: true, valor: (l) => vendaPorId[l.id]?.custo },
        { titulo: 'Já pago', tipo: 'moeda', soma: true, valor: (l) => vendaPorId[l.id]?.pago },
        { titulo: 'Falta receber', tipo: 'moeda', soma: true, valor: (l) => Math.max(0, vendaPorId[l.id]?.falta || 0) },
        { titulo: 'Prazo (dias)', tipo: 'numero', valor: (l) => l.prazo_dias },
        { titulo: 'Vencimento', tipo: 'data', valor: (l) => l.vencimento },
        { titulo: 'Observação', valor: (l) => l.observacao },
        { titulo: 'Observação da cobrança', valor: (l) => l.observacao_cobranca },
      ],
    })
    // Entregas: um cliente por linha, com o que levar e se já foi entregue
    const linhasEntregas = []
    org.entregas.forEach((e) => {
      if (e.paradas.length === 0) linhasEntregas.push({ e, p: null })
      e.paradas.forEach((p) => linhasEntregas.push({ e, p }))
    })
    linhasEntregas.sort((a, b) => comparaTexto(b.e.data_entrega || '9999', a.e.data_entrega || '9999') || comparaTexto(b.e.created_at, a.e.created_at))
    aba({
      nome: 'Entregas', cor: 'verde', titulo: 'Entregas',
      descricao: 'Cada entrega montada, com um cliente por linha: o que era para levar e se já foi entregue (e a venda que gerou). Sem dia marcado aparece primeiro.',
      linhas: linhasEntregas,
      colunas: [
        { titulo: 'Entrega', valor: (x) => x.e.nome || 'Entrega' },
        { titulo: 'Dia', tipo: 'data', valor: (x) => x.e.data_entrega },
        { titulo: 'Situação', valor: (x) => situacaoDaEntrega(x.e) },
        { titulo: 'Cliente', valor: (x) => (x.p ? x.p.cliente : '(sem clientes)') },
        { titulo: 'O que levar', valor: (x) => (x.p ? textoDosItensDaParada(x.p.itens, produtoPorId) : '') },
        { titulo: 'Entregue?', tipo: 'simnao', valor: (x) => (x.p ? x.p.feita : null) },
        { titulo: 'Valor da venda gerada', tipo: 'moeda', valor: (x) => (x.p && x.p.venda_id ? vendaPorId[x.p.venda_id]?.total : null) },
        { titulo: 'Observação da entrega', valor: (x) => x.e.observacao },
      ],
    })
    aba({
      nome: 'Itens das vendas', cor: 'verde', titulo: 'Itens das vendas do estoque',
      descricao: 'Cada produto vendido. O "custo unitário" é o do dia da venda (é ele que calcula o lucro).',
      linhas: [...est.venda_estoque_itens].sort((a, b) => comparaTexto(vendaPorId[b.venda_id]?.data_venda, vendaPorId[a.venda_id]?.data_venda)),
      conhecidas: ['quantidade', 'preco_unitario', 'custo_unitario'],
      colunas: [
        { titulo: 'Data da venda', tipo: 'data', valor: (l) => vendaPorId[l.venda_id]?.data_venda },
        { titulo: 'Cliente', valor: (l) => nomeCliente(vendaPorId[l.venda_id]?.cliente_id) },
        { titulo: 'Produto', valor: (l) => nomeProduto(l.produto_id) },
        { titulo: 'Quantidade', tipo: 'numero', valor: (l) => Number(l.quantidade) },
        { titulo: 'Preço unitário', tipo: 'moeda', valor: (l) => l.preco_unitario },
        { titulo: 'Total da linha', tipo: 'moeda', soma: true, valor: (l) => arredonda2(Number(l.quantidade) * Number(l.preco_unitario)) },
        { titulo: 'Custo unitário', tipo: 'moeda', valor: (l) => l.custo_unitario },
        { titulo: 'Lucro bruto', tipo: 'moeda', soma: true, valor: (l) => arredonda2(Number(l.quantidade) * (Number(l.preco_unitario) - Number(l.custo_unitario))) },
      ],
    })
    aba({
      nome: 'Pagamentos de vendas', cor: 'verde', titulo: 'Pagamentos recebidos dos clientes',
      descricao: 'Cada pagamento recebido, inclusive os parciais.',
      linhas: maisRecentes(est.pagamentos_venda, 'data_pagamento'), conhecidas: ['valor', 'data_pagamento', 'forma'],
      colunas: [
        { titulo: 'Dia do pagamento', tipo: 'data', valor: (l) => l.data_pagamento },
        { titulo: 'Cliente', valor: (l) => nomeCliente(vendaPorId[l.venda_id]?.cliente_id) },
        { titulo: 'Data da venda', tipo: 'data', valor: (l) => vendaPorId[l.venda_id]?.data_venda },
        { titulo: 'Valor', tipo: 'moeda', soma: true, valor: (l) => l.valor },
        { titulo: 'Forma', valor: (l) => FORMA[l.forma] || '' },
      ],
    })
    aba({
      nome: 'Retiradas de lucro', cor: 'verde', titulo: 'Retiradas de lucro',
      descricao: 'O lucro que você tirou para você.',
      linhas: maisRecentes(est.retiradas_lucro, 'data_retirada'), conhecidas: ['valor', 'data_retirada', 'observacao'],
      colunas: [
        { titulo: 'Dia', tipo: 'data', valor: (l) => l.data_retirada },
        { titulo: 'Valor', tipo: 'moeda', soma: true, valor: (l) => l.valor },
        { titulo: 'Observação', valor: (l) => l.observacao },
      ],
    })
    aba({
      nome: 'Metas (próxima compra)', cor: 'verde', titulo: 'Próxima meta de compra',
      descricao: 'O que você quer comprar e o dinheiro que precisa ter.',
      linhas: est.metas_estoque, conhecidas: ['quantidade', 'preco_unitario'],
      colunas: [
        { titulo: 'Produto', valor: (l) => nomeProduto(l.produto_id) },
        { titulo: 'Quantidade', tipo: 'numero', valor: (l) => Number(l.quantidade) },
        { titulo: 'Preço unitário', tipo: 'moeda', valor: (l) => l.preco_unitario },
        { titulo: 'Subtotal', tipo: 'moeda', soma: true, valor: (l) => arredonda2(Number(l.quantidade) * Number(l.preco_unitario)) },
      ],
    })
    aba({
      nome: 'Lembretes', cor: 'verde', titulo: 'Lembretes',
      descricao: 'O que você anotou para não esquecer, os pendentes e os que já foram feitos.',
      linhas: maisRecentes(est.lembretes, 'created_at'), conhecidas: ['texto', 'feito', 'feito_em'],
      colunas: [
        { titulo: 'Anotado em', tipo: 'data', valor: (l) => l.created_at },
        { titulo: 'Lembrete', valor: (l) => l.texto },
        { titulo: 'Cliente', valor: (l) => nomeCliente(l.cliente_id) },
        { titulo: 'Feito?', tipo: 'simnao', valor: (l) => l.feito },
        { titulo: 'Feito em', tipo: 'data', valor: (l) => l.feito_em },
      ],
    })
  }

  // ── "Leia-me": explica o arquivo e lista as abas, na frente de tudo ──
  const leia = adicionarResumo(wb, {
    nome: 'Leia-me',
    cor: 'cinza',
    titulo: 'Cópia de segurança: Planilha Inteligente',
    subtitulo: `Gerada em ${new Date().toLocaleString('pt-BR')}. Contém os valores reais do seu cadastro; guarde com cuidado e não compartilhe.`,
    blocos: [
      {
        titulo: 'Como usar', cor: 'azul', linhas: [
          { rotulo: 'Cada aba é um assunto', nota: 'Veja a lista abaixo. A cor da aba mostra o grupo: azul = empresas que você representa, verde = seu estoque, cinza = clientes e rotas.' },
          { rotulo: 'Procurar e filtrar', nota: 'Clique na setinha do cabeçalho de qualquer coluna para filtrar ou ordenar.' },
          { rotulo: 'Totais', nota: 'A linha "Total" no fim de cada aba soma só o que estiver visível depois de filtrar.' },
          { rotulo: 'Não é para restaurar', nota: 'Esta é uma cópia para consulta e segurança. Os códigos internos do sistema não foram incluídos.' },
        ],
      },
      {
        titulo: 'O que tem em cada aba', cor: 'cinza', linhas: abasCriadas.map((a) => ({ rotulo: a.nome, nota: a.nota })),
      },
    ],
  })
  // Leia-me vai para a primeira posição (o ExcelJS ordena as abas pelo orderNo ao gravar)
  leia.orderNo = -1

  await baixar(wb, `backup-${dataLocalStr(new Date())}.xlsx`)
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
