// Teste do pedido "Esperando liberação" nas Visitas (banco em memória). Uso: node visitas-espera.mjs <url-base> <perfil> <pasta-png>
// Pedido pendente não conta como venda nem comissão; "Aprovado" vira venda no dia da aprovação;
// "Não aprovado" apaga só o pedido e a visita fica como "Não comprou".
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { EDGE } from './suporte/navegador.mjs'
const [base, perfil, saida] = process.argv.slice(2)
const PORTA = 9367
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(saida, { recursive: true })

const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORTA}`, `--user-data-dir=${perfil}`, '--window-size=1200,1000', 'about:blank'], { stdio: 'ignore' })
let alvos = []
for (let i = 0; i < 60; i++) { try { alvos = await (await fetch(`http://127.0.0.1:${PORTA}/json`)).json(); if (alvos.some((a) => a.type === 'page')) break } catch {} await sleep(250) }
const ws = new WebSocket(alvos.find((a) => a.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const pend = new Map(); const eventos = []
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } else eventos.push(m) })
const cmd = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })
const js = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails))
  return r.result?.result?.value
}
async function ir(url) {
  eventos.length = 0
  await cmd('Page.navigate', { url })
  for (let i = 0; i < 100; i++) { if (eventos.some((e) => e.method === 'Page.loadEventFired')) break; await sleep(200) }
  await sleep(1500)
}
let falhas = 0
const confere = (nome, ok, extra = '') => { if (!ok) falhas++; console.log(`${ok ? '✓' : '✗ FALHOU'} ${nome}${extra ? ' → ' + extra : ''}`) }
await cmd('Page.enable'); await cmd('Runtime.enable')

const hoje = new Date()
const dia = (delta) => { const x = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + delta); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const HOJE = dia(0)
const MES = HOJE.slice(0, 7)

const prep = () => js(`window.__alertas = []; window.alert = (t) => window.__alertas.push(t); window.__confirms = []; window.confirm = (t) => { window.__confirms.push(t); return true }; 1`)
const visita = async (vid) => JSON.parse(await js(`JSON.stringify(__db.visitas.find((v) => v.id === ${JSON.stringify(vid)}) || null)`))
const itensDe = async (vid) => js(`__db.itens_venda.filter((i) => i.visita_id === ${JSON.stringify(vid)}).length`)
const pergunta = () => js(`(() => { const j = document.querySelector('.pergunta-overlay'); return j && j.classList.contains('aberto') ? { titulo: j.querySelector('#perguntaTitulo').textContent, texto: j.querySelector('.pergunta-linhas').innerText } : null })()`)
const responder = async (sim) => { await js(`document.querySelector('.pergunta-overlay .${sim ? 'pergunta-sim' : 'pergunta-nao'}').click(); 1`); await sleep(900) }
const linhaDe = (nome) => `[...document.querySelectorAll('#listaVisitas tr')].find((t) => t.querySelectorAll('td')[1]?.innerText.trim() === ${JSON.stringify(nome)})`
const statusDe = (nome) => js(`(() => { const tr = ${linhaDe(nome)}; return tr ? tr.querySelectorAll('td')[2].innerText.replace(/\\s+/g, ' ').trim() : null })()`)

// Põe visitas no banco e recarrega a lista do mês
async function semear(visitas) {
  await js(`(() => {
    for (const v of ${JSON.stringify(visitas)}) {
      __db.visitas.push({ user_id: 'u1', desconto_aplicado: 0, observacao: null, created_at: v.data_visita + 'T09:00:00Z', ...v.visita })
      v.itens.forEach((it, i) => __db.itens_venda.push({ id: v.visita.id + '-i' + i, user_id: 'u1', visita_id: v.visita.id, comissao_manual: null, ...it }))
    }
    document.getElementById('selectMes').dispatchEvent(new Event('change'))
    return 1
  })()`)
  await sleep(1200)
}

