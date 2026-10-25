// Teste de ataque (XSS): abre cada página com o cenário "xss" (carga de ataque em todo campo de texto) e
// registra quais campos executaram código. Uso: node cdp-xss.mjs <url-base> <perfil> <pasta-png>
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { EDGE } from './suporte/navegador.mjs'
const [base, perfil, saida] = process.argv.slice(2)
const PORTA = 9357
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(saida, { recursive: true })
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORTA}`, `--user-data-dir=${perfil}`, '--window-size=1200,1000', 'about:blank'], { stdio: 'ignore' })
let alvos = []
for (let i = 0; i < 60; i++) { try { alvos = await (await fetch(`http://127.0.0.1:${PORTA}/json`)).json(); if (alvos.some((a) => a.type === 'page')) break } catch {} await sleep(250) }
const ws = new WebSocket(alvos.find((a) => a.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const pend = new Map(); const eventos = []; let excecoes = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') excecoes.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').split('\n')[0].slice(0, 140))
  eventos.push(m)
})
const cmd = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })
const js = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails))
  return r.result?.result?.value
}
async function ir(url) {
  eventos.length = 0; excecoes = []
  await cmd('Page.navigate', { url })
  for (let i = 0; i < 100; i++) { if (eventos.some((e) => e.method === 'Page.loadEventFired')) break; await sleep(200) }
  await sleep(2600)
}
await cmd('Page.enable'); await cmd('Runtime.enable')
await cmd('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false })
// executa antes de qualquer script da página
await cmd('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__xss = []; window.alert = () => {}; window.confirm = () => true;' })
await ir(`${base}/`); await js(`localStorage.setItem('seed', 'xss'); 1`)

// Interações que revelam mais telas (listas fechadas, calendário, editores). Cada passo tolera elemento ausente.
const clicar = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) { e.click(); return true } return false })()`)
const paginas = [
  { nome: 'Dashboard', url: '/pages/dashboard', passos: async () => { await sleep(500) } },
  { nome: 'Clientes', url: '/pages/clientes', passos: async () => { await clicar('.btn-editar'); await sleep(500); await clicar('.btn-desconto-rapido'); await sleep(400) } },
  { nome: 'Empresas', url: '/pages/empresas', passos: async () => { await clicar('.btn-editar'); await sleep(400) } },
  { nome: 'Visitas', url: '/pages/visitas', passos: async () => { await clicar('.btn-editar'); await sleep(1500) } },
  { nome: 'Rotas', url: '/pages/rotas', passos: async () => {
      await js(`document.querySelectorAll('.cidade-card').forEach((c) => c.classList.add('aberto')); 1`); await sleep(500)
      await js(`const d = document.getElementById('entSecao'); if (d) d.open = true; 1`); await sleep(400)
      await clicar('#btnVisaoCalendario'); await sleep(900)
      await clicar('.calendario-rota-pill'); await sleep(800)   // clique que usa o texto num seletor
    } },
]

const todos = new Set(); const porPagina = []
for (const p of paginas) {
  await ir(`${base}${p.url}`)
  try { await p.passos() } catch (e) { console.log('   (passo falhou em', p.nome + ':', String(e).slice(0, 100) + ')') }
  const disparou = JSON.parse(await js(`JSON.stringify([...new Set(window.__xss)])`))
  const literais = await js(`(document.body.innerText.match(/<img src=x onerror/g) || []).length`)
  disparou.forEach((m) => todos.add(m))
  porPagina.push({ pagina: p.nome, disparou, literais, excecoes: [...excecoes] })
  await cmd('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(join(saida, `${p.nome.toLowerCase()}.png`), Buffer.from(s.result.data, 'base64')))
}

console.log('==== RESULTADO DO TESTE DE ATAQUE ====')
for (const r of porPagina) {
  console.log(`\n${r.pagina}: ${r.disparou.length} campo(s) executaram código | textos de ataque mostrados LITERALMENTE na tela: ${r.literais}`)
  r.disparou.forEach((m) => console.log('   ✗ disparou:', m))
  if (r.excecoes.length) console.log('   ⚠ erros de JavaScript:', [...new Set(r.excecoes)].join(' | '))
}
console.log(`\nTOTAL: ${todos.size} campo(s) distintos executaram código`)
console.log(todos.size === 0 ? 'RESULTADO: SEGURO (nenhum disparo)' : 'RESULTADO: VULNERÁVEL')
try { const v = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).json(); const b = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => b.addEventListener('open', r)); b.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch {}
await sleep(1200); proc.kill(); process.exit(todos.size === 0 ? 0 : 1)
