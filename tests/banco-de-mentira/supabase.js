// BANCO DE MENTIRA para testes de tela (substitui js/supabase.js SÓ na cópia de teste).
// Guarda tudo em memória; imita o que o app usa do supabase-js e as regras do SQL
// (chaves estrangeiras, cascata, set null, unique, checks, relações embutidas no select).

const uuid = () => crypto.randomUUID()

const db = {
  clientes: [
    { id: 'c1', user_id: 'u1', nome: 'Pet Shop do Lulu', cidade: 'Campinas', observacoes: '', desconto: 50 },
    { id: 'c2', user_id: 'u1', nome: 'Agro Zeta', cidade: 'Valinhos', observacoes: 'Fecha às 17h', desconto: 0 },
  ],
  empresas: [
    { id: 'e1', user_id: 'u1', nome: 'Racao Forte', percentual_comissao: 10 },
    { id: 'e2', user_id: 'u1', nome: 'Areia Boa', percentual_comissao: 5 },
  ],
  visitas: [],
  itens_venda: [],
  comissoes_recebidas: [],
  rota_agendamentos: [],
  rota_clientes: [],
  rotas: [],
  cidades_ordem: [],
  fornecedores: [{ id: 'f1', user_id: 'u1', nome: 'Luciano', observacao: null }],
  produtos: [
    { id: 'p1', user_id: 'u1', nome: 'Areia de mandioca 4 kg', unidade: 'fardo', fornecedor_id: 'f1', descricao: null, preco_custo: 20, preco_venda: 26, ativo: true },
    { id: 'p2', user_id: 'u1', nome: 'Ração 15kg', unidade: 'saco', fornecedor_id: 'f1', descricao: null, preco_custo: 150, preco_venda: 210, ativo: true },
  ],
  compras_estoque: [
    { id: 'cp1', user_id: 'u1', produto_id: 'p1', fornecedor_id: 'f1', quantidade: 100, custo_unitario: 20, data_compra: '2026-10-01', created_at: '2026-10-01T10:00:00Z' },
    { id: 'cp2', user_id: 'u1', produto_id: 'p2', fornecedor_id: 'f1', quantidade: 10, custo_unitario: 150, data_compra: '2026-10-01', created_at: '2026-10-01T10:01:00Z' },
  ],
  pagamentos_compra: [],
  vendas_estoque: [],
  venda_estoque_itens: [],
  pagamentos_venda: [],
  retiradas_lucro: [],
  metas_estoque: [],
  lembretes: [], push_subscriptions: [],
  entregas: [],
  entrega_paradas: [],
  entrega_itens: [],
}
window.__db = db
window.__falhar = null // { tabela, op, code? }: simula erro do servidor uma vez
window.__log = []

// Relações usadas nos selects embutidos: [tipo, coluna, tabela alvo]
const REL = {
  visitas: { clientes: ['one', 'cliente_id', 'clientes'], itens_venda: ['many', 'visita_id', 'itens_venda'] },
  itens_venda: { empresas: ['one', 'empresa_id', 'empresas'] },
  vendas_estoque: {
    clientes: ['one', 'cliente_id', 'clientes'],
    venda_estoque_itens: ['many', 'venda_id', 'venda_estoque_itens'],
    pagamentos_venda: ['many', 'venda_id', 'pagamentos_venda'],
  },
  venda_estoque_itens: { produtos: ['one', 'produto_id', 'produtos'] },
  lembretes: { clientes: ['one', 'cliente_id', 'clientes'] },
  rota_clientes: { clientes: ['one', 'cliente_id', 'clientes'] },
  entregas: { entrega_paradas: ['many', 'entrega_id', 'entrega_paradas'] },
  entrega_paradas: { clientes: ['one', 'cliente_id', 'clientes'], entrega_itens: ['many', 'parada_id', 'entrega_itens'], vendas_estoque: ['one', 'venda_id', 'vendas_estoque'] },
  entrega_itens: { produtos: ['one', 'produto_id', 'produtos'] },
  compras_estoque: {
    fornecedores: ['one', 'fornecedor_id', 'fornecedores'],
    produtos: ['one', 'produto_id', 'produtos'],
    pagamentos_compra: ['many', 'compra_id', 'pagamentos_compra'],
  },
}

function embeds(s) {
  const out = []; let depth = 0
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '(') {
      if (depth === 0) { const m = s.slice(0, k).match(/([A-Za-z_]+)\s*$/); out.push({ name: m[1], from: k + 1 }) }
      depth++
    } else if (s[k] === ')') {
      depth--
      if (depth === 0) out[out.length - 1].inner = s.slice(out[out.length - 1].from, k)
    }
  }
  return out
}

function aplicarEmbeds(tabela, linhas, selectStr) {
  const defs = REL[tabela] || {}
  for (const e of embeds(selectStr || '')) {
    const d = defs[e.name]
    if (!d) continue
    linhas = linhas.map((l) => {
      const alvo = db[d[2]]
      let val
      if (d[0] === 'one') {
        const r = alvo.find((x) => x.id === l[d[1]])
        val = r ? aplicarEmbeds(d[2], [{ ...r }], e.inner)[0] : null
      } else {
        val = aplicarEmbeds(d[2], alvo.filter((x) => x[d[1]] === l.id).map((x) => ({ ...x })), e.inner)
      }
      return { ...l, [e.name]: val }
    })
  }
  return linhas
}

