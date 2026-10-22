// Seção "Estoque" da página Empresas: fornecedores, produtos e compras da revenda
// (areia, ração...). Fica separada das empresas que o Caio representa.
//
// O estoque de cada produto NUNCA é guardado: é sempre calculado como
//   (soma das compras) − (soma do que foi vendido).
// Assim, corrigir ou excluir uma compra/venda acerta o saldo sozinho.
//
// Todos os ids e classes daqui começam com "est" de propósito: o empresas.js
// procura botões por classe em toda a página (.btn-editar, .btn-excluir...),
// então estes não podem ter os mesmos nomes.

import { supabase, buscarTodasLinhas } from './supabase.js'
import { mensagemErro } from './erros.js'

const { data: { session } } = await supabase.auth.getSession()
// Sem sessão, o empresas.js já manda para o login; aqui não há nada a fazer.
if (session) iniciar(session.user.id)

function iniciar(userId) {
  const $ = (id) => document.getElementById(id)

  // ── Utilidades ──────────────────────────────────────────────
  const fmt = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const fmtQtd = (v) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
  const arredonda2 = (v) => Math.round((Number(v) || 0) * 100) / 100
  const arredonda3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000
  const dataBR = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '')
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  // "AAAA-MM-DD" no fuso LOCAL (toISOString viraria o dia depois das 21h)
  function hojeLocal() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  // ── Estado (recarregado do banco depois de cada alteração) ───
  let fornecedores = []
  let produtos = []
  let compras = []
  let pagoPorCompra = {}      // compra_id -> total já pago ao fornecedor
  let vendidoPorProduto = {}  // produto_id -> total já vendido

  const fornecedorPorId = () => Object.fromEntries(fornecedores.map((f) => [f.id, f]))
  const produtoPorId = () => Object.fromEntries(produtos.map((p) => [p.id, p]))

  async function carregar() {
    const [f, p, c, pg, it] = await Promise.all([
      supabase.from('fornecedores').select('*').order('nome'),
      supabase.from('produtos').select('*').order('nome'),
      buscarTodasLinhas('compras_estoque', { order: 'id' }),
      buscarTodasLinhas('pagamentos_compra', { select: 'compra_id, valor', order: 'id' }),
      buscarTodasLinhas('venda_estoque_itens', { select: 'produto_id, quantidade', order: 'id' }),
    ])

    const erro = f.error || p.error || c.error || pg.error || it.error
    if (erro) {
      console.error('Erro ao carregar o estoque:', erro)
      $('estListaFornecedores').innerHTML = '<tr><td colspan="3" class="est-vazio-linha">Não foi possível carregar o estoque. Recarregue a página.</td></tr>'
      return false
    }

    fornecedores = f.data
    produtos = p.data
    compras = c.data

    pagoPorCompra = {}
    pg.data.forEach((x) => { pagoPorCompra[x.compra_id] = (pagoPorCompra[x.compra_id] || 0) + Number(x.valor) })

    vendidoPorProduto = {}
    it.data.forEach((x) => { vendidoPorProduto[x.produto_id] = (vendidoPorProduto[x.produto_id] || 0) + Number(x.quantidade) })

    return true
  }

  function estoqueDoProduto(produtoId) {
    const comprado = compras
      .filter((c) => c.produto_id === produtoId)
      .reduce((s, c) => s + Number(c.quantidade), 0)
    return arredonda3(comprado - (vendidoPorProduto[produtoId] || 0))
  }

  // ── Desenho das tabelas ─────────────────────────────────────
  function desenharFornecedores() {
    const corpo = $('estListaFornecedores')
    if (fornecedores.length === 0) {
      corpo.innerHTML = '<tr><td colspan="3" class="est-vazio-linha">Nenhum fornecedor cadastrado ainda.</td></tr>'
      return
    }
    corpo.innerHTML = fornecedores.map((f) => `
      <tr>
        <td><strong>${esc(f.nome)}</strong></td>
        <td>${esc(f.observacao) || '—'}</td>
        <td>
          <div class="acoes">
            <button type="button" class="est-btn-editar" data-acao="editar-fornecedor" data-id="${f.id}">Editar</button>
            <button type="button" class="est-btn-excluir" data-acao="excluir-fornecedor" data-id="${f.id}">Excluir</button>
          </div>
        </td>
      </tr>`).join('')
  }

  function desenharProdutos() {
    const corpo = $('estListaProdutos')
    const resumo = $('estResumoProdutos')
    const porFornecedor = fornecedorPorId()

    if (produtos.length === 0) {
      resumo.style.display = 'none'
      corpo.innerHTML = '<tr><td colspan="8" class="est-vazio-linha">Nenhum produto cadastrado ainda.</td></tr>'
      return
    }

    let valorTotal = 0
    corpo.innerHTML = produtos.map((p) => {
      const emEstoque = estoqueDoProduto(p.id)
      const valor = Math.max(0, emEstoque) * Number(p.preco_custo)
      valorTotal += valor
      return `
        <tr class="${p.ativo ? '' : 'est-inativo'}">
          <td>
            <strong>${esc(p.nome)}</strong>${p.ativo ? '' : ' <span class="badge badge-nao">Inativo</span>'}
            ${p.descricao ? `<span class="est-sub">${esc(p.descricao)}</span>` : ''}
          </td>
          <td>${esc(p.unidade)}</td>
          <td>${esc(porFornecedor[p.fornecedor_id]?.nome) || '—'}</td>
          <td>${fmt(p.preco_custo)}</td>
          <td>${fmt(p.preco_venda)}</td>
          <td class="${emEstoque < 0 ? 'est-negativo' : ''}">${fmtQtd(emEstoque)} ${esc(p.unidade)}</td>
          <td>${fmt(valor)}</td>
          <td>
            <div class="acoes">
              <button type="button" class="est-btn-editar" data-acao="editar-produto" data-id="${p.id}">Editar</button>
              <button type="button" class="est-btn-excluir" data-acao="excluir-produto" data-id="${p.id}">Excluir</button>
            </div>
          </td>
        </tr>`
    }).join('')

    resumo.style.display = 'block'
    resumo.innerHTML = `Mercadoria em estoque (pelo custo): <strong>${fmt(valorTotal)}</strong>`
  }

  function desenharCompras() {
    const corpo = $('estListaCompras')
    if (compras.length === 0) {
      corpo.innerHTML = '<tr><td colspan="8" class="est-vazio-linha">Nenhuma compra registrada ainda.</td></tr>'
      return
    }
    const porProduto = produtoPorId()
    const porFornecedor = fornecedorPorId()
    const ordenadas = [...compras].sort((a, b) =>
      String(b.data_compra).localeCompare(String(a.data_compra)) ||
      String(b.created_at).localeCompare(String(a.created_at)))

    corpo.innerHTML = ordenadas.map((c) => {
      const produto = porProduto[c.produto_id]
      const total = arredonda2(Number(c.quantidade) * Number(c.custo_unitario))
      const pago = pagoPorCompra[c.id] || 0
      const falta = arredonda2(total - pago)
      let pagamento
      if (falta <= 0) pagamento = '<span class="badge badge-sim">Pago</span>'
      else if (pago > 0) pagamento = `<span class="badge badge-parcial">Falta ${fmt(falta)}</span>`
      else pagamento = `<span class="badge badge-nao">A pagar ${fmt(falta)}</span>`
      if (falta > 0 && c.vencimento) pagamento += `<span class="est-sub">vence em ${dataBR(c.vencimento)}</span>`

      return `
        <tr>
          <td>${dataBR(c.data_compra)}</td>
          <td><strong>${esc(produto?.nome) || '—'}</strong></td>
          <td>${esc(porFornecedor[c.fornecedor_id]?.nome) || '—'}</td>
          <td>${fmtQtd(c.quantidade)} ${esc(produto?.unidade || '')}</td>
          <td>${fmt(c.custo_unitario)}</td>
          <td>${fmt(total)}</td>
          <td>${pagamento}</td>
          <td>
            <div class="acoes">
              <button type="button" class="est-btn-editar" data-acao="editar-compra" data-id="${c.id}">Editar</button>
              <button type="button" class="est-btn-excluir" data-acao="excluir-compra" data-id="${c.id}">Excluir</button>
            </div>
          </td>
        </tr>`
    }).join('')
  }

  async function recarregar() {
    if (await carregar()) {
      desenharFornecedores()
      desenharProdutos()
      desenharCompras()
    }
  }

  // ── Janelinhas (modais) ─────────────────────────────────────
  const MODAIS = ['estModalFornecedor', 'estModalProduto', 'estModalCompra']
  const abrir = (id) => $(id).classList.add('aberto')
  const fechar = (id) => $(id).classList.remove('aberto')

  MODAIS.forEach((id) => {
    $(id).addEventListener('click', (e) => { if (e.target === $(id)) fechar(id) })
    $(id).querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', () => fechar(id)))
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') MODAIS.forEach(fechar)
  })

  // Evita salvar duas vezes se o botão for clicado de novo antes de terminar
  async function comBotaoTravado(botao, rotuloOcupado, tarefa) {
    const rotulo = botao.textContent
    botao.disabled = true
    botao.textContent = rotuloOcupado
    try { await tarefa() } finally {
      botao.disabled = false
      botao.textContent = rotulo
    }
  }

  // ── Fornecedor ──────────────────────────────────────────────
  function abrirFornecedor(f) {
    $('estFornecedorTitulo').textContent = f ? 'Editar fornecedor' : 'Novo fornecedor'
    $('estFornecedorId').value = f?.id || ''
    $('estFornNome').value = f?.nome || ''
    $('estFornObs').value = f?.observacao || ''
    abrir('estModalFornecedor')
    $('estFornNome').focus()
  }

  $('estBtnNovoFornecedor').addEventListener('click', () => abrirFornecedor(null))

  $('estFormFornecedor').addEventListener('submit', async (e) => {
    e.preventDefault()
    const id = $('estFornecedorId').value
    const dados = {
      user_id: userId,
      nome: $('estFornNome').value.trim(),
      observacao: $('estFornObs').value.trim() || null,
    }
    if (!dados.nome) return

    await comBotaoTravado($('estBtnSalvarFornecedor'), 'Salvando...', async () => {
      const res = id
        ? await supabase.from('fornecedores').update(dados).eq('id', id)
        : await supabase.from('fornecedores').insert(dados)
      if (res.error) { console.error('Erro ao salvar fornecedor:', res.error); alert(mensagemErro(res.error)); return }
      fechar('estModalFornecedor')
      await recarregar()
    })
  })

  async function excluirFornecedor(id) {
    const f = fornecedores.find((x) => x.id === id)
    if (!confirm(`Excluir o fornecedor "${f?.nome || ''}"?\nOs produtos e as compras dele continuam existindo, só ficam sem fornecedor.`)) return
    const { error } = await supabase.from('fornecedores').delete().eq('id', id)
    if (error) { console.error('Erro ao excluir fornecedor:', error); alert(mensagemErro(error, 'excluir')); return }
    await recarregar()
  }

  // ── Produto ─────────────────────────────────────────────────
  function preencherSelectFornecedores(select, selecionado) {
    select.innerHTML = '<option value="">— sem fornecedor —</option>' +
      fornecedores.map((f) => `<option value="${f.id}">${esc(f.nome)}</option>`).join('')
    select.value = selecionado || ''
  }

  function abrirProduto(p) {
    $('estProdutoTitulo').textContent = p ? 'Editar produto' : 'Novo produto'
    $('estProdutoId').value = p?.id || ''
    $('estProdNome').value = p?.nome || ''
    $('estProdUnidade').value = p?.unidade || 'fardo'
    preencherSelectFornecedores($('estProdFornecedor'), p?.fornecedor_id)
    $('estProdDescricao').value = p?.descricao || ''
    $('estProdCusto').value = p ? p.preco_custo : ''
    $('estProdVenda').value = p ? p.preco_venda : ''
    $('estProdAtivo').checked = p ? !!p.ativo : true
    abrir('estModalProduto')
    $('estProdNome').focus()
  }

  $('estBtnNovoProduto').addEventListener('click', () => abrirProduto(null))

  $('estFormProduto').addEventListener('submit', async (e) => {
    e.preventDefault()
    const id = $('estProdutoId').value
    const dados = {
      user_id: userId,
      nome: $('estProdNome').value.trim(),
      unidade: $('estProdUnidade').value,
      fornecedor_id: $('estProdFornecedor').value || null,
      descricao: $('estProdDescricao').value.trim() || null,
      preco_custo: arredonda2($('estProdCusto').value),
      preco_venda: arredonda2($('estProdVenda').value),
      ativo: $('estProdAtivo').checked,
    }
    if (!dados.nome) return

    await comBotaoTravado($('estBtnSalvarProduto'), 'Salvando...', async () => {
      const res = id
        ? await supabase.from('produtos').update(dados).eq('id', id)
        : await supabase.from('produtos').insert(dados)
      if (res.error) { console.error('Erro ao salvar produto:', res.error); alert(mensagemErro(res.error)); return }
      fechar('estModalProduto')
      await recarregar()
    })
  })

  async function excluirProduto(id) {
    const p = produtos.find((x) => x.id === id)
    if (!confirm(`Excluir o produto "${p?.nome || ''}"?`)) return
    const { error } = await supabase.from('produtos').delete().eq('id', id)
    if (error) {
      console.error('Erro ao excluir produto:', error)
      if (error.code === '23503') {
        // chave estrangeira: já existe compra ou venda desse produto
        alert('Este produto já tem compras ou vendas registradas, então não pode ser excluído (isso protege o seu histórico).\n\nSe não quiser mais vê-lo na lista de compras, abra "Editar" e desmarque "Ativo".')
      } else {
        alert(mensagemErro(error, 'excluir'))
      }
      return
    }
    await recarregar()
  }

  // ── Compra ──────────────────────────────────────────────────
  // A mesma janela serve para REGISTRAR e para EDITAR. Em edição, "compraEditando" guarda a compra
  // original; os pagamentos já feitos NÃO mudam sozinhos (só se o Caio marcar "Continua paga por inteiro").
  let compraEditando = null // { compra, pago } ou null (janela em modo "Registrar")

  function totalDaJanela() {
    return arredonda2(Number($('estCompQtd').value) * Number($('estCompCusto').value))
  }

  function atualizarTotalCompra() {
    $('estCompTotal').innerHTML = `Total da compra: <strong>${fmt(totalDaJanela())}</strong>`
    if (compraEditando) atualizarSituacaoEdicao()
  }

  // Situação do pagamento de uma compra em edição, com os valores que estão na janela agora.
  // "pagoReal" (opcional) é o total pago lido do banco no momento de salvar.
  function situacaoEdicao(pagoReal) {
    const { compra } = compraEditando
    const pago = arredonda2(pagoReal ?? compraEditando.pago)
    const totalAntigo = arredonda2(Number(compra.quantidade) * Number(compra.custo_unitario))
    const totalNovo = totalDaJanela()
    const estavaPaga = arredonda2(totalAntigo - pago) <= 0
    const mudouTotal = Math.abs(totalNovo - totalAntigo) > 0.004
    const mostraContinua = estavaPaga && mudouTotal // a caixinha só faz sentido nesse caso
    const ajustar = mostraContinua && $('estCompContinuaPaga').checked
    const pagoDepois = ajustar ? totalNovo : pago
    return { pago, pagoDepois, totalAntigo, totalNovo, mostraContinua, ajustar, falta: arredonda2(totalNovo - pagoDepois) }
  }

  function atualizarSituacaoEdicao() {
    const s = situacaoEdicao()
    $('estLinhaContinuaPaga').style.display = s.mostraContinua ? '' : 'none'
    $('estEdicaoPago').innerHTML = `Já pago: <strong>${fmt(s.pagoDepois)}</strong> · ` + (
      s.falta > 0.004 ? `Falta <strong>${fmt(s.falta)}</strong>`
        : s.falta < -0.004 ? `<strong>Pago a mais: ${fmt(-s.falta)}</strong> (corrija o valor)`
          : '<strong>Paga por inteiro</strong>')
    $('estCampoVenc').style.display = s.falta > 0.004 ? 'flex' : 'none'
  }

  // c = compra a editar; sem argumento, abre para registrar uma nova
  function abrirCompra(c) {
    const editando = !!c
    compraEditando = editando ? { compra: c, pago: arredonda2(pagoPorCompra[c.id] || 0) } : null

    const ativos = produtos.filter((p) => p.ativo || (editando && p.id === c.produto_id))
    const semProduto = ativos.length === 0
    $('estCompAviso').style.display = semProduto ? 'block' : 'none'
    $('estBtnSalvarCompra').disabled = semProduto

    $('estCompId').value = c?.id || ''
    $('estCompTitulo').textContent = editando ? 'Editar compra' : 'Registrar compra'
    $('estBtnSalvarCompra').textContent = editando ? 'Salvar alterações' : 'Salvar compra'
    $('estLinhaPago').style.display = editando ? 'none' : ''
    $('estEdicaoPago').style.display = editando ? '' : 'none'
    $('estLinhaContinuaPaga').style.display = 'none'
    $('estCompContinuaPaga').checked = false

    $('estCompProduto').innerHTML = ativos.map((p) => `<option value="${p.id}">${esc(p.nome)}${p.ativo ? '' : ' (inativo)'}</option>`).join('')

    if (editando) {
      $('estCompProduto').value = c.produto_id
      preencherSelectFornecedores($('estCompFornecedor'), c.fornecedor_id)
      $('estCompData').value = String(c.data_compra).slice(0, 10)
      $('estCompQtd').value = Number(c.quantidade)
      $('estCompCusto').value = Number(c.custo_unitario)
      $('estCompObs').value = c.observacao || ''
      $('estCompVenc').value = c.vencimento ? String(c.vencimento).slice(0, 10) : ''
      $('estCompAtualizaCusto').checked = false // numa edição, o custo do produto só muda se o Caio pedir
      atualizarTotalCompra()
    } else {
      $('estCompData').value = hojeLocal()
      $('estCompQtd').value = ''
      $('estCompObs').value = ''
      $('estCompPago').checked = true
      $('estCompVenc').value = ''
      $('estCampoVenc').style.display = 'none'
      $('estCompAtualizaCusto').checked = true
      aoMudarProdutoDaCompra()
    }
    abrir('estModalCompra')
    $('estCompQtd').focus()
  }

  // Ao escolher o produto (só ao registrar), já sugere o fornecedor e o custo dele
  function aoMudarProdutoDaCompra() {
    const p = produtoPorId()[$('estCompProduto').value]
    preencherSelectFornecedores($('estCompFornecedor'), p?.fornecedor_id)
    $('estCompCusto').value = p ? p.preco_custo : ''
    atualizarTotalCompra()
  }

  // O vencimento só faz sentido quando a compra ficou "a pagar"
  $('estCompPago').addEventListener('change', () => {
    $('estCampoVenc').style.display = $('estCompPago').checked ? 'none' : 'flex'
  })

  $('estBtnNovaCompra').addEventListener('click', () => abrirCompra(null))
  $('estCompProduto').addEventListener('change', () => { if (!compraEditando) aoMudarProdutoDaCompra() })
  $('estCompQtd').addEventListener('input', atualizarTotalCompra)
  $('estCompCusto').addEventListener('input', atualizarTotalCompra)
  $('estCompContinuaPaga').addEventListener('change', atualizarSituacaoEdicao)

  // Ajusta os pagamentos para a soma bater com o novo total (compra que continua paga por inteiro):
  // total maior -> registra a diferença; total menor -> tira dos pagamentos mais recentes.
  async function ajustarPagamentos(compraId, pagamentos, pago, totalNovo, dataPagamento) {
    const diferenca = arredonda2(totalNovo - pago)
    if (Math.abs(diferenca) < 0.004) return {}
    if (diferenca > 0) {
      const r = await supabase.from('pagamentos_compra').insert({ user_id: userId, compra_id: compraId, valor: diferenca, data_pagamento: dataPagamento })
      return r.error ? { erro: r.error } : {}
    }
    let restante = -diferenca
    const recentes = [...pagamentos].sort((a, b) =>
      String(b.data_pagamento).localeCompare(String(a.data_pagamento)) || String(b.created_at).localeCompare(String(a.created_at)))
    for (const p of recentes) {
      if (restante <= 0.004) break
      const valor = Number(p.valor)
      const r = valor <= restante + 0.004
        ? await supabase.from('pagamentos_compra').delete().eq('id', p.id)
        : await supabase.from('pagamentos_compra').update({ valor: arredonda2(valor - restante) }).eq('id', p.id)
      if (r.error) return { erro: r.error }
      restante = arredonda2(restante - valor)
    }
    return {}
  }

  async function salvarEdicaoCompra({ produtoId, produto, quantidade, custo }) {
    const antiga = compraEditando.compra
    await comBotaoTravado($('estBtnSalvarCompra'), 'Salvando...', async () => {
      // Pagamentos lidos do banco AGORA (a tela pode estar desatualizada)
      const resPag = await supabase.from('pagamentos_compra').select('id, valor, data_pagamento, created_at').eq('compra_id', antiga.id)
      if (resPag.error) { console.error('Erro ao ler os pagamentos da compra:', resPag.error); alert(mensagemErro(resPag.error)); return }
      const pagamentos = resPag.data
      const pago = arredonda2(pagamentos.reduce((s, p) => s + Number(p.valor), 0))
      const s = situacaoEdicao(pago)

      // 1) O novo total não pode ficar abaixo do que já foi pago (a menos que o pagamento seja ajustado junto)
      if (!s.ajustar && s.totalNovo < pago - 0.004) {
        alert(s.mostraContinua
          ? `O novo total (${fmt(s.totalNovo)}) ficou menor do que já foi pago (${fmt(pago)}).\n\nSe a compra continua paga por inteiro, marque "Continua paga por inteiro" para o pagamento ser ajustado. Se não, corrija a quantidade ou o custo.`
          : `O novo total (${fmt(s.totalNovo)}) ficou menor do que já foi pago (${fmt(pago)}). Corrija a quantidade ou o custo.`)
        return
      }

      // 2) Lembrete: compra que estava paga por inteiro, mudou de valor e a caixinha está desmarcada
      if (s.mostraContinua && !s.ajustar && s.totalNovo > pago + 0.004) {
        if (!confirm(`Atenção: esta compra estava paga por inteiro (${fmt(pago)}) e o total mudou para ${fmt(s.totalNovo)}.\n\nSe ela continua paga, clique em Cancelar e marque "Continua paga por inteiro".\n\nSe salvar assim, ficará "Falta ${fmt(s.totalNovo - pago)}" em "Quem eu devo".\n\nSalvar mesmo assim?`)) return
      }

      // 3) Estoque: avisa (sem bloquear) se a edição deixar algum produto negativo
      const saldoDepois = (id) => {
        let saldo = estoqueDoProduto(id)
        if (id === antiga.produto_id) saldo -= Number(antiga.quantidade)
        if (id === produtoId) saldo += quantidade
        return arredonda3(saldo)
      }
      const avisosEstoque = [...new Set([antiga.produto_id, produtoId])].map((id) => {
        const antes = estoqueDoProduto(id)
        const depois = saldoDepois(id)
        const p = produtoPorId()[id]
        return depois < 0 && depois < antes - 0.0005 ? `${p?.nome || 'produto'}: ficará com ${fmtQtd(depois)} ${p?.unidade || ''} (hoje: ${fmtQtd(antes)})` : null
      }).filter(Boolean)
      if (avisosEstoque.length && !confirm(`Depois desta edição o estoque ficará negativo (foi vendido mais do que comprado):\n\n${avisosEstoque.join('\n')}\n\nSalvar mesmo assim? (Depois é só lançar a compra que falta.)`)) return

      // 4) Grava a compra; depois o pagamento e o custo do produto (se algum passo extra falhar, só avisamos o que faltou)
      const dataCompra = $('estCompData').value || hojeLocal()
      const { error } = await supabase.from('compras_estoque').update({
        produto_id: produtoId,
        fornecedor_id: $('estCompFornecedor').value || null,
        quantidade,
        custo_unitario: custo,
        data_compra: dataCompra,
        observacao: $('estCompObs').value.trim() || null,
        vencimento: s.falta > 0.004 ? ($('estCompVenc').value || null) : (antiga.vencimento || null),
      }).eq('id', antiga.id)
      if (error) { console.error('Erro ao editar a compra:', error); alert(mensagemErro(error)); return }

      let aviso = ''
      if (s.ajustar) {
        const r = await ajustarPagamentos(antiga.id, pagamentos, pago, s.totalNovo, dataCompra)
        if (r.erro) {
          console.error('Erro ao ajustar o pagamento da compra:', r.erro)
          aviso += 'A compra foi alterada, mas não consegui ajustar o pagamento. Confira "Já pago" e "Falta" na lista de Compras.\n'
        }
      }
      if ($('estCompAtualizaCusto').checked && custo !== Number(produto.preco_custo)) {
        const r = await supabase.from('produtos').update({ preco_custo: custo }).eq('id', produtoId)
        if (r.error) {
          console.error('Erro ao atualizar o custo do produto:', r.error)
          aviso += 'A compra foi alterada, mas não consegui atualizar o custo do produto.\n'
        }
      }

      fechar('estModalCompra')
      await recarregar()
      if (aviso) alert(aviso)
    })
  }

  $('estFormCompra').addEventListener('submit', async (e) => {
    e.preventDefault()
    const produtoId = $('estCompProduto').value
    const produto = produtoPorId()[produtoId]
    const quantidade = arredonda3($('estCompQtd').value)
    const custo = arredonda2($('estCompCusto').value)
    if (!produto || quantidade <= 0 || custo < 0) return

    if (compraEditando) { await salvarEdicaoCompra({ produtoId, produto, quantidade, custo }); return }

    const dados = {
      user_id: userId,
      produto_id: produtoId,
      fornecedor_id: $('estCompFornecedor').value || null,
      quantidade,
      custo_unitario: custo,
      data_compra: $('estCompData').value || hojeLocal(),
      observacao: $('estCompObs').value.trim() || null,
      // Compra "a pagar" pode ter data de vencimento (às vezes tem boleto, às vezes não)
      vencimento: (!$('estCompPago').checked && $('estCompVenc').value) ? $('estCompVenc').value : null,
    }

    await comBotaoTravado($('estBtnSalvarCompra'), 'Salvando...', async () => {
      const { data: compra, error } = await supabase.from('compras_estoque').insert(dados).select().single()
      if (error) { console.error('Erro ao salvar compra:', error); alert(mensagemErro(error)); return }

      // Passos extras: se algum falhar, a compra já está salva; só avisamos o que faltou.
      let aviso = ''
      if ($('estCompPago').checked) {
        const r = await supabase.from('pagamentos_compra').insert({
          user_id: userId,
          compra_id: compra.id,
          valor: arredonda2(quantidade * custo),
          data_pagamento: dados.data_compra,
        })
        if (r.error) {
          console.error('Erro ao registrar o pagamento da compra:', r.error)
          aviso += 'A compra foi salva, mas não consegui registrar o pagamento. Ela aparece como "A pagar".\n'
        }
      }
      if ($('estCompAtualizaCusto').checked && custo !== Number(produto.preco_custo)) {
        const r = await supabase.from('produtos').update({ preco_custo: custo }).eq('id', produtoId)
        if (r.error) {
          console.error('Erro ao atualizar o custo do produto:', r.error)
          aviso += 'A compra foi salva, mas não consegui atualizar o custo do produto.\n'
        }
      }

      fechar('estModalCompra')
      await recarregar()
      if (aviso) alert(aviso)
    })
  })

  async function excluirCompra(id) {
    if (!confirm('Excluir esta compra?\nO estoque do produto diminui na mesma quantidade e os pagamentos dela também são apagados.')) return
    const { error } = await supabase.from('compras_estoque').delete().eq('id', id)
    if (error) { console.error('Erro ao excluir compra:', error); alert(mensagemErro(error, 'excluir')); return }
    await recarregar()
  }

  // ── Botões das tabelas (um único "ouvinte" para a seção toda) ──
  $('secaoEstoque').addEventListener('click', (e) => {
    const botao = e.target.closest('[data-acao]')
    if (!botao) return
    const id = botao.dataset.id
    switch (botao.dataset.acao) {
      case 'editar-fornecedor': abrirFornecedor(fornecedores.find((f) => f.id === id)); break
      case 'excluir-fornecedor': excluirFornecedor(id); break
      case 'editar-produto': abrirProduto(produtos.find((p) => p.id === id)); break
      case 'excluir-produto': excluirProduto(id); break
      case 'editar-compra': abrirCompra(compras.find((c) => c.id === id)); break
      case 'excluir-compra': excluirCompra(id); break
    }
  })

  recarregar()
}
