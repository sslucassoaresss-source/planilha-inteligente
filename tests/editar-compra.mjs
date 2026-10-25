// Teste do botão "Editar" em Compras (banco em memória, cenário "guia"). Uso: node cdp-editar-compra.mjs <url-base> <perfil> <pasta-png>
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { EDGE } from './suporte/navegador.mjs'
const [base, perfil, saida] = process.argv.slice(2)
const PORTA = 9351
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
  await sleep(1800)
}
let falhas = 0
const confere = (nome, ok, extra = '') => { if (!ok) falhas++; console.log(`${ok ? '✓' : '✗ FALHOU'} ${nome}${extra ? ' → ' + extra : ''}`) }
await cmd('Page.enable'); await cmd('Runtime.enable')
await cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1000, deviceScaleFactor: 1, mobile: false })

// ── Auxiliares ──
// Recarrega a página (o banco de mentira volta ao cenário inicial) e prepara alert/confirm controláveis
async function novaPagina() {
  await ir(`${base}/pages/empresas`)
  await js(`window.__confirms = []; window.__alertas = []; window.__resp = []; window.confirm = (t) => { window.__confirms.push(t); return window.__resp.length ? window.__resp.shift() : true }; window.alert = (t) => window.__alertas.push(t); 1`)
}
const banco = async () => JSON.parse(await js(`(async () => {
  const { supabase } = await import('/js/supabase.js')
  const q = async (t) => (await supabase.from(t).select('*')).data
  return JSON.stringify({ compras: await q('compras_estoque'), pags: await q('pagamentos_compra'), produtos: await q('produtos') })
})()`))
const pagoDe = (b, cid) => Math.round(b.pags.filter((p) => p.compra_id === cid).reduce((s, p) => s + Number(p.valor), 0) * 100) / 100
const compraDe = (b, cid) => b.compras.find((c) => c.id === cid)
const aberto = () => js(`document.getElementById('estModalCompra').classList.contains('aberto')`)
const visivel = (idEl) => js(`(() => { const e = document.getElementById('${idEl}'); return !!e && getComputedStyle(e).display !== 'none' })()`)
const texto = (idEl) => js(`document.getElementById('${idEl}').innerText.replace(/\\s+/g, ' ').trim()`)
const abrirEdicao = async (cid) => { await js(`document.querySelector('[data-acao="editar-compra"][data-id="${cid}"]').click(); 1`); await sleep(400) }
const digitar = async (idEl, valor) => { await js(`(() => { const e = document.getElementById('${idEl}'); e.value = '${valor}'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return 1 })()`); await sleep(150) }
const marcar = async (idEl, v) => { await js(`(() => { const e = document.getElementById('${idEl}'); e.checked = ${v}; e.dispatchEvent(new Event('change', { bubbles: true })); return 1 })()`); await sleep(150) }
const salvar = async () => { await js(`document.getElementById('estBtnSalvarCompra').click(); 1`); await sleep(1500) }
const confirmacoes = async () => JSON.parse(await js(`JSON.stringify(__confirms)`)).map((x) => x.replace(/ /g, ' '))
const alertas = async () => JSON.parse(await js(`JSON.stringify(__alertas)`)).map((x) => x.replace(/ /g, ' '))
const linhaCompra = (cid) => js(`(() => { const b = document.querySelector('[data-acao="editar-compra"][data-id="${cid}"]'); return b ? b.closest('tr').innerText.replace(/\\s+/g, ' ').trim() : null })()`)
const estoqueDe = (nome) => js(`(() => { const tr = [...document.querySelectorAll('#estListaProdutos tr')].find(r => r.innerText.includes('${nome}')); return tr ? tr.innerText.replace(/\\s+/g, ' ').trim() : null })()`)

await ir(`${base}/`)
await js(`localStorage.setItem('seed', 'guia'); 1`)

