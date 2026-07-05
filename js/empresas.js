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

const listaEmpresas = document.getElementById('listaEmpresas')
const modalOverlay  = document.getElementById('modalOverlay')
const formEmpresa   = document.getElementById('formEmpresa')

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
  const { data, error } = await supabase
    .from('empresas')
    .select('*')
    .order('nome')

  if (error) { console.error('Erro ao carregar empresas:', error); return }

  listaEmpresas.innerHTML = ''

  const msgVazio = document.getElementById('msgVazio')
  const tabelaWrapper = document.getElementById('tabelaWrapper')

  if (data.length === 0) {
    msgVazio.style.display = 'block'
    tabelaWrapper.style.display = 'none'
    return
  }

  msgVazio.style.display = 'none'
  tabelaWrapper.style.display = 'block'

  data.forEach(empresa => {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td><strong>${empresa.nome}</strong></td>
      <td>${empresa.percentual_comissao || 0}%</td>
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

  if (error) { console.error('Erro ao salvar:', error); alert('Erro ao salvar. Tente novamente.'); return }

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