// Teste do botão "Ativar avisos" (js/avisos.js) com PushManager/Notification simulados.
// Uso: node cdp-avisos.mjs <url-base> <perfil> <pasta-png>
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { EDGE } from './suporte/navegador.mjs'
const [base, perfil, saida] = process.argv.slice(2)
const PORTA = 9345
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(saida, { recursive: true })

const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORTA}`, `--user-data-dir=${perfil}`, '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' })
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
  await sleep(1800)
}
let falhas = 0
const confere = (nome, ok, extra = '') => { if (!ok) falhas++; console.log(`${ok ? '✓' : '✗ FALHOU'} ${nome}${extra ? ' → ' + extra : ''}`) }
await cmd('Page.enable'); await cmd('Runtime.enable')

// Simulações injetadas ANTES do app carregar; cada cenário define como o "aparelho" se comporta.
const MOCK = (cfg) => `
  window.__avisos = { subscribe: 0, unsubscribe: 0, pedirPermissao: 0, alertas: [] }
  window.alert = (t) => window.__avisos.alertas.push(t)
  window.confirm = () => true
  const cfg = ${JSON.stringify(cfg)}
  if (cfg.ua) Object.defineProperty(navigator, 'userAgent', { get: () => cfg.ua })
  if (cfg.standalone) Object.defineProperty(navigator, 'standalone', { get: () => true })
  if (cfg.semPush) { delete window.PushManager }
  else if (!window.PushManager) window.PushManager = function () {}
  let perm = cfg.permissao || 'default'
  const FakeN = function () {}
  Object.defineProperty(FakeN, 'permission', { get: () => perm })
  FakeN.requestPermission = async () => { window.__avisos.pedirPermissao++; perm = cfg.responde || 'granted'; return perm }
  window.Notification = FakeN
  let sub = null
  const registro = { pushManager: {
    getSubscription: async () => sub,
    subscribe: async (op) => {
      window.__avisos.subscribe++
      window.__avisos.opcao = { userVisibleOnly: op.userVisibleOnly, bytes: op.applicationServerKey.length }
      sub = { endpoint: 'https://push.exemplo/abc123', toJSON: () => ({ endpoint: 'https://push.exemplo/abc123', keys: { p256dh: 'P256', auth: 'AUTH' } }), unsubscribe: async () => { window.__avisos.unsubscribe++; sub = null; return true } }
      return sub
    },
  } }
  Object.defineProperty(navigator.serviceWorker, 'ready', { get: () => Promise.resolve(registro) })
