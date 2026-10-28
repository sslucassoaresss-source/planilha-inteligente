// Tela de login: mostrar/esconder senha, "Entrando…" sem clique duplo, senha errada × falha de rede, e entrada com sucesso.
// Uso: node login.mjs <url-base> <perfil> <pasta-capturas>
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EDGE } from './suporte/navegador.mjs'

const [base, perfil, capturas] = process.argv.slice(2)
const PORTA = 9351
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
await cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false })
const ir = async (url) => { carregou = false; await cmd('Page.navigate', { url }); for (let i = 0; i < 100 && !carregou; i++) await sleep(200); await sleep(1200) }
const foto = async (nome) => { const s = await cmd('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(capturas, nome + '.png'), Buffer.from(s.result.data, 'base64')) }

let falhas = 0
const confere = (nome, ok, extra = '') => { if (!ok) falhas++; console.log(`${ok ? '✓' : '✗ FALHOU'} ${nome}${extra ? ' → ' + extra : ''}`) }

// Abre o login já com o modo de resposta escolhido e preenche os campos
async function abrirCom(modo) {
  await ir(`${base}/`)
  await avaliar(`localStorage.setItem('login', '${modo}')`)
  await ir(`${base}/`)
  await avaliar(`document.getElementById('email').value = 'teste@exemplo.com'; document.getElementById('password').value = 'qualquer'`)
}
const enviar = () => avaliar(`document.getElementById('loginForm').requestSubmit()`)
// "?." porque, depois de entrar, a página já é o Dashboard (sem os elementos do login)
const estado = () => avaliar(`({
  erroVisivel: !!document.getElementById('errorMsg')?.classList.contains('show'),
  erroTexto: document.getElementById('errorMsg')?.textContent.trim() ?? '',
  botaoTexto: document.getElementById('btnEntrar')?.textContent.trim() ?? '',
  botaoDesligado: !!document.getElementById('btnEntrar')?.disabled,
  chamadas: window.__loginChamadas || 0,
  caminho: location.pathname,
})`)

// ── Estrutura ──
await abrirCom('senha')
confere('campos que o app usa continuam lá (loginForm, email, password, errorMsg)', await avaliar(`['loginForm','email','password','errorMsg','btnEntrar','btnVerSenha'].every((i) => document.getElementById(i))`))
confere('"Lembrar de mim" saiu (não tinha efeito)', await avaliar(`!document.getElementById('remember') && !/Lembrar de mim/.test(document.body.innerText)`))
confere('erro escondido ao abrir', !(await estado()).erroVisivel)
confere('nenhum link que não leva a lugar nenhum (href="#")', await avaliar(`document.querySelectorAll('a[href="#"]').length === 0`))
confere('texto dos avisos sem horário fixo (o horário será escolhido pelo cliente)', await avaliar(`!/\\b\\d{1,2}\\s?h\\b/.test(document.querySelector('.brand-lista').innerText)`))
await foto('login-inicio')

// ── Mostrar/esconder senha ──
await avaliar(`document.getElementById('btnVerSenha').click()`)
let r = await avaliar(`({ tipo: document.getElementById('password').type, pressionado: document.getElementById('btnVerSenha').getAttribute('aria-pressed') })`)
confere('olho mostra a senha', r.tipo === 'text' && r.pressionado === 'true', JSON.stringify(r))
await avaliar(`document.getElementById('btnVerSenha').click()`)
r = await avaliar(`({ tipo: document.getElementById('password').type, pressionado: document.getElementById('btnVerSenha').getAttribute('aria-pressed') })`)
confere('olho esconde de novo', r.tipo === 'password' && r.pressionado === 'false', JSON.stringify(r))

// ── Senha errada ──
await enviar(); await sleep(400)
let e = await estado()
confere('senha errada → mensagem de senha, botão volta a "Entrar"', e.erroVisivel && /incorretos/.test(e.erroTexto) && e.botaoTexto === 'Entrar' && !e.botaoDesligado, JSON.stringify(e))
await foto('login-senha-errada')

// ── Falha de rede (as duas formas) ──
for (const modo of ['rede', 'rede-sdk']) {
  await abrirCom(modo)
  await enviar(); await sleep(400)
  e = await estado()
  confere(`falha de rede (${modo}) → mensagem de internet, não de senha`, e.erroVisivel && /internet/.test(e.erroTexto) && !/incorretos/.test(e.erroTexto) && !e.botaoDesligado, JSON.stringify(e))
}

// ── Demora: "Entrando…", sem clique duplo, erro anterior some ──
await abrirCom('senha')
await enviar(); await sleep(400)
await avaliar(`localStorage.setItem('login', 'lento')`)
await enviar(); await sleep(300)
e = await estado()
confere('durante a espera: botão "Entrando…" desligado e erro anterior escondido', e.botaoDesligado && /Entrando/.test(e.botaoTexto) && !e.erroVisivel, JSON.stringify(e))
await foto('login-entrando')
const antes = e.chamadas
await enviar(); await avaliar(`document.getElementById('btnEntrar').click()`); await sleep(200)
e = await estado()
confere('segundo clique durante a espera não faz outro login', e.chamadas === antes, `chamadas ${antes} → ${e.chamadas}`)
await sleep(2200)
e = await estado()
confere('depois da espera, entra e vai para o Dashboard', /dashboard/.test(e.caminho), e.caminho)

// ── Sucesso direto ──
await abrirCom('ok')
await enviar(); await sleep(1500)
e = await estado()
confere('login certo → Dashboard', /dashboard/.test(e.caminho), e.caminho)

// ── Celular: logo aparece dentro do cartão ──
await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true })
await abrirCom('senha')
r = await avaliar(`({ marca: getComputedStyle(document.querySelector('.form-marca')).display, painel: getComputedStyle(document.querySelector('.brand-panel')).display, largura: document.documentElement.scrollWidth })`)
confere('celular: logo no cartão, painel lateral escondido, sem rolagem lateral', r.marca !== 'none' && r.painel === 'none' && r.largura <= 390, JSON.stringify(r))
await foto('login-celular')

confere('nenhum erro de JavaScript', excecoes.length === 0, excecoes.join(' | '))
console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
try { const v = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).json(); const b = new WebSocket(v.webSocketDebuggerUrl); await new Promise((res) => b.addEventListener('open', res)); b.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch {}
await sleep(1200); proc.kill(); process.exit(falhas === 0 ? 0 : 1)
