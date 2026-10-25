// Teste do "Editar venda" (lista "Vendas de produtos do mês") + aviso ao excluir compra. Banco em memória, cenário "guia".
// Uso: node cdp-editar-venda-completo.mjs <url-base> <perfil> <pasta-png>
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { EDGE } from './suporte/navegador.mjs'
const [base, perfil, saida] = process.argv.slice(2)
const PORTA = 9355
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
const limpa = (s) => String(s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
await cmd('Page.enable'); await cmd('Runtime.enable')
await cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1000, deviceScaleFactor: 1, mobile: false })

// ── Auxiliares ──
const mocks = `window.__confirms = []; window.__alertas = []; window.__resp = []; window.confirm = (t) => { window.__confirms.push(t); return window.__resp.length ? window.__resp.shift() : true }; window.alert = (t) => window.__alertas.push(t); 1`

// Cria 5 vendas de teste (hoje) e recarrega a lista:
//  sL: ligada à visita vL, 2 × areia @26, paga por inteiro (52)
//  sO: solta, 2 × areia @26, paga por inteiro (52)
//  sP: solta, 1 × ração @210, parcial (100)
//  sU: solta, 3 × areia @26, sem pagamento
//  sM: solta, 10 × areia @10 = 100, dois pagamentos (30 em 01/10 e 70 em 05/10)
async function novaPagina() {
  await ir(`${base}/pages/visitas`)
  await js(mocks)
  await js(`(async () => {
    const { supabase } = await import('/js/supabase.js')
    const d = (() => { const h = new Date(); return h.getFullYear() + '-' + String(h.getMonth() + 1).padStart(2, '0') + '-' + String(h.getDate()).padStart(2, '0') })()
    const cli = (await supabase.from('clientes').select('id')).data[0].id
    const venda = async (idv, visita, itens, pags, venc = null) => {
      if (visita) await supabase.from('visitas').insert({ id: visita, user_id: 'u1', cliente_id: cli, data_visita: d, comprou: true, desconto_aplicado: 0, observacao: null })
      await supabase.from('vendas_estoque').insert({ id: idv, user_id: 'u1', cliente_id: cli, visita_id: visita, data_venda: d, observacao: null, prazo_dias: venc ? 10 : null, vencimento: venc })
      for (const [p, q, pr, c] of itens) await supabase.from('venda_estoque_itens').insert({ user_id: 'u1', venda_id: idv, produto_id: p, quantidade: q, preco_unitario: pr, custo_unitario: c })
      for (const [v, dt] of pags) await supabase.from('pagamentos_venda').insert({ user_id: 'u1', venda_id: idv, valor: v, data_pagamento: dt || d })
    }
    await venda('sL', 'vL', [['p1', 2, 26, 20]], [[52]])
    await venda('sO', null, [['p1', 2, 26, 20]], [[52]])
    await venda('sP', null, [['p2', 1, 210, 150]], [[100]], '2099-12-31')
    await venda('sU', null, [['p1', 3, 26, 20]], [])
    await venda('sM', null, [['p1', 10, 10, 20]], [[30, '2026-10-01'], [70, '2026-10-05']])
    document.getElementById('selectMes').dispatchEvent(new Event('change'))
    return 1
  })()`)
  await sleep(1600)
}
const banco = async () => JSON.parse(await js(`(async () => {
  const { supabase } = await import('/js/supabase.js')
  const q = async (t) => (await supabase.from(t).select('*')).data
  return JSON.stringify({ vendas: await q('vendas_estoque'), itens: await q('venda_estoque_itens'), pags: await q('pagamentos_venda'), produtos: await q('produtos'), compras: await q('compras_estoque') })
})()`))
const itensDe = (b, v) => b.itens.filter((i) => i.venda_id === v)
const pagoDe = (b, v) => Math.round(b.pags.filter((p) => p.venda_id === v).reduce((s, p) => s + Number(p.valor), 0) * 100) / 100
const vendaDe = (b, v) => b.vendas.find((x) => x.id === v)
const saldo = (b, pid) => Math.round((b.compras.filter((c) => c.produto_id === pid).reduce((s, c) => s + Number(c.quantidade), 0) - b.itens.filter((i) => i.produto_id === pid).reduce((s, i) => s + Number(i.quantidade), 0)) * 1000) / 1000
const aberto = () => js(`document.getElementById('estModalEditarVenda').classList.contains('aberto')`)
const visivel = (idEl) => js(`(() => { const e = document.getElementById('${idEl}'); return !!e && getComputedStyle(e).display !== 'none' })()`)
const texto = async (idEl) => limpa(await js(`document.getElementById('${idEl}').innerText`))
const editar = async (v) => { await js(`document.querySelector('[data-est-acao="editar-venda"][data-id="${v}"]').click(); 1`); await sleep(900) }
const digitar = async (seletor, valor) => { await js(`(() => { const e = document.querySelector(${JSON.stringify(seletor)}); e.value = ${JSON.stringify(String(valor))}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return 1 })()`); await sleep(150) }
const marcar = async (idEl, v) => { await js(`(() => { const e = document.getElementById('${idEl}'); e.checked = ${v}; e.dispatchEvent(new Event('change', { bubbles: true })); return 1 })()`); await sleep(150) }
const salvar = async () => { await js(`document.getElementById('estBtnSalvarEdVenda').click(); 1`); await sleep(1700) }
const confirmacoes = async () => JSON.parse(await js(`JSON.stringify(__confirms)`)).map(limpa)
const alertas = async () => JSON.parse(await js(`JSON.stringify(__alertas)`)).map(limpa)
const linhaVenda = (v) => js(`(() => { const b = document.querySelector('[data-est-acao="editar-venda"][data-id="${v}"]'); return b ? b.closest('tr').innerText.replace(/\\s+/g, ' ').trim() : null })()`)
const qtdLinha = (n = 0) => `#estEdLinhas .est-linha:nth-child(${n + 1}) .est-qtd`
const precoLinha = (n = 0) => `#estEdLinhas .est-linha:nth-child(${n + 1}) .est-preco`

