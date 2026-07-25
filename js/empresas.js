import { supabase } from './supabase.js'
import { mensagemErro } from './erros.js'

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

const listaEmpresas = document.getElementById('listaEmpresas')
const modalOverlay  = document.getElementById('modalOverlay')
const formEmpresa   = document.getElementById('formEmpresa')

// ── Seletor de mês (comissão por empresa é sempre referente a um mês) ──
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

selectMes.addEventListener('change', () => carregarEmpresas())

function abrirModal(titulo = 'Nova Empresa') {
  document.getElementById('modalTitulo').textContent = titulo
  modalOverlay.classList.add('aberto')
}

function fecharModal() {
  modalOverlay.classList.remove('aberto')
  formEmpresa.reset()
  document.getElementById('empresaId').value = ''
}

document.getElementById('btnNovaEmpresa').addEventListener('click', () => abrirModal())
document.getElementById('btnFecharModal').addEventListener('click', fecharModal)
document.getElementById('btnCancelar').addEventListener('click', fecharModal)
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) fecharModal() })

async function carregarEmpresas() {
  const [ano, mes] = selectMes.value.split('-')
  const inicio = `${ano}-${mes}-01`
  const fim = `${ano}-${mes}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}`

  const { data, error } = await supabase
    .from('empresas')
    .select('*')
    .order('nome')

  if (error) { console.error('Erro ao carregar empresas:', error); return }

  // Vendas do mês (mesmo cálculo de comissão usado no Dashboard), pra
  // somar quanto cada empresa deve de comissão neste mês.
  const { data: visitas, error: errVisitas } = await supabase
    .from('visitas')
    .select('itens_venda(empresa_id, valor, comissao_manual)')
    .eq('comprou', true)
    .gte('data_visita', inicio)
    .lte('data_visita', fim)

  if (errVisitas) console.error('Erro ao carregar vendas do mês:', errVisitas)

  const empresaPorId = {}
  data.forEach(empresa => { empresaPorId[empresa.id] = empresa })

  const totaisPorEmpresa = {}
  visitas?.forEach(v => {
    (v.itens_venda || []).forEach(item => {
      if (!item.empresa_id) return
      if (!totaisPorEmpresa[item.empresa_id]) totaisPorEmpresa[item.empresa_id] = { vendido: 0, comissao: 0 }

      totaisPorEmpresa[item.empresa_id].vendido += item.valor || 0

      if (item.comissao_manual !== null && item.comissao_manual !== undefined) {
        totaisPorEmpresa[item.empresa_id].comissao += item.comissao_manual
      } else {
        const percentual = empresaPorId[item.empresa_id]?.percentual_comissao || 0
        totaisPorEmpresa[item.empresa_id].comissao += (item.valor || 0) * (percentual / 100)
      }
    })
  })

  // Status "recebido" de cada empresa neste mês
  const { data: recebidos, error: errRecebidos } = await supabase
    .from('comissoes_recebidas')
    .select('empresa_id, recebido')
    .eq('mes', parseInt(mes))
    .eq('ano', parseInt(ano))

  if (errRecebidos) console.error('Erro ao carregar status de comissão:', errRecebidos)

  const recebidoPorEmpresa = {}
  recebidos?.forEach(r => { recebidoPorEmpresa[r.empresa_id] = r.recebido })

  listaEmpresas.innerHTML = ''

  const msgVazio = document.getElementById('msgVazio')
  const tabelaWrapper = document.getElementById('tabelaWrapper')
  const resumoComissao = document.getElementById('resumoComissao')

  if (data.length === 0) {
    msgVazio.style.display = 'block'
    tabelaWrapper.style.display = 'none'
    resumoComissao.style.display = 'none'
    return
  }

  msgVazio.style.display = 'none'
  tabelaWrapper.style.display = 'block'
  resumoComissao.style.display = 'block'

  // Resumo do mês: total de comissão e quanto ainda falta receber
  let comissaoTotal = 0
  let comissaoNaoRecebida = 0
  data.forEach(empresa => {
    const comissao = totaisPorEmpresa[empresa.id]?.comissao || 0
    comissaoTotal += comissao
    if (comissao > 0 && !recebidoPorEmpresa[empresa.id]) comissaoNaoRecebida += comissao
  })

  const fmt = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  resumoComissao.innerHTML = comissaoTotal === 0
    ? 'Nenhuma venda registrada neste mês ainda.'
    : `Comissão do mês: <strong>${fmt(comissaoTotal)}</strong> · Ainda não recebido: <strong>${fmt(comissaoNaoRecebida)}</strong>`

  data.forEach(empresa => {
    const totais = totaisPorEmpresa[empresa.id] || { vendido: 0, comissao: 0 }
    const recebido = !!recebidoPorEmpresa[empresa.id]

    const tr = document.createElement('tr')
    if (recebido) tr.classList.add('recebido')
    tr.innerHTML = `
      <td><strong>${empresa.nome}</strong></td>
      <td>${empresa.percentual_comissao || 0}%</td>
      <td>${fmt(totais.vendido)}</td>
      <td>${fmt(totais.comissao)}</td>
      <td><input type="checkbox" class="check-recebido" data-empresa-id="${empresa.id}" ${recebido ? 'checked' : ''}></td>
      <td>
        <div class="acoes">
          <button class="btn-editar" data-id="${empresa.id}">Editar</button>
          <button class="btn-excluir" data-id="${empresa.id}">Excluir</button>
        </div>
      </td>
    `
    listaEmpresas.appendChild(tr)
  })

  document.querySelectorAll('.btn-editar').forEach(btn => {
    btn.addEventListener('click', () => editarEmpresa(btn.dataset.id, data))
  })

  document.querySelectorAll('.btn-excluir').forEach(btn => {
    btn.addEventListener('click', () => excluirEmpresa(btn.dataset.id))
  })

  document.querySelectorAll('.check-recebido').forEach(chk => {
    chk.addEventListener('change', async () => {
      const empresaId = chk.dataset.empresaId
      chk.disabled = true

      const { error: errUpsert } = await supabase
        .from('comissoes_recebidas')
        .upsert({
          user_id:     userId,
          empresa_id:  empresaId,
          mes:         parseInt(mes),
          ano:         parseInt(ano),
          recebido:    chk.checked,
          recebido_em: chk.checked ? new Date().toISOString() : null
        }, { onConflict: 'user_id,empresa_id,mes,ano' })

      chk.disabled = false

      if (errUpsert) {
        console.error('Erro ao marcar comissão como recebida:', errUpsert)
        alert(mensagemErro(errUpsert, 'atualizar o status de recebimento'))
        chk.checked = !chk.checked
        return
      }

      carregarEmpresas()
    })
  })
}