const erroFK = () => ({ code: '23503', message: 'violates foreign key constraint' })

class Consulta {
  constructor(tabela) {
    this.t = tabela; this.op = 'select'; this.filtros = []; this.ordem = null; this.sel = '*'
    this.payload = null; this.unico = false; this.devolve = false; this.faixa = null
  }
  select(s) { if (this.op !== 'select') this.devolve = true; this.sel = s || '*'; return this }
  insert(p) { this.op = 'insert'; this.payload = p; return this }
  update(p) { this.op = 'update'; this.payload = p; return this }
  upsert(p) { this.op = 'upsert'; this.payload = p; return this }
  delete() { this.op = 'delete'; return this }
  eq(c, v) { this.filtros.push((l) => l[c] === v); return this }
  gt(c, v) { this.filtros.push((l) => l[c] > v); return this }
  gte(c, v) { this.filtros.push((l) => l[c] >= v); return this }
  lte(c, v) { this.filtros.push((l) => l[c] <= v); return this }
  in(c, vs) { this.filtros.push((l) => vs.includes(l[c])); return this }
  order(c, o) { this.ordem = c; this.desc = o && o.ascending === false; return this }
  range(a, b) { this.faixa = [a, b]; return this }
  single() { this.unico = true; return this }
  then(ok, ko) { return Promise.resolve(this.executar()).then(ok, ko) }

  executar() {
    const falha = window.__falhar
    if (falha && falha.tabela === this.t && falha.op === this.op) {
      if (!falha.sempre) window.__falhar = null
      return { data: null, error: { code: falha.code || '42501', message: 'falha simulada' } }
    }
    window.__log.push(`${this.op} ${this.t}`)
    const tabela = db[this.t]
    if (!tabela) return { data: null, error: { code: '42P01', message: `tabela ${this.t} não existe` } }

    if (this.op === 'select') {
      let linhas = tabela.filter((l) => this.filtros.every((f) => f(l)))
      if (this.ordem) {
        linhas = [...linhas].sort((a, b) => String(a[this.ordem]).localeCompare(String(b[this.ordem]), 'pt-BR') * (this.desc ? -1 : 1))
      }
      if (this.faixa) linhas = linhas.slice(this.faixa[0], this.faixa[1] + 1)
      linhas = aplicarEmbeds(this.t, linhas.map((l) => ({ ...l })), this.sel)
      return { data: this.unico ? (linhas[0] ?? null) : linhas, error: null }
    }

    if (this.op === 'insert' || this.op === 'upsert') {
      const novas = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p) => ({
        id: uuid(), created_at: new Date().toISOString(), ...p,
      }))
      for (const n of novas) {
        if ('quantidade' in n && !(Number(n.quantidade) > 0)) return { data: null, error: { code: '23514', message: 'check quantidade' } }
        if ('valor' in n && this.t.startsWith('pagamentos') && !(Number(n.valor) > 0)) return { data: null, error: { code: '23514', message: 'check valor' } }
        if (this.t === 'produtos') { n.ativo = n.ativo ?? true; n.unidade = n.unidade ?? 'un' }
        if (this.t === 'entrega_paradas') { n.feita = n.feita ?? false; n.venda_id = n.venda_id ?? null; n.ordem = n.ordem ?? 0 }
        if (this.t === 'entregas') { n.data_entrega = n.data_entrega ?? null }
        if (this.t === 'lembretes') { n.feito = n.feito ?? false; n.feito_em = n.feito_em ?? null }
        if (this.t === 'compras_estoque' && !db.produtos.some((p) => p.id === n.produto_id)) return { data: null, error: erroFK() }
        if (this.t === 'vendas_estoque') {
          if (!db.clientes.some((c) => c.id === n.cliente_id)) return { data: null, error: erroFK() }
          if (n.visita_id && db.vendas_estoque.some((v) => v.visita_id === n.visita_id)) return { data: null, error: { code: '23505', message: 'unique visita_id' } }
        }
        if (this.t === 'venda_estoque_itens' && (!db.vendas_estoque.some((v) => v.id === n.venda_id) || !db.produtos.some((p) => p.id === n.produto_id))) return { data: null, error: erroFK() }
        if (this.t === 'pagamentos_venda' && !db.vendas_estoque.some((v) => v.id === n.venda_id)) return { data: null, error: erroFK() }
        if (this.t === 'itens_venda' && !db.visitas.some((v) => v.id === n.visita_id)) return { data: null, error: erroFK() }
      }
      novas.forEach((n) => tabela.push(n))
      const devolvido = novas.map((n) => ({ ...n }))
      return { data: this.devolve ? (this.unico ? devolvido[0] : devolvido) : null, error: null }
    }

    if (this.op === 'update') {
      const alvo = tabela.filter((l) => this.filtros.every((f) => f(l)))
      alvo.forEach((l) => Object.assign(l, this.payload))
      return { data: null, error: null }
    }

    if (this.op === 'delete') {
      const alvo = tabela.filter((l) => this.filtros.every((f) => f(l)))
      for (const l of alvo) {
        if (this.t === 'produtos' && (db.compras_estoque.some((c) => c.produto_id === l.id) || db.venda_estoque_itens.some((i) => i.produto_id === l.id))) return { data: null, error: erroFK() }
        if (this.t === 'clientes' && db.vendas_estoque.some((v) => v.cliente_id === l.id)) return { data: null, error: erroFK() }
      }
      alvo.forEach((l) => {
        db[this.t].splice(db[this.t].indexOf(l), 1)
        if (this.t === 'compras_estoque') db.pagamentos_compra = db.pagamentos_compra.filter((p) => p.compra_id !== l.id)
        if (this.t === 'vendas_estoque') {
          db.entrega_paradas.forEach((x) => { if (x.venda_id === l.id) x.venda_id = null })
          db.venda_estoque_itens = db.venda_estoque_itens.filter((i) => i.venda_id !== l.id)
          db.pagamentos_venda = db.pagamentos_venda.filter((p) => p.venda_id !== l.id)
        }
        if (this.t === 'visitas') {
          db.itens_venda = db.itens_venda.filter((i) => i.visita_id !== l.id)           // cascade
          db.vendas_estoque.forEach((v) => { if (v.visita_id === l.id) v.visita_id = null }) // set null
        }
        if (this.t === 'clientes') db.lembretes.forEach((x) => { if (x.cliente_id === l.id) x.cliente_id = null })
        if (this.t === 'entregas') { const ps = db.entrega_paradas.filter((x) => x.entrega_id === l.id).map((x) => x.id); db.entrega_paradas = db.entrega_paradas.filter((x) => x.entrega_id !== l.id); db.entrega_itens = db.entrega_itens.filter((x) => !ps.includes(x.parada_id)) }
        if (this.t === 'entrega_paradas') db.entrega_itens = db.entrega_itens.filter((x) => x.parada_id !== l.id)
        if (this.t === 'fornecedores') {
          db.produtos.forEach((p) => { if (p.fornecedor_id === l.id) p.fornecedor_id = null })
          db.compras_estoque.forEach((c) => { if (c.fornecedor_id === l.id) c.fornecedor_id = null })
        }
      })
      ;['pagamentos_compra', 'venda_estoque_itens', 'pagamentos_venda', 'itens_venda', 'entrega_paradas', 'entrega_itens'].forEach((k) => { window.__db[k] = db[k] })
      return { data: null, error: null }
    }
    return { data: null, error: null }
  }
}

