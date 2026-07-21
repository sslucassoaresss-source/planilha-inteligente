import { supabase } from './supabase.js'
import { mensagemErro } from './erros.js'
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/+esm'

// ── Proteção de rota ──────────────────────────────────────────
const { data: { session } } = await supabase.auth.getSession()
if (!session) {
  window.location.href = '../index.html'
  throw new Error('Sem sessão — redirecionando para login')
}

const userId = session.user.id
document.getElementById('conteudo').style.display = 'block'

// Esconde qualquer caixa de sugestão de cliente aberta ao rolar a página —
// como elas são posicionadas via coordenadas fixas (ver carregarRotas), sem
// isso ficariam "flutuando" no lugar errado depois do scroll.
window.addEventListener('scroll', () => {
  document.querySelectorAll('.sugestoes-cliente-flutuante').forEach(el => {
    el.style.display = 'none'
  })
}, true)

// ── Sair ──────────────────────────────────────────────────────
document.getElementById('btnSair').addEventListener('click', async () => {
  await supabase.auth.signOut()
  window.location.href = '../index.html'
})

// ── Seletor de mês (só usado pelo Calendário — rotas são fixas agora) ──
const selectMes = document.getElementById('selectMes')
const hoje = new Date()
const hojeISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`

// Do mais recente pro mais antigo (mês atual/futuros no topo, indo pra baixo)
for (let i = 4; i >= -12; i--) {
  const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1)
  const valor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const opt = document.createElement('option')
  opt.value = valor
  opt.textContent = label.charAt(0).toUpperCase() + label.slice(1)
  if (i === 0) opt.selected = true
  selectMes.appendChild(opt)
}

selectMes.addEventListener('change', () => carregarRotas())

// ── Alternância Rotas Salvas / Calendário ──────────────────────
const btnVisaoLista       = document.getElementById('btnVisaoLista')
const btnVisaoCalendario  = document.getElementById('btnVisaoCalendario')
const filtroMes           = document.querySelector('.filtro-mes')

function mostrarLista() {
  document.getElementById('listaCidades').style.display = 'block'
  document.getElementById('calendarioMes').style.display = 'none'
  // O seletor de mês só faz sentido no Calendário agora — rotas são fixas
  // e não pertencem mais a nenhum mês específico.
  filtroMes.style.display = 'none'
  btnVisaoLista.classList.add('ativo')
  btnVisaoCalendario.classList.remove('ativo')
}

function mostrarCalendarioView() {
  document.getElementById('listaCidades').style.display = 'none'
  document.getElementById('calendarioMes').style.display = 'block'
  filtroMes.style.display = ''
  btnVisaoCalendario.classList.add('ativo')
  btnVisaoLista.classList.remove('ativo')
}

btnVisaoLista.addEventListener('click', mostrarLista)
btnVisaoCalendario.addEventListener('click', mostrarCalendarioView)

// ── Modal (nova rota / editar rota) ────────────────────────────
const modalOverlay  = document.getElementById('modalOverlay')
const formRota      = document.getElementById('formRota')

// Id da rota de origem quando o modal foi aberto pra "Duplicar" — se
// setado, o submit copia os clientes (e a ordem) dessa rota pra rota nova
// criada. Fica null em qualquer outro fluxo (nova rota / editar rota).
let duplicarOrigemId = null

function abrirModal(cidade, rotaId, nomeAtual, obsAtual) {
  document.getElementById('rotaCidade').value = cidade
  document.getElementById('rotaId').value = rotaId || ''
  document.getElementById('nomeRota').value = nomeAtual || ''
  document.getElementById('obsRota').value = obsAtual || ''
  document.getElementById('modalTitulo').textContent = rotaId
    ? `Editar rota — ${cidade}`
    : `Nova rota — ${cidade}`
  modalOverlay.classList.add('aberto')
}

function fecharModal() {
  modalOverlay.classList.remove('aberto')
  formRota.reset()
  duplicarOrigemId = null
}

document.getElementById('btnFecharModal').addEventListener('click', fecharModal)
document.getElementById('btnCancelar').addEventListener('click', fecharModal)
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) fecharModal() })

// ── Salvar rota (nova ou edição) — rota fixa, sem mês/data própria ──
formRota.addEventListener('submit', async (e) => {
  e.preventDefault()

  const cidade = document.getElementById('rotaCidade').value
  const rotaId = document.getElementById('rotaId').value
  const nome   = document.getElementById('nomeRota').value.trim()
  const obs    = document.getElementById('obsRota').value.trim()

  const dados = {
    user_id:    userId,
    cidade,
    nome,
    observacao: obs || null
  }

  let error
  let novaRotaId = null

  if (rotaId) {
    const res = await supabase.from('rotas').update(dados).eq('id', rotaId)
    error = res.error
  } else {
    const res = await supabase.from('rotas').insert(dados).select().single()
    error = res.error
    novaRotaId = res.data?.id
  }

  if (error) {
    console.error('Erro ao salvar rota:', error)
    alert(mensagemErro(error))
    return
  }

  // Duplicação: copia os clientes (e a ordem) da rota de origem pra rota
  // recém-criada. Só roda em inserts (rotaId vazio) originados do botão
  // "Duplicar" — edição normal e nova rota em branco não passam por aqui.
  if (!rotaId && duplicarOrigemId && novaRotaId) {
    const { data: vinculosOrigem, error: errOrigem } = await supabase
      .from('rota_clientes')
      .select('cliente_id, ordem')
      .eq('rota_id', duplicarOrigemId)
      .order('ordem')

    if (errOrigem) {
      console.error('Erro ao copiar clientes da rota de origem:', errOrigem)
    } else if (vinculosOrigem.length > 0) {
      const copias = vinculosOrigem.map(v => ({
        user_id:    userId,
        rota_id:    novaRotaId,
        cliente_id: v.cliente_id,
        ordem:      v.ordem
      }))
      const { error: errCopia } = await supabase.from('rota_clientes').insert(copias)
      if (errCopia) console.error('Erro ao copiar clientes da rota de origem:', errCopia)
    }
  }
  duplicarOrigemId = null

  fecharModal()
  carregarRotas([normalizarCidade(cidade)])
})

// ── Modal (atribuir rota fixa já criada a um dia do calendário) ──
const modalAtribuirOverlay  = document.getElementById('modalAtribuirOverlay')
const formAtribuir          = document.getElementById('formAtribuir')
const selectRotaAtribuir    = document.getElementById('selectRotaAtribuir')
const msgSemRotas           = document.getElementById('msgSemRotas')
const btnAtribuir           = document.getElementById('btnAtribuir')

let diaSelecionadoParaAtribuir = null

function abrirModalAtribuir(dia, ano, mes, todasRotasFixas) {
  diaSelecionadoParaAtribuir = { dia, ano, mes }

  const diaFormatado = `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`
  document.getElementById('modalAtribuirTitulo').textContent = `Atribuir rota ao dia ${diaFormatado}`

  selectRotaAtribuir.innerHTML = ''

  if (todasRotasFixas.length === 0) {
    selectRotaAtribuir.style.display = 'none'
    btnAtribuir.style.display = 'none'
    msgSemRotas.style.display = 'block'
  } else {
    selectRotaAtribuir.style.display = ''
    btnAtribuir.style.display = ''
    msgSemRotas.style.display = 'none'

    todasRotasFixas
      .slice()
      .sort((a, b) => a.cidade.localeCompare(b.cidade) || a.nome.localeCompare(b.nome))
      .forEach(r => {
        const opt = document.createElement('option')
        opt.value = r.id
        opt.textContent = `${r.nome} — ${r.cidade}`
        selectRotaAtribuir.appendChild(opt)
      })
  }

  modalAtribuirOverlay.classList.add('aberto')
}

function fecharModalAtribuir() {
  modalAtribuirOverlay.classList.remove('aberto')
  formAtribuir.reset()
  diaSelecionadoParaAtribuir = null
}

document.getElementById('btnFecharAtribuir').addEventListener('click', fecharModalAtribuir)
document.getElementById('btnCancelarAtribuir').addEventListener('click', fecharModalAtribuir)
modalAtribuirOverlay.addEventListener('click', (e) => { if (e.target === modalAtribuirOverlay) fecharModalAtribuir() })

// Atribuir sempre CRIA uma nova ocorrência (nunca move uma já existente) —
// assim a mesma rota fixa pode rodar em mais de um dia do mesmo mês, se for
// o caso, e o histórico de meses anteriores nunca é sobrescrito.
formAtribuir.addEventListener('submit', async (e) => {
  e.preventDefault()
  if (!diaSelecionadoParaAtribuir) return

  const { dia, ano, mes } = diaSelecionadoParaAtribuir
  const rotaId = selectRotaAtribuir.value
  if (!rotaId) return

  const data = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`

  const { error } = await supabase.from('rota_agendamentos').insert({
    user_id: userId,
    rota_id: rotaId,
    data
  })

  if (error) {
    console.error('Erro ao agendar rota:', error)
    alert(mensagemErro(error, 'agendar a rota'))
    return
  }

  fecharModalAtribuir()
  carregarRotas()
})

