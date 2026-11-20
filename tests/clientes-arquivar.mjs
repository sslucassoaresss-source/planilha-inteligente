// Teste de Arquivar / Reativar cliente (banco em memória). Uso: node clientes-arquivar.mjs <url-base> <perfil> <pasta-png>
// O cliente arquivado some da lista, das buscas, das rotas e dos avisos, mas visitas, vendas e cobranças ficam.
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { EDGE } from './suporte/navegador.mjs'
const [base, perfil, saida] = process.argv.slice(2)
const PORTA = 9365
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(saida, { recursive: true })

const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORTA}`, `--user-data-dir=${perfil}`, '--window-size=1200,1000', 'about:blank'], { stdio: 'ignore' })
let alvos = []
for (let i = 0; i < 60; i++) { try { alvos = await (await fetch(`http://127.0.0.1:${PORTA}/json`)).json(); if (alvos.some((a) => a.type === 'page')) break } catch {} await sleep(250) }
const ws = new WebSocket(alvos.find((a) => a.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const pend = new Map(); const eventos = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return }
  // A biblioteca de arrastar das Rotas vem da internet: aqui ela é trocada por uma de mentira
  if (m.method === 'Fetch.requestPaused') {
    const corpo = Buffer.from('export default { create() { return { destroy() {}, option() {} } } }').toString('base64')
    cmd('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: corpo })
    return
  }
  eventos.push(m)
})
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
await cmd('Fetch.enable', { patterns: [{ urlPattern: '*sortablejs*' }] })