export const supabase = {
  from: (t) => new Consulta(t),
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
    signOut: async () => ({}),
    // Login simulado; o resultado vem da marca "login" no localStorage:
    // ok (padrão) · senha (senha errada) · rede (o fetch lança erro) · rede-sdk (erro devolvido com status 0) · lento (demora 1,5 s e entra)
    signInWithPassword: async () => {
      const modo = localStorage.getItem('login') || 'ok'
      window.__loginChamadas = (window.__loginChamadas || 0) + 1
      if (modo === 'lento') await new Promise((r) => setTimeout(r, 1500))
      if (modo === 'senha') return { data: {}, error: { name: 'AuthApiError', status: 400, message: 'Invalid login credentials' } }
      if (modo === 'rede') throw new TypeError('Failed to fetch')
      // como o supabase-js 2 costuma devolver a falha de rede (sem lançar)
      if (modo === 'rede-sdk') return { data: {}, error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } }
      return { data: { session: { user: { id: 'u1' } } }, error: null }
    },
  },
}

export async function buscarTodasLinhas(tabela, { select = '*', order = null, filtro = null } = {}) {
  let q = supabase.from(tabela).select(select)
  if (filtro) q = filtro(q)
  if (order) q = q.order(order)
  const r = await q
  return r.error ? { data: null, error: r.error } : { data: r.data, error: null }
}

// ── Cenário de lucro (?seed=lucro): vendas de meses diferentes com pagamentos em partes ──
if (localStorage.getItem('seed') === 'lucro') {
  const it = (venda_id, produto_id, quantidade, preco_unitario, custo_unitario) => ({ id: uuid(), user_id: 'u1', venda_id, produto_id, quantidade, preco_unitario, custo_unitario })
  const pg = (venda_id, valor, data_pagamento, n) => ({ id: uuid(), user_id: 'u1', venda_id, valor, data_pagamento, created_at: `${data_pagamento}T10:0${n}:00Z` })
  // A: set/28, areia 10 x 26 (custo 20): total 260, custo 200, lucro máx 60. Pago 150 (set), 80 (out), 30 (out)
  db.vendas_estoque.push({ id: 'vA', user_id: 'u1', cliente_id: 'c1', visita_id: null, data_venda: '2026-09-28', prazo_dias: 10, vencimento: '2026-10-08' })
  db.venda_estoque_itens.push(it('vA', 'p1', 10, 26, 20))
  db.pagamentos_venda.push(pg('vA', 150, '2026-09-28', 1), pg('vA', 80, '2026-10-03', 1), pg('vA', 30, '2026-10-04', 1))
  // B: set/30, ração 1 x 210 (custo 150): paga na hora (lucro 60 em setembro)
  db.vendas_estoque.push({ id: 'vB', user_id: 'u1', cliente_id: 'c2', visita_id: null, data_venda: '2026-09-30', prazo_dias: null, vencimento: null })
  db.venda_estoque_itens.push(it('vB', 'p2', 1, 210, 150))
  db.pagamentos_venda.push(pg('vB', 210, '2026-09-30', 1))
  // C: out/10, areia 5 x 26 fiado (sem pagamento)
  db.vendas_estoque.push({ id: 'vC', user_id: 'u1', cliente_id: 'c1', visita_id: null, data_venda: '2026-10-10', prazo_dias: 10, vencimento: '2026-10-20' })
  db.venda_estoque_itens.push(it('vC', 'p1', 5, 26, 20))
  // D: out/12, venda NO PREJUÍZO: 1 x 10 (custo 20), paga 10 -> lucro 0 (nunca negativo)
  db.vendas_estoque.push({ id: 'vD', user_id: 'u1', cliente_id: 'c2', visita_id: null, data_venda: '2026-10-12', prazo_dias: null, vencimento: null })
  db.venda_estoque_itens.push(it('vD', 'p1', 1, 10, 20))
  db.pagamentos_venda.push(pg('vD', 10, '2026-10-12', 1))
  db.retiradas_lucro.push({ id: 'r1', user_id: 'u1', valor: 50, data_retirada: '2026-10-05', observacao: 'conta pessoal', created_at: '2026-10-05T10:00:00Z' })
}