function linkMapsDe(c) {
  if (c.latitude != null && c.longitude != null) {
    return `https://maps.google.com/?q=${c.latitude},${c.longitude}`
  }
  const enderecoCompleto = [c.endereco, c.bairro, c.cidade, c.estado].filter(Boolean).join(', ')
  return enderecoCompleto
    ? `https://maps.google.com/?q=${encodeURIComponent(enderecoCompleto)}`
    : null
}

function enderecoDe(c) {
  return [c.endereco, c.bairro, c.cidade, c.estado].filter(Boolean).join(', ') || '—'
}

// Normaliza o nome da cidade pra agrupar ignorando maiúscula/minúscula e espaços extras
function normalizarCidade(cidade) {
  return (cidade?.trim() || 'Sem cidade').toLowerCase().replace(/\s+/g, ' ')
}

// Remove acentos e ignora maiúscula/minúscula, pra buscar "sao paulo" e achar "São Paulo"
// (mesmo helper usado na busca de cliente em Visitas)
function normalizarTexto(txt) {
  return (txt || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

// ── Carregar e renderizar ─────────────────────────────────────
// "chavesParaAbrir" recebe as cidades (já normalizadas) que devem
// continuar/ficar abertas depois do recarregamento — sem isso, toda
// ação (criar rota, adicionar/remover cliente, etc.) reconstrói os
// cards do zero e todas as cidades fecham sozinhas.
async function carregarRotas(chavesParaAbrir = []) {
  const [ano, mes]  = selectMes.value.split('-')
  const diasNoMes   = new Date(parseInt(ano), parseInt(mes), 0).getDate()
  const primeiroDia = `${ano}-${mes}-01`
  const ultimoDia   = `${ano}-${mes}-${String(diasNoMes).padStart(2, '0')}`

  // Todos os clientes (pra agrupar por cidade e alimentar o "+ adicionar")
  const { data: clientes, error: errClientes } = await supabase
    .from('clientes')
    .select('*')
    .order('nome')

  if (errClientes) {
    console.error('Erro ao carregar clientes:', errClientes)
    return
  }

  // Rotas fixas — não pertencem mais a nenhum mês, então sempre buscamos todas.
  const { data: rotas } = await supabase
    .from('rotas')
    .select('*')

  // Agendamentos (ocorrências no calendário) só do mês em exibição
  const { data: agendamentosDoMes, error: errAgendamentosMes } = await supabase
    .from('rota_agendamentos')
    .select('id, rota_id, data')
    .gte('data', primeiroDia)
    .lte('data', ultimoDia)

  if (errAgendamentosMes) console.error('Erro ao carregar agendamentos do mês:', errAgendamentosMes)

  // Todas as datas já agendadas de cada rota (passadas e futuras), pra
  // mostrar em Rotas Salvas — passadas em vermelho, futuras em verde.
  const { data: todosAgendamentos, error: errTodosAgendamentos } = await supabase
    .from('rota_agendamentos')
    .select('rota_id, data')
    .order('data')

  if (errTodosAgendamentos) console.error('Erro ao carregar agendamentos:', errTodosAgendamentos)

  const datasPorRota = {}
  todosAgendamentos?.forEach(a => {
    if (!datasPorRota[a.rota_id]) datasPorRota[a.rota_id] = []
    datasPorRota[a.rota_id].push(a.data)
  })

  // Agrupa as rotas fixas por cidade normalizada.
  // Várias rotas na mesma cidade são esperadas e desejadas
  // (ex: "Rota 1" e "Rota 2" em Indaiatuba) — não mesclamos automaticamente.
  const rotasPorCidade = {}
  rotas?.forEach(r => {
    const chave = normalizarCidade(r.cidade)
    if (!rotasPorCidade[chave]) rotasPorCidade[chave] = []
    rotasPorCidade[chave].push(r)
  })

  // Clientes já vinculados a cada rota (lista fixa e ordenada)
  const rotaIds = (rotas || []).map(r => r.id)
  let rotaClientesPorRota = {}

  if (rotaIds.length > 0) {
    const { data: vinculos, error: errVinc } = await supabase
      .from('rota_clientes')
      .select('*, clientes(*)')
      .in('rota_id', rotaIds)
      .order('ordem')

    if (errVinc) {
      console.error('Erro ao carregar clientes da rota:', errVinc)
    } else {
      vinculos.forEach(v => {
        if (!rotaClientesPorRota[v.rota_id]) rotaClientesPorRota[v.rota_id] = []
        rotaClientesPorRota[v.rota_id].push(v)
      })
    }
  }

  const listaCidades  = document.getElementById('listaCidades')
  const msgVazio      = document.getElementById('msgVazio')
  const alertaDivisao = document.getElementById('alertaDivisao')

  // Guarda quem já estava aberto antes de apagar tudo, e soma as
  // cidades que devem abrir por causa da ação que acabou de acontecer
  const cidadesAbertas = new Set([
    ...Array.from(listaCidades.querySelectorAll('.cidade-card.aberto')).map(el => el.dataset.cidadeChave),
    ...chavesParaAbrir
  ])

  listaCidades.innerHTML = ''

  // As caixas de sugestão de cliente (ver renderização abaixo) são anexadas
  // direto no <body> pra escapar do "overflow: hidden" do card — como os
  // cards são recriados do zero a cada chamada, removemos as antigas aqui
  // pra não acumular elementos órfãos.
  document.querySelectorAll('.sugestoes-cliente-flutuante').forEach(el => el.remove())

  if (clientes.length === 0) {
    msgVazio.style.display = 'block'
    return
  }

  msgVazio.style.display = 'none'

  // Agrupa clientes por cidade normalizada (ignora maiúscula/minúscula e espaços)
  const grupos = {}
  const contagemNomes = {}
  clientes.forEach(c => {
    const raw = c.cidade?.trim() || 'Sem cidade'
    const chave = normalizarCidade(raw)
    if (!grupos[chave]) { grupos[chave] = []; contagemNomes[chave] = {} }
    grupos[chave].push(c)
    contagemNomes[chave][raw] = (contagemNomes[chave][raw] || 0) + 1
  })

  // Escolhe o nome de exibição mais comum de cada grupo (ex: entre "indaiatuba" e "Indaiatuba")
  const nomeExibicao = {}
  for (const chave of Object.keys(grupos)) {
    nomeExibicao[chave] = Object.entries(contagemNomes[chave])
      .sort((a, b) => b[1] - a[1])[0][0]
  }

  // Cidades com rota fixa criada mas sem nenhum cliente atual (ex: cliente que
  // gerou o grupo foi excluído ou mudou de cidade depois) não entram em
  // "grupos" acima — sem isso a rota fica presa: some de Rotas Salvas e vira
  // "Rota — undefined" no Calendário, sem jeito de editar/excluir.
  Object.keys(rotasPorCidade).forEach(chave => {
    if (!grupos[chave]) {
      grupos[chave] = []
      nomeExibicao[chave] = rotasPorCidade[chave][0].cidade?.trim() || 'Sem cidade'
    }
  })

  const temAlerta = Object.values(grupos).some(g => g.length > 40)
  alertaDivisao.style.display = temAlerta ? 'block' : 'none'

  // Mapa rota_id -> {nome, cidade, chave}, reaproveitado tanto no Calendário
  // quanto no seletor do modal "Atribuir rota ao dia".
  const infoPorRotaId = {}
  rotas?.forEach(r => {
    const chave = normalizarCidade(r.cidade)
    infoPorRotaId[r.id] = { nome: r.nome?.trim() || 'Rota', cidade: nomeExibicao[chave], chave }
  })

  const rotasPorDia = {}
  agendamentosDoMes?.forEach(a => {
    const info = infoPorRotaId[a.rota_id]
    if (!info) return
    const dia = parseInt(a.data.split('-')[2], 10)
    if (!rotasPorDia[dia]) rotasPorDia[dia] = []
    rotasPorDia[dia].push({ agendamentoId: a.id, chave: info.chave, nome: info.nome, cidade: info.cidade })
  })

  const todasRotasFixas = (rotas || []).map(r => ({
    id:     r.id,
    nome:   infoPorRotaId[r.id].nome,
    cidade: infoPorRotaId[r.id].cidade
  }))

  renderizarCalendario(parseInt(ano), parseInt(mes), rotasPorDia, todasRotasFixas)

  // ── Renderiza cada cidade ──
  Object.entries(grupos)
    .sort(([a], [b]) => nomeExibicao[a].localeCompare(nomeExibicao[b]))
    .forEach(([chave, listaClientesCidade]) => {
      const cidade = nomeExibicao[chave]
      const excede = listaClientesCidade.length > 40

      const rotasDaCidade = (rotasPorCidade[chave] || [])
        .slice()
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

      const card = document.createElement('div')
      card.className = 'cidade-card'
      card.setAttribute('data-cidade-chave', chave)
      if (cidadesAbertas.has(chave)) card.classList.add('aberto')
      card.innerHTML = `
        <div class="cidade-header">
          <div class="cidade-info">
            <span class="cidade-nome">${cidade}</span>
            <span class="cidade-count ${excede ? 'alerta-count' : ''}">
              ${listaClientesCidade.length} cliente${listaClientesCidade.length !== 1 ? 's' : ''}${excede ? ' ⚠️' : ''}
            </span>
            <span class="cidade-count">${rotasDaCidade.length} rota${rotasDaCidade.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="cidade-direita">
            <button class="btn-definir btn-nova-rota">+ Nova Rota</button>
            <span class="chevron">▼</span>
          </div>
        </div>

        <div class="cidade-clientes">
          ${rotasDaCidade.length === 0
            ? '<p class="dica-arrastar" style="padding:14px 20px 18px;">Nenhuma rota criada ainda nesta cidade. Clique em "+ Nova Rota" para começar.</p>'
            : rotasDaCidade.map((rota, i) => renderizarRotaSubcard(rota, i, clientes, rotaClientesPorRota[rota.id] || [], datasPorRota[rota.id] || [])).join('')}
        </div>
      `

      // Abrir/fechar a cidade
      card.querySelector('.cidade-header').addEventListener('click', (e) => {
        if (e.target.closest('.btn-nova-rota')) return
        card.classList.toggle('aberto')
      })

      // + Nova Rota
      card.querySelector('.btn-nova-rota').addEventListener('click', (e) => {
        e.stopPropagation()
        abrirModal(cidade, null, '', '')
      })

      // Liga os eventos de cada sub-card de rota
      rotasDaCidade.forEach(rota => {
        const subcard = card.querySelector(`.rota-subcard[data-rota-id="${rota.id}"]`)
        if (!subcard) return

        const vinculosRota = rotaClientesPorRota[rota.id] || []

        // Editar rota (nome, observação)
        subcard.querySelector('.btn-editar-rota').addEventListener('click', (e) => {
          e.stopPropagation()
          abrirModal(cidade, rota.id, rota.nome, rota.observacao)
        })

        // Duplicar rota — cria uma cópia (mesma cidade, mesma lista de
        // clientes e ordem), pra variar levemente uma rota existente sem
        // montar do zero. Agendar quando ela roda é feito depois, no
        // Calendário — a cópia nasce sem nenhuma data.
        subcard.querySelector('.btn-duplicar-rota').addEventListener('click', (e) => {
          e.stopPropagation()
          abrirModal(cidade, null, `${rota.nome?.trim() || 'Rota'} (cópia)`, rota.observacao || '')
          document.getElementById('modalTitulo').textContent = `Duplicar rota — ${cidade}`
          duplicarOrigemId = rota.id
        })

        // Excluir a rota inteira (a rota fixa, os vínculos de clientes e
        // todas as datas agendadas dela)
        subcard.querySelector('.btn-excluir-rota-completa').addEventListener('click', async (e) => {
          e.stopPropagation()
          const confirmar = confirm(
            `Excluir a rota "${rota.nome || 'sem nome'}"?\nOs clientes só serão desvinculados desta rota — nenhum cadastro é apagado. As datas já agendadas dela também serão removidas.`
          )
          if (!confirmar) return

          // Remove primeiro os vínculos/agendamentos, depois a rota (evita erro de referência)
          await supabase.from('rota_clientes').delete().eq('rota_id', rota.id)
          await supabase.from('rota_agendamentos').delete().eq('rota_id', rota.id)
          const { error } = await supabase.from('rotas').delete().eq('id', rota.id)

          if (error) {
            console.error('Erro ao excluir rota:', error)
            alert('Erro ao excluir rota.')
            return
          }
          carregarRotas([chave])
        })

        // Remover cliente da rota
        subcard.querySelectorAll('.btn-remover-rota').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation()
            const vinculoId = btn.dataset.vinculoId
            const { error } = await supabase.from('rota_clientes').delete().eq('id', vinculoId)
            if (error) {
              console.error('Erro ao remover cliente da rota:', error)
              alert('Erro ao remover cliente da rota.')
              return
            }
            carregarRotas([chave])
          })
        })

        // Adicionar cliente à rota — busca com autocomplete (mesmo padrão de Visitas),
        // em vez de um <select> com todos os clientes pra rolar um por um
        const inputBuscaCliente = subcard.querySelector('.input-busca-cliente-rota')
        const btnAdd            = subcard.querySelector('.btn-add-cliente-rota')

        if (inputBuscaCliente && btnAdd) {
          // Restrito aos clientes desta cidade — evita adicionar por engano
          // um cliente de outra cidade dentro da rota errada.
          const clientesDisponiveis = listaClientesCidade.filter(c => !vinculosRota.some(v => v.cliente_id === c.id))
          let clienteEscolhido = null

          // A caixa de sugestões é anexada direto no <body>, em vez de ficar
          // dentro do card de cidade — o card tem "overflow: hidden" (pra manter
          // os cantos arredondados) e isso cortava a lista quando ela aparecia
          // perto do fim do card. Posicionamos via JS usando as coordenadas
          // reais do campo na tela, então ela sempre aparece por cima de tudo.
          const boxSugestoesCliente = document.createElement('div')
          boxSugestoesCliente.className = 'sugestoes-cliente sugestoes-cliente-flutuante'
          document.body.appendChild(boxSugestoesCliente)

          function posicionarSugestoes() {
            const rect = inputBuscaCliente.getBoundingClientRect()
            boxSugestoesCliente.style.position = 'fixed'
            boxSugestoesCliente.style.top   = `${rect.bottom + 4}px`
            boxSugestoesCliente.style.left  = `${rect.left}px`
            boxSugestoesCliente.style.width = `${rect.width}px`
            boxSugestoesCliente.style.right = 'auto'
          }

          function renderizarSugestoesRota(filtro) {
            const termo = normalizarTexto(filtro)
            boxSugestoesCliente.innerHTML = ''

            if (!termo) {
              boxSugestoesCliente.style.display = 'none'
              return
            }

            const resultados = clientesDisponiveis
              .filter(c => normalizarTexto(c.nome).includes(termo))
              .slice(0, 8)

            if (resultados.length === 0) {
              boxSugestoesCliente.innerHTML = '<div class="sugestao-vazia">Nenhum cliente encontrado</div>'
              posicionarSugestoes()
              boxSugestoesCliente.style.display = 'block'
              return
            }

            resultados.forEach(c => {
              const item = document.createElement('div')
              item.className = 'sugestao-item'
              item.textContent = `${c.nome}${c.cidade ? ' — ' + c.cidade : ''}`
              // mousedown (não click) pra disparar antes do blur do input
              item.addEventListener('mousedown', (e) => {
                e.preventDefault()
                clienteEscolhido = c
                inputBuscaCliente.value = c.nome
                boxSugestoesCliente.innerHTML = ''
                boxSugestoesCliente.style.display = 'none'
                btnAdd.disabled = false
              })
              boxSugestoesCliente.appendChild(item)
            })

            posicionarSugestoes()
            boxSugestoesCliente.style.display = 'block'
          }

          inputBuscaCliente.addEventListener('input', () => {
            // Enquanto o usuário digita, invalida a seleção anterior
            clienteEscolhido = null
            btnAdd.disabled = true
            renderizarSugestoesRota(inputBuscaCliente.value)
          })

          inputBuscaCliente.addEventListener('focus', () => {
            if (inputBuscaCliente.value) renderizarSugestoesRota(inputBuscaCliente.value)
          })

          inputBuscaCliente.addEventListener('blur', () => {
            setTimeout(() => { boxSugestoesCliente.style.display = 'none' }, 150)
          })

          btnAdd.addEventListener('click', async (e) => {
            e.stopPropagation()
            if (!clienteEscolhido) {
              alert('Escolha um cliente da lista de sugestões antes de adicionar.')
              inputBuscaCliente.focus()
              return
            }

            const proximaOrdem = vinculosRota.length > 0
              ? Math.max(...vinculosRota.map(v => v.ordem)) + 1
              : 0

            const { error } = await supabase.from('rota_clientes').insert({
              user_id: userId,
              rota_id: rota.id,
              cliente_id: clienteEscolhido.id,
              ordem: proximaOrdem
            })

            if (error) {
              console.error('Erro ao adicionar cliente à rota:', error)
              alert(mensagemErro(error, 'adicionar cliente à rota'))
              return
            }
            carregarRotas([chave])
          })
        }

        // Drag and drop pra reordenar (uma instância por rota)
        ativarDragDrop(subcard.querySelector('.rota-lista-clientes'), rota.id)
      })

      listaCidades.appendChild(card)
    })
}

