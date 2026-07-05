import { supabase } from './supabase.js'

const { data: { session } } = await supabase.auth.getSession()
if (!session) {
  window.location.href = '../index.html'
  throw new Error('Sem sessão — redirecionando para login')
}

const userId = session.user.id
const hoje = new Date()
document.getElementById('conteudo').style.display = 'block'

document.getElementById('btnSair').addEventListener('click', async () => {
  await supabase.auth.signOut()
  window.location.href = '../index.html'
})

// ── Seletor de mês ────────────────────────────────────────────
const selectMes = document.getElementById('selectMes')

for (let i = 0; i < 6; i++) {
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
  const valor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const opt = document.createElement('option')
  opt.value = valor
  opt.textContent = label.charAt(0).toUpperCase() + label.slice(1)
  selectMes.appendChild(opt)
}

selectMes.addEventListener('change', carregarVisitas)

// ── Carregar clientes e empresas (para os selects) ────────────
let todosClientes = []
let todasEmpresas = []

async function carregarClientes() {
  const { data, error } = await supabase
    .from('clientes')
    .select('id, nome, observacoes, desconto')
    .order('nome')

  if (error) return
  todosClientes = data

  const select = document.getElementById('clienteId')
  select.innerHTML = '<option value="">Selecione um cliente...</option>'
  data.forEach(c => {
    const opt = document.createElement('option')
    opt.value = c.id
    opt.textContent = c.nome
    select.appendChild(opt)
  })
}

async function carregarEmpresas() {
  const { data, error } = await supabase
    .from('empresas')
    .select('id, nome, percentual_comissao')
    .order('nome')

  if (error) return
  todasEmpresas = data
}

// ── Cliente selecionado: mostra obs fixas ─────────────────────
let clienteAtual = null

document.getElementById('clienteId').addEventListener('change', (e) => {
  clienteAtual = todosClientes.find(c => c.id === e.target.value) || null
  const obsFixa = document.getElementById('obsFixa')
  const obsFixaTexto = document.getElementById('obsFixaTexto')

  if (clienteAtual?.observacoes) {
    obsFixaTexto.textContent = clienteAtual.observacoes
    obsFixa.style.display = 'block'
  } else {
    obsFixa.style.display = 'none'
  }

  // Recalcula os itens já adicionados (desconto pode mudar)
  document.querySelectorAll('.item-venda-row').forEach(atualizarLinhaItem)
  recalcularTotal()
})

// ── Status: mostra/oculta bloco de itens ──────────────────────
document.getElementById('comprou').addEventListener('change', (e) => {
  const blocoItens = document.getElementById('blocoItens')
  if (e.target.value === 'true') {
    blocoItens.style.display = 'block'
    if (document.querySelectorAll('.item-venda-row').length === 0) {
      adicionarLinhaItem()
    }
  } else {
    blocoItens.style.display = 'none'
  }
})

// ── Itens de venda: adicionar / remover / calcular ────────────
const templateItem = document.getElementById('templateItem')
const listaItens   = document.getElementById('listaItens')

function adicionarLinhaItem(empresaId = '', valor = '') {
  const clone = templateItem.content.cloneNode(true)
  const row = clone.querySelector('.item-venda-row')
  const selectEmpresa = row.querySelector('.item-empresa')
  const inputValor = row.querySelector('.item-valor')

  todasEmpresas.forEach(emp => {
    const opt = document.createElement('option')
    opt.value = emp.id
    opt.textContent = `${emp.nome} (${emp.percentual_comissao || 0}%)`
    selectEmpresa.appendChild(opt)
  })

  if (empresaId) selectEmpresa.value = empresaId
  if (valor) inputValor.value = valor

  selectEmpresa.addEventListener('change', () => { atualizarLinhaItem(row); recalcularTotal() })
  inputValor.addEventListener('input', () => { atualizarLinhaItem(row); recalcularTotal() })
  row.querySelector('.btn-remover-item').addEventListener('click', () => {
    row.remove()
    recalcularTotal()
  })

  listaItens.appendChild(row)
  atualizarLinhaItem(row)
}

function atualizarLinhaItem(row) {
  const infoSpan = row.querySelector('.item-desconto-info')
  const desconto = clienteAtual?.desconto || 0
  infoSpan.textContent = desconto > 0 ? `−${desconto}% desc.` : ''
}