// ── Visitas de representação para o gráfico (?seed=lucro ou seed=rep) ──
if (['lucro', 'rep'].includes(localStorage.getItem('seed'))) {
  const vis = (id, cliente_id, data_visita, desconto_aplicado) => db.visitas.push({ id, user_id: 'u1', cliente_id, data_visita, comprou: true, desconto_aplicado, observacao: null, created_at: `${data_visita}T09:00:00Z` })
  const item = (visita_id, empresa_id, valor) => db.itens_venda.push({ id: uuid(), user_id: 'u1', visita_id, empresa_id, valor, comissao_manual: null })
  vis('vr1', 'c2', '2026-10-12', 0); item('vr1', 'e1', 150)   // mesmo dia da venda D (estoque R$ 10)
  vis('vr2', 'c2', '2026-10-20', 0); item('vr2', 'e2', 300)   // só representação (maior dia)
  vis('vr3', 'c1', '2026-10-25', 50); item('vr3', 'e1', 200)  // desconto fixo de R$ 50 -> R$ 150
}

// ── Cenário "última compra" (seed=clientes) ──
if (localStorage.getItem('seed') === 'clientes') {
  const cli = (id, nome, cidade) => db.clientes.push({ id, user_id: 'u1', nome, cidade, telefone: '', observacoes: '', desconto: 0 })
  const vis = (id, cliente_id, data_visita, comprou) => db.visitas.push({ id, user_id: 'u1', cliente_id, data_visita, comprou, desconto_aplicado: 0, observacao: null, created_at: `${data_visita}T09:00:00Z` })
  const venda = (id, cliente_id, data_venda) => db.vendas_estoque.push({ id, user_id: 'u1', cliente_id, visita_id: null, data_venda, prazo_dias: null, vencimento: null })
  cli('c3', 'Loja Nova (nunca comprou)', 'Campinas'); cli('c4', 'Só Estoque', 'Valinhos'); cli('c5', 'Empate no dia', 'Campinas')
  // c1 Pet Shop do Lulu: empresas 25/10 (mais recente) e estoque 10/10
  vis('v1', 'c1', '2026-10-25', true); vis('v1b', 'c1', '2026-10-05', true); venda('s1', 'c1', '2026-10-10')
  // c2 Agro Zeta: empresas 12/10 e estoque 18/10 (estoque mais recente); visita "Não comprou" 30/10 não conta
  vis('v2', 'c2', '2026-10-12', true); vis('v2n', 'c2', '2026-10-30', false); venda('s2', 'c2', '2026-10-18')
  // c3: só visita "Não comprou" -> nunca comprou
  vis('v3n', 'c3', '2026-10-20', false)
  // c4: só estoque
  venda('s4', 'c4', '2026-10-30')
  // c5: empresas e estoque no MESMO dia
  vis('v5', 'c5', '2026-11-01', true); venda('s5', 'c5', '2026-11-01')
}