await ir(`${base}/`); await js(`localStorage.setItem('seed', 'guia'); 1`)

// ── 1) Botão Editar na lista ──
await novaPagina()
let b = await banco()
const nBotoes = await js(`document.querySelectorAll('[data-est-acao="editar-venda"]').length`)
const nVendasMes = await js(`document.querySelectorAll('#estListaVendas tr').length`)
confere('cada venda da lista tem o botão Editar', nBotoes === nVendasMes && nBotoes >= 5, `${nBotoes} botões / ${nVendasMes} linhas`)

// ── 2) Venda SOLTA paga por inteiro: janela preenchida ──
await editar('sO')
confere('janela abre com cliente, "sem visita ligada" e data editável', (await aberto()) && (await texto('estEdCabecalho')).includes('sem visita ligada') && (await visivel('estEdCampoData')), await texto('estEdCabecalho'))
confere('linha preenchida: 1 linha, qtd 2, preço 26', (await js(`document.querySelectorAll('#estEdLinhas .est-linha').length`)) === 1 && (await js(`document.querySelector('${qtdLinha(0)}').value`)) === '2' && (await js(`document.querySelector('${precoLinha(0)}').value`)) === '26')
confere('situação: "Já recebido R$ 52,00 · Paga por inteiro"; caixinha escondida', (await texto('estEdSituacao')).includes('52,00') && (await texto('estEdSituacao')).includes('Paga por inteiro') && !(await visivel('estEdLinhaContinua')), await texto('estEdSituacao'))
const infoLinha = limpa(await js(`document.querySelector('#estEdLinhas .est-linha-info').innerText`))
const saldoAreia = saldo(b, 'p1')
confere('info da linha mostra o estoque disponível (saldo + as 2 unidades desta venda)', infoLinha.includes(`Em estoque: ${saldoAreia + 2}`) || infoLinha.includes(`Em estoque: ${(saldoAreia + 2).toLocaleString('pt-BR')}`), `${infoLinha} | saldo banco ${saldoAreia}`)
await cmd('Page.captureScreenshot', { format: 'png', clip: { x: 150, y: 0, width: 800, height: 760, scale: 1 } }).then((s) => writeFileSync(join(saida, 'editar-venda-janela.png'), Buffer.from(s.result.data, 'base64')))

