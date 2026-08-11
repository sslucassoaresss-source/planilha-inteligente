import { supabase } from './supabase.js'
import { mensagemErro } from './erros.js'

const { data: { session } } = await supabase.auth.getSession()
if (!session) {
  window.location.href = '../index.html'
  throw new Error('Sem sessão — redirecionando para login')
}

const userId = session.user.id
document.getElementById('conteudo').style.display = 'block'

const listaClientes   = document.getElementById('listaClientes')
const modalOverlay    = document.getElementById('modalOverlay')
const modalTitulo     = document.getElementById('modalTitulo')
const formCliente     = document.getElementById('formCliente')
const msgVazio        = document.getElementById('msgVazio')
const msgBuscaVazia   = document.getElementById('msgBuscaVazia')
const tabelaWrapper   = document.getElementById('tabelaWrapper')
const inputBuscaCliente = document.getElementById('buscaCliente')

let todosClientes = []

function abrirModal(titulo = 'Novo Cliente') {
  modalTitulo.textContent = titulo
  modalOverlay.classList.add('aberto')
}

function fecharModal() {
  modalOverlay.classList.remove('aberto')
  formCliente.reset()
  document.getElementById('clienteId').value = ''
  esconderSugestoesCidade()
}

document.getElementById('btnNovoCliente').addEventListener('click', () => abrirModal())
document.getElementById('btnFecharModal').addEventListener('click', fecharModal)
document.getElementById('btnCancelar').addEventListener('click', fecharModal)
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) fecharModal() })

document.getElementById('btnSair').addEventListener('click', async () => {
  await supabase.auth.signOut()
  window.location.href = '../index.html'
})

