// Teste da exclusão de visita com venda de estoque (banco em memória). Uso: node cdp-excluir-visita.mjs <url-base> <perfil> <pasta-png>
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { EDGE } from './suporte/navegador.mjs'
const [base, perfil, saida] = process.argv.slice(2)
const PORTA = 9347
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

const lerBanco = async () => JSON.parse(await js(`(async () => {
  const { supabase } = await import('/js/supabase.js')
  const q = async (t) => (await supabase.from(t).select('*')).data
  return JSON.stringify({ visitas: await q('visitas'), vendas: await q('vendas_estoque'), itens: await q('venda_estoque_itens'), pags: await q('pagamentos_venda'), itensEmp: await q('itens_venda') })
})()`))

// Cria 3 visitas hoje: vt1 (venda s/ pagamento), vt2 (venda com pagamento parcial), vt3 (só empresa, sem venda de estoque)
async function prepararCenario() {
  await ir(`${base}/pages/visitas`)
  await js(`window.__confirms = []; window.__alertas = []; window.confirm = (t) => { window.__confirms.push(t); return true }; window.alert = (t) => window.__alertas.push(t); 1`)
  await js(`(async () => {
    const { supabase } = await import('/js/supabase.js')
    const hoje = new Date(); const d = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0') + '-' + String(hoje.getDate()).padStart(2, '0')
    const cli = (await supabase.from('clientes').select('id')).data
    const prod = (await supabase.from('produtos').select('id,nome')).data
    const nova = async (idv, cliente, comVenda, pago) => {
      await supabase.from('visitas').insert({ id: idv, user_id: 'u1', cliente_id: cliente, data_visita: d, comprou: true, desconto_aplicado: 0, observacao: null })
      if (!comVenda) { await supabase.from('itens_venda').insert({ user_id: 'u1', visita_id: idv, empresa_id: (await supabase.from('empresas').select('id')).data[0].id, valor: 100 }); return }
      const v = (await supabase.from('vendas_estoque').insert({ user_id: 'u1', cliente_id: cliente, visita_id: idv, data_venda: d, observacao: null, vencimento: null }).select().single()).data
      await supabase.from('venda_estoque_itens').insert({ user_id: 'u1', venda_id: v.id, produto_id: prod[0].id, quantidade: 2, preco_unitario: 26, custo_unitario: 20 })
      await supabase.from('venda_estoque_itens').insert({ user_id: 'u1', venda_id: v.id, produto_id: prod[1].id, quantidade: 1, preco_unitario: 210, custo_unitario: 150 })
      if (pago) await supabase.from('pagamentos_venda').insert({ user_id: 'u1', venda_id: v.id, valor: pago, data_pagamento: d })
    }
    await nova('vt1', cli[0].id, true, 0)
    await nova('vt2', cli[1].id, true, 100)
    await nova('vt3', cli[0].id, false, 0)
    document.getElementById('selectMes').dispatchEvent(new Event('change'))
    return 1
  })()`)
  await sleep(1500)
}
const clicarExcluirVisita = async (idv) => { await js(`document.querySelector('.btn-excluir[data-id="${idv}"]').click(); 1`); await sleep(700) }
const modalAberto = () => js(`document.getElementById('estModalExclusao').classList.contains('aberto')`)
const clicar = async (idb) => { await js(`document.getElementById('${idb}').click(); 1`); await sleep(1500) }

await cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false })
await ir(`${base}/`); await js(`localStorage.setItem('seed', 'guia'); 1`)

// ── A) Visita com venda: abre a janela com os dados ──
await prepararCenario()
let b = await lerBanco()
confere('cenário: 3 visitas de teste, 2 vendas de estoque ligadas', b.visitas.filter((v) => ['vt1', 'vt2', 'vt3'].includes(v.id)).length === 3 && b.vendas.filter((v) => v.visita_id === 'vt1' || v.visita_id === 'vt2').length === 2)
await clicarExcluirVisita('vt2')
confere('janela de exclusão abriu (visita com venda de estoque)', await modalAberto())
confere('não usou o confirm antigo', (await js(`__confirms.length`)) === 0)
const info = await js(`document.getElementById('estExcInfo').innerText`)
confere('mostra valor da venda (R$ 262,00) e o que já foi recebido (R$ 100,00)', info.includes('262,00') && info.includes('100,00'), info.replace(/\n+/g, ' | ').slice(0, 200))
confere('mostra os produtos', info.includes('× 2') && info.includes('× 1'))
await cmd('Page.captureScreenshot', { format: 'png', clip: { x: 250, y: 120, width: 600, height: 520, scale: 1 } }).then((s) => writeFileSync(join(saida, 'excluir-visita-janela.png'), Buffer.from(s.result.data, 'base64')))

// ── B) Cancelar e X: nada muda ──
await clicar('estExcCancelar')
b = await lerBanco()
confere('Cancelar: janela fechou e nada foi apagado', !(await modalAberto()) && b.visitas.some((v) => v.id === 'vt2') && b.vendas.some((v) => v.visita_id === 'vt2'))
await clicarExcluirVisita('vt2'); await clicar('estExcFechar')
b = await lerBanco()
confere('X: janela fechou e nada foi apagado', !(await modalAberto()) && b.visitas.some((v) => v.id === 'vt2'))

