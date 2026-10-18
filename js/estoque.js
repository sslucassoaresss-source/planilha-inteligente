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
  function atualizarTotalCompra() {
    const total = arredonda2(Number($('estCompQtd').value) * Number($('estCompCusto').value))
    $('estCompTotal').innerHTML = `Total da compra: <strong>${fmt(total)}</strong>`
  }

  function abrirCompra() {
    const ativos = produtos.filter((p) => p.ativo)
    const semProduto = ativos.length === 0
    $('estCompAviso').style.display = semProduto ? 'block' : 'none'
    $('estBtnSalvarCompra').disabled = semProduto

    $('estCompProduto').innerHTML = ativos.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')
    $('estCompData').value = hojeLocal()
    $('estCompQtd').value = ''
    $('estCompObs').value = ''
    $('estCompPago').checked = true
    $('estCompVenc').value = ''
    $('estCampoVenc').style.display = 'none'
    $('estCompAtualizaCusto').checked = true
    aoMudarProdutoDaCompra()
    abrir('estModalCompra')
    $('estCompQtd').focus()
  }

  // Ao escolher o produto, já sugere o fornecedor e o custo dele
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

  $('estBtnNovaCompra').addEventListener('click', abrirCompra)
  $('estCompProduto').addEventListener('change', aoMudarProdutoDaCompra)
  $('estCompQtd').addEventListener('input', atualizarTotalCompra)
  $('estCompCusto').addEventListener('input', atualizarTotalCompra)

  $('estFormCompra').addEventListener('submit', async (e) => {
    e.preventDefault()
    const produtoId = $('estCompProduto').value
    const produto = produtoPorId()[produtoId]
    const quantidade = arredonda3($('estCompQtd').value)
    const custo = arredonda2($('estCompCusto').value)
    if (!produto || quantidade <= 0 || custo < 0) return

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
      case 'excluir-compra': excluirCompra(id); break
    }
  })

  recarregar()
}