function normalizarTexto(txt) {
  return (txt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

// Mesma chave usada em Rotas pra agrupar cidades (sem acento, sem
// mai\u00fascula, sem espa\u00e7o extra) \u2014 \u00e9 o que decide se duas grafias s\u00e3o a
// mesma cidade.
function chaveCidade(cidade) {
  return normalizarTexto(cidade?.trim() || '').replace(/\s+/g, ' ')
}

// \u2500\u2500 Sugest\u00e3o de cidade no cadastro \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Cidade \u00e9 campo livre, e cada grafia diferente ("Sao Paulo", "S\u00c3O PAULO")
// vira um grupo separado na tela de Rotas. Sugerir as cidades j\u00e1 usadas
// evita essa diverg\u00eancia na origem, sem impedir cadastrar uma cidade nova.
const inputCidade = document.getElementById('cidade')

// Caixa presa ao <body>: o modal tem "overflow-y: auto" e cortaria a
// lista se ela ficasse dentro dele. z-index alto pra ficar acima do modal.
const boxSugestoesCidade = document.createElement('div')
boxSugestoesCidade.className = 'sugestoes-cidade'
document.body.appendChild(boxSugestoesCidade)

function esconderSugestoesCidade() {
  boxSugestoesCidade.style.display = 'none'
}

// Cidades j\u00e1 cadastradas, uma por grafia can\u00f4nica (a mais usada entre as
// varia\u00e7\u00f5es), em ordem alfab\u00e9tica.
function cidadesConhecidas() {
  const contagem = {}
  todosClientes.forEach(c => {
    const raw = c.cidade?.trim()
    if (!raw) return
    const chave = chaveCidade(raw)
    if (!contagem[chave]) contagem[chave] = {}
    contagem[chave][raw] = (contagem[chave][raw] || 0) + 1
  })

  return Object.values(contagem)
    .map(variacoes => Object.entries(variacoes).sort((a, b) => b[1] - a[1])[0][0])
    .sort((a, b) => a.localeCompare(b))
}

function posicionarSugestoesCidade() {
  const rect = inputCidade.getBoundingClientRect()
  boxSugestoesCidade.style.position = 'fixed'
  boxSugestoesCidade.style.top   = `${rect.bottom + 4}px`
  boxSugestoesCidade.style.left  = `${rect.left}px`
  boxSugestoesCidade.style.width = `${rect.width}px`
}

function renderizarSugestoesCidade() {
  const termo = chaveCidade(inputCidade.value)
  const resultados = cidadesConhecidas()
    .filter(cidade => !termo || chaveCidade(cidade).includes(termo))
    .slice(0, 8)

  // Nada a sugerir (nenhuma cidade cadastrada ainda, ou o que foi digitado
  // j\u00e1 \u00e9 exatamente uma cidade conhecida) \u2014 some, em vez de atrapalhar.
  const jaExato = resultados.length === 1 && chaveCidade(resultados[0]) === termo
  if (resultados.length === 0 || jaExato) {
    esconderSugestoesCidade()
    return
  }

  boxSugestoesCidade.innerHTML = ''
  resultados.forEach(cidade => {
    const item = document.createElement('div')
    item.className = 'sugestao-item'
    item.textContent = cidade
    // mousedown (n\u00e3o click) pra disparar antes do blur do input
    item.addEventListener('mousedown', (e) => {
      e.preventDefault()
      inputCidade.value = cidade
      esconderSugestoesCidade()
    })
    boxSugestoesCidade.appendChild(item)
  })

  posicionarSugestoesCidade()
  boxSugestoesCidade.style.display = 'block'
}

inputCidade.addEventListener('focus', renderizarSugestoesCidade)
inputCidade.addEventListener('input', renderizarSugestoesCidade)
inputCidade.addEventListener('blur', () => setTimeout(esconderSugestoesCidade, 150))

// O modal rola por dentro (overflow-y: auto), ent\u00e3o o scroll dele tamb\u00e9m
// precisa esconder a caixa \u2014 da\u00ed o listener em fase de captura.
window.addEventListener('scroll', esconderSugestoesCidade, true)

async function carregarClientes() {
  const { data, error } = await supabase
    .from('clientes')
    .select('*')
    .order('nome')

  if (error) { console.error('Erro ao carregar clientes:', error); return }

  todosClientes = data

  if (data.length === 0) {
    msgVazio.style.display = 'block'
    tabelaWrapper.style.display = 'none'
    document.querySelector('.filtros').style.display = 'none'
    return
  }

  msgVazio.style.display = 'none'
  document.querySelector('.filtros').style.display = 'block'

  renderizarTabela(todosClientes)
}

function renderizarTabela(lista) {
  listaClientes.innerHTML = ''

  if (lista.length === 0) {
    tabelaWrapper.style.display = 'none'
    msgBuscaVazia.style.display = 'block'
    return
  }

  msgBuscaVazia.style.display = 'none'
  tabelaWrapper.style.display = 'block'

  lista.forEach(cliente => {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td><strong>${cliente.nome}</strong></td>
      <td>${cliente.cidade || '—'}</td>
      <td>${cliente.telefone || '—'}</td>
      <td class="obs-cell" title="${cliente.observacoes || ''}">${cliente.observacoes || '—'}</td>
      <td class="celula-desconto" data-id="${cliente.id}">
        <button class="btn-desconto-rapido" data-id="${cliente.id}" data-valor="${cliente.desconto || 0}">
          ${cliente.desconto ? cliente.desconto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '+ desconto'}
        </button>
      </td>
      <td>
        <div class="acoes">
          <button class="btn-editar" data-id="${cliente.id}">Editar</button>
          <button class="btn-excluir" data-id="${cliente.id}">Excluir</button>
        </div>
      </td>
    `
    listaClientes.appendChild(tr)
  })

  document.querySelectorAll('.btn-editar').forEach(btn => {
    btn.addEventListener('click', () => editarCliente(btn.dataset.id, lista))
  })

  document.querySelectorAll('.btn-excluir').forEach(btn => {
    btn.addEventListener('click', () => excluirCliente(btn.dataset.id))
  })

  document.querySelectorAll('.btn-desconto-rapido').forEach(btn => {
    btn.addEventListener('click', () => abrirDescontoRapido(btn))
  })
}

// ── Busca dinâmica (filtra por nome ou cidade, ignorando acentos/maiúsculas) ──
inputBuscaCliente.addEventListener('input', () => {
  const termo = normalizarTexto(inputBuscaCliente.value)

  if (!termo) {
    renderizarTabela(todosClientes)
    return
  }

  const filtrados = todosClientes.filter(c =>
    normalizarTexto(c.nome).includes(termo) || normalizarTexto(c.cidade).includes(termo)
  )

  renderizarTabela(filtrados)
})

function abrirDescontoRapido(btn) {
  const celula = btn.closest('.celula-desconto')
  const id = btn.dataset.id
  const valorAtual = btn.dataset.valor

  celula.innerHTML = `
    <div class="desconto-inline">
      <input type="number" class="input-desconto-rapido" value="${valorAtual > 0 ? valorAtual : ''}"
             placeholder="0" step="0.01" min="0" max="100" autofocus>
      <button class="btn-salvar-desconto" data-id="${id}">✓</button>
    </div>
  `

  const input = celula.querySelector('.input-desconto-rapido')
  input.focus()
  input.select()

  const salvar = async () => {
    const novoValor = parseFloat(input.value) || 0
    const { error } = await supabase.from('clientes').update({ desconto: novoValor }).eq('id', id)
    if (error) {
      console.error('Erro ao salvar desconto:', error)
      alert('Erro ao salvar desconto.')
      return
    }
    carregarClientes()
  }

  celula.querySelector('.btn-salvar-desconto').addEventListener('click', salvar)
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') salvar() })
  input.addEventListener('blur', () => {
    // Pequeno delay pra permitir clique no botão de salvar antes de fechar
    setTimeout(() => { if (document.activeElement !== input) salvar() }, 150)
  })
}

formCliente.addEventListener('submit', async (e) => {
  e.preventDefault()

  const id = document.getElementById('clienteId').value
  const btnSalvar = document.getElementById('btnSalvar')

  // Coordenadas: aceita "lat, lng" colado direto do Google Maps
  const coordRaw = document.getElementById('coordenadas').value.trim()
  let latitude = null
  let longitude = null

  if (coordRaw) {
    const partes = coordRaw.split(',').map(p => parseFloat(p.trim()))
    if (partes.length === 2 && !isNaN(partes[0]) && !isNaN(partes[1])) {
      [latitude, longitude] = partes
    } else {
      alert('Coordenadas inválidas. Use o formato: latitude, longitude (ex: -23.1234, -47.5678)')
      return
    }
  }

  const dados = {
    user_id:     userId,
    nome:        document.getElementById('nome').value.trim(),
    endereco:    document.getElementById('endereco').value.trim(),
    latitude,
    longitude,
    bairro:      document.getElementById('bairro').value.trim(),
    cidade:      document.getElementById('cidade').value.trim(),
    estado:      document.getElementById('estado').value.trim().toUpperCase(),
    telefone:    document.getElementById('telefone').value.trim(),
    desconto:    parseFloat(document.getElementById('desconto').value) || 0,
    observacoes: document.getElementById('observacoes').value.trim(),
  }

  btnSalvar.textContent = 'Salvando...'
  btnSalvar.disabled = true

  let error
  if (id) {
    const res = await supabase.from('clientes').update(dados).eq('id', id)
    error = res.error
  } else {
    const res = await supabase.from('clientes').insert(dados)
    error = res.error
  }

  btnSalvar.textContent = 'Salvar'
  btnSalvar.disabled = false

  if (error) { console.error('Erro ao salvar:', error); alert(mensagemErro(error)); return }

  fecharModal()
  carregarClientes()
})

function editarCliente(id, lista) {
  const cliente = lista.find(c => c.id === id)
  if (!cliente) return

  document.getElementById('clienteId').value   = cliente.id
  document.getElementById('nome').value         = cliente.nome || ''
  document.getElementById('endereco').value     = cliente.endereco || ''
  document.getElementById('coordenadas').value  =
    (cliente.latitude != null && cliente.longitude != null) ? `${cliente.latitude}, ${cliente.longitude}` : ''
  document.getElementById('bairro').value       = cliente.bairro || ''
  document.getElementById('cidade').value       = cliente.cidade || ''
  document.getElementById('estado').value       = cliente.estado || ''
  document.getElementById('telefone').value     = cliente.telefone || ''
  document.getElementById('desconto').value     = cliente.desconto || ''
  document.getElementById('observacoes').value  = cliente.observacoes || ''

  abrirModal('Editar Cliente')
}

async function excluirCliente(id) {
  const confirmar = confirm('Tem certeza que deseja excluir este cliente?\nEssa ação não pode ser desfeita.')
  if (!confirmar) return

  const { error } = await supabase.from('clientes').delete().eq('id', id)
  if (error) { console.error('Erro ao excluir:', error); alert('Erro ao excluir. Tente novamente.'); return }

  carregarClientes()
}

carregarClientes()