formEmpresa.addEventListener('submit', async (e) => {
  e.preventDefault()

  const id = document.getElementById('empresaId').value
  const btnSalvar = document.getElementById('btnSalvar')

  const dados = {
    user_id: userId,
    nome: document.getElementById('nome').value.trim(),
    percentual_comissao: parseFloat(document.getElementById('percentualComissao').value) || 0,
  }

  btnSalvar.textContent = 'Salvando...'
  btnSalvar.disabled = true

  let error
  if (id) {
    const res = await supabase.from('empresas').update(dados).eq('id', id)
    error = res.error
  } else {
    const res = await supabase.from('empresas').insert(dados)
    error = res.error
  }

  btnSalvar.textContent = 'Salvar'
  btnSalvar.disabled = false

  if (error) { console.error('Erro ao salvar:', error); alert(mensagemErro(error)); return }

  fecharModal()
  carregarEmpresas()
})

function editarEmpresa(id, lista) {
  const empresa = lista.find(e => e.id === id)
  if (!empresa) return

  document.getElementById('empresaId').value = empresa.id
  document.getElementById('nome').value = empresa.nome || ''
  document.getElementById('percentualComissao').value = empresa.percentual_comissao || ''

  abrirModal('Editar Empresa')
}

async function excluirEmpresa(id) {
  const confirmar = confirm('Tem certeza que deseja excluir esta empresa?\nIsso pode afetar vendas já registradas.')
  if (!confirmar) return

  const { error } = await supabase.from('empresas').delete().eq('id', id)
  if (error) { console.error('Erro ao excluir:', error); alert('Erro ao excluir. Tente novamente.'); return }

  carregarEmpresas()
}

carregarEmpresas()