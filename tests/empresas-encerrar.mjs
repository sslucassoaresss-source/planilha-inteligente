// Teste de Encerrar / Reativar empresa (banco em memória). Uso: node empresas-encerrar.mjs <url-base> <perfil> <pasta-png>
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { EDGE } from './suporte/navegador.mjs'
const [base, perfil, saida] = process.argv.slice(2)
const PORTA = 9361
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

const banco = async () => JSON.parse(await js(`JSON.stringify({ empresas: __db.empresas, recebidas: __db.comissoes_recebidas, itens: __db.itens_venda })`))
const empresa = async (nome) => (await banco()).empresas.find((e) => e.nome === nome)
const acharLinha = (nome) => `[...document.querySelectorAll('#listaEmpresas tr')].find((t) => t.querySelector('strong')?.textContent === ${JSON.stringify(nome)})`
const linha = (nome) => js(`(() => { const tr = ${acharLinha(nome)}; return tr ? { texto: tr.innerText, encerrada: tr.querySelector('.badge')?.textContent === 'Encerrada', cinza: tr.classList.contains('est-inativo'), botoes: [...tr.querySelectorAll('button')].map((b) => b.textContent.trim()) } : null })()`)
const clicarNaLinha = async (nome, texto) => {
  await js(`[...${acharLinha(nome)}.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(texto)}).click(); 1`)
  await sleep(500)
}
const pergunta = () => js(`(() => { const j = document.querySelector('.pergunta-overlay'); return j && j.classList.contains('aberto') ? { titulo: j.querySelector('#perguntaTitulo').textContent, texto: j.querySelector('.pergunta-linhas').innerText, sim: j.querySelector('.pergunta-sim').textContent } : null })()`)
const responder = async (sim) => { await js(`document.querySelector('.pergunta-overlay .${sim ? 'pergunta-sim' : 'pergunta-nao'}').click(); 1`); await sleep(900) }

// Abre a página com o cenário "empresas" do banco de mentira; "ativa" define a situação de cada empresa ao carregar
async function abrir(pagina, ativa = {}) {
  await js(`localStorage.setItem('seed', 'empresas'); localStorage.setItem('empresas-ativa', ${JSON.stringify(JSON.stringify(ativa))}); 1`)
  await ir(`${base}/pages/${pagina}`)
  await js(`window.__alertas = []; window.alert = (t) => window.__alertas.push(t); window.__confirms = []; window.confirm = (t) => { window.__confirms.push(t); return true }; 1`)
}
const opcoesVendaNova = async () => {
  await js(`document.getElementById('btnNovaVisita').click(); document.getElementById('comprou').value = 'sim'; document.getElementById('comprou').dispatchEvent(new Event('change')); document.getElementById('btnAddItem').click(); 1`)
  await sleep(400)
  return JSON.parse(await js(`JSON.stringify([...document.querySelector('#listaItens .item-empresa').options].map((o) => o.textContent))`))
}

await cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false })
await ir(`${base}/`)
await abrir('empresas')

// ── A) Sem a coluna "ativa" no banco: toda empresa aparece como ativa, com "Encerrar"; não existe mais "Excluir" ──
let l1 = await linha('Racao Forte')
confere('empresa sem a coluna "ativa" aparece como ativa, com botão Encerrar', l1 && !l1.encerrada && l1.botoes.includes('Encerrar') && !l1.botoes.includes('Reativar'), JSON.stringify(l1?.botoes))
confere('nenhuma empresa tem botão Excluir', await js(`![...document.querySelectorAll('#listaEmpresas button')].some((b) => /excluir/i.test(b.textContent))`))

