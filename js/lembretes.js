// Painel "Lembretes" do Dashboard (ao lado dos clientes com desconto): o Caio anota
// coisas como "mandar cotação pro Fulano" e, quando faz, marca "Feito" e o lembrete sai
// da lista. O cliente é opcional. "Feito" só marca e esconde (o registro fica guardado).
//
// Módulo independente: o dashboard.js não é tocado. Ids/classes começam com "est".

import { supabase, buscarTodasLinhas } from './supabase.js'
import { mensagemErro } from './erros.js'

const { data: { session } } = await supabase.auth.getSession()
// Sem sessão, o dashboard.js já manda para o login.
if (session && document.getElementById('estLembretes')) iniciar(session.user.id)

function iniciar(userId) {
  const $ = (id) => document.getElementById(id)
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const normalizar = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

  let lembretes = []

  // ── Lista ───────────────────────────────────────────────────
  async function carregar() {
    // Mais antigos primeiro: é uma fila do que ainda falta fazer
    const { data, error } = await supabase
      .from('lembretes')
      .select('*, clientes(nome)')
      .eq('feito', false)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Erro ao carregar os lembretes:', error)
      $('estListaLembretes').innerHTML = '<p class="est-cob-vazio">Não foi possível carregar os lembretes. Recarregue a página.</p>'
      return
    }
    lembretes = data
    desenhar()
  }

  function desenhar() {
    const lista = $('estListaLembretes')
    if (lembretes.length === 0) {
      lista.innerHTML = '<p class="est-cob-vazio">Nenhum lembrete pendente. Anote abaixo o que não pode esquecer.</p>'
      return
    }
    lista.innerHTML = lembretes.map((l) => `
      <div class="est-lembrete">
        <div class="est-lembrete-corpo">
          <div class="est-lembrete-texto">${esc(l.texto)}</div>
          ${l.clientes?.nome ? `<span class="est-lembrete-cliente">${esc(l.clientes.nome)}</span>` : ''}
        </div>
        <div class="est-lembrete-acoes">
          <button type="button" class="est-btn-editar" data-est-lembrete="feito" data-id="${l.id}" title="Marcar como feito">✓ Feito</button>
          <button type="button" class="est-btn-remover" data-est-lembrete="apagar" data-id="${l.id}" title="Apagar este lembrete">🗑️</button>
        </div>
      </div>`).join('')
  }

  $('estListaLembretes').addEventListener('click', async (e) => {
    const botao = e.target.closest('[data-est-lembrete]')
    if (!botao) return
    const id = botao.dataset.id
    botao.disabled = true

    if (botao.dataset.estLembrete === 'feito') {
      const { error } = await supabase.from('lembretes').update({ feito: true, feito_em: new Date().toISOString() }).eq('id', id)
      if (error) { console.error('Erro ao marcar o lembrete como feito:', error); alert(mensagemErro(error, 'atualizar')); botao.disabled = false; return }
    } else {
      if (!confirm('Apagar este lembrete?')) { botao.disabled = false; return }
      const { error } = await supabase.from('lembretes').delete().eq('id', id)
      if (error) { console.error('Erro ao apagar o lembrete:', error); alert(mensagemErro(error, 'apagar')); botao.disabled = false; return }
    }
    await carregar()
  })

  // ── Cliente (opcional), com busca pelo nome ─────────────────
  // Os ~1.300 clientes só são carregados quando o campo é usado pela primeira vez.
  let clientes = null
  let carregandoClientes = null

  function garantirClientes() {
    if (clientes) return Promise.resolve(clientes)
    if (!carregandoClientes) {
      carregandoClientes = buscarTodasLinhas('clientes', { select: 'id, nome', order: 'id' }).then(({ data, error }) => {
        if (error) { console.error('Erro ao carregar clientes:', error); carregandoClientes = null; return [] }
        clientes = data.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
        return clientes
      })
    }
    return carregandoClientes
  }

  const campoCliente = $('estLembreteCliente')
  const campoClienteId = $('estLembreteClienteId')
  const caixaSugestoes = $('estLembreteSugestoes')

  function esconderSugestoes() { caixaSugestoes.style.display = 'none' }

  async function mostrarSugestoes() {
    const termo = normalizar(campoCliente.value)
    if (!termo) { esconderSugestoes(); return }
    const todos = await garantirClientes()
    const achados = todos.filter((c) => normalizar(c.nome).includes(termo)).slice(0, 8)
    caixaSugestoes.innerHTML = ''
    if (achados.length === 0) {
      caixaSugestoes.innerHTML = '<div class="sugestao-vazia">Nenhum cliente encontrado</div>'
    } else {
      achados.forEach((c) => {
        const item = document.createElement('div')
        item.className = 'sugestao-item'
        item.textContent = c.nome
        // pointerdown (não click) para disparar antes de o campo perder o foco
        item.addEventListener('pointerdown', (ev) => {
          ev.preventDefault()
          campoCliente.value = c.nome
          campoClienteId.value = c.id
          esconderSugestoes()
        })
        caixaSugestoes.appendChild(item)
      })
    }
    caixaSugestoes.style.display = 'block'
  }

  campoCliente.addEventListener('focus', () => { garantirClientes(); if (campoCliente.value) mostrarSugestoes() })
  campoCliente.addEventListener('input', () => {
    campoClienteId.value = '' // enquanto digita, a escolha anterior deixa de valer
    mostrarSugestoes()
  })
  campoCliente.addEventListener('blur', () => setTimeout(esconderSugestoes, 150))

  // ── Novo lembrete ───────────────────────────────────────────
  $('estFormLembrete').addEventListener('submit', async (e) => {
    e.preventDefault()
    const texto = $('estLembreteTexto').value.trim()
    if (!texto) return

    // Escreveu um nome de cliente mas não escolheu da lista: não adivinhamos
    if (campoCliente.value.trim() && !campoClienteId.value) {
      alert('Escolha o cliente na lista de sugestões, ou apague o campo para salvar sem cliente.')
      campoCliente.focus()
      return
    }

    const botao = $('estBtnSalvarLembrete')
    botao.disabled = true
    botao.textContent = 'Salvando...'
    const { error } = await supabase.from('lembretes').insert({
      user_id: userId,
      texto,
      cliente_id: campoClienteId.value || null,
    })
    botao.disabled = false
    botao.textContent = 'Salvar'
    if (error) { console.error('Erro ao salvar o lembrete:', error); alert(mensagemErro(error)); return }

    $('estLembreteTexto').value = ''
    campoCliente.value = ''
    campoClienteId.value = ''
    esconderSugestoes()
    await carregar()
    $('estLembreteTexto').focus()
  })

  carregar()
}
