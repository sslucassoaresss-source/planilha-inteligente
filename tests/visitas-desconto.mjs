// Teste do desconto fixo do cliente como LEMBRETE (banco em memória). Uso: node visitas-desconto.mjs <url-base> <perfil> <pasta-png>
// O desconto é dado na distribuidora, não sai da venda: a visita vale a soma dos itens, inclusive as antigas
// (que tinham desconto_aplicado gravado), e a comissão continua sobre o valor dos itens.
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { EDGE } from './suporte/navegador.mjs'
const [base, perfil, saida] = process.argv.slice(2)
const PORTA = 9369
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

await cmd('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false })
await ir(`${base}/`); await js(`localStorage.clear(); 1`)

// ── A) Nova visita para o Pet Shop do Lulu (desconto fixo de R$ 50): lembrete, sem subtrair ──
await ir(`${base}/pages/visitas`)
await js(`document.getElementById('btnNovaVisita').click(); 1`); await sleep(300)
await js(`(() => { const c = document.getElementById('clienteBusca'); c.focus(); c.value = 'Pet'; c.dispatchEvent(new Event('input', { bubbles: true })); return 1 })()`)
await sleep(400)
await js(`document.querySelector('#sugestoesCliente .sugestao-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); 1`)
await sleep(300)
const lembrete = await js(`(() => { const d = document.getElementById('descontoFixo'); return getComputedStyle(d).display === 'none' ? '' : d.innerText.replace(/\\s+/g, ' ') })()`)
confere('lembrete do desconto aparece: "tem que dar" e não muda o valor da venda', /50,00/.test(lembrete) && /tem que dar/.test(lembrete) && /Não muda o valor da venda/.test(lembrete), lembrete)
await js(`(() => {
  const s = document.getElementById('comprou'); s.value = 'true'; s.dispatchEvent(new Event('change'))
  const r = document.querySelector('#listaItens .item-venda-row')
  r.querySelector('.item-empresa').value = 'e1'
  const v = r.querySelector('.item-valor'); v.value = '303.77'; v.dispatchEvent(new Event('input'))
  return 1
})()`)
await sleep(300)
const form = JSON.parse(await js(`JSON.stringify({ total: document.getElementById('totalItens').textContent, linhaDesconto: !!document.getElementById('linhaDescontoTotal'), texto: document.getElementById('blocoItens').innerText })`))
confere('total da visita = soma dos itens (R$ 303,77), sem a linha de desconto', /303,77/.test(form.total) && !form.linhaDesconto && !/288,77/.test(form.texto) && !/Desconto do cliente/.test(form.texto), JSON.stringify({ total: form.total, linhaDesconto: form.linhaDesconto }))
await cmd('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(join(saida, 'desconto-lembrete.png'), Buffer.from(s.result.data, 'base64')))
await js(`document.getElementById('btnSalvar').click(); 1`); await sleep(1500)
const salva = JSON.parse(await js(`JSON.stringify(__db.visitas.find((v) => v.cliente_id === 'c1') || null)`))
confere('salva com desconto_aplicado = 0', salva && salva.comprou === true && salva.desconto_aplicado === 0, JSON.stringify(salva))
const linha = await js(`[...document.querySelectorAll('#listaVisitas tr')].map((t) => t.innerText).join(' | ')`)
confere('na lista e no "Total do dia": R$ 303,77', /303,77/.test(linha) && /303,77/.test(await js(`document.getElementById('totalHoje').textContent`)), linha.replace(/\s+/g, ' ').slice(0, 160))

// ── B) Visitas antigas (com desconto_aplicado gravado) voltam ao valor cheio ──
const hoje = new Date()
const d = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`
await js(`(() => {
  __db.visitas.push({ id: 'vAntiga', user_id: 'u1', cliente_id: 'c1', data_visita: '${d}', comprou: true, desconto_aplicado: 50, observacao: null, created_at: '${d}T08:00:00Z' })
  __db.itens_venda.push({ id: 'iAntiga', user_id: 'u1', visita_id: 'vAntiga', empresa_id: 'e1', valor: 200, comissao_manual: null })
  document.getElementById('selectMes').dispatchEvent(new Event('change'))
  return 1
})()`)
await sleep(1200)
const total = await js(`document.getElementById('totalHoje').textContent`)
confere('visita antiga com desconto gravado conta cheia: total do dia R$ 503,77 (303,77 + 200)', /503,77/.test(total), total)
const dados = await js(`JSON.stringify({ visitas: __db.visitas, itens: __db.itens_venda })`)
await ir(`${base}/pages/dashboard`)
await js(`(() => { const x = ${dados}; __db.visitas.push(...x.visitas); __db.itens_venda.push(...x.itens); document.getElementById('selectMes').dispatchEvent(new Event('change')); return 1 })()`)
await sleep(1200)
const dash = JSON.parse(await js(`JSON.stringify({ vendido: document.getElementById('totalVendido').textContent, comissao: document.getElementById('totalComissao').textContent })`))
confere('Dashboard: total vendido R$ 503,77 e comissão sobre os itens (10% = R$ 50,38)', /503,77/.test(dash.vendido) && /50,38/.test(dash.comissao), JSON.stringify(dash))
confere('"Clientes com desconto ativo" continua (é o lembrete de quem tem desconto)', /Pet Shop do Lulu/.test(await js(`document.getElementById('descontosLista').innerText`)))

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
try { const v = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).json(); const bb = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => bb.addEventListener('open', r)); bb.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch {}
await sleep(1200); proc.kill(); process.exit(falhas === 0 ? 0 : 1)