function recalcularTotal() {
  let total = 0
  document.querySelectorAll('.item-venda-row').forEach(row => {
    const valorBruto = parseFloat(row.querySelector('.item-valor').value) || 0
    const desconto = clienteAtual?.desconto || 0
    const valorFinal = valorBruto * (1 - desconto / 100)
    total += valorFinal
  })
  document.getElementById('totalItens').textContent =
    total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

document.getElementById('btnAddItem').addEventListener('click', () => adicionarLinhaItem())

// ── Modal ─────────────────────────────────────────────────────
const modalOverlay = document.getElementById('modalOverlay')
const formVisita   = document.getElementById('formVisita')

function abrirModal(titulo = 'Nova Visita') {
  document.getElementById('modalTitulo').textContent = titulo
  if (!document.getElementById('visitaId').value) {
    document.getElementById('dataVisita').value = hoje.toISOString().split('T')[0]
  }
  modalOverlay.classList.add('aberto')
}

function fecharModal() {
  modalOverlay.classList.remove('aberto')
  formVisita.reset()
  document.getElementById('visitaId').value = ''
  document.getElementById('obsFixa').style.display = 'none'
  document.getElementById('blocoItens').style.display = 'none'
  listaItens.innerHTML = ''
  clienteAtual = null
}

document.getElementById('btnNovaVisita').addEventListener('click', () => abrirModal())
document.getElementById('btnFecharModal').addEventListener('click', fecharModal)
document.getElementById('btnCancelar').addEventListener('click', fecharModal)
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) fecharModal() })

// ── Salvar visita + itens ─────────────────────────────────────
formVisita.addEventListener('submit', async (e) => {
  e.preventDefault()

  const id        = document.getElementById('visitaId').value
  const btnSalvar = document.getElementById('btnSalvar')
  const comprou   = document.getElementById('comprou').value === 'true'
  const desconto  = clienteAtual?.desconto || 0

  // Monta lista de itens a partir das linhas do formulário
  const linhas = document.querySelectorAll('.item-venda-row')
  const itens = []

  if (comprou) {
    for (const row of linhas) {
      const empresaId = row.querySelector('.item-empresa').value
      const valorBruto = parseFloat(row.querySelector('.item-valor').value) || 0
      if (!empresaId || valorBruto <= 0) continue
      const valorFinal = valorBruto * (1 - desconto / 100)
      itens.push({ empresa_id: empresaId, valor: valorFinal })
    }

    if (itens.length === 0) {
      alert('Adicione pelo menos um item de venda com empresa e valor.')
      return
    }
  }

  const dadosVisita = {
    user_id:     userId,
    cliente_id:  document.getElementById('clienteId').value,
    data_visita: document.getElementById('dataVisita').value,
    comprou,
    observacao:  document.getElementById('observacao').value.trim() || null,
  }

  btnSalvar.textContent = 'Salvando...'
  btnSalvar.disabled = true

  let visitaId = id
  let error

  if (id) {
    const res = await supabase.from('visitas').update(dadosVisita).eq('id', id)
    error = res.error

    // Remove itens antigos pra recriar do zero (mais simples e seguro)
    if (!error) {
      await supabase.from('itens_venda').delete().eq('visita_id', id)
    }
  } else {
    const res = await supabase.from('visitas').insert(dadosVisita).select().single()
    error = res.error
    visitaId = res.data?.id
  }

  // Insere os itens de venda vinculados à visita
  if (!error && comprou && itens.length > 0) {
    const itensComVisita = itens.map(item => ({
      user_id: userId,
      visita_id: visitaId,
      empresa_id: item.empresa_id,
      valor: item.valor
    }))

    const resItens = await supabase.from('itens_venda').insert(itensComVisita)
    error = resItens.error
  }

  btnSalvar.textContent = 'Salvar'
  btnSalvar.disabled = false

  if (error) {
    console.error('Erro ao salvar visita:', error)
    alert('Erro ao salvar. Tente novamente.')
    return
  }

  fecharModal()
  carregarVisitas()
})

// ── Carregar visitas do mês ───────────────────────────────────
async function carregarVisitas() {
  const [ano, mes] = selectMes.value.split('-')
  const inicio = `${ano}-${mes}-01`
  const fim    = new Date(ano, mes, 0).toISOString().split('T')[0]

  const { data: visitas, error } = await supabase
    .from('visitas')
    .select('*, clientes(nome), itens_venda(id, valor, empresa_id, empresas(nome))')
    .gte('data_visita', inicio)
    .lte('data_visita', fim)
    .order('data_visita', { ascending: false })

  if (error) { console.error('Erro ao carregar visitas:', error); return }

  renderizarResumo(visitas)
  renderizarTabela(visitas)
}