await cmd('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false })
await ir(`${base}/`); await js(`localStorage.clear(); 1`)

// ── A) Lançar um pedido "Esperando liberação" ──
await ir(`${base}/pages/visitas`); await prep()
await js(`document.getElementById('btnNovaVisita').click(); 1`); await sleep(300)
const opcoes = JSON.parse(await js(`JSON.stringify([...document.getElementById('comprou').options].map((o) => o.textContent))`))
confere('status tem a opção "Esperando liberação"', opcoes.includes('Esperando liberação'), JSON.stringify(opcoes))
await js(`(() => {
  document.getElementById('clienteId').value = 'c2'; document.getElementById('clienteBusca').value = 'Agro Zeta'
  const s = document.getElementById('comprou'); s.value = 'aguardando'; s.dispatchEvent(new Event('change'))
  return 1
})()`)
await sleep(300)
const form = JSON.parse(await js(`JSON.stringify({
  itens: getComputedStyle(document.getElementById('blocoItens')).display !== 'none',
  aviso: getComputedStyle(document.querySelector('.aviso-espera')).display !== 'none',
  estoque: getComputedStyle(document.getElementById('estBlocoVenda')).display !== 'none',
  linhas: document.querySelectorAll('#listaItens .item-venda-row').length })`))
confere('formulário: itens das empresas aparecem, com o aviso, e sem o bloco do estoque', form.itens && form.aviso && !form.estoque && form.linhas === 1, JSON.stringify(form))
await cmd('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(join(saida, 'espera-formulario.png'), Buffer.from(s.result.data, 'base64')))

// item em branco: o navegador barra (campo obrigatório) e nada é salvo
await js(`document.getElementById('btnSalvar').click(); 1`); await sleep(500)
confere('item em branco: não salva', (await js(`__db.visitas.length`)) === 0)
// sem nenhuma linha de item: o app avisa
await js(`document.querySelector('#listaItens .btn-remover-item').click(); document.getElementById('btnSalvar').click(); 1`); await sleep(500)
confere('pedido pendente sem item de empresa não salva e avisa', (await js(`__alertas.length === 1 && __alertas[0].includes('esperando liberação')`)) && (await js(`__db.visitas.length`)) === 0, await js(`JSON.stringify(__alertas)`))
await js(`document.getElementById('btnAddItem').click(); 1`)
await js(`(() => {
  const r = document.querySelector('#listaItens .item-venda-row')
  r.querySelector('.item-empresa').value = 'e1'
  const v = r.querySelector('.item-valor'); v.value = '300'; v.dispatchEvent(new Event('input'))
  document.getElementById('btnSalvar').click(); return 1
})()`)
await sleep(1500)
const nova = JSON.parse(await js(`JSON.stringify(__db.visitas[0] || null)`))
confere('salvou: comprou = false, aguardando_liberacao = true, com o item de R$ 300', nova && nova.comprou === false && nova.aguardando_liberacao === true && (await itensDe(nova.id)) === 1, JSON.stringify(nova))
const st = await statusDe('Agro Zeta')
confere('na lista: bolinha amarela "Esperando liberação" com Aprovado e Não aprovado', /Esperando liberação/.test(st) && /Aprovado/.test(st) && /Não aprovado/.test(st) && (await js(`!!${linhaDe('Agro Zeta')}.querySelector('.bolinha-espera')`)), st)

// ── B) Não conta como venda ──
const resumo = JSON.parse(await js(`JSON.stringify({ visitas: document.getElementById('visitasHoje').textContent, compraram: document.getElementById('compraramHoje').textContent, total: document.getElementById('totalHoje').textContent })`))
confere('resumo do dia: conta a visita, mas não a compra nem o valor', resumo.visitas === '1' && resumo.compraram === '0' && /0,00/.test(resumo.total), JSON.stringify(resumo))
await cmd('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(join(saida, 'espera-lista.png'), Buffer.from(s.result.data, 'base64')))

// ── C) Editar o pedido pendente: continua pendente ──
await js(`document.querySelector('.btn-editar[data-id="${nova.id}"]').click(); 1`); await sleep(600)
const ed = JSON.parse(await js(`JSON.stringify({ status: document.getElementById('comprou').value, linhas: document.querySelectorAll('#listaItens .item-venda-row').length, estoque: getComputedStyle(document.getElementById('estBlocoVenda')).display !== 'none' })`))
confere('editar: abre como "Esperando liberação", com o item e sem o estoque', ed.status === 'aguardando' && ed.linhas === 1 && !ed.estoque, JSON.stringify(ed))
await js(`document.getElementById('observacao').value = 'pedido especial'; document.getElementById('btnSalvar').click(); 1`); await sleep(1500)
const ed2 = await visita(nova.id)
confere('salvar a edição mantém pendente e o item', ed2.aguardando_liberacao === true && ed2.comprou === false && ed2.observacao === 'pedido especial' && (await itensDe(nova.id)) === 1, JSON.stringify(ed2))
// trocar para "Comprou" na edição tira a marca de pendente
await js(`document.querySelector('.btn-editar[data-id="${nova.id}"]').click(); 1`); await sleep(600)
await js(`(() => { const s = document.getElementById('comprou'); s.value = 'true'; s.dispatchEvent(new Event('change')); document.getElementById('btnSalvar').click(); return 1 })()`)
await sleep(1500)
const ed3 = await visita(nova.id)
confere('trocar para "Comprou" na edição: deixa de estar pendente', ed3.aguardando_liberacao === false && ed3.comprou === true, JSON.stringify(ed3))

// ── D) Aprovado: vira venda no dia da aprovação ──
await ir(`${base}/pages/visitas`); await prep()
const ONTEM = dia(-1)
await semear([
  { visita: { id: 'pA', cliente_id: 'c2', data_visita: ONTEM, comprou: false, aguardando_liberacao: true }, itens: [{ empresa_id: 'e1', valor: 500 }] },
  { visita: { id: 'pN', cliente_id: 'c1', data_visita: ONTEM, comprou: false, aguardando_liberacao: true, desconto_aplicado: 50 }, itens: [{ empresa_id: 'e2', valor: 200 }] },
])
if (ONTEM.slice(0, 7) !== MES) { await js(`document.getElementById('selectMes').value = '${ONTEM.slice(0, 7)}'; document.getElementById('selectMes').dispatchEvent(new Event('change')); 1`); await sleep(1200) }
await js(`document.querySelector('.btn-aprovado[data-id="pA"]').click(); 1`); await sleep(500)
let p = await pergunta()
confere('Aprovado: pergunta e diz que conta hoje, dia da aprovação', p?.titulo === 'Pedido aprovado?' && p.texto.includes('dia da aprovação') && p.texto.includes('500,00'), JSON.stringify(p))
await responder(false)
confere('"Não": continua pendente', (await visita('pA')).aguardando_liberacao === true)
await js(`document.querySelector('.btn-aprovado[data-id="pA"]').click(); 1`); await sleep(500); await responder(true)
const aprovada = await visita('pA')
confere('"Sim": vira Comprou, sai de pendente e a data passa para hoje', aprovada.comprou === true && aprovada.aguardando_liberacao === false && aprovada.data_visita === HOJE, JSON.stringify(aprovada))
confere('o item do pedido continua (é a venda)', (await itensDe('pA')) === 1)
const r2 = JSON.parse(await js(`JSON.stringify({ compraram: document.getElementById('compraramHoje').textContent, total: document.getElementById('totalHoje').textContent })`))
confere('agora entra no resumo de hoje (compraram 1, R$ 500,00)', r2.compraram === '1' && /500,00/.test(r2.total), JSON.stringify(r2))

// ── E) Não aprovado: apaga só o pedido; a visita fica como "Não comprou" ──
if (ONTEM.slice(0, 7) !== MES) { await js(`document.getElementById('selectMes').value = '${ONTEM.slice(0, 7)}'; document.getElementById('selectMes').dispatchEvent(new Event('change')); 1`); await sleep(1200) }
await js(`document.querySelector('.btn-nao-aprovado[data-id="pN"]').click(); 1`); await sleep(500)
p = await pergunta()
confere('Não aprovado: pergunta e explica que a visita continua como "Não comprou"', p?.titulo === 'Pedido não aprovado?' && p.texto.includes('Não comprou') && p.texto.includes('200,00'), JSON.stringify(p))
await responder(true)
const naoAprov = await visita('pN')
confere('a visita continua, na mesma data, como "Não comprou" e sem desconto', naoAprov && naoAprov.comprou === false && naoAprov.aguardando_liberacao === false && naoAprov.data_visita === ONTEM && naoAprov.desconto_aplicado === 0, JSON.stringify(naoAprov))
confere('os itens do pedido foram apagados', (await itensDe('pN')) === 0)
confere('na lista aparece "Não comprou"', /Não comprou/.test(await statusDe('Pet Shop do Lulu') || ''), String(await statusDe('Pet Shop do Lulu')))

// ── F) Dashboard e Empresas (cenário "pendentes": 1 pedido pendente de R$ 1.000 e 1 venda de R$ 100, hoje) ──
await js(`localStorage.setItem('seed', 'pendentes'); 1`)
await ir(`${base}/pages/dashboard`)
const dash = JSON.parse(await js(`JSON.stringify({ vendido: document.getElementById('totalVendido').textContent, comissao: document.getElementById('totalComissao').textContent, faixa: [...document.querySelectorAll('.dp-faixa')].map((a) => ({ texto: a.innerText.replace(/\\s+/g, ' '), href: a.getAttribute('href') })), ultimas: document.body.innerText })`))
confere('Dashboard: total vendido e comissão só com o "Comprou" (R$ 100 e R$ 10)', /100,00/.test(dash.vendido) && /10,00/.test(dash.comissao) && !/1\.100/.test(dash.vendido), JSON.stringify({ vendido: dash.vendido, comissao: dash.comissao }))
const aviso = dash.faixa.find((f) => /esperando liberação/.test(f.texto))
confere('Dashboard: aviso "1 pedido esperando liberação · R$ 1.000,00"', aviso && /1 pedido esperando liberação/.test(aviso.texto) && /1\.000,00/.test(aviso.texto), JSON.stringify(dash.faixa))
confere('o aviso abre Visitas no mês do pedido', aviso?.href === `visitas.html?mes=${MES}`, aviso?.href)
confere('Dashboard: "Últimas visitas" mostra "Esperando liberação"', dash.ultimas.includes('Esperando liberação'))
await cmd('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 150, width: 1200, height: 420, scale: 1 } }).then((r) => writeFileSync(join(saida, 'espera-dashboard.png'), Buffer.from(r.result.data, 'base64')))
await ir(`${base}/pages/empresas`)
const emp = await js(`document.getElementById('resumoComissao').innerText`)
confere('Empresas: comissão do mês só da venda (R$ 10,00), sem o pendente', /10,00/.test(emp) && !/110,00/.test(emp), emp)

// ── G) Link ?mes= abre o mês pedido; sem pendente, sem aviso ──
const MES_ANTERIOR = (() => { const x = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}` })()
await ir(`${base}/pages/visitas?mes=${MES_ANTERIOR}`)
confere('Visitas?mes= abre no mês do link', (await js(`document.getElementById('selectMes').value`)) === MES_ANTERIOR)
await js(`localStorage.removeItem('seed'); 1`)
await ir(`${base}/pages/dashboard`)
confere('Dashboard sem pedido pendente: sem o aviso', await js(`![...document.querySelectorAll('.dp-faixa')].some((a) => /esperando liberação/.test(a.innerText))`))

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
try { const v = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).json(); const bb = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => bb.addEventListener('open', r)); bb.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch {}
await sleep(1200); proc.kill(); process.exit(falhas === 0 ? 0 : 1)