// ── 3) O CASO DO LUCAS: 2 -> 1 (total 26 < 52 recebidos) ──
await digitar(qtdLinha(0), 1)
confere('com qtd 1: caixinha "Continua paga por inteiro" aparece, desmarcada', (await visivel('estEdLinhaContinua')) && (await js(`document.getElementById('estEdContinuaPaga').checked`)) === false)
confere('com a caixinha disponível, o texto "Recebido a mais" aponta para ela', (await texto('estEdSituacao')).includes('Recebido a mais') && (await texto('estEdSituacao')).includes('ou marque'), await texto('estEdSituacao'))
await salvar()
b = await banco()
let al = await alertas()
confere('sem a caixinha: bloqueia, explica e NÃO salva', al.length === 1 && al[0].includes('menor do que já foi recebido') && al[0].includes('Continua paga por inteiro') && (await aberto()) && Number(itensDe(b, 'sO')[0].quantidade) === 2 && pagoDe(b, 'sO') === 52, al[0]?.slice(0, 90))
await marcar('estEdContinuaPaga', true)
confere('marcada: "Já recebido R$ 26,00 · Paga por inteiro"', (await texto('estEdSituacao')).includes('26,00') && (await texto('estEdSituacao')).includes('Paga por inteiro'), await texto('estEdSituacao'))
const saldoAntes = saldo(b, 'p1')
await salvar()
b = await banco()
confere('salvou: venda com 1 unidade (só 1 item), custo 20 mantido', !(await aberto()) && itensDe(b, 'sO').length === 1 && Number(itensDe(b, 'sO')[0].quantidade) === 1 && Number(itensDe(b, 'sO')[0].custo_unitario) === 20)
confere('pagamento ajustado para R$ 26,00 (era um só de 52)', pagoDe(b, 'sO') === 26 && b.pags.filter((p) => p.venda_id === 'sO').length === 1, String(pagoDe(b, 'sO')))
confere('O ESTOQUE VOLTOU: +1 unidade de areia', saldo(b, 'p1') === saldoAntes + 1, `${saldoAntes} -> ${saldo(b, 'p1')}`)
confere('a lista mostra a venda paga com 1 unidade', (await linhaVenda('sO')).includes('× 1') && (await linhaVenda('sO')).includes('Pago'), await linhaVenda('sO'))

// ── 4) Venda LIGADA a visita ──
await novaPagina()
await editar('sL')
confere('ligada a visita: data escondida e aviso no cabeçalho', !(await visivel('estEdCampoData')) && (await texto('estEdCabecalho')).includes('ligada a uma visita'), await texto('estEdCabecalho'))
await digitar(qtdLinha(0), 1); await marcar('estEdContinuaPaga', true)
await salvar()
b = await banco()
confere('ligada a visita: 2 -> 1 salvo, continua ligada, custo mantido, pagamento 26', Number(itensDe(b, 'sL')[0].quantidade) === 1 && vendaDe(b, 'sL').visita_id === 'vL' && Number(itensDe(b, 'sL')[0].custo_unitario) === 20 && pagoDe(b, 'sL') === 26)
// a visita abre com o valor novo
await js(`document.querySelector('.btn-editar[data-id="vL"]').click(); 1`); await sleep(2000)
confere('ao abrir a visita, o bloco de produtos já mostra a quantidade 1', (await js(`document.querySelector('#estListaLinhas .est-qtd')?.value`)) === '1')
await js(`document.querySelector('#modalOverlay .modal-fechar, #btnCancelar')?.click(); 1`)