// ── Cenário de cobranças (seed=cobrancas): datas relativas a HOJE ──
if (localStorage.getItem('seed') === 'cobrancas') {
  const hoje = new Date()
  const dia = (delta) => { const x = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + delta); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
  const pgV = (venda_id, valor, data) => db.pagamentos_venda.push({ id: uuid(), user_id: 'u1', venda_id, valor, data_pagamento: data, forma: null, created_at: `${data}T10:00:00Z` })
  const pgC = (compra_id, valor) => db.pagamentos_compra.push({ id: uuid(), user_id: 'u1', compra_id, valor, data_pagamento: dia(-30), forma: null })
  const venda = (id, cliente_id, venc, itens, obs) => { db.vendas_estoque.push({ id, user_id: 'u1', cliente_id, visita_id: null, data_venda: dia(-10), prazo_dias: venc ? 10 : null, vencimento: venc, observacao_cobranca: obs || null }); itens.forEach(([p, q, pr, c]) => db.venda_estoque_itens.push({ id: uuid(), user_id: 'u1', venda_id: id, produto_id: p, quantidade: q, preco_unitario: pr, custo_unitario: c })) }
  // as compras iniciais do cenário ficam pagas (não aparecem em "Quem eu devo")
  pgC('cp1', 2000); pgC('cp2', 1500)
  // Quem me deve
  venda('qd1', 'c1', dia(-3), [['p1', 10, 30, 20]], 'cobrar por Pix na sexta')   // total 300, pagou 100 -> falta 200, ATRASADA 3 dias
  pgV('qd1', 100, dia(-8))
  venda('qd2', 'c2', dia(0), [['p1', 3, 30, 20]])                                  // 90, vence HOJE
  venda('qd3', 'c1', dia(2), [['p2', 1, 200, 150]])                                // 200, vence em 2 dias
  venda('qd4', 'c2', null, [['p1', 5, 30, 20]])                                    // 150, sem prazo
  venda('qd5', 'c1', dia(-1), [['p1', 1, 30, 20]]); pgV('qd5', 30, dia(-5))        // quitada: não aparece
  // Quem eu devo
  db.compras_estoque.push({ id: 'k1', user_id: 'u1', produto_id: 'p2', fornecedor_id: 'f1', quantidade: 2, custo_unitario: 150, data_compra: dia(-12), created_at: `${dia(-12)}T10:00:00Z`, vencimento: dia(-1), observacao_cobranca: null })  // 300, venceu ontem
  db.compras_estoque.push({ id: 'k2', user_id: 'u1', produto_id: 'p1', fornecedor_id: null, quantidade: 10, custo_unitario: 20, data_compra: dia(-5), created_at: `${dia(-5)}T10:00:00Z`, vencimento: null, observacao_cobranca: null }); pgC('k2', 50) // 200, pagou 50, sem prazo
  db.compras_estoque.push({ id: 'k3', user_id: 'u1', produto_id: 'p1', fornecedor_id: 'f1', quantidade: 1, custo_unitario: 20, data_compra: dia(-5), created_at: `${dia(-5)}T10:00:01Z`, vencimento: null, observacao_cobranca: null }); pgC('k3', 20)  // quitada
}

// ── Cenário de entregas (seed=entregas): datas relativas a HOJE ──
if (localStorage.getItem('seed') === 'entregas') {
  const hoje = new Date()
  const dia = (delta) => { const x = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + delta); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
  const ent = (id, nome, data, criado) => db.entregas.push({ id, user_id: 'u1', nome, data_entrega: data, observacao: null, created_at: criado })
  const par = (id, entrega_id, cliente_id, ordem, feita) => db.entrega_paradas.push({ id, user_id: 'u1', entrega_id, cliente_id, ordem, feita, venda_id: null, created_at: `2026-10-0${ordem + 1}T10:00:00Z` })
  const it = (parada_id, produto_id, quantidade) => db.entrega_itens.push({ id: uuid(), user_id: 'u1', parada_id, produto_id, quantidade })
  ent('en1', 'Areia de sábado', null, '2026-10-10T10:00:00Z')           // SEM DIA
  par('pa1', 'en1', 'c1', 0, false); it('pa1', 'p1', 10)
  par('pa2', 'en1', 'c2', 1, false); it('pa2', 'p1', 5); it('pa2', 'p2', 2)
  ent('en2', 'Ração do Lulu', dia(-2), '2026-10-11T10:00:00Z')          // ATRASADA
  par('pa3', 'en2', 'c1', 0, false); it('pa3', 'p2', 3)
  ent('en3', null, dia(2), '2026-10-12T10:00:00Z')                       // em 2 dias
  par('pa4', 'en3', 'c2', 0, false); it('pa4', 'p1', 8)
  ent('en4', 'Entrega antiga', dia(-9), '2026-10-01T10:00:00Z')          // CONCLUÍDA
  par('pa5', 'en4', 'c1', 0, true); it('pa5', 'p1', 4)
}