// ── C) Só a visita: a venda continua, "sem visita ligada" ──
await clicarExcluirVisita('vt2'); await clicar('estExcSo')
b = await lerBanco()
const vendaSolta = b.vendas.find((v) => v.cliente_id && !v.visita_id && b.itens.some((i) => i.venda_id === v.id && Number(i.quantidade) === 2 && i.produto_id) && b.pags.some((p) => p.venda_id === v.id))
confere('"Excluir só a visita": visita saiu, venda e pagamento continuam', !b.visitas.some((v) => v.id === 'vt2') && !!vendaSolta)
confere('a venda solta aparece na lista com "sem visita ligada"', await js(`document.getElementById('estListaVendas').innerText.includes('sem visita ligada')`))

// ── D) Visita e venda: tudo some, itens e pagamentos junto ──
await clicarExcluirVisita('vt1'); await clicar('estExcTudo')
b = await lerBanco()
const itensDaVt1 = b.itens.length
confere('"Excluir visita e a venda": visita e venda sumiram', !b.visitas.some((v) => v.id === 'vt1') && !b.vendas.some((v) => v.visita_id === 'vt1'))
confere('itens da venda apagada também sumiram (só restam os da venda solta)', b.itens.every((i) => b.vendas.some((v) => v.id === i.venda_id)), `itens=${itensDaVt1}`)
confere('venda de outra visita/solta continua intacta', !!vendaSolta && b.vendas.some((v) => v.id === vendaSolta.id))

// ── E) Visita sem venda de estoque: pergunta de sempre ──
await js(`window.__confirms = []; 1`)
await clicarExcluirVisita('vt3')
const confs = JSON.parse(await js(`JSON.stringify(__confirms)`))
b = await lerBanco()
confere('visita sem venda: usou o confirm de sempre (sem janela)', confs.length === 1 && confs[0].includes('Tem certeza') && !(await modalAberto()) && !b.visitas.some((v) => v.id === 'vt3'), JSON.stringify(confs).slice(0, 120))
confere('itens de empresas da visita saíram junto (cascata de sempre)', !b.itensEmp.some((i) => i.visita_id === 'vt3'))

// ── F) Falha ao apagar a venda: nada é apagado ──
await prepararCenario()
await js(`(async () => { const { supabase } = await import('/js/supabase.js'); const o = supabase.from; supabase.from = (t) => { const q = o(t); if (t === 'vendas_estoque') { const d = q.delete.bind(q); q.delete = () => ({ eq: async () => ({ error: { code: '42501', message: 'permission denied' } }) }) } return q }; window.__restaurar = () => { supabase.from = o }; return 1 })()`)
await js(`window.__alertas = []; 1`)
await clicarExcluirVisita('vt1'); await clicar('estExcTudo')
b = await lerBanco()
confere('falha na venda: visita NÃO foi excluída e avisou', b.visitas.some((v) => v.id === 'vt1') && (await js(`__alertas.length === 1 && __alertas[0].includes('A visita não foi excluída')`)), await js(`JSON.stringify(__alertas)`))
await js(`__restaurar(); 1`)

// ── G) Falha ao apagar a visita, depois que a venda saiu: mensagem clara ──
await js(`(async () => { const { supabase } = await import('/js/supabase.js'); const o = supabase.from; supabase.from = (t) => { const q = o(t); if (t === 'visitas') { q.delete = () => ({ eq: async () => ({ error: { code: '42501', message: 'permission denied' } }) }) } return q }; window.__restaurar2 = () => { supabase.from = o }; return 1 })()`)
await js(`window.__alertas = []; 1`)
await clicarExcluirVisita('vt1'); await clicar('estExcTudo')
b = await lerBanco()
confere('falha na visita: venda já saiu, visita ficou, mensagem explica', b.visitas.some((v) => v.id === 'vt1') && !b.vendas.some((v) => v.visita_id === 'vt1') && (await js(`__alertas.length === 1 && __alertas[0].includes('foi apagada, mas')`)), await js(`JSON.stringify(__alertas)`))
await js(`__restaurar2(); 1`)

// ── H) Celular: janela sem estourar ──
await cmd('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 2, mobile: true })
await prepararCenario()
await clicarExcluirVisita('vt2')
confere('celular: janela aberta e sem rolagem lateral', (await modalAberto()) && (await js(`document.documentElement.scrollWidth <= window.innerWidth + 1`)), String(await js(`document.documentElement.scrollWidth`)))
await cmd('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(join(saida, 'excluir-visita-celular.png'), Buffer.from(s.result.data, 'base64')))

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
try { const v = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).json(); const bb = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => bb.addEventListener('open', r)); bb.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch {}
await sleep(1200); proc.kill(); process.exit(falhas === 0 ? 0 : 1)