// ── 5) Estava paga, total SOBE, caixinha desmarcada: lembrete ──
await novaPagina()
await editar('sO'); await digitar(qtdLinha(0), 3)
confere('total subiu: mostra Falta R$ 26,00 e o vencimento', (await texto('estEdSituacao')).includes('Falta R$ 26,00') && (await visivel('estEdCampoVenc')), await texto('estEdSituacao'))
await js(`__resp.push(false); 1`)
await salvar()
let conf = await confirmacoes(); b = await banco()
confere('lembrete aparece; Cancelar não salva e a janela continua aberta', conf.length === 1 && conf[0].includes('Continua paga por inteiro') && conf[0].includes('Falta R$ 26,00') && (await aberto()) && Number(itensDe(b, 'sO')[0].quantidade) === 2)
await js(`__resp.push(true); 1`)
await salvar()
b = await banco()
confere('"Salvar mesmo assim": qtd 3, pagamento intacto (52), lista mostra "Falta R$ 26,00"', Number(itensDe(b, 'sO')[0].quantidade) === 3 && pagoDe(b, 'sO') === 52 && (await linhaVenda('sO')).includes('Falta R$ 26,00'), await linhaVenda('sO'))

// ── 6) Total sobe com a caixinha marcada ──
await novaPagina()
await editar('sO'); await digitar(qtdLinha(0), 3); await marcar('estEdContinuaPaga', true)
await salvar()
b = await banco()
confere('caixinha marcada + total maior: entra pagamento da diferença (soma 78), sem lembrete', (await confirmacoes()).length === 0 && pagoDe(b, 'sO') === 78 && (await linhaVenda('sO')).includes('Pago'), String(pagoDe(b, 'sO')))

// ── 7) Pagamento parcial ──
await novaPagina()
await editar('sP')
confere('parcial: "Já recebido R$ 100,00 · Falta R$ 110,00", sem caixinha, vencimento preenchido', (await texto('estEdSituacao')).includes('100,00') && (await texto('estEdSituacao')).includes('Falta R$ 110,00') && !(await visivel('estEdLinhaContinua')) && (await js(`document.getElementById('estEdVenc').value`)) === '2099-12-31', await texto('estEdSituacao'))
await digitar(precoLinha(0), 50); await salvar()
b = await banco(); al = await alertas()
confere('total (50) menor que o recebido (100): bloqueia SEM citar a caixinha', al.length === 1 && al[0].includes('menor do que já foi recebido') && !al[0].includes('Continua paga') && (await aberto()) && Number(itensDe(b, 'sP')[0].preco_unitario) === 210, al[0]?.slice(0, 80))
await digitar(precoLinha(0), 200); await salvar()
b = await banco()
confere('preço 200: pagamento intacto (100) e Falta R$ 100,00', Number(itensDe(b, 'sP')[0].preco_unitario) === 200 && pagoDe(b, 'sP') === 100 && (await linhaVenda('sP')).includes('Falta R$ 100,00'), await linhaVenda('sP'))

// ── 8) Sem nenhum pagamento ──
await novaPagina()
await editar('sU')
confere('sem pagamentos: "Já recebido R$ 0,00 · Falta R$ 78,00", sem caixinha', (await texto('estEdSituacao')).includes('Falta R$ 78,00') && !(await visivel('estEdLinhaContinua')), await texto('estEdSituacao'))
await digitar(qtdLinha(0), 5); await digitar('#estEdVenc', '2026-11-20')
await salvar()
b = await banco()
confere('qtd 5 e vencimento 20/11 salvos; nenhum pagamento criado; lista "A pagar R$ 130,00"', Number(itensDe(b, 'sU')[0].quantidade) === 5 && vendaDe(b, 'sU').vencimento === '2026-11-20' && pagoDe(b, 'sU') === 0 && (await linhaVenda('sU')).includes('A pagar R$ 130,00'), await linhaVenda('sU'))

