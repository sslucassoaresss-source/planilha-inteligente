// Teste do calendário de Rotas com entregas (banco em memória). Uso: node cdp-calendario.mjs <url-base> <perfil> <pasta-png>
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { EDGE } from './suporte/navegador.mjs'
const [base, perfil, saida] = process.argv.slice(2)
const PORTA = 9343
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
const erros = []
await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('Log.enable')

await cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1000, deviceScaleFactor: 1, mobile: false })
await ir(`${base}/`)
await js(`localStorage.setItem('seed', 'guia'); 1`)
await ir(`${base}/pages/rotas`)
await js(`window.alert = () => {}; window.confirm = () => true; 1`)

const contaPills = () => js(`document.querySelectorAll('#calendarioMes .ent-cal-pill').length`)
const textos = () => js(`JSON.stringify([...document.querySelectorAll('#calendarioMes .ent-cal-pill')].map(p => ({ t: p.textContent.trim(), c: p.className, dia: p.closest('.calendario-dia').querySelector('.calendario-dia-numero').textContent })))`)

// 1) Visão Lista: o calendário está escondido, mas já deve ter os selos (observador)
await js(`document.getElementById('btnVisaoCalendario').click(); 1`)
await sleep(600)
confere('calendário aparece', await js(`getComputedStyle(document.getElementById('calendarioMes')).display !== 'none'`))
let n = await contaPills()
confere('1 selo (a entrega com dia; a "sem dia" não aparece)', n === 1, String(n))
console.log('   ', await textos())