// ── Cenário do GUIA (seed=guia): dados neutros e bonitos para as telas do guia do Caio ──
if (localStorage.getItem('seed') === 'guia') {
  const hoje = new Date()
  const dia = (delta) => { const x = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + delta); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
  db.clientes[1].nome = 'Mundo Animal'
  db.produtos[1].nome = 'Ração 15 kg'
  db.compras_estoque.length = 0
  const compra = (id, produto_id, quantidade, custo_unitario, data_compra, vencimento = null, obs = null) => db.compras_estoque.push({ id, user_id: 'u1', produto_id, fornecedor_id: 'f1', quantidade, custo_unitario, data_compra, vencimento, observacao_cobranca: obs, created_at: `${data_compra}T10:00:00Z` })
  const pagC = (compra_id, valor, data, forma) => db.pagamentos_compra.push({ id: uuid(), user_id: 'u1', compra_id, valor, data_pagamento: data, forma })
  compra('cp1', 'p1', 100, 20, '2026-10-01'); pagC('cp1', 2000, '2026-10-01', 'pix')
  compra('cp2', 'p2', 20, 150, '2026-10-01'); pagC('cp2', 3000, '2026-10-01', 'pix')
  compra('cp3', 'p2', 10, 150, '2026-10-15', dia(0), 'pagar o resto hoje'); pagC('cp3', 500, '2026-10-15', 'dinheiro')
  const venda = (id, cliente_id, data_venda, itens, vencimento = null, obs = null) => { db.vendas_estoque.push({ id, user_id: 'u1', cliente_id, visita_id: null, data_venda, prazo_dias: vencimento ? 10 : null, vencimento, observacao_cobranca: obs }); itens.forEach(([p, q, pr, c]) => db.venda_estoque_itens.push({ id: uuid(), user_id: 'u1', venda_id: id, produto_id: p, quantidade: q, preco_unitario: pr, custo_unitario: c })) }
  const pagV = (venda_id, valor, data_pagamento, forma) => db.pagamentos_venda.push({ id: uuid(), user_id: 'u1', venda_id, valor, data_pagamento, forma, created_at: `${data_pagamento}T10:00:00Z` })
  venda('s1', 'c1', '2026-10-03', [['p1', 20, 26, 20]]); pagV('s1', 520, '2026-10-03', 'pix')
  venda('s2', 'c2', '2026-10-07', [['p2', 2, 210, 150]]); pagV('s2', 420, '2026-10-07', 'dinheiro')
  venda('s3', 'c1', '2026-10-12', [['p2', 1, 210, 150], ['p1', 5, 26, 20]], dia(3), 'cobrar por Pix na sexta'); pagV('s3', 220, '2026-10-12', 'pix')
  venda('s4', 'c2', '2026-10-14', [['p1', 10, 26, 20]], dia(-2))
  db.retiradas_lucro.push({ id: 'r1', user_id: 'u1', valor: 100, data_retirada: '2026-10-10', observacao: 'conta pessoal', created_at: '2026-10-10T10:00:00Z' })
  db.metas_estoque.push({ id: 'm1', user_id: 'u1', produto_id: 'p1', quantidade: 200, preco_unitario: 20, created_at: '2026-10-16T10:00:00Z' }, { id: 'm2', user_id: 'u1', produto_id: 'p2', quantidade: 50, preco_unitario: 150, created_at: '2026-10-16T10:00:01Z' })
  const vis = (id, cliente_id, data_visita) => db.visitas.push({ id, user_id: 'u1', cliente_id, data_visita, comprou: true, desconto_aplicado: 0, observacao: null, created_at: `${data_visita}T09:00:00Z` })
  const item = (visita_id, empresa_id, valor) => db.itens_venda.push({ id: uuid(), user_id: 'u1', visita_id, empresa_id, valor, comissao_manual: null })
  vis('vr1', 'c1', '2026-10-05'); item('vr1', 'e1', 800); vis('vr2', 'c2', '2026-10-12'); item('vr2', 'e2', 500); vis('vr3', 'c1', '2026-10-16'); item('vr3', 'e1', 300)
  const ent = (id, nome, data, criado) => db.entregas.push({ id, user_id: 'u1', nome, data_entrega: data, observacao: null, created_at: criado })
  const par = (id, entrega_id, cliente_id, ordem) => db.entrega_paradas.push({ id, user_id: 'u1', entrega_id, cliente_id, ordem, feita: false, venda_id: null, created_at: `2026-10-1${ordem}T10:00:00Z` })
  const ei = (parada_id, produto_id, quantidade) => db.entrega_itens.push({ id: uuid(), user_id: 'u1', parada_id, produto_id, quantidade })
  ent('en1', 'Entrega de areia de sábado', null, '2026-10-16T10:00:00Z'); par('pa1', 'en1', 'c1', 0); ei('pa1', 'p1', 10); par('pa2', 'en1', 'c2', 1); ei('pa2', 'p1', 5); ei('pa2', 'p2', 2)
  ent('en2', 'Ração do Lulu', dia(2), '2026-10-17T10:00:00Z'); par('pa3', 'en2', 'c1', 0); ei('pa3', 'p2', 3)
  db.lembretes.push({ id: 'l1', user_id: 'u1', texto: 'Mandar cotação da ração 15 kg', cliente_id: 'c1', feito: false, feito_em: null, created_at: '2026-10-16T10:00:00Z' }, { id: 'l2', user_id: 'u1', texto: 'Pedir o boleto novo ao Luciano', cliente_id: null, feito: false, feito_em: null, created_at: '2026-10-17T10:00:00Z' })
}

