import { supabase } from './supabase.js'
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/+esm'

// ── Proteção de rota ──────────────────────────────────────────
const { data: { session } } = await supabase.auth.getSession()
if (!session) {
  window.location.href = '../index.html'
  throw new Error('Sem sessão — redirecionando para login')
}

const userId = session.user.id
document.getElementById('conteudo').style.display = 'block'

// ── Sair ──────────────────────────────────────────────────────
document.getElementById('btnSair').addEventListener('click', async () => {
  await supabase.auth.signOut()
  window.location.href = '../index.html'
})

// ── Seletor de mês ────────────────────────────────────────────
const selectMes = document.getElementById('selectMes')
const hoje = new Date()

for (let i = -12; i < 5; i++) {
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

// ── Alternância Lista / Calendário ─────────────────────────────
const btnVisaoLista       = document.getElementById('btnVisaoLista')
const btnVisaoCalendario  = document.getElementById('btnVisaoCalendario')

function mostrarLista() {
  document.getElementById('listaCidades').style.display = 'block'
  document.getElementById('calendarioMes').style.display = 'none'
  btnVisaoLista.classList.add('ativo')
  btnVisaoCalendario.classList.remove('ativo')
}

function mostrarCalendarioView() {
  document.getElementById('listaCidades').style.display = 'none'
  document.getElementById('calendarioMes').style.display = 'block'
  btnVisaoCalendario.classList.add('ativo')
  btnVisaoLista.classList.remove('ativo')
}

btnVisaoLista.addEventListener('click', mostrarLista)
btnVisaoCalendario.addEventListener('click', mostrarCalendarioView)

// ── Modal (nova rota / editar rota) ────────────────────────────
const modalOverlay  = document.getElementById('modalOverlay')
const formRota      = document.getElementById('formRota')

function abrirModal(cidade, rotaId, nomeAtual, dataAtual, obsAtual) {
  document.getElementById('rotaCidade').value = cidade
  document.getElementById('rotaId').value = rotaId || ''
  document.getElementById('nomeRota').value = nomeAtual || ''
  document.getElementById('dataVisita').value = dataAtual || ''
  document.getElementById('obsRota').value = obsAtual || ''
  document.getElementById('modalTitulo').textContent = rotaId
    ? `Editar rota — ${cidade}`
    : `Nova rota — ${cidade}`
  modalOverlay.classList.add('aberto')
}

function fecharModal() {
  modalOverlay.classList.remove('aberto')
  formRota.reset()
}

document.getElementById('btnFecharModal').addEventListener('click', fecharModal)
document.getElementById('btnCancelar').addEventListener('click', fecharModal)
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) fecharModal() })

