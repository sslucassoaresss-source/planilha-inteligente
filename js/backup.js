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
const COLUNAS_MOEDA = new Set(['valor', 'desconto', 'desconto_aplicado', 'comissao_manual'])

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