// ── Cenário de ATAQUE (seed=xss): cada campo de texto recebe uma carga que, se o app a tratar como HTML,
// avisa em window.__xss qual campo disparou. A carga funciona em texto E dentro de atributo entre aspas
// ("> fecha o atributo/tag e <img onerror> executa). ──
if (localStorage.getItem('seed') === 'xss') {
  const P = (marca) => `"><img src=x onerror="window.__xss&&window.__xss.push('${marca}')">`
  const hoje = new Date()
  const dia = (delta) => { const x = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + delta); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
  const agora = new Date().toISOString()

  const cidadeAtaque = P('cli.cidade')
  db.clientes.length = 0
  db.clientes.push(
    { id: 'c1', user_id: 'u1', nome: P('cli.nome'), endereco: P('cli.endereco'), bairro: P('cli.bairro'), cidade: cidadeAtaque, estado: P('cli.estado'), telefone: P('cli.telefone'), observacoes: P('cli.obs'), desconto: 25, latitude: null, longitude: null },
    { id: 'c2', user_id: 'u1', nome: P('cli2.nome'), endereco: 'Rua Normal 10', bairro: 'Centro', cidade: cidadeAtaque, estado: 'SP', telefone: '19 99999-0000', observacoes: '', desconto: 0, latitude: null, longitude: null },
  )

  db.empresas.length = 0
  db.empresas.push({ id: 'e1', user_id: 'u1', nome: P('emp.nome'), percentual_comissao: 10 })

  db.visitas.length = 0; db.itens_venda.length = 0
  db.visitas.push({ id: 'v1', user_id: 'u1', cliente_id: 'c1', data_visita: dia(0), comprou: true, desconto_aplicado: 0, observacao: P('vis.obs'), created_at: agora })
  db.itens_venda.push({ id: 'iv1', user_id: 'u1', visita_id: 'v1', empresa_id: 'e1', valor: 100, comissao_manual: null })

  db.rotas.length = 0; db.rota_clientes.length = 0; db.rota_agendamentos.length = 0
  db.rotas.push({ id: 'r1', user_id: 'u1', cidade: cidadeAtaque, nome: P('rota.nome'), observacao: P('rota.obs'), created_at: agora })
  db.rota_clientes.push({ id: 'rc1', user_id: 'u1', rota_id: 'r1', cliente_id: 'c1', ordem: 0 }, { id: 'rc2', user_id: 'u1', rota_id: 'r1', cliente_id: 'c2', ordem: 1 })
  db.rota_agendamentos.push({ id: 'ra1', user_id: 'u1', rota_id: 'r1', data: dia(0) })

  // Estoque
  db.fornecedores.length = 0
  db.fornecedores.push({ id: 'f1', user_id: 'u1', nome: P('forn.nome'), observacao: P('forn.obs') })
  db.produtos.length = 0
  db.produtos.push(
    { id: 'p1', user_id: 'u1', nome: P('prod.nome'), unidade: P('prod.unidade'), fornecedor_id: 'f1', descricao: P('prod.desc'), preco_custo: 20, preco_venda: 26, ativo: true },
  )
  db.compras_estoque.length = 0; db.pagamentos_compra.length = 0
  db.compras_estoque.push(
    { id: 'cp1', user_id: 'u1', produto_id: 'p1', fornecedor_id: 'f1', quantidade: 100, custo_unitario: 20, data_compra: dia(-5), vencimento: null, observacao: P('compra.obs'), observacao_cobranca: null, created_at: agora },
    { id: 'cp2', user_id: 'u1', produto_id: 'p1', fornecedor_id: 'f1', quantidade: 10, custo_unitario: 20, data_compra: dia(-2), vencimento: dia(1), observacao: null, observacao_cobranca: P('compra.obscob'), created_at: agora },
  )
  db.vendas_estoque.length = 0; db.venda_estoque_itens.length = 0; db.pagamentos_venda.length = 0
  db.vendas_estoque.push({ id: 's1', user_id: 'u1', cliente_id: 'c1', visita_id: null, data_venda: dia(0), prazo_dias: 3, vencimento: dia(1), observacao: P('venda.obs'), observacao_cobranca: P('venda.obscob'), created_at: agora })
  db.venda_estoque_itens.push({ id: 'si1', user_id: 'u1', venda_id: 's1', produto_id: 'p1', quantidade: 5, preco_unitario: 26, custo_unitario: 20, created_at: agora })
  db.retiradas_lucro.length = 0
  db.retiradas_lucro.push({ id: 'r1x', user_id: 'u1', valor: 10, data_retirada: dia(-1), observacao: P('retirada.obs'), created_at: agora })
  db.metas_estoque.length = 0
  db.metas_estoque.push({ id: 'm1', user_id: 'u1', produto_id: 'p1', quantidade: 50, preco_unitario: 20, created_at: agora })
  db.entregas.length = 0; db.entrega_paradas.length = 0; db.entrega_itens.length = 0
  db.entregas.push({ id: 'en1', user_id: 'u1', nome: P('ent.nome'), data_entrega: dia(0), observacao: P('ent.obs'), created_at: agora })
  db.entrega_paradas.push({ id: 'pa1', user_id: 'u1', entrega_id: 'en1', cliente_id: 'c1', ordem: 0, feita: false, venda_id: null, created_at: agora })
  db.entrega_itens.push({ id: 'ei1', user_id: 'u1', parada_id: 'pa1', produto_id: 'p1', quantidade: 3 })
  db.lembretes.length = 0
  db.lembretes.push({ id: 'l1', user_id: 'u1', texto: P('lembrete.texto'), cliente_id: 'c1', feito: false, feito_em: null, created_at: agora })
}

