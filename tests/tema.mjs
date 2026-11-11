// Teste do tema claro / escuro / automático (banco em memória). Uso: node tema.mjs <url-base> <perfil> <pasta-png>
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { EDGE } from './suporte/navegador.mjs'
const [base, perfil, saida] = process.argv.slice(2)
const PORTA = 9363
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
  await sleep(1200)
}
let falhas = 0
const confere = (nome, ok, extra = '') => { if (!ok) falhas++; console.log(`${ok ? '✓' : '✗ FALHOU'} ${nome}${extra ? ' → ' + extra : ''}`) }
await cmd('Page.enable'); await cmd('Runtime.enable')

const aparelho = (cor) => cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: cor }] })
const tema = () => js(`document.documentElement.dataset.theme`)
const salvo = () => js(`localStorage.getItem('pi_tema')`)
const fundo = () => js(`getComputedStyle(document.body).backgroundColor`)
const barra = () => js(`document.querySelector('meta[name="theme-color"]').content`)
const menuAberto = () => js(`!document.getElementById('temaMenu').hidden`)
const ESCURO = 'rgb(13, 21, 32)'   // --fundo-pagina no escuro
const CLARO = 'rgb(243, 245, 248)' // --fundo-pagina no claro

// Clique de verdade (mouse), como o de uma pessoa: dispara pointerdown/pointerup e click
async function clicar(seletor) {
  const r = JSON.parse(await js(`(() => { const b = document.querySelector(${JSON.stringify(seletor)}).getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }) })()`))
  for (const type of ['mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await sleep(300)
}
const tecla = async (key, code = key) => {
  const codigo = { Escape: 27, Enter: 13, ArrowDown: 40, ArrowUp: 38 }[key]
  // O Enter precisa do caractere (text) para o navegador "apertar" o botão em foco
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: codigo, ...(key === 'Enter' ? { text: '\r' } : {}) })
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: codigo })
  await sleep(250)
}

await cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false })
await ir(`${base}/`); await js(`localStorage.clear(); localStorage.setItem('seed', 'lucro'); 1`)

// ── A) Automático (nada salvo): segue o aparelho, inclusive quando ele troca com a página aberta ──
await aparelho('light'); await ir(`${base}/pages/dashboard`)
confere('automático com aparelho claro: tema claro', (await tema()) === 'light' && (await fundo()) === CLARO, `${await tema()} ${await fundo()}`)
await aparelho('dark'); await sleep(300)
confere('aparelho trocou para escuro com a página aberta: o app acompanha', (await tema()) === 'dark' && (await fundo()) === ESCURO, `${await tema()} ${await fundo()}`)
confere('barra do celular escura no escuro', (await barra()) === '#16212E', await barra())
await ir(`${base}/pages/dashboard`)
confere('automático com aparelho escuro: já abre escuro', (await tema()) === 'dark')

