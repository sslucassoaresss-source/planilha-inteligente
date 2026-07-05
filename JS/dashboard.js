import { supabase } from './supabase.js'

const { data: { session } } = await supabase.auth.getSession()
if (!session) {
  window.location.href = '../index.html'
  throw new Error('Sem sessão — redirecionando para login')
}

const userId = session.user.id
document.getElementById('conteudo').style.display = 'block'

document.getElementById('btnSair').addEventListener('click', async () => {
  await supabase.auth.signOut()
  window.location.href = '../index.html'
})

// ── Preencher seletor de mês ──────────────────────────────────
const selectMes = document.getElementById('selectMes')
const hoje = new Date()

for (let i = 0; i < 6; i++) {
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
  const valor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const opt = document.createElement('option')
  opt.value = valor
  opt.textContent = label.charAt(0).toUpperCase() + label.slice(1)
  selectMes.appendChild(opt)
}

selectMes.addEventListener('change', () => carregarDados())

// ── Carregar dados do Supabase ────────────────────────────────
async function carregarDados() {
  const [ano, mes] = selectMes.value.split('-')
  const inicio = `${ano}-${mes}-01`
  const fim = new Date(ano, mes, 0).toISOString().split('T')[0]

  const { data: visitas, error } = await supabase
    .from('visitas')
    .select('*, clientes(nome), itens_venda(id, valor, empresa_id, empresas(nome, percentual_comissao))')
    .gte('data_visita', inicio)
    .lte('data_visita', fim)
    .order('data_visita', { ascending: false })

  if (error) {
    console.error('Erro ao carregar visitas:', error)
    return
  }

  renderizarCards(visitas)
  renderizarGrafico(visitas, ano, mes)
  renderizarVisitasRecentes(visitas)
}

// ── Cards de resumo ───────────────────────────────────────────
function renderizarCards(visitas) {
  const total = visitas.length
  const compraram = visitas.filter(v => v.comprou)

  let totalVendido = 0
  let totalComissao = 0

  compraram.forEach(v => {
    ;(v.itens_venda || []).forEach(item => {
      const valor = item.valor || 0
      const percentual = item.empresas?.percentual_comissao || 0
      totalVendido += valor
      totalComissao += valor * (percentual / 100)
    })
  })

  const taxa = total > 0 ? Math.round((compraram.length / total) * 100) : 0

  document.getElementById('totalVisitas').textContent = total
  document.getElementById('totalVendido').textContent =
    totalVendido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  document.getElementById('taxaConversao').textContent = `${taxa}%`
  document.getElementById('totalComissao').textContent =
    totalComissao.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// ── Gráfico de barras por dia ─────────────────────────────────
function renderizarGrafico(visitas, ano, mes) {
  const grafico = document.getElementById('grafico')
  grafico.innerHTML = ''

  const diasNoMes = new Date(ano, mes, 0).getDate()
  const vendasPorDia = {}

  visitas.forEach(v => {
    if (!v.comprou) return
    const dia = new Date(v.data_visita).getUTCDate()
    const totalVisita = (v.itens_venda || []).reduce((s, it) => s + (it.valor || 0), 0)
    if (totalVisita > 0) {
      vendasPorDia[dia] = (vendasPorDia[dia] || 0) + totalVisita
    }
  })

  const maxValor = Math.max(...Object.values(vendasPorDia), 1)

  for (let dia = 1; dia <= diasNoMes; dia++) {
    const valor = vendasPorDia[dia] || 0
    const altura = Math.max((valor / maxValor) * 100, valor > 0 ? 8 : 2)

    const wrap = document.createElement('div')
    wrap.className = 'barra-wrap'

    const barra = document.createElement('div')
    barra.className = 'barra'
    barra.style.height = `${altura}%`
    barra.style.opacity = valor > 0 ? '1' : '0.2'

    if (valor > 0) {
      const tooltip = document.createElement('div')
      tooltip.className = 'barra-tooltip'
      tooltip.textContent = valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      barra.appendChild(tooltip)
    }

    const label = document.createElement('div')
    label.className = 'barra-label'
    label.textContent = dia % 5 === 0 || dia === 1 ? dia : ''

    wrap.appendChild(barra)
    wrap.appendChild(label)
    grafico.appendChild(wrap)
  }
}

// ── Visitas recentes ──────────────────────────────────────────
function renderizarVisitasRecentes(visitas) {
  const lista = document.getElementById('visitasRecentes')
  lista.innerHTML = ''

  const recentes = visitas.slice(0, 8)

  if (recentes.length === 0) {
    lista.innerHTML = '<p style="color:var(--text-soft);font-size:14px">Nenhuma visita no período.</p>'
    return
  }

  recentes.forEach(v => {
    const data = new Date(v.data_visita)
    const dataFormatada = data.toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', timeZone: 'UTC'
    })

    const item = document.createElement('div')
    item.className = 'visita-item'
    item.innerHTML = `
      <div>
        <div class="visita-nome">${v.clientes?.nome || '—'}</div>
        <div class="visita-data">${dataFormatada}</div>
      </div>
      <span class="badge ${v.comprou ? 'badge-sim' : 'badge-nao'}">
        ${v.comprou ? 'Comprou' : 'Não comprou'}
      </span>
    `
    lista.appendChild(item)
  })
}

// ── Inicializar ───────────────────────────────────────────────
carregarDados()