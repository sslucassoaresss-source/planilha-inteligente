// Tela de Clientes: bolinha de cor pela última compra, resumo por cor e filtro ao clicar (cenário "cores").
// Uso: node clientes-bolinhas.mjs <url-base> <perfil> <pasta-capturas>
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EDGE } from './suporte/navegador.mjs'

const [base, perfil, capturas] = process.argv.slice(2)
const PORTA = 9353
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORTA}`, `--user-data-dir=${perfil}`, 'about:blank'], { stdio: 'ignore' })
let alvos = []
for (let i = 0; i < 60; i++) { try { alvos = await (await fetch(`http://127.0.0.1:${PORTA}/json`)).json(); if (alvos.some((a) => a.type === 'page')) break } catch {} await sleep(250) }
const ws = new WebSocket(alvos.find((a) => a.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const pend = new Map(); let carregou = false; const excecoes = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return }
  if (m.method === 'Page.loadEventFired') carregou = true
  if (m.method === 'Runtime.exceptionThrown') excecoes.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0])
})
const cmd = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })
const avaliar = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value
await cmd('Page.enable'); await cmd('Runtime.enable')
await cmd('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false })
const ir = async (url) => { carregou = false; await cmd('Page.navigate', { url }); for (let i = 0; i < 100 && !carregou; i++) await sleep(200); await sleep(2000) }
const foto = async (nome) => { const s = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(join(capturas, nome + '.png'), Buffer.from(s.result.data, 'base64')) }

let falhas = 0
const confere = (nome, ok, extra = '') => { if (!ok) falhas++; console.log(`${ok ? '✓' : '✗ FALHOU'} ${nome}${extra ? ' → ' + extra : ''}`) }

await ir(`${base}/`)
await avaliar(`localStorage.setItem('seed', 'cores')`)
await ir(`${base}/pages/clientes`)

// Cor de cada cliente, pelo nome
const cores = await avaliar(`Object.fromEntries([...document.querySelectorAll('#listaClientes tr')].map((tr) => [
  tr.querySelector('td')?.textContent.trim(),
  { faixa: tr.dataset.faixa, bolinha: (tr.querySelector('.est-ultima .cc-bolinha')?.className || '').replace('cc-bolinha ', ''), texto: tr.querySelector('.est-ultima')?.innerText.replace(/\\s+/g, ' ').trim() },
]))`)
const esperado = {
  'Pet Shop do Lulu': 'verde',      // 3 dias
  'Agro Zeta': 'verde',             // 15 dias (limite, venda de estoque)
  'Dezesseis Dias': 'amarela',
  'Trinta Dias': 'amarela',         // 30 dias (limite)
  'Trinta e Um Dias': 'vermelha',
  'Dois Meses': 'vermelha',         // a visita "Não comprou" recente não conta
  'Só Não Comprou': 'cinza',
  'Nunca Visitado': 'cinza',
}
for (const [nome, cor] of Object.entries(esperado)) {
  const achado = cores[nome]
  confere(`${nome} → ${cor}`, achado && achado.faixa === cor && achado.bolinha === `cc-${cor}`, JSON.stringify(achado))
}
confere('texto mostra "há N dias" com a origem', /há 3 dias · empresas/.test(cores['Pet Shop do Lulu']?.texto || '') && /há 16 dias · empresas/.test(cores['Dezesseis Dias']?.texto || ''), `${cores['Pet Shop do Lulu']?.texto} | ${cores['Dezesseis Dias']?.texto}`)

// ── Resumo por cor ──
const contagem = await avaliar(`Object.fromEntries([...document.querySelectorAll('.cc-resumo .cc-filtro')].map((b) => [b.dataset.faixa, Number(b.querySelector('strong').textContent)]))`)
confere('resumo conta 2 verdes, 2 amarelas, 2 vermelhas, 2 sem compra', JSON.stringify(contagem) === JSON.stringify({ verde: 2, amarela: 2, vermelha: 2, cinza: 2 }), JSON.stringify(contagem))
await foto('clientes-cores')

// ── Filtro ──
const visiveis = () => avaliar(`[...document.querySelectorAll('#listaClientes tr')].filter((tr) => tr.offsetParent !== null).map((tr) => tr.dataset.faixa)`)
await avaliar(`document.querySelector('.cc-filtro[data-faixa="vermelha"]').click()`); await sleep(200)
let v = await visiveis()
confere('clicar em "mais de 30 dias" mostra só os vermelhos', v.length === 2 && v.every((f) => f === 'vermelha'), JSON.stringify(v))
confere('botão escolhido fica marcado e aparece "Mostrar todos"', await avaliar(`document.querySelector('.cc-filtro[data-faixa="vermelha"]').classList.contains('ativo') && !!document.querySelector('.cc-limpar')`))
await foto('clientes-filtro-vermelha')

// filtro + busca juntos: buscar "Dois" com o filtro vermelho → só "Dois Meses"
await avaliar(`{ const b = document.getElementById('buscaCliente'); b.value = 'Dois'; b.dispatchEvent(new Event('input', { bubbles: true })) }`); await sleep(400)
v = await avaliar(`[...document.querySelectorAll('#listaClientes tr')].filter((tr) => tr.offsetParent !== null).map((tr) => tr.querySelector('td').textContent.trim())`)
confere('filtro continua valendo depois da busca redesenhar a lista', v.length === 1 && v[0] === 'Dois Meses', JSON.stringify(v))
await avaliar(`{ const b = document.getElementById('buscaCliente'); b.value = ''; b.dispatchEvent(new Event('input', { bubbles: true })) }`); await sleep(400)

await avaliar(`document.querySelector('.cc-limpar').click()`); await sleep(200)
v = await visiveis()
confere('"Mostrar todos" volta a lista inteira', v.length === 8, String(v.length))
await avaliar(`document.querySelector('.cc-filtro[data-faixa="cinza"]').click()`); await sleep(150)
await avaliar(`document.querySelector('.cc-filtro[data-faixa="cinza"]').click()`); await sleep(150)
v = await visiveis()
confere('clicar de novo na mesma cor também desliga o filtro', v.length === 8, String(v.length))

// ── Celular: bolinha ao lado do nome (a coluna fica fora da tela); no computador ela fica escondida ──
const noNomeComputador = await avaliar(`[...document.querySelectorAll('.cc-no-nome')].filter((b) => b.offsetParent !== null).length`)
confere('computador: bolinha ao lado do nome escondida', noNomeComputador === 0, String(noNomeComputador))
await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true })
await sleep(300)
const noNome = await avaliar(`Object.fromEntries([...document.querySelectorAll('#listaClientes tr')].map((tr) => {
  const b = tr.querySelector('td .cc-no-nome')
  return [tr.querySelector('td').textContent.trim(), b && b.offsetParent !== null ? b.className.match(/cc-(verde|amarela|vermelha|cinza)/)[1] : null]
}))`)
confere('celular: bolinha visível ao lado do nome, na cor certa', Object.entries(esperado).every(([n, c]) => noNome[n] === c), JSON.stringify(noNome))
await foto('clientes-celular')

confere('nenhum erro de JavaScript', excecoes.length === 0, excecoes.join(' | '))
console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
try { const vv = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).json(); const b = new WebSocket(vv.webSocketDebuggerUrl); await new Promise((res) => b.addEventListener('open', res)); b.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch {}
await sleep(1200); proc.kill(); process.exit(falhas === 0 ? 0 : 1)