function renderizarRotaSubcard(rota, index, clientes, vinculosRota, datas) {
  const nomeRota = rota.nome?.trim() || `Rota ${index + 1}`

  // Cada data já agendada da rota vira um badge — vermelho se já passou,
  // verde se ainda vai acontecer (comparado com hoje).
  const badgesData = datas.length === 0
    ? '<span class="data-badge sem-data">Sem visita agendada</span>'
    : datas.map(d => {
        const futura = d >= hojeISO
        const formatada = new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
        return `<span class="data-badge ${futura ? 'data-futura' : 'data-passada'}">📅 ${formatada}</span>`
      }).join('')

  return `
    <div class="rota-subcard" data-rota-id="${rota.id}">
      <div class="rota-subcard-header">
        <div class="rota-subcard-info">
          <span class="rota-nome">${nomeRota}</span>
          <div class="rota-datas">${badgesData}</div>
        </div>
        <div class="rota-subcard-acoes">
          <button class="btn-duplicar-rota" title="Duplicar esta rota">⧉</button>
          <button class="btn-definir btn-editar-rota">Editar</button>
          <button class="btn-excluir-rota-completa" title="Excluir esta rota">🗑️</button>
        </div>
      </div>

      <div class="rota-lista-clientes" data-rota-id="${rota.id}">
        ${renderizarListaFixa(vinculosRota)}
      </div>

      ${vinculosRota.length > 0 ? '<p class="dica-arrastar">Arraste ⠿ para reordenar a sequência de visita.</p>' : ''}

      <div class="adicionar-cliente-rota">
        <div class="campo-busca-cliente">
          <input type="text" class="input-busca-cliente-rota" placeholder="Buscar cliente para adicionar..." autocomplete="off">
        </div>
        <button class="btn-add-cliente-rota" disabled>Adicionar</button>
      </div>
    </div>
  `
}