// 2) Inserir uma atrasada (pendente, 3 dias atrás) e uma concluída (dia de hoje) e marcar o dia da "sem dia" -> recarrega
await js(`(async () => {
  const { supabase } = await import('/js/supabase.js')
  const uid = (await supabase.auth.getSession()).data.session.user.id
  const d = (delta) => { const x = new Date(); x.setDate(x.getDate() + delta); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0') }
  const cli = (await supabase.from('clientes').select('id')).data[0].id
  const prod = (await supabase.from('produtos').select('id')).data[0].id
  for (const [nome, dia, feita] of [['Atrasada teste', d(-3), false], ['Concluída teste', d(0), true]]) {
    const e = (await supabase.from('entregas').insert({ user_id: uid, nome, data_entrega: dia }).select().single()).data
    const p = (await supabase.from('entrega_paradas').insert({ user_id: uid, entrega_id: e.id, cliente_id: cli, ordem: 0, feita }).select().single()).data
    await supabase.from('entrega_itens').insert({ user_id: uid, parada_id: p.id, produto_id: prod, quantidade: 2 })
  }
  return 1
})()`)
const hoje = new Date(); const dia = (d) => { const x = new Date(hoje); x.setDate(x.getDate() + d); return x }
const mesmoMes = (d) => d.getMonth() === hoje.getMonth()
const alvoSemDia = dia(5)
const alvoStr = `${alvoSemDia.getFullYear()}-${String(alvoSemDia.getMonth() + 1).padStart(2, '0')}-${String(alvoSemDia.getDate()).padStart(2, '0')}`
await js(`(() => { const i = document.querySelector('[id^=entDia-]'); i.value = '${alvoStr}'; document.querySelector('[data-ent=marcar-dia]').click(); return 1 })()`)
await sleep(1200)
const lista = JSON.parse(await textos())
console.log('   ', JSON.stringify(lista))
const esperadas = [dia(2), alvoSemDia, dia(-3), dia(0)].filter(mesmoMes).length
confere(`selos no mês aberto (esperado ${esperadas})`, lista.length === esperadas, String(lista.length))
confere('atrasada em vermelho', lista.some((x) => x.t.includes('Atrasada teste') ? x.c.includes('ent-cal-atrasada') : true) && (lista.some((x) => x.t.includes('Atrasada teste')) || !mesmoMes(dia(-3))))
confere('concluída com ✓ e cinza', lista.some((x) => x.t.startsWith('✓') && x.c.includes('ent-cal-feita')))
confere('"Marcar dia" aparece no dia certo', !mesmoMes(alvoSemDia) || lista.some((x) => Number(x.dia) === alvoSemDia.getDate() && x.t.includes('Entrega de areia')))
await cmd('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(join(saida, 'calendario-desktop.png'), Buffer.from(s.result.data, 'base64')))

// 3) Clique no selo: abre o cartão, destaca, e NÃO abre o "atribuir rota ao dia"
await js(`document.getElementById('entSecao').open = false; 1`)
const modalAbertoAntes = await js(`[...document.querySelectorAll('.modal-overlay')].filter(m => getComputedStyle(m).display !== 'none' && getComputedStyle(m).visibility !== 'hidden' && m.offsetParent !== null).length`)
await js(`document.querySelector('#calendarioMes .ent-cal-pill').click(); 1`)
await sleep(500)
confere('clicar no selo abre a seção Entregas', await js(`document.getElementById('entSecao').open`))
confere('cartão recebe destaque', await js(`!!document.querySelector('.ent-card-destaque')`))
const modalAbertoDepois = await js(`[...document.querySelectorAll('.modal-overlay')].filter(m => getComputedStyle(m).display !== 'none' && getComputedStyle(m).visibility !== 'hidden' && m.offsetParent !== null).length`)
confere('não abriu janela de "atribuir rota"', modalAbertoDepois === modalAbertoAntes, `${modalAbertoAntes} → ${modalAbertoDepois}`)

// 4) Clique em dia vazio continua abrindo o atribuir (comportamento original)
await js(`(() => { const cel = [...document.querySelectorAll('#calendarioMes .calendario-dia:not(.vazio)')].find(c => !c.querySelector('.ent-cal-pill')); cel.click(); return 1 })()`)
await sleep(400)
const abriuAtribuir = await js(`[...document.querySelectorAll('.modal-overlay')].filter(m => m.offsetParent !== null || getComputedStyle(m).display !== 'none').length`)
confere('clicar em dia vazio ainda abre o "atribuir rota"', abriuAtribuir > modalAbertoAntes, `${modalAbertoAntes} → ${abriuAtribuir}`)
await js(`document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('aberto', 'ativo', 'open')); document.querySelectorAll('.modal-fechar').forEach(b => b.click()); 1`)

const mudarMes = (v) => js("(() => { const sel = document.getElementById('selectMes'); sel.value = '" + v + "'; sel.dispatchEvent(new Event('change')); return 1 })()")
// 5) Trocar de mês: selos mudam; voltar: voltam
const opcoes = JSON.parse(await js(`JSON.stringify([...document.getElementById('selectMes').options].map(o => o.value))`))
const atual = await js(`document.getElementById('selectMes').value`)
const proximo = opcoes[opcoes.indexOf(atual) - 1]
await mudarMes(proximo)
await sleep(1200)
const noProximo = await contaPills()
confere(`mês seguinte (${proximo}) sem selos fora do esperado`, noProximo === [dia(2), alvoSemDia, dia(-3), dia(0)].filter((d) => !mesmoMes(d)).length, String(noProximo))
await mudarMes(atual)
await sleep(1200)
confere('voltou ao mês atual com os mesmos selos', (await contaPills()) === esperadas, String(await contaPills()))

// 6) Duplicidade: forçar redesenho várias vezes não duplica
for (let i = 0; i < 3; i++) await js("document.getElementById('selectMes').dispatchEvent(new Event('change')); 1")
await sleep(1500)
confere('sem selos duplicados após 3 redesenhos', (await contaPills()) === esperadas, String(await contaPills()))

// 7) Celular
await cmd('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 2, mobile: true })
await ir(`${base}/pages/rotas`)
await js(`window.alert = () => {}; window.confirm = () => true; document.getElementById('btnVisaoCalendario').click(); 1`)
await sleep(900)
confere('celular: sem rolagem horizontal', await js(`document.documentElement.scrollWidth <= window.innerWidth + 1`), String(await js(`document.documentElement.scrollWidth`)))
const calBox = JSON.parse(await js(`(() => { const b = document.getElementById('calendarioMes').getBoundingClientRect(); return JSON.stringify({ x: b.left, y: b.top + scrollY, w: b.width, h: b.height }) })()`))
const sh = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: calBox.y - 10, width: 375, height: Math.min(calBox.h + 20, 700), scale: 1 } })
writeFileSync(join(saida, 'calendario-celular.png'), Buffer.from(sh.result.data, 'base64'))

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
try { const v = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).json(); const b = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => b.addEventListener('open', r)); b.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch {}
await sleep(1200); proc.kill(); process.exit(falhas === 0 ? 0 : 1)
