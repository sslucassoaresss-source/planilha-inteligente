// Prioridade de visita nas telas: selo em Clientes, aviso + "Ver só esses", link do Dashboard
// (?prioridade=atrasados), campo na janela do cliente (Outro prazo, prazo inválido, salvar e o selo aparecer).
// Uso: node clientes-prioridade.mjs <url-base> <perfil> <pasta-capturas>
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EDGE } from './suporte/navegador.mjs'

const [base, perfil, capturas] = process.argv.slice(2)
const PORTA = 9355
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

// Situação de cada linha, pelo nome (o nome fica no <strong>; o selo vem embaixo)
const linhas = () => avaliar(`Object.fromEntries([...document.querySelectorAll('#listaClientes tr')].map((tr) => [
  tr.querySelector('td strong')?.textContent.trim(),
  { estado: tr.dataset.prioridade || '', selo: tr.querySelector('.cp-selo')?.textContent || '', visivel: tr.offsetParent !== null },
]))`)

await ir(`${base}/`)
await avaliar(`localStorage.setItem('seed', 'prioridade')`)
await ir(`${base}/pages/clientes`)

// ── Selos ──
let l = await linhas()
const esperado = {
  'Pet Shop do Lulu': ['em-dia', 'Semanal · em dia (faltam 4 dias)'],
  'Agro Zeta': ['hoje', 'Semanal · visitar hoje'],                       // "Não comprou" conta como visita
  'Semanal Atrasado': ['atrasado', 'Semanal · atrasado há 3 dias'],      // venda de estoque conta
  'Quinzenal da Entrega': ['atrasado', 'Quinzenal · atrasado há 1 dia'], // entrega feita (venda) conta
  'Mensal Nunca Visitado': ['atrasado', 'Mensal · atrasado há 15 dias'], // conta do cadastro
  'Mensal Recém Cadastrado': ['em-dia', 'Mensal · em dia (faltam 25 dias)'],
  'A Cada Dez Dias': ['atrasado', 'A cada 10 dias · atrasado há 2 dias'],
  'Sem Prioridade': ['', ''],
}
for (const [nome, [estado, selo]] of Object.entries(esperado)) {
  confere(`${nome} → ${estado || 'sem selo'}`, l[nome]?.estado === estado && l[nome]?.selo === selo, JSON.stringify(l[nome]))
}

// ── Aviso acima da tabela ──
let aviso = await avaliar(`document.querySelector('.cp-aviso')?.innerText.replace(/\\s+/g, ' ').trim()`)
confere('aviso: 4 prioritários atrasados, do mais atrasado primeiro', /^⚠ ?4 clientes prioritários estão sem visita no prazo: Mensal Nunca Visitado, Semanal Atrasado, A Cada Dez Dias e mais 1\./.test(aviso), aviso)
await foto('clientes-prioridade')

await avaliar(`document.querySelector('.cp-aviso-botao').click()`); await sleep(200)
l = await linhas()
const visiveis = Object.entries(l).filter(([, v]) => v.visivel).map(([n]) => n).sort()
confere('"Ver só esses" mostra só os 4 atrasados', JSON.stringify(visiveis) === JSON.stringify(['A Cada Dez Dias', 'Mensal Nunca Visitado', 'Quinzenal da Entrega', 'Semanal Atrasado']), JSON.stringify(visiveis))
confere('botão vira "Mostrar todos"', (await avaliar(`document.querySelector('.cp-aviso-botao').textContent`)) === 'Mostrar todos')
await foto('clientes-prioridade-filtro')
await avaliar(`document.querySelector('.cp-aviso-botao').click()`); await sleep(200)
l = await linhas()
confere('"Mostrar todos" volta os 8', Object.values(l).filter((v) => v.visivel).length === 8)

// ── Link do Dashboard: Clientes já abre filtrado ──
await ir(`${base}/pages/clientes?prioridade=atrasados`)
l = await linhas()
confere('?prioridade=atrasados abre só com os atrasados', Object.values(l).filter((v) => v.visivel).length === 4, String(Object.values(l).filter((v) => v.visivel).length))