// ── Cenário NORMAL (seed=normal): os MESMOS campos do cenário de ataque, mas com dados reais difíceis
// (& ' " > % acentos). Serve para comparar a tela do app antigo com a do app corrigido: devem ser idênticas. ──
if (localStorage.getItem('seed') === 'normal') {
  const hoje = new Date()
  const dia = (delta) => { const x = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + delta); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
  const agora = '2026-10-25T10:00:00.000Z'
  const cidade = "São José d'Oeste"

  db.clientes.length = 0
  db.clientes.push(
    { id: 'c1', user_id: 'u1', nome: 'João & Filhos Ltda', endereco: "Rua D'Ávila, 123", bairro: 'Vila Água Branca', cidade, estado: 'SP', telefone: '(19) 99999-1234', observacoes: 'Falar com "Zé" > gerente; 50% de desconto & prazo', desconto: 25, latitude: null, longitude: null },
    { id: 'c2', user_id: 'u1', nome: 'Pet "Top" Shop', endereco: 'Av. Brasil, 10 - Loja 2', bairro: 'Centro', cidade, estado: 'SP', telefone: '', observacoes: '', desconto: 0, latitude: null, longitude: null },
    { id: 'c3', user_id: 'u1', nome: "Agro D'Água & Cia", endereco: '', bairro: '', cidade: 'Campinas', estado: 'SP', telefone: '19 3333-0000', observacoes: 'Ração 5% > Premium', desconto: 10, latitude: -22.9, longitude: -47.06 },
  )
  db.empresas.length = 0
  db.empresas.push({ id: 'e1', user_id: 'u1', nome: 'Ração & Areia "Forte"', percentual_comissao: 10 }, { id: 'e2', user_id: 'u1', nome: "D'Lar Pet", percentual_comissao: 7.5 })

  db.visitas.length = 0; db.itens_venda.length = 0
  db.visitas.push(
    { id: 'v1', user_id: 'u1', cliente_id: 'c1', data_visita: dia(0), comprou: true, desconto_aplicado: 25, observacao: 'Pediu 10% > tabela & entrega', created_at: agora },
    { id: 'v2', user_id: 'u1', cliente_id: 'c2', data_visita: dia(-1), comprou: false, desconto_aplicado: 0, observacao: null, created_at: agora },
  )
  db.itens_venda.push({ id: 'iv1', user_id: 'u1', visita_id: 'v1', empresa_id: 'e1', valor: 100, comissao_manual: null }, { id: 'iv2', user_id: 'u1', visita_id: 'v1', empresa_id: 'e2', valor: 50, comissao_manual: null })

  db.rotas.length = 0; db.rota_clientes.length = 0; db.rota_agendamentos.length = 0
  db.rotas.push({ id: 'r1', user_id: 'u1', cidade, nome: 'Rota "Norte" & Sul', observacao: "Sair às 7h; D'Ávila primeiro", created_at: agora })
  db.rota_clientes.push({ id: 'rc1', user_id: 'u1', rota_id: 'r1', cliente_id: 'c1', ordem: 0 }, { id: 'rc2', user_id: 'u1', rota_id: 'r1', cliente_id: 'c2', ordem: 1 })
  db.rota_agendamentos.push({ id: 'ra1', user_id: 'u1', rota_id: 'r1', data: dia(0) })

  db.fornecedores.length = 0
  db.fornecedores.push({ id: 'f1', user_id: 'u1', nome: 'Luciano & Irmãos', observacao: "Paga em 30 dias > boleto" })
  db.produtos.length = 0
  db.produtos.push({ id: 'p1', user_id: 'u1', nome: 'Areia "Premium" 4 kg', unidade: 'fardo', fornecedor_id: 'f1', descricao: "Fardo c/ 5 sacos & lacre", preco_custo: 20, preco_venda: 26, ativo: true })
  db.compras_estoque.length = 0; db.pagamentos_compra.length = 0
  db.compras_estoque.push(
    { id: 'cp1', user_id: 'u1', produto_id: 'p1', fornecedor_id: 'f1', quantidade: 100, custo_unitario: 20, data_compra: dia(-5), vencimento: null, observacao: 'Nota 123 & 124', observacao_cobranca: null, created_at: agora },
    { id: 'cp2', user_id: 'u1', produto_id: 'p1', fornecedor_id: 'f1', quantidade: 10, custo_unitario: 20, data_compra: dia(-2), vencimento: dia(1), observacao: null, observacao_cobranca: 'Pagar > sexta "sem falta"', created_at: agora },
  )
  db.vendas_estoque.length = 0; db.venda_estoque_itens.length = 0; db.pagamentos_venda.length = 0
  db.vendas_estoque.push({ id: 's1', user_id: 'u1', cliente_id: 'c1', visita_id: null, data_venda: dia(0), prazo_dias: 3, vencimento: dia(1), observacao: 'Entrega & instalação', observacao_cobranca: "Cobrar por Pix > D'Ávila", created_at: agora })
  db.venda_estoque_itens.push({ id: 'si1', user_id: 'u1', venda_id: 's1', produto_id: 'p1', quantidade: 5, preco_unitario: 26, custo_unitario: 20, created_at: agora })
  db.retiradas_lucro.length = 0
  db.retiradas_lucro.push({ id: 'r1x', user_id: 'u1', valor: 10, data_retirada: dia(-1), observacao: 'Conta "pessoal" & luz', created_at: agora })
  db.metas_estoque.length = 0
  db.metas_estoque.push({ id: 'm1', user_id: 'u1', produto_id: 'p1', quantidade: 50, preco_unitario: 20, created_at: agora })
  db.entregas.length = 0; db.entrega_paradas.length = 0; db.entrega_itens.length = 0
  db.entregas.push({ id: 'en1', user_id: 'u1', nome: 'Entrega "Sábado" & domingo', data_entrega: dia(0), observacao: "Levar troco > R$ 50", created_at: agora })
  db.entrega_paradas.push({ id: 'pa1', user_id: 'u1', entrega_id: 'en1', cliente_id: 'c1', ordem: 0, feita: false, venda_id: null, created_at: agora })
  db.entrega_itens.push({ id: 'ei1', user_id: 'u1', parada_id: 'pa1', produto_id: 'p1', quantidade: 3 })
  db.lembretes.length = 0
  db.lembretes.push({ id: 'l1', user_id: 'u1', texto: 'Mandar cotação > "Agro D\'Água" & Cia', cliente_id: 'c1', feito: false, feito_em: null, created_at: agora })
}