// ── 9) Vários pagamentos: reduz a partir do mais recente ──
await novaPagina()
await editar('sM'); await digitar(precoLinha(0), 5); await marcar('estEdContinuaPaga', true)   // total 50
await salvar()
b = await banco()
let ps = b.pags.filter((p) => p.venda_id === 'sM').map((p) => Number(p.valor)).sort((x, y) => x - y)
confere('total 50: o pagamento mais recente (70) cai para 20; o antigo (30) fica', JSON.stringify(ps) === '[20,30]', JSON.stringify(ps))
await editar('sM'); await digitar(precoLinha(0), 2); await marcar('estEdContinuaPaga', true)   // total 20
await salvar()
b = await banco()
ps = b.pags.filter((p) => p.venda_id === 'sM').map((p) => Number(p.valor))
confere('total 20: o de 20 sai, o de 30 cai para 20; sobra 1 pagamento (soma 20)', ps.length === 1 && pagoDe(b, 'sM') === 20, JSON.stringify(ps))

// ── 10) Trocar produto / acrescentar / custo antigo preservado ──
await novaPagina()
await js(`(async () => { const { supabase } = await import('/js/supabase.js'); await supabase.from('produtos').update({ preco_custo: 99 }).eq('id', 'p1'); return 1 })()`)
await editar('sO')
await js(`document.getElementById('estEdAddProduto').click(); 1`); await sleep(300)
await js(`(() => { const s = document.querySelector('#estEdLinhas .est-linha:nth-child(2) .est-produto'); s.value = 'p2'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1 })()`)
confere('escolher o produto sugere o preço de venda dele (210)', (await js(`document.querySelector('${precoLinha(1)}').value`)) === '210')
await digitar(qtdLinha(1), 1); await marcar('estEdContinuaPaga', true)
await salvar()
b = await banco()
const its = itensDe(b, 'sO')
const lAreia = its.find((i) => i.produto_id === 'p1'); const lRacao = its.find((i) => i.produto_id === 'p2')
confere('linha antiga mantém o custo 20 (mesmo com o custo do produto em 99); produto novo usa o custo de hoje (150)', its.length === 2 && Number(lAreia.custo_unitario) === 20 && Number(lRacao.custo_unitario) === 150, its.map((i) => `${i.produto_id}:${i.custo_unitario}`).join(' '))
confere('total novo (52 + 210 = 262) todo pago (continua paga marcada)', pagoDe(b, 'sO') === 262, String(pagoDe(b, 'sO')))

// ── 11) Validações ──
await novaPagina()
await editar('sU')
await js(`document.querySelector('#estEdLinhas .est-btn-remover').click(); 1`); await sleep(200)
await salvar()
al = await alertas(); b = await banco()
confere('remover todas as linhas: avisa "pelo menos um produto" e não salva', al.length === 1 && al[0].includes('pelo menos um produto') && itensDe(b, 'sU').length === 1)
await js(`document.getElementById('estEdAddProduto').click(); 1`); await sleep(200)
await js(`__alertas.length = 0; 1`)
await salvar()
al = await alertas()
confere('linha em branco adicionada sem preencher: ignorada, ainda "pelo menos um produto"', al.length === 1 && al[0].includes('pelo menos um produto'))
await js(`(() => { const s = document.querySelector('#estEdLinhas .est-linha .est-produto'); s.value = 'p1'; s.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('#estEdLinhas .est-linha .est-preco').value = ''; return 1 })()`)
await digitar(qtdLinha(0), 2); await js(`__alertas.length = 0; 1`)
await js(`document.querySelector('${precoLinha(0)}').value = ''; 1`)
await salvar()
al = await alertas()
confere('preço em branco: pede o preço', al.length === 1 && al[0].includes('Informe o preço'), al[0])
await js(`document.querySelector('#estModalEditarVenda [data-fechar]').click(); 1`)
confere('Cancelar fecha a janela sem mexer em nada', !(await aberto()))

