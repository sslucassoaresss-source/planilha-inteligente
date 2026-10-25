// Regressão visual: abre as mesmas páginas, com os MESMOS dados normais (seed=normal), no app ANTIGO (porta A)
// e no app CORRIGIDO (porta B), e compara a página inteira. Uso: node cdp-regressao.mjs <urlA> <urlB> <perfil> <pasta-png>
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { EDGE } from './suporte/navegador.mjs'
const [urlA, urlB, perfil, saida] = process.argv.slice(2)
const PORTA = 9359
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
await cmd('Page.addScriptToEvaluateOnNewDocument', { source: 'window.alert = () => {}; window.confirm = () => true;' })
for (const u of [urlA, urlB]) { await ir(`${u}/`); await js(`localStorage.setItem('seed', 'normal'); 1`) }

const clicar = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) { e.click(); return true } return false })()`)
const paginas = [
  { nome: 'dashboard', url: '/pages/dashboard', passos: async () => { await sleep(300) } },
  { nome: 'clientes', url: '/pages/clientes', passos: async () => { await sleep(300) } },
  { nome: 'clientes-editar', url: '/pages/clientes', passos: async () => { await clicar('.btn-editar'); await sleep(500) } },
  { nome: 'empresas', url: '/pages/empresas', passos: async () => { await sleep(300) } },
  { nome: 'visitas', url: '/pages/visitas', passos: async () => { await sleep(300) } },
  { nome: 'visitas-editar', url: '/pages/visitas', passos: async () => { await clicar('.btn-editar'); await sleep(1500) } },
  { nome: 'rotas-cidades', url: '/pages/rotas', passos: async () => { await js(`document.querySelectorAll('.cidade-card').forEach((c) => c.classList.add('aberto')); 1`); await js(`const d = document.getElementById('entSecao'); if (d) d.open = true; 1`); await sleep(600) } },
  { nome: 'rotas-calendario', url: '/pages/rotas', passos: async () => { await clicar('#btnVisaoCalendario'); await sleep(700); await clicar('.calendario-rota-pill'); await sleep(800) } },
]
async function fotografar(base, p) {
  await ir(`${base}${p.url}`)
  try { await p.passos() } catch (e) { return { erro: String(e).slice(0, 120) } }
  // a observação do 1º cliente é tratada à parte (o app antigo quebrava a etiqueta com aspas)
  const obs = await js(`(() => { const td = [...document.querySelectorAll('td.obs-cell')].find((x) => x.textContent.includes('gerente')); if (!td) return null; const r = { title: td.getAttribute('title'), texto: td.textContent.trim() }; td.outerHTML = '<td class="obs-cell">[MASCARADO]</td>'; return r })()`)
  // a página inteira, sem scripts nem elementos que variam sozinhos
  const html = await js(`(() => { const c = document.body.cloneNode(true); c.querySelectorAll('script').forEach((s) => s.remove()); return c.innerHTML.replace(/\\s+/g, ' ') })()`)
  const texto = await js(`document.body.innerText.replace(/\\s+/g, ' ')`)
  // o atributo rel="noopener noreferrer" do link do mapa foi acrescentado de propósito (invisível): não conta como diferença
  return { html: html.split(' rel="noopener noreferrer"').join(''), texto, obs, excecoes: [...excecoes] }
}
let diferencas = 0
console.log('==== REGRESSÃO: app ANTIGO × app CORRIGIDO, com dados normais difíceis (& \' " > %) ====')
for (const p of paginas) {
  const a = await fotografar(urlA, p)
  const b = await fotografar(urlB, p)
  if (a.erro || b.erro) { console.log(`✗ ${p.nome}: passo falhou`, a.erro || b.erro); diferencas++; continue }
  const igualHtml = a.html === b.html
  const igualTexto = a.texto === b.texto
  const novosErros = b.excecoes.filter((e) => !a.excecoes.includes(e))
  const ESPERADA = 'Falar com "Zé" > gerente; 50% de desconto & prazo'
  let obsOk = true
  if (b.obs) {
    obsOk = b.obs.title === ESPERADA && b.obs.texto === ESPERADA
    console.log(`    observação (NOVO): etiqueta ${b.obs.title === ESPERADA ? 'correta' : 'ERRADA'} | texto ${b.obs.texto === ESPERADA ? 'correto' : 'ERRADO'}`)
    console.log(`    observação (ANTIGO, defeito): etiqueta = ${JSON.stringify(a.obs.title)} | texto visível = ${JSON.stringify(a.obs.texto)}`)
  }
  const ok = igualHtml && igualTexto && novosErros.length === 0 && obsOk
  if (!ok) diferencas++
  console.log(`${ok ? '✓' : '✗'} ${p.nome}: texto ${igualTexto ? 'idêntico' : 'DIFERENTE'} | HTML ${igualHtml ? 'idêntico' : 'DIFERENTE'} (${a.html.length} caracteres) | erros novos: ${novosErros.length}`)
  if (!igualHtml) { let i = 0; while (i < a.html.length && a.html[i] === b.html[i]) i++; console.log('    antigo:', a.html.slice(Math.max(0, i - 60), i + 120)); console.log('    novo  :', b.html.slice(Math.max(0, i - 60), i + 120)) }
  if (!igualTexto && igualHtml) console.log('    (texto diferente com HTML igual?)')
  const s = await cmd('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(saida, `${p.nome}-novo.png`), Buffer.from(s.result.data, 'base64'))
}
console.log(diferencas === 0 ? '\nTUDO IDÊNTICO: nenhuma diferença para dados normais' : `\n${diferencas} DIFERENÇA(S)`)
try { const v = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).json(); const b = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => b.addEventListener('open', r)); b.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch {}
await sleep(1200); proc.kill(); process.exit(diferencas === 0 ? 0 : 1)