// ── Janela do cliente ──
await ir(`${base}/pages/clientes`)
await avaliar(`window.__alertas = []; window.alert = (m) => window.__alertas.push(String(m))`)
// Editar o "Sem Prioridade": o campo vem vazio
await avaliar(`[...document.querySelectorAll('#listaClientes tr')].find((tr) => tr.querySelector('td strong').textContent.trim() === 'Sem Prioridade').querySelector('.btn-editar').click()`); await sleep(300)
let campo = await avaliar(`({ valor: document.getElementById('prioridade').value, diasEscondido: getComputedStyle(document.getElementById('campoPrioridadeDias')).display === 'none' })`)
confere('editar cliente sem prioridade: "Sem prioridade" e campo de dias escondido', campo.valor === '' && campo.diasEscondido, JSON.stringify(campo))
// "Outro prazo…" mostra o campo de dias; prazo inválido não salva
await avaliar(`{ const s = document.getElementById('prioridade'); s.value = 'outro'; s.dispatchEvent(new Event('change')) }`); await sleep(100)
confere('"Outro prazo…" mostra o campo de dias', (await avaliar(`getComputedStyle(document.getElementById('campoPrioridadeDias')).display === 'none'`)) === false)
await avaliar(`document.getElementById('prioridadeDias').value = '400'; document.getElementById('formCliente').requestSubmit()`); await sleep(300)
let r = await avaliar(`({ alertas: window.__alertas, aberto: document.getElementById('modalOverlay').classList.contains('aberto'), valido: document.getElementById('prioridadeDias').checkValidity() })`)
confere('prazo 400 (fora de 1 a 365) não salva (o navegador barra pelo limite do campo)', r.aberto && !r.valido, JSON.stringify(r))
await avaliar(`document.getElementById('prioridadeDias').value = ''; document.getElementById('formCliente').requestSubmit()`); await sleep(300)
r = await avaliar(`({ alertas: window.__alertas, aberto: document.getElementById('modalOverlay').classList.contains('aberto') })`)
confere('"Outro prazo" sem número avisa e não salva', r.aberto && r.alertas.length === 1 && /inválido/.test(r.alertas[0]), JSON.stringify(r))
// Defeito encontrado: 400 em "Outro prazo" e depois trocar para Mensal deixava o campo escondido inválido e travava o Salvar
await avaliar(`document.getElementById('prioridadeDias').value = '400'; { const s = document.getElementById('prioridade'); s.value = '30'; s.dispatchEvent(new Event('change')) }`); await sleep(100)
confere('trocar de "Outro prazo" para Mensal limpa o número escondido', (await avaliar(`document.getElementById('prioridadeDias').value`)) === '' && (await avaliar(`document.getElementById('formCliente').checkValidity()`)))
await avaliar(`{ const s = document.getElementById('prioridade'); s.value = 'outro'; s.dispatchEvent(new Event('change')) }`); await sleep(100)
// Prazo de 20 dias: salva, e o selo aparece sem recarregar a página (visita há 90 dias → atrasado 70)
await avaliar(`document.getElementById('prioridadeDias').value = '20'; document.getElementById('formCliente').requestSubmit()`); await sleep(1500)
l = await linhas()
confere('salvar prazo de 20 dias: selo aparece na hora (atrasado há 70 dias)', l['Sem Prioridade']?.selo === 'A cada 20 dias · atrasado há 70 dias', JSON.stringify(l['Sem Prioridade']))
aviso = await avaliar(`(document.querySelector('.cp-aviso')?.innerText || '').replace(/\\s+/g, ' ').trim()`)
confere('aviso passa a contar 5 atrasados', /^⚠ ?5 clientes/.test(aviso), aviso)
// Reabrir: vem como "Outro prazo" com 20
await avaliar(`[...document.querySelectorAll('#listaClientes tr')].find((tr) => tr.querySelector('td strong').textContent.trim() === 'Sem Prioridade').querySelector('.btn-editar').click()`); await sleep(300)
campo = await avaliar(`({ valor: document.getElementById('prioridade').value, dias: document.getElementById('prioridadeDias').value, diasEscondido: getComputedStyle(document.getElementById('campoPrioridadeDias')).display === 'none' })`)
confere('reabrir: "Outro prazo" com 20 dias', campo.valor === 'outro' && campo.dias === '20' && !campo.diasEscondido, JSON.stringify(campo))
// Trocar para Mensal e salvar: campo de dias some e o prazo vira 30 (90 dias → atrasado 60)
await avaliar(`{ const s = document.getElementById('prioridade'); s.value = '30'; s.dispatchEvent(new Event('change')) }`); await sleep(100)
confere('escolher Mensal esconde o campo de dias', await avaliar(`getComputedStyle(document.getElementById('campoPrioridadeDias')).display === 'none'`))
await avaliar(`document.getElementById('formCliente').requestSubmit()`); await sleep(1500)
l = await linhas()
confere('salvar Mensal: "Mensal · atrasado há 60 dias"', l['Sem Prioridade']?.selo === 'Mensal · atrasado há 60 dias', JSON.stringify(l['Sem Prioridade']))
// Tirar a prioridade: selo some
await avaliar(`[...document.querySelectorAll('#listaClientes tr')].find((tr) => tr.querySelector('td strong').textContent.trim() === 'Sem Prioridade').querySelector('.btn-editar').click()`); await sleep(300)
await avaliar(`{ const s = document.getElementById('prioridade'); s.value = ''; s.dispatchEvent(new Event('change')); document.getElementById('formCliente').requestSubmit() }`); await sleep(1500)
l = await linhas()
confere('"Sem prioridade" tira o selo', l['Sem Prioridade']?.selo === '' && l['Sem Prioridade']?.estado === '', JSON.stringify(l['Sem Prioridade']))
// Novo cliente: o campo começa vazio (o formulário anterior não deixa resto)
await avaliar(`document.getElementById('btnNovoCliente').click()`); await sleep(200)
campo = await avaliar(`({ valor: document.getElementById('prioridade').value, diasEscondido: getComputedStyle(document.getElementById('campoPrioridadeDias')).display === 'none' })`)
confere('novo cliente: prioridade começa vazia', campo.valor === '' && campo.diasEscondido, JSON.stringify(campo))
await avaliar(`document.getElementById('btnCancelar').click()`)