// ── Salvar rota (nova ou edição) ───────────────────────────────
formRota.addEventListener('submit', async (e) => {
  e.preventDefault()

  const [ano, mes] = selectMes.value.split('-')
  const cidade     = document.getElementById('rotaCidade').value
  const rotaId     = document.getElementById('rotaId').value
  const nome       = document.getElementById('nomeRota').value.trim()
  const dataVisita = document.getElementById('dataVisita').value
  const obs        = document.getElementById('obsRota').value.trim()

  const dados = {
    user_id:     userId,
    mes:         parseInt(mes),
    ano:         parseInt(ano),
    cidade,
    nome,
    data_visita: dataVisita || null,
    observacao:  obs || null
  }

  let error

  if (rotaId) {
    const res = await supabase.from('rotas').update(dados).eq('id', rotaId)
    error = res.error
  } else {
    const res = await supabase.from('rotas').insert(dados)
    error = res.error
  }

  if (error) {
    console.error('Erro ao salvar rota:', error)
    alert('Erro ao salvar. Tente novamente.')
    return
  }

  fecharModal()
  carregarRotas([normalizarCidade(cidade)])
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
  const [ano, mes] = selectMes.value.split('-')

  // Todos os clientes (pra agrupar por cidade e alimentar o "+ adicionar")
  const { data: clientes, error: errClientes } = await supabase
    .from('clientes')
    .select('*')
    .order('nome')

  if (errClientes) {
    console.error('Erro ao carregar clientes:', errClientes)
    return
  }

  // Rotas (dias) já criadas neste mês
  const { data: rotas } = await supabase
    .from('rotas')
    .select('*')
    .eq('mes', parseInt(mes))
    .eq('ano', parseInt(ano))

  // Agrupa as rotas existentes por cidade normalizada.
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

  const temAlerta = Object.values(grupos).some(g => g.length > 40)
  alertaDivisao.style.display = temAlerta ? 'block' : 'none'

  renderizarCalendario(parseInt(ano), parseInt(mes), rotasPorCidade, nomeExibicao)

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
              ${listaClientesCidade.length} cliente${listaClientesCidade.length > 1 ? 's' : ''}${excede ? ' ⚠️' : ''}
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
            : rotasDaCidade.map((rota, i) => renderizarRotaSubcard(rota, i, clientes, rotaClientesPorRota[rota.id] || [])).join('')}
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
        abrirModal(cidade, null, '', '', '')
      })

      // Liga os eventos de cada sub-card de rota
      rotasDaCidade.forEach(rota => {
        const subcard = card.querySelector(`.rota-subcard[data-rota-id="${rota.id}"]`)
        if (!subcard) return

        const vinculosRota = rotaClientesPorRota[rota.id] || []

        // Editar rota (nome, data, observação)
        subcard.querySelector('.btn-editar-rota').addEventListener('click', (e) => {
          e.stopPropagation()
          abrirModal(cidade, rota.id, rota.nome, rota.data_visita, rota.observacao)
        })

        // Excluir a rota inteira
        subcard.querySelector('.btn-excluir-rota-completa').addEventListener('click', async (e) => {
          e.stopPropagation()
          const confirmar = confirm(
            `Excluir a rota "${rota.nome || 'sem nome'}"?\nOs clientes só serão desvinculados desta rota — nenhum cadastro é apagado.`
          )
          if (!confirmar) return

          // Remove primeiro os vínculos, depois a rota (evita erro de referência)
          await supabase.from('rota_clientes').delete().eq('rota_id', rota.id)
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
        const inputBuscaCliente   = subcard.querySelector('.input-busca-cliente-rota')
        const boxSugestoesCliente = subcard.querySelector('.sugestoes-cliente')
        const btnAdd              = subcard.querySelector('.btn-add-cliente-rota')

        if (inputBuscaCliente && btnAdd) {
          const clientesDisponiveis = clientes.filter(c => !vinculosRota.some(v => v.cliente_id === c.id))
          let clienteEscolhido = null

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
              alert('Erro ao adicionar cliente à rota.')
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

function renderizarRotaSubcard(rota, index, clientes, vinculosRota) {
  const nomeRota = rota.nome?.trim() || `Rota ${index + 1}`
  const temData  = rota.data_visita
  const dataFormatada = temData
    ? new Date(rota.data_visita).toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', timeZone: 'UTC'
      })
    : null

  return `
    <div class="rota-subcard" data-rota-id="${rota.id}">
      <div class="rota-subcard-header">
        <div class="rota-subcard-info">
          <span class="rota-nome">${nomeRota}</span>
          <span class="data-badge ${temData ? '' : 'sem-data'}">
            ${temData ? `📅 ${dataFormatada}` : 'Sem data definida'}
          </span>
        </div>
        <div class="rota-subcard-acoes">
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
          <div class="sugestoes-cliente"></div>
        </div>
        <button class="btn-add-cliente-rota" disabled>Adicionar</button>
      </div>
    </div>
  `
}

// ── Visão em calendário do mês ──────────────────────────────────
const nomesDiasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function renderizarCalendario(ano, mes, rotasPorCidade, nomeExibicao) {
  const calendario = document.getElementById('calendarioMes')
  calendario.innerHTML = ''

  const diasNoMes         = new Date(ano, mes, 0).getDate()
  const primeiroDiaSemana = new Date(ano, mes - 1, 1).getDay()

  // Mapeia cada dia do mês pras rotas marcadas nele (usando a string "AAAA-MM-DD"
  // direto, sem passar por new Date(), pra evitar o mesmo bug de fuso horário
  // que já corrigimos em Visitas/Dashboard)
  const rotasPorDia = {}
  Object.entries(rotasPorCidade).forEach(([chave, lista]) => {
    const cidade = nomeExibicao[chave]
    lista.forEach(rota => {
      if (!rota.data_visita) return
      const dia = parseInt(rota.data_visita.split('-')[2], 10)
      if (!rotasPorDia[dia]) rotasPorDia[dia] = []
      rotasPorDia[dia].push({ rota, cidade, chave })
    })
  })

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
      ${rotasDoDia.map(({ rota, cidade, chave }) => `
        <button class="calendario-rota-pill" data-chave="${chave}">
          ${rota.nome?.trim() || 'Rota'} — ${cidade}
        </button>
      `).join('')}
    `

    grid.appendChild(celula)
  }

  calendario.appendChild(grid)

  // Clique numa rota do calendário: volta pra Lista e abre a cidade correspondente
  calendario.querySelectorAll('.calendario-rota-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const chave = btn.dataset.chave
      mostrarLista()
      const card = document.querySelector(`.cidade-card[data-cidade-chave="${chave}"]`)
      if (card) {
        card.classList.add('aberto')
        card.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
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