// Simula o ambiente da Edge Function (Deno + Supabase + web-push) em Node e exercita o handler inteiro.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
const require = createRequire(import.meta.url)
const webpushReal = require('web-push')

const fonte = readFileSync(new URL('../supabase/functions/avisos-diarios/index.ts', import.meta.url), 'utf8')
const codigo = fonte.split('\n').filter((l) => !l.startsWith('import ')).join('\n')

// Chaves de TESTE geradas na hora (nunca as chaves reais do projeto)
const par = webpushReal.generateVAPIDKeys()
const chaves = { VAPID_PUBLIC_KEY: par.publicKey, VAPID_PRIVATE_KEY: par.privateKey, VAPID_SUBJECT: 'mailto:teste@exemplo.com' }

let falhas = 0
const confere = (nome, ok, extra = '') => { if (!ok) falhas++; console.log(`${ok ? '✓' : '✗ FALHOU'} ${nome}${extra ? ' → ' + extra : ''}`) }

// Aparelho simulado com chaves reais (para a criptografia do web-push ser válida)
function novoAparelho(nome) {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys()
  return { endpoint: `https://push.exemplo/${nome}`, p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') }
}

// Data de hoje em Brasília (mesma conta da função) e deslocamentos
const hojeBR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const desloca = (d) => { const [a, m, dia] = hojeBR.split('-').map(Number); return new Date(Date.UTC(a, m - 1, dia + d)).toISOString().slice(0, 10) }

// ── Supabase de mentira (só o que a função usa) ──
function montarBanco(tabelas) {
  const removidos = []
  const supabase = {
    from(t) {
      const q = { t, filtros: [], modo: 'select' }
      q.select = () => q
      q.order = () => q
      q.eq = (c, v) => { q.filtros.push((l) => l[c] === v); return q.modo === 'delete' ? Object.assign(Promise.resolve(apagar(q)), q) : q }
      q.lte = (c, v) => { q.filtros.push((l) => l[c] != null && l[c] <= v); return q }
      q.range = (a, b) => Promise.resolve({ data: tabelas[t].filter((l) => q.filtros.every((f) => f(l))).slice(a, b + 1), error: null })
      q.delete = () => { q.modo = 'delete'; return q }
      return q
    },
  }
  function apagar(q) {
    const alvo = tabelas[q.t].filter((l) => q.filtros.every((f) => f(l)))
    alvo.forEach((l) => { tabelas[q.t].splice(tabelas[q.t].indexOf(l), 1); removidos.push(l.id) })
    return { error: null }
  }
  return { supabase, removidos }
}

// Carrega a função com um ambiente simulado e devolve o handler
function carregarFuncao({ env, tabelas, comportamento = {} }) {
  const { supabase, removidos } = montarBanco(tabelas)
  const enviados = []
  let handler
  const Deno = { env: { get: (k) => env[k] }, serve: (fn) => { handler = fn } }
  const webpush = {
    setVapidDetails: (a, p, k) => webpushReal.setVapidDetails(a, p, k), // valida de verdade as chaves
    sendNotification: async (sub, payload, opts) => {
      // monta e criptografa de verdade (sem rede): prova que chaves, aparelho e opções são válidos
      const det = webpushReal.generateRequestDetails(sub, payload, opts)
      enviados.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), ttl: opts.TTL, tamanho: det.body.length, auth: det.headers.Authorization })
      const c = comportamento[sub.endpoint.split('/').pop()]
      if (c) { const e = new Error('falha simulada'); e.statusCode = c; throw e }
      return { statusCode: 201 }
    },
  }
  new Function('Deno', 'createClient', 'webpush', 'Response', codigo.replace(/^\s*\/\/ @ts-nocheck/m, '')
    .replace(/webpush/g, 'webpush'))(Deno, () => supabase, webpush, Response)
  return { handler, enviados, removidos }
}