// ── Dashboard ──
await ir(`${base}/pages/dashboard`)
const faixa = await avaliar(`(() => { const a = document.querySelector('.dp-faixa'); return a ? { texto: a.innerText.replace(/\\s+/g, ' ').trim(), href: a.getAttribute('href'), dentroDoAzul: !!a.closest('.frente-azul') } : null })()`)
confere('Dashboard: aviso no bloco azul com os nomes e link para Clientes filtrado',
  faixa && faixa.dentroDoAzul && faixa.href === 'clientes.html?prioridade=atrasados' && /4 clientes prioritários sem visita no prazo: Mensal Nunca Visitado, Semanal Atrasado, A Cada Dez Dias e mais 1/.test(faixa.texto), JSON.stringify(faixa))
await foto('dashboard-prioridade')

// Sem nenhum atrasado (cenário "guia" não tem prioridade): nada de aviso
await avaliar(`localStorage.setItem('seed', 'guia')`)
await ir(`${base}/pages/dashboard`)
confere('Dashboard sem prioritários atrasados: sem aviso', (await avaliar(`document.querySelectorAll('.dp-faixa').length`)) === 0)
await ir(`${base}/pages/clientes`)
confere('Clientes sem prioritários atrasados: sem aviso', (await avaliar(`getComputedStyle(document.querySelector('.cp-aviso')).display`)) === 'none')

confere('nenhum erro de JavaScript', excecoes.length === 0, excecoes.join(' | '))
console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
try { const v = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).json(); const b = new WebSocket(v.webSocketDebuggerUrl); await new Promise((res) => b.addEventListener('open', res)); b.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch {}
await sleep(1200); proc.kill(); process.exit(falhas === 0 ? 0 : 1)