// ── Visão em calendário do mês ──────────────────────────────────
const nomesDiasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function renderizarCalendario(ano, mes, rotasPorDia, todasRotasFixas) {
  const calendario = document.getElementById('calendarioMes')
  calendario.innerHTML = ''

  const diasNoMes         = new Date(ano, mes, 0).getDate()
  const primeiroDiaSemana = new Date(ano, mes - 1, 1).getDay()

  const grid = document.createElement('div')
  grid.className = 'calendario-grid'

  nomesDiasSemana.forEach(nome => {
    const cab = document.createElement('div')
    cab.className = 'calendario-cabecalho'
    cab.textContent = nome
    grid.appendChild(cab)
  })

  for (let i = 0; i < primeiroDiaSemana; i++) {
    const vazio = document.createElement('div')
    vazio.className = 'calendario-dia vazio'
    grid.appendChild(vazio)
  }

  for (let dia = 1; dia <= diasNoMes; dia++) {
    const celula = document.createElement('div')
    celula.className = 'calendario-dia'

    const rotasDoDia = rotasPorDia[dia] || []

    celula.innerHTML = `
      <div class="calendario-dia-numero">${dia}</div>
      ${rotasDoDia.map(r => `
        <div class="calendario-rota-item">
          <button class="calendario-rota-pill" data-chave="${r.chave}">${r.nome} — ${r.cidade}</button>
          <button class="calendario-rota-remover" data-agendamento-id="${r.agendamentoId}" title="Remover desta data">×</button>
        </div>
      `).join('')}
    `

    // Clicar em qualquer parte vazia do dia abre o seletor pra atribuir
    // uma das rotas fixas já criadas a esse dia — assim o calendário vira
    // o jeito principal de marcar quando cada rota roda, sem precisar
    // remontar nada em Rotas Salvas.
    celula.addEventListener('click', () => {
      abrirModalAtribuir(dia, ano, mes, todasRotasFixas)
    })

    grid.appendChild(celula)
  }

  calendario.appendChild(grid)

  // Clique numa rota do calendário: volta pra Rotas Salvas e abre a cidade correspondente
  calendario.querySelectorAll('.calendario-rota-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation() // não deixa abrir também o modal de atribuir do dia
      const chave = btn.dataset.chave
      mostrarLista()
      const card = document.querySelector(`.cidade-card[data-cidade-chave="${chave}"]`)
      if (card) {
        card.classList.add('aberto')
        card.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  })

  // "×" no pill: remove só esta ocorrência (a rota fixa e os clientes continuam intactos)
  calendario.querySelectorAll('.calendario-rota-remover').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const confirmar = confirm('Remover esta rota desta data? A rota e os clientes continuam salvos normalmente.')
      if (!confirmar) return

      const { error } = await supabase.from('rota_agendamentos').delete().eq('id', btn.dataset.agendamentoId)
      if (error) {
        console.error('Erro ao remover agendamento:', error)
        alert(mensagemErro(error, 'remover a rota desta data'))
        return
      }
      carregarRotas()
    })
  })
}

