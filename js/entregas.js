// Seção "Entregas" da tela Rotas: o Caio monta o que levar para cada cliente (ex.: 10 fardos
// para o Lulu, 5 para o Mundo Animal), mesmo sem saber o dia. Enquanto a entrega estiver SEM DIA
// marcado, aparece um aviso (só para entregas, não para as rotas de visita).
//
// Módulo independente: o rotas.js não é tocado. Ids/classes começam com "ent" (o rotas.js
// procura alguns elementos por classe).
//
// Tabelas (novas): entregas, entrega_paradas (um cliente por parada) e entrega_itens
// (produto e quantidade). A "Entrega feita" (que cria a venda) vem na parte seguinte.

import { supabase, buscarTodasLinhas } from './supabase.js'
import { mensagemErro } from './erros.js'

const { data: { session } } = await supabase.auth.getSession()
// Sem sessão, o rotas.js já manda para o login.
if (session && document.getElementById('entSecao')) iniciar(session.user.id)

function iniciar(userId) {
  const $ = (id) => document.getElementById(id)
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const normalizar = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const fmtQtd = (v) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
  const arredonda3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000

  function dataLocalStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  // "AAAA-MM-DD" -> "sáb., 25/10" (sem passar por UTC, para não "virar o dia")
  function diaDaSemana(dataStr) {
    const [a, m, d] = dataStr.split('-').map(Number)
    return new Date(a, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
  }

  // ── Dados ───────────────────────────────────────────────────
  let entregas = []
  let produtos = []      // produtos ativos (para escolher o que levar)
  let clientes = null    // carregados só quando o campo de cliente é usado (~1.300)
  let carregandoClientes = null

  async function carregar() {
    const [e, p] = await Promise.all([
      supabase
        .from('entregas')
        .select('*, entrega_paradas(*, clientes(nome), entrega_itens(*, produtos(nome, unidade)))')
        .order('created_at', { ascending: true }),
      supabase.from('produtos').select('*').eq('ativo', true).order('nome'),
    ])
    if (e.error || p.error) {
      console.error('Erro ao carregar as entregas:', e.error || p.error)
      $('entLista').innerHTML = '<p class="est-cob-vazio">Não foi possível carregar as entregas. Recarregue a página.</p>'
      return false
    }
    entregas = e.data.map((x) => ({
      ...x,
      paradas: [...(x.entrega_paradas || [])]
        .sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || String(a.created_at).localeCompare(String(b.created_at)))
        .map((par) => ({ ...par, itens: par.entrega_itens || [] })),
    }))
    produtos = p.data
    return true
  }

  function garantirClientes() {
    if (clientes) return Promise.resolve(clientes)
    if (!carregandoClientes) {
      carregandoClientes = buscarTodasLinhas('clientes', { select: 'id, nome, cidade', order: 'id' }).then(({ data, error }) => {
        if (error) { console.error('Erro ao carregar clientes:', error); carregandoClientes = null; return [] }
        clientes = data.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'))
        return clientes
      })
    }
    return carregandoClientes
  }

  // ── Situação de cada entrega ────────────────────────────────
  const pendente = (ent) => ent.paradas.some((p) => !p.feita)
  const semDia = (ent) => !ent.data_entrega && pendente(ent)
  const atrasada = (ent) => !!ent.data_entrega && ent.data_entrega < dataLocalStr(new Date()) && pendente(ent)

  const textoItens = (itens) => itens
    .map((i) => `${fmtQtd(i.quantidade)} ${i.produtos?.unidade || ''} ${i.produtos?.nome || 'produto'}`.replace(/\s+/g, ' ').trim()).join(' · ')

  // Total a levar, somando só o que ainda falta entregar
  function totalALevar(ent) {
    const soma = {}
    ent.paradas.filter((p) => !p.feita).forEach((p) => p.itens.forEach((i) => {
      const chave = i.produto_id
      soma[chave] = soma[chave] || { qtd: 0, unidade: i.produtos?.unidade || '', nome: i.produtos?.nome || 'produto' }
      soma[chave].qtd += Number(i.quantidade)
    }))
    return Object.values(soma).map((x) => `${fmtQtd(x.qtd)} ${x.unidade} ${x.nome}`.replace(/\s+/g, ' ').trim()).join(' · ')
  }

  // ── Desenho da lista ────────────────────────────────────────
  function ordenadas() {
    const peso = (e) => (!pendente(e) ? 3 : !e.data_entrega ? 0 : 1)
    return [...entregas].sort((a, b) =>
      peso(a) - peso(b) ||
      String(a.data_entrega || '').localeCompare(String(b.data_entrega || '')) ||
      String(a.created_at).localeCompare(String(b.created_at)))
  }

  function htmlEntrega(ent) {
    const concluida = !pendente(ent)
    let selo
    if (concluida) selo = '<span class="badge badge-sim">Concluída</span>'
    else if (!ent.data_entrega) selo = '<span class="badge badge-parcial">Sem dia marcado</span>'
    else if (atrasada(ent)) selo = `<span class="badge badge-nao">Atrasada · ${diaDaSemana(ent.data_entrega)}</span>`
    else selo = `<span class="badge est-selo-neutro">${diaDaSemana(ent.data_entrega)}</span>`

    const marcarDia = semDia(ent) ? `
      <div class="ent-marcar-dia">
        <label for="entDia-${ent.id}">Escolha o dia:</label>
        <input type="date" id="entDia-${ent.id}">
        <button type="button" class="est-btn-editar" data-ent="marcar-dia" data-id="${ent.id}">Marcar dia</button>
      </div>` : ''

    const levar = totalALevar(ent)
    const paradas = ent.paradas.map((p) => `
      <div class="ent-parada-lista ${p.feita ? 'ent-feita' : ''}">
        <div><strong>${esc(p.clientes?.nome || '—')}</strong>${p.feita ? ' <span class="badge badge-sim">✓ Entregue</span>' : ''}</div>
        <div class="est-sub">${esc(textoItens(p.itens)) || 'sem produtos'}</div>
      </div>`).join('')

    return `
      <div class="ent-card ${semDia(ent) ? 'ent-card-semdia' : atrasada(ent) ? 'ent-card-atrasada' : concluida ? 'ent-card-concluida' : ''}">
        <div class="ent-card-topo">
          <div class="ent-card-titulo"><strong>${esc(ent.nome || 'Entrega')}</strong> ${selo}</div>
          <div class="acoes">
            <button type="button" class="est-btn-editar" data-ent="editar" data-id="${ent.id}">Editar</button>
            <button type="button" class="est-btn-excluir" data-ent="excluir" data-id="${ent.id}">Excluir</button>
          </div>
        </div>
        ${marcarDia}
        ${levar ? `<div class="ent-levar">Total a levar: <strong>${esc(levar)}</strong></div>` : ''}
        <div class="ent-paradas-lista">${paradas || '<span class="est-sub">Sem clientes.</span>'}</div>
        ${ent.observacao ? `<div class="est-cob-obs">📝 ${esc(ent.observacao)}</div>` : ''}
      </div>`
  }

  let jaAbriu = false
  function desenhar() {
    const lista = ordenadas()
    const pendentes = lista.filter(pendente)
    const nSemDia = lista.filter(semDia).length
    const nAtrasadas = lista.filter(atrasada).length

    $('entLista').innerHTML = lista.length
      ? lista.map(htmlEntrega).join('')
      : '<p class="est-cob-vazio">Nenhuma entrega ainda. Clique em "+ Nova entrega" para montar a primeira.</p>'

    const partes = []
    if (nSemDia) partes.push(`${nSemDia} ${nSemDia === 1 ? 'entrega sem dia marcado' : 'entregas sem dia marcado'}`)
    if (nAtrasadas) partes.push(`${nAtrasadas} ${nAtrasadas === 1 ? 'atrasada' : 'atrasadas'}`)
    $('entAviso').style.display = partes.length ? 'block' : 'none'
    $('entAviso').textContent = partes.length ? `⚠ ${partes.join(' · ')}. Escolha o dia no cartão abaixo.` : ''

    $('entResumoTexto').textContent = lista.length
      ? `${pendentes.length} ${pendentes.length === 1 ? 'pendente' : 'pendentes'}${nSemDia ? ` · ${nSemDia} sem dia marcado` : ''}`
      : 'nenhuma ainda'
    $('entResumoTexto').classList.toggle('ent-resumo-alerta', nSemDia > 0)

    // Abre sozinha, uma vez, quando há entrega sem dia (para o aviso não passar batido)
    if (!jaAbriu && (nSemDia > 0 || nAtrasadas > 0)) { $('entSecao').open = true; jaAbriu = true }
  }

  async function recarregar() {
    if (await carregar()) desenhar()
  }

  // ── Ações nos cartões ───────────────────────────────────────
  $('entLista').addEventListener('click', async (e) => {
    const botao = e.target.closest('[data-ent]')
    if (!botao) return
    const id = botao.dataset.id
    const ent = entregas.find((x) => x.id === id)

    if (botao.dataset.ent === 'marcar-dia') {
      const dia = $(`entDia-${id}`).value
      if (!dia) { alert('Escolha o dia no campo de data antes de clicar em "Marcar dia".'); return }
      botao.disabled = true
      const { error } = await supabase.from('entregas').update({ data_entrega: dia }).eq('id', id)
      if (error) { console.error('Erro ao marcar o dia:', error); alert(mensagemErro(error, 'atualizar')); botao.disabled = false; return }
      await recarregar()
    }

    if (botao.dataset.ent === 'editar' && ent) abrirModal(ent)

    if (botao.dataset.ent === 'excluir' && ent) {
      const jaVendeu = ent.paradas.some((p) => p.feita)
      if (!confirm(`Excluir a entrega "${ent.nome || 'Entrega'}"?\nOs clientes e produtos dela somem.${jaVendeu ? '\n\nAs vendas já lançadas a partir dela NÃO são apagadas (continuam no estoque e no dinheiro).' : ''}`)) return
      const { error } = await supabase.from('entregas').delete().eq('id', id)
      if (error) { console.error('Erro ao excluir a entrega:', error); alert(mensagemErro(error, 'excluir')); return }
      await recarregar()
    }
  })

  // ── Janela de criar / editar ────────────────────────────────
  // Estado da janela: lista de paradas; cada uma com cliente e itens.
  // Paradas já entregues (feita) ficam travadas: não podem ser alteradas aqui.
  let paradasEditando = []

  const abrir = () => $('entModal').classList.add('aberto')
  const fechar = () => $('entModal').classList.remove('aberto')
  $('entModal').addEventListener('click', (e) => { if (e.target === $('entModal')) fechar() })
  $('entModal').querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', fechar))
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar() })

  const opcoesProdutos = (selecionado) =>
    '<option value="">Produto...</option>' + produtos.map((p) => `<option value="${p.id}" ${p.id === selecionado ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')

  function linhaItem(item = {}) {
    return `
      <div class="ent-item">
        <select class="ent-produto">${opcoesProdutos(item.produtoId)}</select>
        <input type="number" class="ent-qtd" step="0.001" min="0.001" placeholder="Quantidade" value="${item.quantidade ?? ''}">
        <button type="button" class="est-btn-remover" data-ent-modal="remover-item" title="Remover produto">🗑️</button>
      </div>`
  }

  function desenharParadas() {
    $('entParadas').innerHTML = paradasEditando.map((p, i) => p.feita ? `
      <div class="ent-parada ent-parada-travada">
        <div class="ent-parada-topo"><strong>${esc(p.nome)}</strong> <span class="badge badge-sim">✓ Já entregue</span></div>
        <div class="est-sub">${esc(p.resumo || '')} (não dá para alterar aqui)</div>
      </div>` : `
      <div class="ent-parada" data-indice="${i}">
        <div class="ent-parada-topo">
          <strong>${esc(p.nome)}</strong>
          <button type="button" class="est-btn-remover" data-ent-modal="remover-parada" title="Tirar este cliente da entrega">🗑️</button>
        </div>
        <div class="ent-itens">${(p.itens.length ? p.itens : [{}]).map(linhaItem).join('')}</div>
        <button type="button" class="est-btn-card ent-btn-add" data-ent-modal="add-item">+ Produto</button>
      </div>`).join('')
    atualizarTotalModal()
  }

  // Lê o que está digitado de volta para o estado (antes de redesenhar)
  function lerDoFormulario() {
    document.querySelectorAll('#entParadas .ent-parada[data-indice]').forEach((el) => {
      const p = paradasEditando[Number(el.dataset.indice)]
      if (!p) return
      p.itens = [...el.querySelectorAll('.ent-item')].map((linha) => ({
        produtoId: linha.querySelector('.ent-produto').value,
        quantidade: linha.querySelector('.ent-qtd').value,
      }))
    })
  }

  function atualizarTotalModal() {
    const soma = {}
    paradasEditando.filter((p) => !p.feita).forEach((p) => p.itens.forEach((i) => {
      const q = Number(i.quantidade)
      if (!i.produtoId || !(q > 0)) return
      soma[i.produtoId] = (soma[i.produtoId] || 0) + q
    }))
    const texto = Object.entries(soma).map(([id, q]) => {
      const pr = produtos.find((x) => x.id === id)
      return `${fmtQtd(q)} ${pr?.unidade || ''} ${pr?.nome || ''}`.replace(/\s+/g, ' ').trim()
    }).join(' · ')
    $('entTotalModal').innerHTML = texto ? `Total a levar: <strong>${esc(texto)}</strong>` : 'Adicione clientes e produtos para ver o total a levar.'
  }

  function abrirModal(ent) {
    $('entModalTitulo').textContent = ent ? 'Editar entrega' : 'Nova entrega'
    $('entId').value = ent?.id || ''
    $('entNome').value = ent?.nome || ''
    $('entData').value = ent?.data_entrega || ''
    $('entObs').value = ent?.observacao || ''
    $('entBuscaCliente').value = ''
    paradasEditando = (ent?.paradas || []).map((p) => ({
      id: p.id, clienteId: p.cliente_id, nome: p.clientes?.nome || '—', feita: p.feita, resumo: textoItens(p.itens),
      itens: p.itens.map((i) => ({ produtoId: i.produto_id, quantidade: Number(i.quantidade) })),
    }))
    desenharParadas()
    $('entAvisoSemProdutos').style.display = produtos.length ? 'none' : 'block'
    abrir()
  }

  $('entBtnNova').addEventListener('click', () => abrirModal(null))

  $('entParadas').addEventListener('click', (e) => {
    const botao = e.target.closest('[data-ent-modal]')
    if (!botao) return
    lerDoFormulario()
    const bloco = botao.closest('.ent-parada')
    const p = paradasEditando[Number(bloco?.dataset.indice)]
    if (botao.dataset.entModal === 'add-item' && p) p.itens.push({})
    if (botao.dataset.entModal === 'remover-parada' && p) paradasEditando.splice(paradasEditando.indexOf(p), 1)
    if (botao.dataset.entModal === 'remover-item' && p) {
      const indiceItem = [...bloco.querySelectorAll('.ent-item')].indexOf(botao.closest('.ent-item'))
      p.itens.splice(indiceItem, 1)
    }
    desenharParadas()
  })
  $('entParadas').addEventListener('input', () => { lerDoFormulario(); atualizarTotalModal() })

  // Adicionar cliente (busca pelo nome)
  const campoBusca = $('entBuscaCliente')
  const caixa = $('entSugestoes')
  const esconderSugestoes = () => { caixa.style.display = 'none' }

  async function mostrarSugestoes() {
    const termo = normalizar(campoBusca.value)
    if (!termo) { esconderSugestoes(); return }
    const todos = await garantirClientes()
    const achados = todos.filter((c) => normalizar(c.nome).includes(termo)).slice(0, 8)
    caixa.innerHTML = ''
    if (achados.length === 0) {
      caixa.innerHTML = '<div class="sugestao-vazia">Nenhum cliente encontrado</div>'
    } else {
      achados.forEach((c) => {
        const item = document.createElement('div')
        item.className = 'sugestao-item'
        item.textContent = c.nome + (c.cidade ? ` · ${c.cidade}` : '')
        // pointerdown (não click) para disparar antes de o campo perder o foco
        item.addEventListener('pointerdown', (ev) => {
          ev.preventDefault()
          lerDoFormulario()
          if (paradasEditando.some((p) => p.clienteId === c.id)) {
            alert(`${c.nome} já está nesta entrega. Para levar mais produtos para ele, use "+ Produto" no bloco dele.`)
          } else {
            paradasEditando.push({ clienteId: c.id, nome: c.nome, feita: false, itens: [{}] })
            desenharParadas()
          }
          campoBusca.value = ''
          esconderSugestoes()
        })
        caixa.appendChild(item)
      })
    }
    caixa.style.display = 'block'
  }

  campoBusca.addEventListener('focus', () => { garantirClientes(); if (campoBusca.value) mostrarSugestoes() })
  campoBusca.addEventListener('input', mostrarSugestoes)
  campoBusca.addEventListener('blur', () => setTimeout(esconderSugestoes, 150))

  // ── Salvar ──────────────────────────────────────────────────
  $('entForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    lerDoFormulario()

    const pendentesNaJanela = paradasEditando.filter((p) => !p.feita)
    const travadas = paradasEditando.filter((p) => p.feita)
    if (pendentesNaJanela.length + travadas.length === 0) {
      alert('Adicione pelo menos um cliente à entrega.')
      return
    }

    // Valida e limpa os itens de cada parada pendente
    for (const p of pendentesNaJanela) {
      const validos = p.itens.filter((i) => i.produtoId || i.quantidade)
      for (const i of validos) {
        if (!i.produtoId || !(Number(i.quantidade) > 0)) {
          alert(`Em "${p.nome}", escolha o produto e a quantidade em todas as linhas (ou remova a linha).`)
          return
        }
      }
      if (validos.length === 0) {
        alert(`Adicione pelo menos um produto para "${p.nome}" (ou tire o cliente da entrega).`)
        return
      }
      p.itensValidos = validos.map((i) => ({ produto_id: i.produtoId, quantidade: arredonda3(i.quantidade) }))
    }

    const id = $('entId').value
    const dados = {
      nome: $('entNome').value.trim() || null,
      data_entrega: $('entData').value || null,
      observacao: $('entObs').value.trim() || null,
    }

    const botao = $('entBtnSalvar')
    botao.disabled = true
    botao.textContent = 'Salvando...'
    try {
      const resultado = id ? await atualizarEntrega(id, dados, pendentesNaJanela, travadas) : await criarEntrega(dados, pendentesNaJanela)
      if (resultado?.erro) { alert(resultado.erro); return }
      fechar()
      await recarregar()
    } finally {
      botao.disabled = false
      botao.textContent = 'Salvar entrega'
    }
  })

  // Grava paradas e itens de uma entrega; devolve { erro } ou {}
  async function gravarParadas(entregaId, paradas, ordemInicial) {
    const linhasParadas = paradas.map((p, i) => ({ user_id: userId, entrega_id: entregaId, cliente_id: p.clienteId, ordem: ordemInicial + i }))
    const resPar = await supabase.from('entrega_paradas').insert(linhasParadas).select()
    if (resPar.error) { console.error('Erro ao salvar as paradas:', resPar.error); return { erro: mensagemErro(resPar.error) } }

    // Cada parada criada é associada ao que foi digitado pelo número da ordem (não depende
    // da ordem em que o banco devolve as linhas)
    const itens = []
    resPar.data.forEach((par) => {
      const origem = paradas[par.ordem - ordemInicial]
      origem.itensValidos.forEach((it) => itens.push({
        user_id: userId, parada_id: par.id, produto_id: it.produto_id, quantidade: it.quantidade,
      }))
    })
    const resItens = await supabase.from('entrega_itens').insert(itens)
    if (resItens.error) { console.error('Erro ao salvar os produtos da entrega:', resItens.error); return { erro: mensagemErro(resItens.error), paradasCriadas: resPar.data.map((x) => x.id) } }
    return { paradasCriadas: resPar.data.map((x) => x.id) }
  }

  async function criarEntrega(dados, paradas) {
    const { data: nova, error } = await supabase.from('entregas').insert({ user_id: userId, ...dados }).select().single()
    if (error) { console.error('Erro ao criar a entrega:', error); return { erro: mensagemErro(error) } }
    const r = await gravarParadas(nova.id, paradas, 0)
    if (r.erro) {
      await supabase.from('entregas').delete().eq('id', nova.id) // não deixa entrega pela metade
      return { erro: r.erro }
    }
    return {}
  }

  // Edição: grava as paradas novas ANTES de apagar as antigas pendentes (se algo falhar, nada se perde)
  async function atualizarEntrega(id, dados, pendentesNaJanela, travadas) {
    const antigas = (entregas.find((x) => x.id === id)?.paradas || []).filter((p) => !p.feita).map((p) => p.id)
    let criadas = []
    if (pendentesNaJanela.length > 0) {
      const r = await gravarParadas(id, pendentesNaJanela, travadas.length)
      if (r.erro) {
        if (r.paradasCriadas?.length) await supabase.from('entrega_paradas').delete().in('id', r.paradasCriadas) // desfaz as novas
        return { erro: r.erro }
      }
      criadas = r.paradasCriadas
    }
    if (antigas.length > 0) {
      const { error } = await supabase.from('entrega_paradas').delete().in('id', antigas)
      if (error) {
        console.error('Erro ao remover as paradas antigas:', error)
        if (criadas.length) await supabase.from('entrega_paradas').delete().in('id', criadas)
        return { erro: mensagemErro(error) }
      }
    }
    const { error } = await supabase.from('entregas').update(dados).eq('id', id)
    if (error) { console.error('Erro ao atualizar a entrega:', error); return { erro: mensagemErro(error) } }
    return {}
  }

  recarregar()
}