const ENV = { CRON_SEGREDO: 'segredo-de-teste', VAPID_PUBLIC_KEY: chaves.VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: chaves.VAPID_PRIVATE_KEY, VAPID_SUBJECT: chaves.VAPID_SUBJECT, SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' }
const pedido = (metodo, cab = {}, corpo) => new Request('http://x/avisos-diarios', { method: metodo, headers: { 'content-type': 'application/json', ...cab }, body: corpo === undefined ? undefined : JSON.stringify(corpo) })
const ok = { 'x-cron-segredo': 'segredo-de-teste' }

const aparelho = (id, user, nome) => ({ id, user_id: user, created_at: '2026-10-18T10:00:00Z', ...novoAparelho(nome) })
const venda = (user, venc, q, p, pagos = []) => ({ id: `v${Math.random()}`, user_id: user, vencimento: venc, venda_estoque_itens: [{ quantidade: q, preco_unitario: p }], pagamentos_venda: pagos.map((v) => ({ valor: v })) })

// ── 1) Segurança ──
{
  const { handler } = carregarFuncao({ env: ENV, tabelas: { push_subscriptions: [aparelho('a1', 'A', 'a1')], vendas_estoque: [], compras_estoque: [], entregas: [] } })
  confere('GET é recusado (405)', (await handler(pedido('GET'))).status === 405)
  confere('sem o cabeçalho de segredo: 401', (await handler(pedido('POST', {}, {}))).status === 401)
  confere('segredo errado: 401', (await handler(pedido('POST', { 'x-cron-segredo': 'errado' }, {}))).status === 401)
  confere('segredo certo: 200', (await handler(pedido('POST', ok, {}))).status === 200)
}
{
  const { handler } = carregarFuncao({ env: { ...ENV, CRON_SEGREDO: undefined }, tabelas: { push_subscriptions: [], vendas_estoque: [], compras_estoque: [], entregas: [] } })
  confere('sem CRON_SEGREDO configurado: nunca autoriza (401)', (await handler(pedido('POST', {}, {}))).status === 401 && (await handler(pedido('POST', { 'x-cron-segredo': '' }, {}))).status === 401)
}
{
  const { handler } = carregarFuncao({ env: { ...ENV, VAPID_PRIVATE_KEY: undefined }, tabelas: { push_subscriptions: [], vendas_estoque: [], compras_estoque: [], entregas: [] } })
  const r = await handler(pedido('POST', ok, {}))
  confere('faltando chave VAPID: 500 com mensagem clara', r.status === 500 && (await r.json()).erro.includes('VAPID'))
}

// ── 2) Sem aparelhos ──
{
  const { handler, enviados } = carregarFuncao({ env: ENV, tabelas: { push_subscriptions: [], vendas_estoque: [], compras_estoque: [], entregas: [] } })
  const r = await (await handler(pedido('POST', ok, {}))).json()
  confere('sem aparelhos: nada enviado', r.aparelhos === 0 && enviados.length === 0, JSON.stringify(r))
}

// ── 3) Modo de teste ──
{
  const t = { push_subscriptions: [aparelho('a1', 'A', 'a1'), aparelho('a2', 'A', 'a2'), aparelho('b1', 'B', 'b1')], vendas_estoque: [], compras_estoque: [], entregas: [] }
  const { handler, enviados } = carregarFuncao({ env: ENV, tabelas: t })
  const r = await (await handler(pedido('POST', ok, { teste: true }))).json()
  confere('teste: manda "Teste de aviso" a todos os 3 aparelhos (2 pessoas)', r.enviados === 3 && r.pessoas === 2 && enviados.every((e) => e.payload.corpo.startsWith('Teste de aviso')), JSON.stringify(r))
}

// ── 4) Rodada normal: separação por pessoa, aparelhos expirados e falhas ──
{
  const t = {
    push_subscriptions: [aparelho('a1', 'A', 'a1'), aparelho('a2', 'A', 'gone'), aparelho('b1', 'B', 'b1'), aparelho('c1', 'C', 'boom'), aparelho('d1', 'D', 'd1')],
    vendas_estoque: [
      venda('A', desloca(-3), 2, 50),            // A: 1 vencida (R$ 100 em aberto)
      venda('A', desloca(0), 1, 80, [80]),       // A: paga por inteiro -> não conta
      venda('B', desloca(1), 1, 10),             // B: vence amanhã
      venda('C', desloca(0), 1, 10),             // C: vence hoje (mas o aparelho de C falha)
      venda('D', desloca(5), 1, 10),             // D: vence só daqui a 5 dias -> nada
    ],
    compras_estoque: [{ id: 'c-a', user_id: 'A', vencimento: desloca(0), quantidade: 10, custo_unitario: 150, pagamentos_compra: [{ valor: 500 }] }],
    entregas: [{ id: 'e-b', user_id: 'B', data_entrega: null, entrega_paradas: [{ feita: false }] }],
  }
  const { handler, enviados, removidos } = carregarFuncao({ env: ENV, tabelas: t, comportamento: { gone: 410, boom: 500 } })
  const r = await (await handler(pedido('POST', ok, {}))).json()
  const doA = enviados.filter((e) => e.endpoint.endsWith('/a1') || e.endpoint.endsWith('/gone'))
  const doB = enviados.find((e) => e.endpoint.endsWith('/b1'))
  confere('resumo: 5 aparelhos, 4 pessoas, 2 enviados, 1 sem aviso, 1 removido, 1 falha', r.aparelhos === 5 && r.pessoas === 4 && r.enviados === 2 && r.semAviso === 1 && r.removidos === 1 && r.falhas === 1, JSON.stringify(r))
  confere('A: texto com a vencida e a conta a pagar de hoje (sem a venda já paga)', doA[0].payload.corpo === 'A receber: 1 vencida\nA pagar: 1 vence hoje', JSON.stringify(doA[0].payload.corpo))
  confere('B: texto só dele (amanhã + entrega sem dia), sem vazar dados de A', doB.payload.corpo === 'A receber: 1 vence amanhã\nEntrega: 1 sem dia marcado', JSON.stringify(doB.payload.corpo))
  confere('aparelho expirado (410) foi apagado da tabela; o de falha 500 e os outros ficaram', removidos.join() === 'a2' && t.push_subscriptions.map((x) => x.id).join() === 'a1,b1,c1,d1')
  confere('D (vence em 5 dias) e quem não tem nada: nenhuma notificação', !enviados.some((e) => e.endpoint.endsWith('/d1')))
  confere('mesmo aviso vai para os 2 aparelhos da mesma pessoa', doA.length === 2 && doA[0].payload.corpo === doA[1].payload.corpo)
  confere('conteúdo só com quantidades (sem R$)', enviados.every((e) => !/R\$|\d+,\d{2}/.test(e.payload.corpo)))
  confere('assinatura VAPID presente e TTL de 12 h', enviados.every((e) => /^vapid t=.+, ?k=.+/.test(e.auth) && e.ttl === 43200), (enviados[0].auth || '').slice(0, 40) + '…')
  confere('payload criptografado de verdade (corpo > texto)', enviados.every((e) => e.tamanho > 100))
}

// ── 5) Um dia com muita coisa não quebra o limite de 1000 linhas ──
{
  const muitas = Array.from({ length: 2300 }, (_, i) => venda('A', desloca(-1), 1, 10))
  const t = { push_subscriptions: [aparelho('a1', 'A', 'a1')], vendas_estoque: muitas, compras_estoque: [], entregas: [] }
  const { handler, enviados } = carregarFuncao({ env: ENV, tabelas: t })
  await handler(pedido('POST', ok, {}))
  confere('2.300 vendas vencidas: lê todas as páginas (1000 por vez)', enviados[0]?.payload.corpo === 'A receber: 2300 vencidas', enviados[0]?.payload.corpo)
}

// ── 6) Modos de teste: simular e somente_user_id ──
{
  const montar = () => ({
    push_subscriptions: [aparelho('a1', 'A', 'a1'), aparelho('a2', 'A', 'gone'), aparelho('b1', 'B', 'b1'), aparelho('d1', 'D', 'd1')],
    vendas_estoque: [venda('A', desloca(-3), 2, 50), venda('B', desloca(1), 1, 10)],
    compras_estoque: [],
    entregas: [],
  })

  // 6a) simular: NÃO envia nada, não apaga aparelho nenhum, mas devolve o texto de cada pessoa
  {
    const t = montar()
    const { handler, enviados, removidos } = carregarFuncao({ env: ENV, tabelas: t, comportamento: { gone: 410 } })
    const r = await (await handler(pedido('POST', ok, { simular: true }))).json()
    const textoDe = (u) => r.simulacao.find((x) => x.pessoa === u)
    confere('simular: nenhuma notificação enviada e nenhum aparelho apagado (mesmo o expirado)', enviados.length === 0 && removidos.length === 0 && t.push_subscriptions.length === 4 && r.enviados === 0 && r.removidos === 0, JSON.stringify({ enviados: r.enviados, removidos: r.removidos }))
    confere('simular: devolve o texto de A, o de B e "nada" para D', textoDe('A').aviso === 'A receber: 1 vencida' && textoDe('B').aviso === 'A receber: 1 vence amanhã' && textoDe('D').aviso === null && textoDe('A').aparelhos === 2, JSON.stringify(r.simulacao))
    confere('simular: o resumo conta 3 pessoas e 4 aparelhos', r.pessoas === 3 && r.aparelhos === 4)
  }

  // 6b) simular + teste: mostra o texto de teste, sem enviar
  {
    const { handler, enviados } = carregarFuncao({ env: ENV, tabelas: montar() })
    const r = await (await handler(pedido('POST', ok, { simular: true, teste: true }))).json()
    confere('simular + teste: mostra "Teste de aviso" para todos e não envia', enviados.length === 0 && r.simulacao.every((x) => x.aviso?.startsWith('Teste de aviso')) && r.simulacao.length === 3)
  }

  // 6c) somente_user_id: o envio vai só para a pessoa indicada
  {
    const { handler, enviados } = carregarFuncao({ env: ENV, tabelas: montar() })
    const r = await (await handler(pedido('POST', ok, { teste: true, somente_user_id: 'B' }))).json()
    confere('somente_user_id: só o aparelho de B recebe o teste (A, D e o resto não)', r.aparelhos === 1 && r.pessoas === 1 && r.enviados === 1 && enviados.length === 1 && enviados[0].endpoint.endsWith('/b1'), JSON.stringify(r))
  }
  {
    const { handler, enviados } = carregarFuncao({ env: ENV, tabelas: montar() })
    const r = await (await handler(pedido('POST', ok, { somente_user_id: 'A' }))).json()
    confere('somente_user_id em modo normal: A recebe o texto real e B não recebe nada', r.pessoas === 1 && enviados.length === 2 && enviados.every((e) => e.payload.corpo === 'A receber: 1 vencida'), JSON.stringify(r))
  }
  // 6d) identificador que não existe: ninguém recebe nada
  {
    const { handler, enviados } = carregarFuncao({ env: ENV, tabelas: montar() })
    const r = await (await handler(pedido('POST', ok, { teste: true, somente_user_id: 'nao-existe' }))).json()
    confere('somente_user_id desconhecido: 0 aparelhos e nada enviado', r.aparelhos === 0 && enviados.length === 0 && r.enviados === 0, JSON.stringify(r))
  }
  // 6e) as travas de segurança valem também nos modos de teste
  {
    const { handler, enviados } = carregarFuncao({ env: ENV, tabelas: montar() })
    const sem = await handler(pedido('POST', {}, { simular: true }))
    const errado = await handler(pedido('POST', { 'x-cron-segredo': 'x' }, { teste: true, somente_user_id: 'A' }))
    confere('modos de teste continuam exigindo o segredo (401 sem/errado)', sem.status === 401 && errado.status === 401 && enviados.length === 0)
  }
}

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