`
let ident
async function cenario(cfg, url = '/pages/dashboard') {
  if (ident) await cmd('Page.removeScriptToEvaluateOnNewDocument', { identifier: ident })
  ident = (await cmd('Page.addScriptToEvaluateOnNewDocument', { source: MOCK(cfg) })).result.identifier
  await ir(`${base}${url}`)
}
const area = () => js(`document.getElementById('avisosArea')?.textContent.trim() ?? null`)
const temBotao = () => js(`!!document.querySelector('#avisosArea button')`)
const clicar = async () => { await js(`document.querySelector('#avisosArea button').click(); 1`); await sleep(1100) }
const linhas = async () => JSON.parse(await js(`(async () => { const { supabase } = await import('/js/supabase.js'); const r = await supabase.from('push_subscriptions').select('*'); return JSON.stringify(r.data) })()`))

await cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false })
await ir(`${base}/`)
await js(`localStorage.setItem('seed', 'guia'); 1`)

// 1) Aparelho que suporta, sem permissão ainda
await cenario({})
confere('suportado: mostra "🔔 Ativar avisos"', (await area()) === '🔔 Ativar avisos', await area())
await clicar()
const l1 = await linhas()
console.log('   __avisos:', await js('JSON.stringify(__avisos)')); confere('pediu permissão 1 vez e fez subscribe 1 vez', await js(`__avisos.pedirPermissao === 1 && __avisos.subscribe === 1`))
confere('chave pública com 65 bytes e userVisibleOnly', await js(`__avisos.opcao.bytes === 65 && __avisos.opcao.userVisibleOnly === true`))
confere('gravou 1 linha (endpoint, p256dh, auth, user_id)', l1.length === 1 && l1[0].endpoint === 'https://push.exemplo/abc123' && l1[0].p256dh === 'P256' && l1[0].auth === 'AUTH' && l1[0].user_id === 'u1', JSON.stringify(l1[0]))
confere('botão virou "🔔 Avisos ativados"', (await area()) === '🔔 Avisos ativados', await area())
await cmd('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 60, width: 1100, height: 150, scale: 1 } }).then((s) => writeFileSync(join(saida, 'avisos-ativado.png'), Buffer.from(s.result.data, 'base64')))
await clicar() // desativar (confirm = true)
console.log('   __avisos após desativar:', await js('JSON.stringify(__avisos)'), 'linhas:', (await linhas()).length)
confere('desativar: removeu a linha e cancelou a inscrição', (await linhas()).length === 0 && (await js(`__avisos.unsubscribe === 1`)))
confere('voltou a "🔔 Ativar avisos"', (await area()) === '🔔 Ativar avisos', await area())
await clicar(); await clicar(); await clicar() // ativa, desativa, ativa
const l2 = await linhas()
confere('ativar/desativar/ativar não deixa linhas repetidas', l2.length === 1, String(l2.length))

// 2) iPhone no Safari comum (sem PushManager, não instalado)
await cenario({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1', semPush: true })
const t3 = await area()
confere('iPhone sem instalar: dica de instalar, sem botão', !!t3?.includes('Adicionar à Tela de Início') && !(await temBotao()), t3)
await cmd('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 2, mobile: true })
await ir(`${base}/pages/dashboard`)
await cmd('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 375, height: 330, scale: 1 } }).then((s) => writeFileSync(join(saida, 'avisos-iphone-dica.png'), Buffer.from(s.result.data, 'base64')))
confere('celular: sem rolagem lateral com a dica', await js(`document.documentElement.scrollWidth <= window.innerWidth + 1`), String(await js(`document.documentElement.scrollWidth`)))
await cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false })

// 3) iPhone com o app instalado
await cenario({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)', standalone: true })
confere('iPhone instalado: mostra "🔔 Ativar avisos"', (await area()) === '🔔 Ativar avisos', await area())
await cmd('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 2, mobile: true })
await ir(`${base}/pages/dashboard`)
await cmd('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 375, height: 420, scale: 1 } }).then((s) => writeFileSync(join(saida, 'avisos-iphone-instalado.png'), Buffer.from(s.result.data, 'base64')))
const alturaBotao = await js(`document.querySelector('#avisosArea button').getBoundingClientRect().height`)
console.log('   altura do botão de avisos (celular):', Math.round(alturaBotao), 'px; botão Excel:', Math.round(await js(`document.getElementById('btnExcelMes').getBoundingClientRect().height`)), 'px')
await cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false })

// 4) Usuário nega a permissão
await cenario({ responde: 'denied' })
await clicar()
confere('negou: sem inscrição nem gravação, explica como liberar', (await js(`__avisos.subscribe === 0`)) && (await linhas()).length === 0 && !!(await area())?.includes('bloqueados'), await area())

// 5) Já estava bloqueado
await cenario({ permissao: 'denied' })
confere('já bloqueado: dica sem botão', !!(await area())?.includes('bloqueados') && !(await temBotao()), await area())

// 6) Falha ao gravar no banco: cancela a inscrição e avisa (sem meio caminho)
await cenario({})
await js(`(async () => { const { supabase } = await import('/js/supabase.js'); const orig = supabase.from; supabase.from = (t) => t === 'push_subscriptions' ? { upsert: async () => ({ error: { code: '42501', message: 'permission denied' } }) } : orig(t); return 1 })()`)
await clicar()
confere('falha no banco: cancelou a inscrição e mostrou mensagem', (await js(`__avisos.unsubscribe === 1 && __avisos.alertas.length === 1`)) && (await area()) === '🔔 Ativar avisos', await js(`JSON.stringify(__avisos.alertas)`))

// 7) Sem nenhum suporte e fora do iPhone: nada aparece
await cenario({ semPush: true })
confere('sem suporte (não-iPhone): área vazia', (await area()) === '', JSON.stringify(await area()))

// 8) Só o Dashboard carrega o módulo
confere('Rotas não carrega avisos.js', await js(`(async () => !(await (await fetch('/pages/rotas.html')).text()).includes('avisos.js'))()`))

// 9) Chave pública do código bate com a gerada
const chaveNoCodigo = await js(`(async () => { const t = await (await fetch('/js/avisos.js')).text(); return (t.match(/CHAVE_PUBLICA = '([^']+)'/) || [])[1] })()`)
console.log('   chave no código:', chaveNoCodigo?.slice(0, 12) + '…', `(${chaveNoCodigo?.length} caracteres)`)

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
try { const v = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).json(); const b = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => b.addEventListener('open', r)); b.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch {}
await sleep(1200); proc.kill(); process.exit(falhas === 0 ? 0 : 1)