// ── 12) Estoque negativo: pergunta e deixa salvar ──
await novaPagina()
await editar('sO'); await digitar(qtdLinha(0), 500); await marcar('estEdContinuaPaga', true)
await js(`__resp.push(false); 1`); await salvar()
conf = await confirmacoes(); b = await banco()
confere('aviso de estoque negativo cita o produto; Cancelar não salva', conf.length === 1 && conf[0].includes('Areia') && conf[0].includes('ficará com -') && Number(itensDe(b, 'sO')[0].quantidade) === 2, conf[0]?.slice(0, 110))
await js(`__resp.push(true); 1`); await salvar()
b = await banco()
confere('"Salvar mesmo assim": venda com 500', Number(itensDe(b, 'sO')[0].quantidade) === 500 && saldo(b, 'p1') < 0, `saldo ${saldo(b, 'p1')}`)
await novaPagina()
await editar('sO'); await digitar(qtdLinha(0), 1); await marcar('estEdContinuaPaga', true); await js(`__confirms.length = 0; 1`)
await salvar()
confere('diminuir a quantidade nunca pergunta de estoque', (await confirmacoes()).length === 0)

// ── 13) Data da venda solta ──
await novaPagina()
await editar('sU'); await digitar('#estEdData', '2026-09-15'); await salvar()
b = await banco()
confere('venda solta: a data muda no banco e a venda sai da lista deste mês', vendaDe(b, 'sU').data_venda === '2026-09-15' && (await linhaVenda('sU')) === null)

// ── 13b) Brinde (preço 0, sem pagamento): a caixinha não faz sentido ──
await novaPagina()
await js(`(async () => {
  const { supabase } = await import('/js/supabase.js')
  const d = new Date()
  const dia = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  const cli = (await supabase.from('clientes').select('id')).data[0].id
  await supabase.from('vendas_estoque').insert({ id: 'sB', user_id: 'u1', cliente_id: cli, visita_id: null, data_venda: dia, observacao: null })
  await supabase.from('venda_estoque_itens').insert({ user_id: 'u1', venda_id: 'sB', produto_id: 'p1', quantidade: 1, preco_unitario: 0, custo_unitario: 20 })
  document.getElementById('selectMes').dispatchEvent(new Event('change'))
  return 1
})()`)
await sleep(1200)
await editar('sB'); await digitar(precoLinha(0), 10)
confere('brinde sem pagamento que ganhou preço: NÃO mostra a caixinha; fica Falta R$ 10,00', !(await visivel('estEdLinhaContinua')) && (await texto('estEdSituacao')).includes('Falta R$ 10,00'), await texto('estEdSituacao'))
await salvar()
b = await banco()
confere('salvou com preço 10 e nenhum pagamento criado', Number(itensDe(b, 'sB')[0].preco_unitario) === 10 && pagoDe(b, 'sB') === 0)

// ── 14) Falhas ──
await novaPagina()
await js(`(async () => { const { supabase } = await import('/js/supabase.js'); const o = supabase.from; supabase.from = (t) => { const q = o(t); if (t === 'venda_estoque_itens') q.insert = async () => ({ error: { code: '42501', message: 'permission denied' } }); return q }; window.__restaura = () => { supabase.from = o }; return 1 })()`)
await editar('sO'); await digitar(qtdLinha(0), 1); await marcar('estEdContinuaPaga', true)
await salvar()
b = await banco(); al = await alertas()
confere('falha ao gravar os itens novos: nada muda (venda e pagamento intactos) e avisa "Nada foi alterado"', Number(itensDe(b, 'sO')[0].quantidade) === 2 && itensDe(b, 'sO').length === 1 && pagoDe(b, 'sO') === 52 && al.length === 1 && al[0].includes('Nada foi alterado') && (await aberto()))
await js(`__restaura(); 1`)
await js(`(async () => { const { supabase } = await import('/js/supabase.js'); const o = supabase.from; supabase.from = (t) => { const q = o(t); if (t === 'pagamentos_venda') { q.insert = async () => ({ error: { code: '42501', message: 'x' } }); q.update = () => ({ eq: async () => ({ error: { code: '42501', message: 'x' } }) }); q.delete = () => ({ eq: async () => ({ error: { code: '42501', message: 'x' } }) }) } return q }; return 1 })()`)
await js(`__alertas.length = 0; 1`)
await salvar()
b = await banco(); al = await alertas()
confere('falha só no ajuste do pagamento: produtos salvos e o aviso diz o que faltou', Number(itensDe(b, 'sO')[0].quantidade) === 1 && al.length === 1 && al[0].includes('não consegui ajustar o pagamento'), al[0]?.slice(0, 100))