// ── 1) Botão e janela preenchida ──
await novaPagina()
confere('cada compra tem o botão Editar (3 compras)', (await js(`document.querySelectorAll('[data-acao="editar-compra"]').length`)) === 3)
await abrirEdicao('cp1')
confere('janela abre em modo edição (título e botão)', (await aberto()) && (await texto('estCompTitulo')) === 'Editar compra' && (await js(`document.getElementById('estBtnSalvarCompra').textContent`)) === 'Salvar alterações')
const campos = await js(`JSON.stringify({ prod: document.getElementById('estCompProduto').selectedOptions[0].text, forn: document.getElementById('estCompFornecedor').selectedOptions[0].text, data: document.getElementById('estCompData').value, qtd: document.getElementById('estCompQtd').value, custo: document.getElementById('estCompCusto').value })`)
confere('campos vêm preenchidos com a compra', JSON.parse(campos).prod.includes('Areia') && JSON.parse(campos).qtd === '100' && JSON.parse(campos).custo === '20' && JSON.parse(campos).data === '2026-10-01', campos)
confere('"Já paguei" escondido; situação do pagamento aparece', !(await visivel('estLinhaPago')) && (await visivel('estEdicaoPago')), await texto('estEdicaoPago'))
confere('paga por inteiro: "Já pago R$ 2.000,00 · Paga por inteiro"; caixinha escondida', (await texto('estEdicaoPago')).includes('2.000,00') && (await texto('estEdicaoPago')).includes('Paga por inteiro') && !(await visivel('estLinhaContinuaPaga')))
confere('"Atualizar custo do produto" começa desmarcado na edição', (await js(`document.getElementById('estCompAtualizaCusto').checked`)) === false)
await cmd('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1100, height: 1000, scale: 1 } }).then((s) => writeFileSync(join(saida, 'editar-compra-1.png'), Buffer.from(s.result.data, 'base64')))

// ── 2) Editar só observação/data/fornecedor: sem avisos, pagamento intacto ──
await digitar('estCompObs', 'nota corrigida'); await digitar('estCompData', '2026-10-02')
await salvar()
let b = await banco()
confere('só observação/data: salvou sem perguntas e sem mexer no pagamento', !(await aberto()) && (await confirmacoes()).length === 0 && compraDe(b, 'cp1').observacao === 'nota corrigida' && compraDe(b, 'cp1').data_compra === '2026-10-02' && pagoDe(b, 'cp1') === 2000)

// ── 3) Paga por inteiro, total sobe, caixinha DESMARCADA: lembrete; Cancelar volta para a janela ──
await novaPagina()
await abrirEdicao('cp1'); await digitar('estCompQtd', '120')
confere('total mudou: caixinha "Continua paga por inteiro" aparece (desmarcada) e mostra Falta R$ 400,00', (await visivel('estLinhaContinuaPaga')) && (await js(`document.getElementById('estCompContinuaPaga').checked`)) === false && (await texto('estEdicaoPago')).includes('Falta R$ 400,00'), await texto('estEdicaoPago'))
confere('campo de vencimento aparece (vai ter falta)', await visivel('estCampoVenc'))
await js(`__resp.push(false); 1`)
await salvar()
let conf = await confirmacoes(); b = await banco()
confere('lembrete aparece ao salvar com a caixinha desmarcada', conf.length === 1 && conf[0].includes('Continua paga por inteiro') && conf[0].includes('Falta R$ 400,00'), (conf[0] || '').slice(0, 90).replace(/\n/g, ' '))
confere('Cancelar no lembrete: nada foi salvo e a janela continua aberta', (await aberto()) && compraDe(b, 'cp1').quantidade == 100 && pagoDe(b, 'cp1') === 2000)
await js(`__resp.push(true); 1`)
await salvar()
b = await banco()
confere('"Salvar mesmo assim": compra com 120, pagamento intacto (2.000) -> Falta R$ 400,00 na lista', !(await aberto()) && compraDe(b, 'cp1').quantidade == 120 && pagoDe(b, 'cp1') === 2000 && (await linhaCompra('cp1')).includes('Falta R$ 400,00'), await linhaCompra('cp1'))

// ── 4) Paga por inteiro, total sobe, caixinha MARCADA: pagamento ajustado, sem lembrete ──
await novaPagina()
await abrirEdicao('cp1'); await digitar('estCompQtd', '120'); await marcar('estCompContinuaPaga', true)
confere('com a caixinha marcada: mostra "Paga por inteiro" e esconde vencimento', (await texto('estEdicaoPago')).includes('2.400,00') && (await texto('estEdicaoPago')).includes('Paga por inteiro') && !(await visivel('estCampoVenc')), await texto('estEdicaoPago'))
await salvar()
b = await banco()
confere('salvou sem lembrete; pagamentos somam 2.400 (entrou +R$ 400,00); lista mostra Pago', (await confirmacoes()).length === 0 && compraDe(b, 'cp1').quantidade == 120 && pagoDe(b, 'cp1') === 2400 && (await linhaCompra('cp1')).includes('Pago'), `${pagoDe(b, 'cp1')} | ${await linhaCompra('cp1')}`)

// ── 5) Paga por inteiro, total DESCE ──
await novaPagina()
await abrirEdicao('cp1'); await digitar('estCompQtd', '90')
await salvar()
b = await banco()
conf = await confirmacoes(); let al = await alertas()
confere('total menor que o pago e caixinha desmarcada: bloqueia, explica e NÃO salva (sem lembrete)', al.length === 1 && al[0].includes('menor do que já foi pago') && al[0].includes('Continua paga por inteiro') && conf.length === 0 && (await aberto()) && compraDe(b, 'cp1').quantidade == 100 && pagoDe(b, 'cp1') === 2000, (al[0] || '').slice(0, 80).replace(/\n/g, ' '))
await marcar('estCompContinuaPaga', true)
await salvar()
b = await banco()
confere('com a caixinha marcada: salva e o pagamento cai para R$ 1.800,00', !(await aberto()) && compraDe(b, 'cp1').quantidade == 90 && pagoDe(b, 'cp1') === 1800 && b.pags.filter((p) => p.compra_id === 'cp1').length === 1, String(pagoDe(b, 'cp1')))

// ── 6) Pagamento parcial (cp3: total 1.500, pago 500, vence hoje) ──
await novaPagina()
await abrirEdicao('cp3')
confere('parcial: situação "Já pago R$ 500,00 · Falta R$ 1.000,00", sem caixinha, com vencimento preenchido', (await texto('estEdicaoPago')).includes('500,00') && (await texto('estEdicaoPago')).includes('Falta R$ 1.000,00') && !(await visivel('estLinhaContinuaPaga')) && (await js(`document.getElementById('estCompVenc').value`)) !== '', await texto('estEdicaoPago'))
await digitar('estCompQtd', '2')
await salvar()
b = await banco(); al = await alertas()
confere('total (300) menor que o já pago (500): bloqueia com mensagem SEM mencionar a caixinha', al.length === 1 && al[0].includes('menor do que já foi pago') && !al[0].includes('Continua paga') && (await aberto()) && compraDe(b, 'cp3').quantidade == 10, (al[0] || '').slice(0, 90).replace(/\n/g, ' '))
await digitar('estCompQtd', '8'); await digitar('estCompVenc', '2026-12-01')
await salvar()
b = await banco()
confere('qtd 8 (total 1.200): pagamento intacto (500), Falta R$ 700,00, novo vencimento salvo', !(await aberto()) && compraDe(b, 'cp3').quantidade == 8 && pagoDe(b, 'cp3') === 500 && compraDe(b, 'cp3').vencimento === '2026-12-01' && (await linhaCompra('cp3')).includes('Falta R$ 700,00'), await linhaCompra('cp3'))

// ── 7) Vários pagamentos: reduz a partir do mais recente ──
await novaPagina()
await js(`(async () => {
  const { supabase } = await import('/js/supabase.js')
  await supabase.from('compras_estoque').insert({ id: 'cpx', user_id: 'u1', produto_id: 'p1', fornecedor_id: 'f1', quantidade: 10, custo_unitario: 100, data_compra: '2026-10-03', vencimento: null })
  await supabase.from('pagamentos_compra').insert({ user_id: 'u1', compra_id: 'cpx', valor: 300, data_pagamento: '2026-10-03' })
  await supabase.from('pagamentos_compra').insert({ user_id: 'u1', compra_id: 'cpx', valor: 700, data_pagamento: '2026-10-08' })
  return 1
})()`)
// A lista só atualiza após uma gravação: uma edição inofensiva no cp2 recarrega tudo
await abrirEdicao('cp2'); await digitar('estCompObs', 'x'); await salvar()
confere('compra de teste com 2 pagamentos (300 + 700) aparece na lista', !!(await linhaCompra('cpx')), await linhaCompra('cpx'))
await abrirEdicao('cpx'); await digitar('estCompCusto', '50'); await marcar('estCompContinuaPaga', true)  // total 500
await salvar()
b = await banco()
let ps = b.pags.filter((p) => p.compra_id === 'cpx').map((p) => Number(p.valor)).sort((x, y) => x - y)
confere('total 500: o pagamento mais recente (700) cai para 200; o antigo (300) fica; soma = 500', JSON.stringify(ps) === '[200,300]', JSON.stringify(ps))
await abrirEdicao('cpx'); await digitar('estCompCusto', '20'); await marcar('estCompContinuaPaga', true)  // total 200
await salvar()
b = await banco()
ps = b.pags.filter((p) => p.compra_id === 'cpx').map((p) => Number(p.valor)).sort((x, y) => x - y)
confere('total 200: o pagamento mais recente (200) sai e o antigo (300) cai para 200; fica 1 pagamento, soma = 200', pagoDe(b, 'cpx') === 200 && ps.length === 1, JSON.stringify(ps))

// ── 8) Compra sem nenhum pagamento (a pagar): edita valores, sem caixinha ──
await novaPagina()
await js(`(async () => { const { supabase } = await import('/js/supabase.js'); await supabase.from('compras_estoque').insert({ id: 'cpy', user_id: 'u1', produto_id: 'p2', fornecedor_id: 'f1', quantidade: 5, custo_unitario: 100, data_compra: '2026-10-10', vencimento: null }); return 1 })()`)
await abrirEdicao('cp2'); await digitar('estCompObs', 'y'); await salvar()   // só para recarregar a lista
await abrirEdicao('cpy')
confere('sem pagamentos: "Já pago R$ 0,00 · Falta R$ 500,00", sem caixinha, com vencimento', (await texto('estEdicaoPago')).includes('Falta R$ 500,00') && !(await visivel('estLinhaContinuaPaga')) && (await visivel('estCampoVenc')), await texto('estEdicaoPago'))
await digitar('estCompQtd', '6'); await digitar('estCompVenc', '2026-11-20')
await salvar()
b = await banco()
confere('sem pagamentos: salvou 6 × 100, Falta R$ 600,00, vencimento 20/11, nenhum pagamento criado', compraDe(b, 'cpy').quantidade == 6 && compraDe(b, 'cpy').vencimento === '2026-11-20' && pagoDe(b, 'cpy') === 0 && (await linhaCompra('cpy')).includes('A pagar R$ 600,00'), await linhaCompra('cpy'))

// ── 9) Trocar de produto: estoque negativo pergunta e deixa salvar ──
await novaPagina()
const antes = await estoqueDe('Areia')
await abrirEdicao('cp1')
await js(`(() => { const s = document.getElementById('estCompProduto'); s.value = 'p2'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1 })()`)
confere('trocar o produto na edição NÃO apaga a quantidade e o custo digitados', (await js(`document.getElementById('estCompQtd').value`)) === '100' && (await js(`document.getElementById('estCompCusto').value`)) === '20')
await js(`__resp.push(false); 1`); await salvar()
conf = await confirmacoes(); b = await banco()
confere('aviso de estoque negativo cita o produto e o saldo; Cancelar não salva', conf.length === 1 && conf[0].includes('Areia') && conf[0].includes('-35') && compraDe(b, 'cp1').produto_id === 'p1', (conf[0] || '').slice(0, 120).replace(/\n/g, ' '))
await js(`__resp.push(true); 1`); await salvar()
b = await banco()
confere('"Salvar mesmo assim": compra passou para a Ração', !(await aberto()) && compraDe(b, 'cp1').produto_id === 'p2', `antes: ${antes}`)
confere('a lista de produtos mostra a areia negativa (−35) e a ração com +100', ((await estoqueDe('Areia')) || '').includes('-35') && ((await estoqueDe('Ração')) || '').includes('127'), `${await estoqueDe('Areia')} | ${await estoqueDe('Ração')}`)

// ── 10) Edição que não piora o estoque não pergunta ──
await novaPagina()
await abrirEdicao('cp1'); await digitar('estCompQtd', '150'); await marcar('estCompContinuaPaga', true)
await salvar()
confere('aumentar a quantidade: sem pergunta de estoque', (await confirmacoes()).length === 0 && !(await aberto()))

// ── 11) "Atualizar o custo do produto" ──
await novaPagina()
await abrirEdicao('cp2'); await digitar('estCompCusto', '160'); await marcar('estCompContinuaPaga', true); await marcar('estCompAtualizaCusto', true)
await salvar()
b = await banco()
confere('marcado: o custo da Ração passou para 160', Number(b.produtos.find((p) => p.id === 'p2').preco_custo) === 160)
await novaPagina()
await abrirEdicao('cp2'); await digitar('estCompCusto', '155'); await marcar('estCompContinuaPaga', true)
await salvar()
b = await banco()
confere('desmarcado (padrão): o custo do produto não mudou', Number(b.produtos.find((p) => p.id === 'p2').preco_custo) === 150)

// ── 12) Falhas ──
await novaPagina()
await js(`(async () => { const { supabase } = await import('/js/supabase.js'); const o = supabase.from; supabase.from = (t) => { const q = o(t); if (t === 'compras_estoque') q.update = () => ({ eq: async () => ({ error: { code: '42501', message: 'permission denied' } }) }); return q }; window.__restaura = () => { supabase.from = o }; return 1 })()`)
await abrirEdicao('cp1'); await digitar('estCompQtd', '110'); await marcar('estCompContinuaPaga', true)
await salvar()
b = await banco(); al = await alertas()
confere('falha ao gravar a compra: nada muda (compra e pagamento intactos) e avisa', compraDe(b, 'cp1').quantidade == 100 && pagoDe(b, 'cp1') === 2000 && al.length === 1 && (await aberto()))
await js(`__restaura(); 1`)
await js(`(async () => { const { supabase } = await import('/js/supabase.js'); const o = supabase.from; supabase.from = (t) => { const q = o(t); if (t === 'pagamentos_compra') q.insert = async () => ({ error: { code: '42501', message: 'permission denied' } }); return q }; return 1 })()`)
await js(`__alertas.length = 0; 1`)
await salvar()
b = await banco(); al = await alertas()
confere('falha só no ajuste do pagamento: compra alterada e aviso diz o que faltou', compraDe(b, 'cp1').quantidade == 110 && pagoDe(b, 'cp1') === 2000 && al.length === 1 && al[0].includes('não consegui ajustar o pagamento'), (al[0] || '').slice(0, 100).replace(/\n/g, ' '))

// ── 13) Registrar compra continua igual (regressão) ──
await novaPagina()
await abrirEdicao('cp1')
await js(`document.querySelector('#estModalCompra [data-fechar]').click(); 1`)
await js(`document.getElementById('estBtnNovaCompra').click(); 1`); await sleep(400)
confere('"+ Registrar compra" volta ao modo normal (título, botão, "Já paguei", sem situação)', (await texto('estCompTitulo')) === 'Registrar compra' && (await js(`document.getElementById('estBtnSalvarCompra').textContent`)) === 'Salvar compra' && (await visivel('estLinhaPago')) && !(await visivel('estEdicaoPago')) && (await js(`document.getElementById('estCompAtualizaCusto').checked`)) === true && (await js(`document.getElementById('estCompQtd').value`)) === '')
await digitar('estCompQtd', '4'); await digitar('estCompCusto', '25')
await salvar()
b = await banco()
const nova = b.compras.find((c) => !['cp1', 'cp2', 'cp3'].includes(c.id))
confere('registrar compra paga: cria a compra e o pagamento do total (R$ 100,00)', !!nova && nova.quantidade == 4 && pagoDe(b, nova.id) === 100, nova ? `${nova.quantidade} × ${nova.custo_unitario}` : 'sem compra nova')

// ── 14) Celular ──
await novaPagina()
await cmd('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 2, mobile: true })
await ir(`${base}/pages/empresas`)
await js(`window.__confirms = []; window.__alertas = []; window.confirm = () => true; window.alert = () => {}; 1`)
await abrirEdicao('cp1'); await digitar('estCompQtd', '130')
confere('celular: janela de edição sem rolagem lateral', (await aberto()) && (await js(`document.documentElement.scrollWidth <= window.innerWidth + 1`)), String(await js(`document.documentElement.scrollWidth`)))
await cmd('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(join(saida, 'editar-compra-celular.png'), Buffer.from(s.result.data, 'base64')))

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
try { const v = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).json(); const bb = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => bb.addEventListener('open', r)); bb.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch {}
await sleep(1200); proc.kill(); process.exit(falhas === 0 ? 0 : 1)