function renderizarListaFixa(vinculos) {
  if (vinculos.length === 0) {
    return `<div class="cliente-row"><span style="color:var(--text-soft);font-size:13px;">Nenhum cliente nesta rota ainda. Adicione abaixo.</span></div>`
  }

  return vinculos.map((v, i) => {
    const c = v.clientes
    const maps = linkMapsDe(c)
    return `
      <div class="cliente-row arrastavel" draggable="true" data-vinculo-id="${v.id}" data-cliente-id="${c.id}">
        <span class="drag-handle">⠿</span>
        <span class="ordem-numero">${i + 1}</span>
        <div class="cliente-row-conteudo">
          <div class="cliente-row-nome">${c.nome}</div>
          <div class="cliente-row-end">${enderecoDe(c)}</div>
        </div>
        <div class="cliente-row-acoes">
          ${maps ? `<a href="${maps}" target="_blank" class="btn-maps">📍</a>` : ''}
          <button class="btn-remover-rota" data-vinculo-id="${v.id}" title="Remover da rota">✕</button>
        </div>
      </div>
    `
  }).join('')
}

// ── Drag and drop (funciona em mouse e touch) ──────────────
function ativarDragDrop(container, rotaId) {
  Sortable.create(container, {
    handle: '.drag-handle',
    draggable: '.arrastavel',
    animation: 150,
    ghostClass: 'arrastando',
    onEnd: async () => {
      const linhas = Array.from(container.querySelectorAll('.cliente-row.arrastavel'))

      // Atualiza os números visíveis na tela imediatamente
      linhas.forEach((row, i) => {
        const numero = row.querySelector('.ordem-numero')
        if (numero) numero.textContent = i + 1
      })

      // Persiste a nova ordem no banco
      const novaOrdem = linhas.map((row, i) => ({ id: row.dataset.vinculoId, ordem: i }))
      for (const item of novaOrdem) {
        await supabase.from('rota_clientes').update({ ordem: item.ordem }).eq('id', item.id)
      }
    }
  })
}

// ── Inicializar ───────────────────────────────────────────────
mostrarLista()
carregarRotas()