// Abre a página com o cenário "prioridade" e os clientes arquivados indicados
async function abrir(pagina, arquivados = []) {
  await js(`localStorage.setItem('seed', 'prioridade'); localStorage.setItem('clientes-arquivados', ${JSON.stringify(JSON.stringify(arquivados))}); 1`)
  await ir(`${base}${pagina}`)
  await js(`window.__alertas = []; window.alert = (t) => window.__alertas.push(t); window.__confirms = []; window.confirm = (t) => { window.__confirms.push(t); return true }; 1`)
}
const nomesNaLista = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('#listaClientes tr strong')].map((s) => s.textContent))`))
const linha = (nome) => `[...document.querySelectorAll('#listaClientes tr')].find((t) => t.querySelector('strong')?.textContent === ${JSON.stringify(nome)})`
const clicarNaLinha = async (nome, texto) => { await js(`[...${linha(nome)}.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(texto)}).click(); 1`); await sleep(500) }
const pergunta = () => js(`(() => { const j = document.querySelector('.pergunta-overlay'); return j && j.classList.contains('aberto') ? { titulo: j.querySelector('#perguntaTitulo').textContent, texto: j.querySelector('.pergunta-linhas').innerText } : null })()`)
const responder = async (sim) => { await js(`document.querySelector('.pergunta-overlay .${sim ? 'pergunta-sim' : 'pergunta-nao'}').click(); 1`); await sleep(900) }
const cliente = async (cid) => JSON.parse(await js(`JSON.stringify(__db.clientes.find((c) => c.id === '${cid}') || null)`))
const textoBotaoArquivados = () => js(`(() => { const b = document.getElementById('btnVerArquivados'); return b.hidden ? null : b.textContent })()`)
const avisoPrioridade = () => js(`document.querySelector('.cp-aviso')?.style.display === 'none' ? '' : (document.querySelector('.cp-aviso')?.innerText || '')`)
const naoComprou = () => js(`(() => { const t = document.querySelector('.cc-resumo')?.innerText || ''; const m = t.match(/ainda não comprou\\s*(\\d+)/); return m ? Number(m[1]) : null })()`)

await cmd('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false })
await ir(`${base}/`)

// ── A) Clientes: sem "Excluir"; arquivado fora da lista, do aviso e da contagem ──
await abrir('/pages/clientes', ['c5'])
let nomes = await nomesNaLista()
confere('nenhum botão Excluir na lista de clientes', await js(`![...document.querySelectorAll('#listaClientes button')].some((b) => /excluir/i.test(b.textContent))`))
confere('cada cliente ativo tem Editar e Arquivar', await js(`[...document.querySelectorAll('#listaClientes tr')].every((tr) => /Editar/.test(tr.innerText) && /Arquivar/.test(tr.innerText))`))
confere('arquivado (Mensal Nunca Visitado) não aparece na lista', !nomes.includes('Mensal Nunca Visitado') && nomes.length === 7, JSON.stringify(nomes))
confere('botão "Ver clientes arquivados (1)" aparece', (await textoBotaoArquivados()) === 'Ver clientes arquivados (1)', String(await textoBotaoArquivados()))
const aviso = await avisoPrioridade()
confere('aviso de prioridade não cita o arquivado', aviso.includes('Semanal Atrasado') && !aviso.includes('Mensal Nunca Visitado'), aviso.replace(/\s+/g, ' ').slice(0, 160))
confere('"ainda não comprou" conta só os ativos (2, sem o arquivado)', (await naoComprou()) === 2, String(await naoComprou()))

// ── B) Ver / esconder arquivados ──
await js(`document.getElementById('btnVerArquivados').click(); 1`); await sleep(300)
nomes = await nomesNaLista()
const linhaArq = JSON.parse(await js(`(() => { const tr = ${linha('Mensal Nunca Visitado')}; return JSON.stringify(tr ? { texto: tr.innerText, botoes: [...tr.querySelectorAll('button')].map((b) => b.textContent.trim()) } : null) })()`))
confere('"Ver" mostra o arquivado no fim, com selo "Arquivado" e "Reativar"', nomes.at(-1) === 'Mensal Nunca Visitado' && linhaArq?.texto.includes('Arquivado') && linhaArq.botoes.includes('Reativar') && !linhaArq.botoes.includes('Arquivar'), JSON.stringify(linhaArq))
confere('arquivado mostrado não ganha selo de prioridade', !(await js(`!!${linha('Mensal Nunca Visitado')}.querySelector('.cp-selo')`)))
confere('o botão vira "Esconder clientes arquivados"', (await textoBotaoArquivados()) === 'Esconder clientes arquivados')
await cmd('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(join(saida, 'clientes-arquivados.png'), Buffer.from(s.result.data, 'base64')))
await js(`document.getElementById('btnVerArquivados').click(); 1`); await sleep(300)
confere('"Esconder" tira o arquivado de novo', !(await nomesNaLista()).includes('Mensal Nunca Visitado'))

// ── C) Arquivar um cliente com venda do estoque (o caso do Caio): nada do histórico some ──
await clicarNaLinha('Semanal Atrasado', 'Arquivar')
let p = await pergunta()
confere('Arquivar pergunta antes e explica que o histórico fica', p?.titulo === 'Arquivar o cliente?' && p.texto.includes('continuam guardadas') && p.texto.includes('Quem me deve'), JSON.stringify(p))
await responder(false)
confere('"Não": continua ativo', (await cliente('c3')).ativo !== false)
await clicarNaLinha('Semanal Atrasado', 'Arquivar'); await responder(true)
const vendaQ3 = await js(`__db.vendas_estoque.some((v) => v.id === 'q3' && v.cliente_id === 'c3')`)
confere('"Sim": arquivado (ativo = false), sem apagar nada', (await cliente('c3')).ativo === false && vendaQ3 && (await js(`__alertas.length`)) === 0, await js(`JSON.stringify(__alertas)`))
confere('some da lista e o contador vira (2)', !(await nomesNaLista()).includes('Semanal Atrasado') && (await textoBotaoArquivados()) === 'Ver clientes arquivados (2)')
await sleep(800)
confere('aviso de prioridade deixa de citar o arquivado (sem recarregar a página)', !(await avisoPrioridade()).includes('Semanal Atrasado'), (await avisoPrioridade()).replace(/\s+/g, ' ').slice(0, 160))
await clicarNaLinha('Sem Prioridade', 'Arquivar'); await responder(true); await sleep(800)
confere('"ainda não comprou" se refaz sem recarregar (Sem Prioridade já comprou: continua 2)', (await naoComprou()) === 2, String(await naoComprou()))
await clicarNaLinha('Agro Zeta', 'Arquivar'); await responder(true); await sleep(800)
confere('arquivar quem nunca comprou baixa o "ainda não comprou" na hora (1)', (await naoComprou()) === 1, String(await naoComprou()))

// ── D) Reativar ──
await js(`document.getElementById('btnVerArquivados').click(); 1`); await sleep(300)
await clicarNaLinha('Mensal Nunca Visitado', 'Reativar')
p = await pergunta()
confere('Reativar pergunta antes', p?.titulo === 'Reativar o cliente?', JSON.stringify(p))
await responder(true)
const posReativar = JSON.parse(await js(`(() => { const tr = ${linha('Mensal Nunca Visitado')}; return JSON.stringify(tr ? [...tr.querySelectorAll('button')].map((b) => b.textContent.trim()) : null) })()`))
confere('reativado: ativo = true, volta com "Arquivar"', (await cliente('c5')).ativo === true && posReativar?.includes('Arquivar'), JSON.stringify(posReativar))

// ── E) Falhas: banco sem a coluna "ativo" e erro do servidor ──
await abrir('/pages/clientes')
await js(`window.__falhar = { tabela: 'clientes', op: 'update', code: 'PGRST204' }; 1`)
await clicarNaLinha('Agro Zeta', 'Arquivar'); await responder(true)
confere('sem a coluna no banco: avisa que não está preparado e não muda nada', (await js(`__alertas.length === 1 && __alertas[0].includes('não está preparado')`)) && (await cliente('c2')).ativo !== false, await js(`JSON.stringify(__alertas)`))
await js(`window.__alertas = []; window.__falhar = { tabela: 'clientes', op: 'update', code: '42501' }; 1`)
await clicarNaLinha('Agro Zeta', 'Arquivar'); await responder(true)
confere('erro do servidor: mensagem de sempre e nada muda', (await js(`__alertas.length === 1 && __alertas[0].includes('Erro ao arquivar')`)) && (await cliente('c2')).ativo !== false, await js(`JSON.stringify(__alertas)`))

// ── F) Dashboard: descontos, aviso de prioridade e busca do lembrete sem o arquivado ──
await abrir('/pages/dashboard', ['c1', 'c5'])
await sleep(800)
confere('"Clientes com desconto ativo" não mostra o arquivado (Pet Shop do Lulu)', (await js(`document.getElementById('descontosLista').innerText`)).includes('Nenhum cliente com desconto ativo'), await js(`document.getElementById('descontosLista').innerText`))
const faixa = await js(`document.querySelector('.dp-faixa')?.innerText || ''`)
confere('aviso de prioridade do Dashboard não cita o arquivado', faixa.includes('Semanal Atrasado') && !faixa.includes('Mensal Nunca Visitado'), faixa.replace(/\s+/g, ' ').slice(0, 160))
const buscarNoCampo = async (campo, texto) => {
  await js(`(() => { const c = document.getElementById('${campo}'); c.focus(); c.value = ${JSON.stringify(texto)}; c.dispatchEvent(new Event('input', { bubbles: true })); return 1 })()`)
  await sleep(700)
}
await buscarNoCampo('estLembreteCliente', 'Pet')
confere('lembrete: busca não oferece o arquivado', (await js(`document.getElementById('estLembreteCliente').parentNode.innerText`)).includes('Nenhum cliente encontrado'))

// ── G) Visitas: a busca não oferece o arquivado, mas a visita antiga dele continua com o nome ──
await abrir('/pages/visitas', ['c1'])
await js(`document.getElementById('btnNovaVisita').click(); 1`)
await buscarNoCampo('clienteBusca', 'Pet')
confere('nova visita: busca por "Pet" não acha o arquivado', (await js(`document.getElementById('sugestoesCliente').innerText`)).includes('Nenhum cliente encontrado'))
await buscarNoCampo('clienteBusca', 'Agro')
confere('nova visita: cliente ativo continua aparecendo', (await js(`document.getElementById('sugestoesCliente').innerText`)).includes('Agro Zeta'))
await js(`(() => {
  const h = new Date(); const d = h.getFullYear() + '-' + String(h.getMonth() + 1).padStart(2, '0') + '-' + String(h.getDate()).padStart(2, '0')
  __db.visitas.push({ id: 'vArq', user_id: 'u1', cliente_id: 'c1', data_visita: d, comprou: false, desconto_aplicado: 0, observacao: null, created_at: d + 'T09:00:00Z' })
  document.getElementById('btnFecharModal')?.click()
  document.getElementById('selectMes').dispatchEvent(new Event('change'))
  return 1
})()`)
await sleep(1200)
await js(`document.querySelector('.btn-editar[data-id="vArq"]').click(); 1`); await sleep(600)
confere('visita antiga do arquivado abre com o nome dele', (await js(`document.getElementById('clienteBusca').value`)) === 'Pet Shop do Lulu', await js(`document.getElementById('clienteBusca').value`))

// ── H) Rotas: arquivado sai do grupo da cidade e da rota montada; entrega não oferece ──
await abrir('/pages/rotas', ['c2'])
await js(`(() => {
  __db.rotas.push({ id: 'r1', user_id: 'u1', cidade: 'Campinas', nome: 'Rota 1', observacao: null })
  __db.rota_clientes.push({ id: 'rc1', user_id: 'u1', rota_id: 'r1', cliente_id: 'c1', ordem: 0 }, { id: 'rc2', user_id: 'u1', rota_id: 'r1', cliente_id: 'c3', ordem: 1 })
  return 1
})()`)
await js(`localStorage.setItem('clientes-arquivados', '["c2","c3"]'); 1`)
await js(`(() => { __db.clientes.find((c) => c.id === 'c3').ativo = false; document.getElementById('selectMes').dispatchEvent(new Event('change')); return 1 })()`)
await sleep(1200)
const cidades = await js(`[...document.querySelectorAll('#listaCidades')].map((e) => e.innerText).join(' ')`)
confere('Rotas: Valinhos (só tinha o arquivado Agro Zeta) não aparece', cidades.includes('Campinas') && !cidades.includes('Valinhos'), cidades.replace(/\s+/g, ' ').slice(0, 120))
const naRota = await js(`[...document.querySelectorAll('.rota-lista-clientes[data-rota-id="r1"] .cliente-row-nome')].map((e) => e.textContent).join(', ')`)
confere('Rotas: a rota montada mostra o ativo e esconde o arquivado', naRota === 'Pet Shop do Lulu', naRota)
confere('Rotas: o vínculo do arquivado com a rota continua guardado (reativar traz de volta)', await js(`__db.rota_clientes.some((v) => v.id === 'rc2')`))
await js(`document.getElementById('entBtnNova').click(); 1`); await sleep(300)
await buscarNoCampo('entBuscaCliente', 'Agro')
confere('Entrega: busca não oferece o arquivado', (await js(`document.getElementById('entSugestoes').innerText`)).includes('Nenhum cliente encontrado'))

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
try { const v = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).json(); const bb = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => bb.addEventListener('open', r)); bb.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch {}
await sleep(1200); proc.kill(); process.exit(falhas === 0 ? 0 : 1)