// ── Resumo do dia ─────────────────────────────────────────────
function renderizarResumo(visitas) {
  const hojeStr = hoje.toISOString().split('T')[0]
  const visitasDeHoje = visitas.filter(v => v.data_visita === hojeStr)
  const compraramHoje = visitasDeHoje.filter(v => v.comprou)
  const totalHoje = compraramHoje.reduce((acc, v) => {
    const totalVisita = (v.itens_venda || []).reduce((s, it) => s + (it.valor || 0), 0)
    return acc + totalVisita
  }, 0)

  document.getElementById('visitasHoje').textContent = visitasDeHoje.length
  document.getElementById('compraramHoje').textContent = compraramHoje.length
  document.getElementById('totalHoje').textContent =
    totalHoje.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// ── Tabela ────────────────────────────────────────────────────
function renderizarTabela(visitas) {
  const lista         = document.getElementById('listaVisitas')
  const msgVazio      = document.getElementById('msgVazio')
  const tabelaWrapper = document.getElementById('tabelaWrapper')

  lista.innerHTML = ''

  if (visitas.length === 0) {
    msgVazio.style.display = 'block'
    tabelaWrapper.style.display = 'none'
    return
  }

  msgVazio.style.display = 'none'
  tabelaWrapper.style.display = 'block'

  visitas.forEach(v => {
    const data = new Date(v.data_visita).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', timeZone: 'UTC'
    })

    const itens = v.itens_venda || []
    const totalVisita = itens.reduce((s, it) => s + (it.valor || 0), 0)
    const valorFmt = totalVisita > 0
      ? totalVisita.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : '—'

    const tagsEmpresas = itens.length > 0
      ? `<div class="empresas-tags">${itens.map(it =>
          `<span class="empresa-tag">${it.empresas?.nome || '—'}: ${(it.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>`
        ).join('')}</div>`
      : '—'

    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${data}</td>
      <td><strong>${v.clientes?.nome || '—'}</strong></td>
      <td><span class="badge ${v.comprou ? 'badge-sim' : 'badge-nao'}">${v.comprou ? 'Comprou' : 'Não comprou'}</span></td>
      <td>${tagsEmpresas}</td>
      <td>${valorFmt}</td>
      <td>
        <div class="acoes">
          <button class="btn-editar" data-id="${v.id}">Editar</button>
          <button class="btn-excluir" data-id="${v.id}">Excluir</button>
        </div>
      </td>
    `
    lista.appendChild(tr)
  })

  document.querySelectorAll('.btn-editar').forEach(btn => {
    btn.addEventListener('click', () => editarVisita(btn.dataset.id, visitas))
  })

  document.querySelectorAll('.btn-excluir').forEach(btn => {
    btn.addEventListener('click', () => excluirVisita(btn.dataset.id))
  })
}

// ── Editar ────────────────────────────────────────────────────
function editarVisita(id, lista) {
  const v = lista.find(v => v.id === id)
  if (!v) return

  document.getElementById('visitaId').value   = v.id
  document.getElementById('clienteId').value  = v.cliente_id
  document.getElementById('dataVisita').value = v.data_visita
  document.getElementById('comprou').value    = String(v.comprou)
  document.getElementById('observacao').value = v.observacao || ''

  clienteAtual = todosClientes.find(c => c.id === v.cliente_id) || null

  const obsFixa = document.getElementById('obsFixa')
  if (clienteAtual?.observacoes) {
    document.getElementById('obsFixaTexto').textContent = clienteAtual.observacoes
    obsFixa.style.display = 'block'
  }

  listaItens.innerHTML = ''

  if (v.comprou) {
    document.getElementById('blocoItens').style.display = 'block'
    const desconto = clienteAtual?.desconto || 0

    ;(v.itens_venda || []).forEach(item => {
      // Reconstroi o valor bruto a partir do valor com desconto salvo
      const valorBruto = desconto > 0 ? item.valor / (1 - desconto / 100) : item.valor
      adicionarLinhaItem(item.empresa_id, valorBruto.toFixed(2))
    })

    recalcularTotal()
  }

  abrirModal('Editar Visita')
}

// ── Excluir ───────────────────────────────────────────────────
async function excluirVisita(id) {
  if (!confirm('Tem certeza que deseja excluir esta visita?\nOs itens de venda vinculados também serão removidos.')) return

  const { error } = await supabase.from('visitas').delete().eq('id', id)
  if (error) { console.error('Erro ao excluir:', error); alert('Erro ao excluir. Tente novamente.'); return }

  carregarVisitas()
}

// ── Inicializar ───────────────────────────────────────────────
await carregarClientes()
await carregarEmpresas()
carregarVisitas()