// ── B) O botão e a janelinha ──
const ordem = await js(`[...document.querySelector('.topbar').children].slice(-3).map((e) => e.className).join(' | ')`)
confere('botão do tema fica antes do olho e do Sair', /tema-caixa \| btn-olho \| btn-sair/.test(ordem), ordem)
confere('botão diz o tema escolhido (Automático) e começa fechado', (await js(`document.querySelector('.btn-tema').getAttribute('aria-label')`)).includes('Automático') && (await js(`document.querySelector('.btn-tema').getAttribute('aria-expanded')`)) === 'false' && !(await menuAberto()))
await clicar('.btn-tema')
confere('tocar no botão abre a janelinha (aria-expanded = true)', (await menuAberto()) && (await js(`document.querySelector('.btn-tema').getAttribute('aria-expanded')`)) === 'true')
const opcoes = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.tema-opcao')].map((o) => o.innerText.replace(/\\s+/g, ' ').trim()))`))
confere('três opções: Automático, Claro e Escuro', opcoes.length === 3 && opcoes[0].startsWith('Automático') && opcoes[1] === 'Claro' && opcoes[2] === 'Escuro', JSON.stringify(opcoes))
confere('a escolhida (Automático) vem marcada e com o foco', await js(`document.activeElement === document.querySelector('.tema-opcao input[value="auto"]') && document.activeElement.checked`))
await cmd('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(join(saida, 'tema-janelinha.png'), Buffer.from(s.result.data, 'base64')))

// ── C) Escolher Claro com o mouse: aplica, salva, fecha ──
await clicar('.tema-opcao:nth-child(3)') // a 1ª filha do fieldset é a legenda
confere('escolher Claro: tema claro mesmo com o aparelho escuro', (await tema()) === 'light' && (await fundo()) === CLARO, `${await tema()} ${await fundo()}`)
confere('escolha salva no aparelho', (await salvo()) === 'light')
confere('a janelinha fechou e o foco voltou para o botão', !(await menuAberto()) && (await js(`document.activeElement === document.querySelector('.btn-tema')`)))
confere('barra do celular branca no claro', (await barra()) === '#FFFFFF', await barra())
confere('botão agora diz "Claro"', (await js(`document.querySelector('.btn-tema').getAttribute('aria-label')`)).includes('Claro'))

// ── D) A escolha vale nas outras telas (e o aparelho não manda mais) ──
await ir(`${base}/pages/empresas`)
confere('outra tela abre no Claro escolhido', (await tema()) === 'light' && (await fundo()) === CLARO)
await ir(`${base}/`)
confere('a tela de entrada também segue a escolha', (await tema()) === 'light')

// ── E) Teclado: setas trocam sem fechar; Enter fecha; Esc fecha e devolve o foco ──
await ir(`${base}/pages/clientes`)
await js(`document.querySelector('.btn-tema').focus(); 1`); await tecla('Enter')
confere('Enter no botão abre a janelinha', await menuAberto())
await tecla('ArrowDown')
confere('seta para baixo: passa para Escuro sem fechar', (await tema()) === 'dark' && (await salvo()) === 'dark' && (await menuAberto()))
await tecla('Enter')
confere('Enter fecha a janelinha', !(await menuAberto()))
await tecla('Enter')
await tecla('Escape')
confere('Esc fecha e o foco volta para o botão', !(await menuAberto()) && (await js(`document.activeElement === document.querySelector('.btn-tema')`)))

// ── F) Tocar fora fecha sem mudar nada ──
await clicar('.btn-tema')
await clicar('h1')
confere('tocar fora fecha e mantém o tema', !(await menuAberto()) && (await tema()) === 'dark')

// ── G) Voltar para Automático apaga a escolha e segue o aparelho de novo ──
await aparelho('light')
await clicar('.btn-tema'); await clicar('.tema-opcao:nth-child(2)')
confere('Automático: apaga a escolha salva', (await salvo()) === null)
confere('Automático: volta a seguir o aparelho (claro)', (await tema()) === 'light')

// ── H) Escuro escolhido: a página já nasce escura (sem piscar claro) ──
await js(`localStorage.setItem('pi_tema', 'dark'); 1`)
await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => { window.__temaNoInicio = document.documentElement.dataset.theme; window.__fundoNoInicio = getComputedStyle(document.body).backgroundColor })` })
await ir(`${base}/pages/visitas`)
confere('o escuro já vale antes dos scripts da página', (await js(`window.__temaNoInicio`)) === 'dark' && (await js(`window.__fundoNoInicio`)) === ESCURO, `${await js('window.__temaNoInicio')} ${await js('window.__fundoNoInicio')}`)
await ir(`${base}/offline.html`)
confere('a tela "Sem conexão" também fica escura', (await tema()) === 'dark' && (await fundo()) === ESCURO)

// ── I) Sem localStorage (navegação privada): não quebra, segue o aparelho ──
await ir(`${base}/pages/dashboard`)
await js(`Object.defineProperty(window, 'localStorage', { get() { throw new Error('bloqueado') } }); 1`)
const semArmazenamento = await js(`(async () => { try { document.querySelector('.btn-tema').click(); document.querySelector('.tema-opcao input[value="light"]').click(); return document.documentElement.dataset.theme + ' / ' + document.querySelector('.btn-tema').getAttribute('aria-label') } catch (e) { return 'erro: ' + e.message } })()`)
confere('sem localStorage: trocar o tema ainda funciona e o botão mostra "Claro" (só não fica salvo)', semArmazenamento.startsWith('light / Tema: Claro'), semArmazenamento)

// ── J) Celular: janelinha aberta sem rolagem lateral ──
await cmd('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 2, mobile: true })
await ir(`${base}/pages/dashboard`)
await clicar('.btn-tema')
const caixa = JSON.parse(await js(`JSON.stringify(document.getElementById('temaMenu').getBoundingClientRect())`))
confere('celular: janelinha inteira dentro da tela e sem rolagem lateral', caixa.left >= 0 && caixa.right <= 375 && (await js(`document.documentElement.scrollWidth <= window.innerWidth + 1`)), JSON.stringify({ left: caixa.left, right: caixa.right }))
await cmd('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(join(saida, 'tema-celular.png'), Buffer.from(s.result.data, 'base64')))

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
try { const v = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).json(); const bb = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => bb.addEventListener('open', r)); bb.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch {}
await sleep(1200); proc.kill(); process.exit(falhas === 0 ? 0 : 1)