// ── B) Encerrar empresa com venda: nada é apagado e o mês continua igual ──
await clicarNaLinha('Racao Forte', 'Encerrar')
let p = await pergunta()
confere('Encerrar: pergunta explica que os meses passados ficam iguais', p?.titulo === 'Encerrar a empresa?' && p.texto.includes('meses passados'), JSON.stringify(p))
await responder(false)
confere('"Não": continua ativa', (await empresa('Racao Forte'))?.ativa !== false)
await clicarNaLinha('Racao Forte', 'Encerrar'); await responder(true)
let b = await banco()
confere('"Sim": ficou encerrada, venda e "Recebido" continuam no banco', b.empresas.find((e) => e.id === 'e1')?.ativa === false && b.itens.some((i) => i.empresa_id === 'e1') && b.recebidas.some((r) => r.empresa_id === 'e1'))
l1 = await linha('Racao Forte')
confere('na tela: selo "Encerrada", botão Reativar, venda e comissão do mês continuam', l1?.encerrada && l1.texto.includes('Encerrada') && l1.botoes.includes('Reativar') && !l1.botoes.includes('Encerrar') && l1.texto.includes('150,00') && l1.texto.includes('15,00'), l1?.texto.replace(/\s+/g, ' '))
confere('selo cinza neutro e linha sem o cinza de "Recebido"/inativo', !l1.cinza && (await js(`!!${acharLinha('Racao Forte')}.querySelector('.badge.est-selo-neutro') && !${acharLinha('Racao Forte')}.querySelector('.badge-nao')`)))
confere('encerrada vai para o fim da lista', await js(`[...document.querySelectorAll('#listaEmpresas tr strong')].map((s) => s.textContent).at(-1) === 'Racao Forte'`))
confere('o "Recebido" do mês continua marcado', await js(`document.querySelector('.check-recebido[data-empresa-id="e1"]').checked`))
confere('o resumo do mês continua com a comissão dela', await js(`document.getElementById('resumoComissao').innerText.includes('15,00')`))
confere('"Editar" de empresa encerrada continua abrindo a janela', await js(`(() => { [...${acharLinha('Racao Forte')}.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Editar').click(); const ok = document.getElementById('modalOverlay').classList.contains('aberto') && document.getElementById('nome').value === 'Racao Forte'; document.getElementById('btnCancelar').click(); return ok })()`))
await cmd('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(join(saida, 'empresa-encerrada.png'), Buffer.from(s.result.data, 'base64')))

// ── C) Visitas: encerrada some da venda nova, mas aparece na edição da venda antiga ──
await abrir('visitas', { e1: false })
let opcoes = await opcoesVendaNova()
confere('venda nova: Racao Forte (encerrada) não aparece, as ativas sim', !opcoes.some((o) => o.includes('Racao Forte')) && opcoes.some((o) => o.includes('Petisco Bom')) && opcoes.some((o) => o.includes('Areia Boa')), JSON.stringify(opcoes))
await abrir('visitas', { e1: false })
await js(`document.querySelector('.btn-editar[data-id="vx1"]').click(); 1`)
await sleep(600)
const edicao = JSON.parse(await js(`(() => { const s = document.querySelector('#listaItens .item-empresa'); return JSON.stringify({ valor: s?.value, texto: s?.selectedOptions[0]?.textContent, opcoes: [...s.options].map((o) => o.textContent) }) })()`))
confere('editar a venda antiga: Racao Forte continua escolhida, marcada "(encerrada)"', edicao.valor === 'e1' && edicao.texto === 'Racao Forte (encerrada)', JSON.stringify(edicao))

// ── D) Reativar ──
await abrir('empresas', { e1: false })
await clicarNaLinha('Racao Forte', 'Reativar')
p = await pergunta()
confere('Reativar: pergunta antes', p?.titulo === 'Reativar a empresa?', JSON.stringify(p))
await responder(true)
l1 = await linha('Racao Forte')
confere('reativada: volta a ativa e com botão Encerrar', (await empresa('Racao Forte'))?.ativa === true && !l1.encerrada && l1.botoes.includes('Encerrar'))
await abrir('visitas', { e1: true })
opcoes = await opcoesVendaNova()
confere('ativa (ativa = true): aparece na venda nova', opcoes.some((o) => o.includes('Racao Forte') && !o.includes('encerrada')), JSON.stringify(opcoes))

// ── E) Banco sem a coluna "ativa": mensagem clara, nada muda ──
await abrir('empresas')
await js(`window.__alertas = []; window.__falhar = { tabela: 'empresas', op: 'update', code: 'PGRST204' }; 1`)
await clicarNaLinha('Racao Forte', 'Encerrar'); await responder(true)
confere('sem a coluna no banco: avisa que o banco não está preparado', (await js(`__alertas.length === 1 && __alertas[0].includes('não está preparado')`)) && (await empresa('Racao Forte'))?.ativa !== false, await js(`JSON.stringify(__alertas)`))

// ── F) Falha comum ao encerrar: mensagem de erro de sempre ──
await js(`window.__alertas = []; window.__falhar = { tabela: 'empresas', op: 'update', code: '42501' }; 1`)
await clicarNaLinha('Racao Forte', 'Encerrar'); await responder(true)
confere('falha do servidor ao encerrar: avisa e não muda', (await js(`__alertas.length === 1 && __alertas[0].includes('Erro ao encerrar')`)) && (await empresa('Racao Forte'))?.ativa !== false, await js(`JSON.stringify(__alertas)`))

// ── G) Celular: sem rolagem lateral na página ──
await cmd('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 2, mobile: true })
await abrir('empresas', { e1: false })
confere('celular: página sem rolagem lateral', await js(`document.documentElement.scrollWidth <= window.innerWidth + 1`), String(await js(`document.documentElement.scrollWidth`)))
await cmd('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(join(saida, 'empresas-celular.png'), Buffer.from(s.result.data, 'base64')))
await js(`localStorage.removeItem('seed'); localStorage.removeItem('empresas-ativa'); 1`)

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
try { const v = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).json(); const bb = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => bb.addEventListener('open', r)); bb.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch {}
await sleep(1200); proc.kill(); process.exit(falhas === 0 ? 0 : 1)