// ── 15) Venda apagada enquanto a janela estava aberta ──
await novaPagina()
await editar('sU'); await digitar(qtdLinha(0), 4)
await js(`(async () => { const { supabase } = await import('/js/supabase.js'); await supabase.from('vendas_estoque').delete().eq('id', 'sU'); return 1 })()`)
await salvar()
al = await alertas()
confere('venda apagada por fora: avisa que não existe mais, fecha a janela e atualiza', al.length === 1 && al[0].includes('não existe mais') && !(await aberto()), al[0]?.slice(0, 80))

// ── 16) Aviso ao EXCLUIR COMPRA (página Empresas) ──
await ir(`${base}/pages/empresas`)
await js(mocks)
await js(`document.querySelector('[data-acao="excluir-compra"][data-id="cp1"]').click(); 1`); await sleep(500)
conf = await confirmacoes()
confere('excluir a compra que deixaria a areia negativa: o aviso mostra o produto e o saldo', conf.length === 1 && conf[0].includes('Atenção') && conf[0].includes('Areia') && conf[0].includes('ficará em -35'), conf[0]?.slice(0, 200))
await ir(`${base}/pages/empresas`)
await js(mocks); await js(`__resp.push(false); 1`)
await js(`document.querySelector('[data-acao="excluir-compra"][data-id="cp3"]').click(); 1`); await sleep(500)
conf = await confirmacoes()
confere('excluir uma compra que mantém o estoque positivo: sem aviso extra', conf.length === 1 && !conf[0].includes('Atenção'), conf[0]?.slice(0, 120))

// ── 17) Celular ──
await novaPagina()
await cmd('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 2, mobile: true })
await ir(`${base}/pages/visitas`)
await js(mocks)
await js(`(async () => {
  const { supabase } = await import('/js/supabase.js')
  const d = (() => { const h = new Date(); return h.getFullYear() + '-' + String(h.getMonth() + 1).padStart(2, '0') + '-' + String(h.getDate()).padStart(2, '0') })()
  const cli = (await supabase.from('clientes').select('id')).data[0].id
  await supabase.from('vendas_estoque').insert({ id: 'sC', user_id: 'u1', cliente_id: cli, visita_id: null, data_venda: d, observacao: null })
  await supabase.from('venda_estoque_itens').insert({ user_id: 'u1', venda_id: 'sC', produto_id: 'p1', quantidade: 2, preco_unitario: 26, custo_unitario: 20 })
  await supabase.from('pagamentos_venda').insert({ user_id: 'u1', venda_id: 'sC', valor: 52, data_pagamento: d })
  document.getElementById('selectMes').dispatchEvent(new Event('change')); return 1 })()`)
await sleep(1500)
await editar('sC'); await digitar(qtdLinha(0), 1)
confere('celular: janela aberta e sem rolagem lateral', (await aberto()) && (await js(`document.documentElement.scrollWidth <= window.innerWidth + 1`)), String(await js(`document.documentElement.scrollWidth`)))
await cmd('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(join(saida, 'editar-venda-celular.png'), Buffer.from(s.result.data, 'base64')))

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
try { const v = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).json(); const bb = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => bb.addEventListener('open', r)); bb.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch {}
await sleep(1200); proc.kill(); process.exit(falhas === 0 ? 0 : 1)
