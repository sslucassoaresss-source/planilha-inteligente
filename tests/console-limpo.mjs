// Abre cada página (banco em memória, cenário "guia") e lista erros de console / exceções. Uso: node cdp-console.mjs <url-base> <perfil>
import { spawn } from 'node:child_process'
import { EDGE } from './suporte/navegador.mjs'
const [base, perfil] = process.argv.slice(2)
const PORTA = 9349
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORTA}`, `--user-data-dir=${perfil}`, 'about:blank'], { stdio: 'ignore' })
let alvos = []
for (let i = 0; i < 60; i++) { try { alvos = await (await fetch(`http://127.0.0.1:${PORTA}/json`)).json(); if (alvos.some((a) => a.type === 'page')) break } catch {} await sleep(250) }
const ws = new WebSocket(alvos.find((a) => a.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const pend = new Map(); let problemas = []; let carregou = false
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return }
  if (m.method === 'Page.loadEventFired') carregou = true
  if (m.method === 'Runtime.exceptionThrown') problemas.push('EXCEÇÃO: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0])
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problemas.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160))
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problemas.push('log: ' + m.params.entry.text.slice(0, 160) + ' ' + (m.params.entry.url || ''))
})
const cmd = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })
await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('Log.enable')
await cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false })
const ir = async (url) => { carregou = false; problemas = []; await cmd('Page.navigate', { url }); for (let i = 0; i < 100 && !carregou; i++) await sleep(200); await sleep(2500) }
await ir(`${base}/`)
await cmd('Runtime.evaluate', { expression: `localStorage.setItem('seed','guia')` })
let total = 0
for (const p of ['/pages/dashboard', '/pages/visitas', '/pages/rotas', '/pages/empresas', '/pages/clientes']) {
  await ir(`${base}${p}`)
  // ignora o aviso conhecido do favicon/sw do servidor de teste
  const reais = problemas.filter((x) => !/favicon|sw\.js|ServiceWorker|manifest|bad HTTP response/i.test(x))
  total += reais.length
  console.log(`${reais.length === 0 ? '✓' : '✗'} ${p}: ${reais.length === 0 ? 'sem erros' : reais.join(' || ')}`)
}
console.log(total === 0 ? '\nTUDO OK' : `\n${total} PROBLEMA(S)`)
try { const v = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).json(); const b = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => b.addEventListener('open', r)); b.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch {}
await sleep(1200); proc.kill(); process.exit(total === 0 ? 0 : 1)
