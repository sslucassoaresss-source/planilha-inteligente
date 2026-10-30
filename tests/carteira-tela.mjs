// Dashboard: "Na carteira" e "Pode retirar" usando os botões de verdade (Acertar, Pagar, Receber, + Retirada),
// a janela própria de pergunta, o 🔊 Ouvir, o aviso do pró-labore, os títulos sem maiúsculas e o Excel com a mesma conta.
// Cenário "guia": próxima meta = 200 × 20 + 50 × 150 = R$ 11.500; compra cp3 com R$ 1.000 a pagar; venda s4 com R$ 260 a receber;
// retirada r1 de R$ 100 em 10/10.
// Uso: node carteira-tela.mjs <url-base> <perfil> <pasta-capturas>
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EDGE } from './suporte/navegador.mjs'

const [base, perfil, capturas] = process.argv.slice(2)
const PORTA = 9357
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORTA}`, `--user-data-dir=${perfil}`, 'about:blank'], { stdio: 'ignore' })
let alvos = []
for (let i = 0; i < 60; i++) { try { alvos = await (await fetch(`http://127.0.0.1:${PORTA}/json`)).json(); if (alvos.some((a) => a.type === 'page')) break } catch {} await sleep(250) }
const ws = new WebSocket(alvos.find((a) => a.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const pend = new Map(); let carregou = false; const excecoes = []; const caixinhas = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return }
  if (m.method === 'Page.loadEventFired') carregou = true
  // Caixinha do navegador (alert/confirm) congela a página: fecha e anota (a carteira não deve abrir nenhuma)
  if (m.method === 'Page.javascriptDialogOpening') { caixinhas.push(m.params.message); ws.send(JSON.stringify({ id: 999000 + caixinhas.length, method: 'Page.handleJavaScriptDialog', params: { accept: false } })) }
  if (m.method === 'Runtime.exceptionThrown') excecoes.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0])
})
const cmd = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })
const avaliar = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value
await cmd('Page.enable'); await cmd('Runtime.enable')
await cmd('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false })
const ir = async (url) => { carregou = false; await cmd('Page.navigate', { url }); for (let i = 0; i < 100 && !carregou; i++) await sleep(200); await sleep(2200) }
const foto = async (nome) => { const s = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(join(capturas, nome + '.png'), Buffer.from(s.result.data, 'base64')) }

let falhas = 0
const confere = (nome, ok, extra = '') => { if (!ok) falhas++; console.log(`${ok ? '✓' : '✗ FALHOU'} ${nome}${extra ? ' → ' + extra : ''}`) }
const limpa = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const cards = async () => {
  const r = await avaliar(`({
    carteira: document.getElementById('estCarteira').textContent,
    subCarteira: document.getElementById('estSubCarteira').textContent,
    retirar: document.getElementById('estRetiravel').textContent,
    subRetirar: document.getElementById('estSubRetiravel').textContent,
    icone: document.getElementById('estIconeRetirar').textContent,
    cor: document.getElementById('estCardRetirar').classList.contains('est-card-falta') ? 'vermelho' : document.getElementById('estCardRetirar').classList.contains('est-card-ok') ? 'verde' : 'neutro',
  })`)
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, limpa(v)]))
}
// Janela de pergunta (js/pergunta.js): devolve o texto e responde
async function responderPergunta(sim) {
  const aberta = await avaliar(`!!document.querySelector('.pergunta-overlay.aberto')`)
  if (!aberta) return null
  const texto = limpa(await avaliar(`document.querySelector('.pergunta-overlay').innerText`))
  await avaliar(`document.querySelector('.pergunta-overlay ${sim ? '.pergunta-sim' : '.pergunta-nao'}').click()`)
  await sleep(700)
  return texto
}
async function acertar(valor) {
  await avaliar(`document.getElementById('estBtnAcertar').click()`); await sleep(200)
  await avaliar(`document.getElementById('estCartValor').value = '${valor}'; document.getElementById('estFormCarteira').requestSubmit()`); await sleep(700)
}
async function cobranca(tipo, idCobranca, valor) {
  await avaliar(`document.querySelector('[data-est-cob="pagar"][data-tipo="${tipo}"][data-id="${idCobranca}"]').click()`); await sleep(250)
  await avaliar(`document.getElementById('estPagValor').value = '${valor}'; document.getElementById('estFormPag').requestSubmit()`); await sleep(700)
}
async function retirar(valor, resposta = true) {
  await avaliar(`document.getElementById('estBtnRetirada').click()`); await sleep(200)
  await avaliar(`document.getElementById('estRetValor').value = '${valor}'; document.getElementById('estFormRetirada').requestSubmit()`); await sleep(350)
  const pergunta = await responderPergunta(resposta)
  await sleep(500)
  await avaliar(`document.getElementById('estModalRetirada').classList.remove('aberto')`)
  return pergunta
}
async function excluirRetirada(textoValor) {
  await avaliar(`document.getElementById('estBtnRetirada').click()`); await sleep(200)
  await avaliar(`[...document.querySelectorAll('#estListaRetiradas .est-retirada-linha')].find((l) => l.textContent.includes('${textoValor}')).querySelector('[data-est-retirada]').click()`); await sleep(300)
  const pergunta = await responderPergunta(true)
  await avaliar(`document.getElementById('estModalRetirada').classList.remove('aberto')`)
  return pergunta
}

await ir(`${base}/`)
await avaliar(`localStorage.setItem('seed', 'guia')`)
await ir(`${base}/pages/dashboard`)
// O que o 🔊 Ouvir diria: guarda o texto em vez de falar (no app de verdade, o celular fala)
await avaliar(`window.__falas = []; if (window.speechSynthesis) window.speechSynthesis.speak = (u) => window.__falas.push(u.text)`)

// ── Leitura mais fácil: títulos sem maiúsculas e ícone fixo em cada card do Estoque ──
const titulos = await avaliar(`[...document.querySelectorAll('.est-dash .card-label')].map((l) => ({ texto: l.textContent.trim(), caixa: getComputedStyle(l).textTransform }))`)
confere('títulos dos cards sem maiúsculas', titulos.every((t) => t.caixa === 'none'), JSON.stringify(titulos.map((t) => t.caixa)))
confere('ícone fixo em cada card: 💰 ✅ 📦 🎯', JSON.stringify(titulos.map((t) => [...t.texto][0])) === JSON.stringify(['💰', '✅', '📦', '🎯']), JSON.stringify(titulos.map((t) => t.texto)))

// ── Antes do primeiro acerto ──
let c = await cards()
confere('sem acerto: carteira "—" e o convite para acertar', c.carteira === '—' && /Toque em Acertar/.test(c.subCarteira), JSON.stringify(c))
confere('sem acerto: pode retirar "—"', c.retirar === '—' && /acerte a carteira/.test(c.subRetirar), JSON.stringify(c))
await avaliar(`document.getElementById('estBtnRetirada').click()`); await sleep(200)
confere('janela de retirada sem acerto pede para acertar primeiro', /Acerte a carteira primeiro/.test(limpa(await avaliar(`document.getElementById('estRetInfo').textContent`))))
await avaliar(`document.querySelector('#estModalRetirada [data-fechar]').click()`)
confere('sem acerto: aviso do pró-labore escondido', (await avaliar(`getComputedStyle(document.getElementById('estFaixaProLabore')).display`)) === 'none')
const temVoz = await avaliar(`'speechSynthesis' in window`)
if (temVoz) {
  await avaliar(`document.getElementById('estBtnOuvir').click()`); await sleep(100)
  confere('🔊 Ouvir sem acerto: explica o que fazer', /ainda não acertou a carteira/.test((await avaliar('window.__falas'))[0] || ''), JSON.stringify(await avaliar('window.__falas')))
}
await foto('carteira-sem-acerto')

// ── Acertar 12.000 (meta 11.500) → pode retirar 500, verde ──
await acertar('12000')
c = await cards()
confere('acertar 12.000 → carteira R$ 12.000,00', c.carteira === 'R$ 12.000,00', c.carteira)
confere('pode retirar R$ 500,00 em verde com ✅, "sobra depois da meta"', c.retirar === 'R$ 500,00' && c.cor === 'verde' && c.icone === '✅' && c.subRetirar === 'sobra depois da meta', JSON.stringify(c))
if (temVoz) {
  await avaliar(`window.__falas = []; document.getElementById('estBtnOuvir').click()`); await sleep(100)
  const fala = (await avaliar('window.__falas'))[0] || ''
  confere('🔊 Ouvir lê carteira, pode retirar e meta, com números falados', fala === 'Na carteira: 12000 reais. Pode retirar: 500 reais. Próxima meta: 11500 reais.', fala)
}
await foto('carteira-verde')

// ── Pagar a compra de R$ 1.000 → carteira cai 1.000 e passa a faltar para a meta ──
await cobranca('compra', 'cp3', '1000')
c = await cards()
confere('pagar compra de 1.000 → carteira R$ 11.000,00', c.carteira === 'R$ 11.000,00', c.carteira)
confere('pode retirar R$ 0,00 em vermelho com ⚠️, "faltam R$ 500,00 para a meta"', c.retirar === 'R$ 0,00' && c.cor === 'vermelho' && c.icone === '⚠️' && c.subRetirar === 'faltam R$ 500,00 para a meta', JSON.stringify(c))
await foto('carteira-vermelha')

// ── Receber 200,50 de uma venda (faltavam 260) → carteira sobe (e o Ouvir fala os centavos) ──
await cobranca('venda', 's4', '200.5')
c = await cards()
confere('receber 200,50 → carteira R$ 11.200,50 e faltam R$ 299,50', c.carteira === 'R$ 11.200,50' && c.subRetirar === 'faltam R$ 299,50 para a meta', JSON.stringify(c))
if (temVoz) {
  await avaliar(`window.__falas = []; document.getElementById('estBtnOuvir').click()`); await sleep(100)
  const fala = (await avaliar('window.__falas'))[0] || ''
  confere('🔊 Ouvir com centavos e falta para a meta', fala === 'Na carteira: 11200 reais e 50 centavos. Para retirar, ainda faltam 299 reais e 50 centavos para a próxima meta. Próxima meta: 11500 reais.', fala)
}

// ── Novo acerto substitui o anterior ──
await acertar('12500')
c = await cards()
confere('novo acerto (12.500) vale a partir de agora → pode retirar R$ 1.000,00', c.carteira === 'R$ 12.500,00' && c.retirar === 'R$ 1.000,00' && c.cor === 'verde', JSON.stringify(c))
await avaliar(`document.getElementById('estBtnAcertar').click()`); await sleep(200)
confere('janela Acertar mostra o último acerto e já vem com o valor atual', /Último acerto: R\$ 12\.500,00/.test(limpa(await avaliar(`document.getElementById('estCartUltimo').textContent`))) && (await avaliar(`document.getElementById('estCartValor').value`)) === '12500')
await avaliar(`document.querySelector('#estModalCarteira [data-fechar]').click()`)

// ── Pró-labore (dia 5): a retirada r1 de 10/10 já conta como o pró-labore de outubro ──
const diaDeHoje = new Date().getDate()
const proLabore = async () => ({ visivel: (await avaliar(`getComputedStyle(document.getElementById('estFaixaProLabore')).display`)) !== 'none', texto: limpa(await avaliar(`document.getElementById('estFaixaProLaboreTexto').textContent`)) })
let pl = await proLabore()
const r1EsteMes = await avaliar(`(window.__db.retiradas_lucro.find((r) => r.id === 'r1')?.data_retirada || '').slice(0, 7) === new Date().toISOString().slice(0, 7)`)
confere('pró-labore escondido quando já há retirada no mês a partir do dia 5', !(diaDeHoje >= 5 && r1EsteMes) || !pl.visivel, JSON.stringify(pl))
const p100 = await excluirRetirada('100,00')
confere('apagar retirada de ANTES do acerto: a janela avisa que a carteira não muda', /Apagar esta retirada\?.*A carteira não muda: esta retirada é de antes do último Acertar/.test(p100 || ''), p100)
c = await cards()
confere('e a carteira de fato não muda (R$ 12.500,00): o acerto já contava o que veio antes', c.carteira === 'R$ 12.500,00', c.carteira)
pl = await proLabore()
if (diaDeHoje >= 5) {
  confere('dia 5 em diante, sem retirada do mês: aviso verde "você pode retirar R$ 1.000,00"', pl.visivel && pl.texto === 'Pró-labore do mês: você pode retirar R$ 1.000,00.', JSON.stringify(pl))
  await foto('carteira-prolabore')
  await avaliar(`document.getElementById('estFaixaProLabore').click()`); await sleep(250)
  confere('tocar no aviso abre a janela de retirada', await avaliar(`document.getElementById('estModalRetirada').classList.contains('aberto')`))
  await avaliar(`document.querySelector('#estModalRetirada [data-fechar]').click()`)
} else {
  confere('antes do dia 5: aviso do pró-labore escondido', !pl.visivel, JSON.stringify(pl))
}

// ── Pró-labore: retirada de 300 dentro do que sobra ──
let pergunta = await retirar('300')
c = await cards()
confere('retirar 300 (sobra 1.000) não pergunta nada e tira da carteira', pergunta === null && c.carteira === 'R$ 12.200,00' && c.retirar === 'R$ 700,00', JSON.stringify({ pergunta, c }))
if (diaDeHoje >= 5) confere('depois da retirada do mês, o aviso do pró-labore some', !(await proLabore()).visivel)

// ── Retirada acima do que sobra: janela própria; "Não" não salva, "Sim" salva e fica vermelho ──
pergunta = await retirar('900', false)
confere('retirar 900 (sobra 700): janela "Vai faltar para a meta" com frases curtas', /Vai faltar para a meta.*Você vai tirar R\$\s?900,00\..*Só sobram R\$\s?700,00\..*Vão faltar R\$\s?200,00 para a próxima compra\./.test(pergunta || ''), pergunta)
c = await cards()
confere('respondendo "Não", nada é salvo', c.carteira === 'R$ 12.200,00', c.carteira)
pergunta = await retirar('900', true)
c = await cards()
confere('respondendo "Sim, tirar mesmo assim": carteira R$ 11.300,00 e faltam R$ 200,00 (vermelho)', c.carteira === 'R$ 11.300,00' && c.cor === 'vermelho' && c.subRetirar === 'faltam R$ 200,00 para a meta', JSON.stringify(c))
const botaoPadrao = await (async () => {
  await avaliar(`document.getElementById('estBtnRetirada').click()`); await sleep(150)
  await avaliar(`document.getElementById('estRetValor').value = '5000'; document.getElementById('estFormRetirada').requestSubmit()`); await sleep(300)
  const foco = await avaliar(`document.activeElement?.className || ''`)
  await avaliar(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(300)
  return foco
})()
confere('na janela de pergunta o botão já selecionado é o "Não" (Enter sem querer não tira nada)', /pergunta-nao/.test(botaoPadrao), botaoPadrao)
c = await cards()
confere('Esc responde "Não": nada salvo', c.carteira === 'R$ 11.300,00', c.carteira)
await avaliar(`document.getElementById('estModalRetirada').classList.remove('aberto')`)

// ── Apagar uma retirada feita DEPOIS do acerto: o dinheiro volta ──
const p900 = await excluirRetirada('900,00')
confere('apagar retirada de DEPOIS do acerto: "Os R$ 900,00 voltam para a carteira"', /Os R\$\s?900,00 voltam para a carteira/.test(p900 || ''), p900)
c = await cards()
confere('e a carteira volta a R$ 12.200,00', c.carteira === 'R$ 12.200,00', c.carteira)

// ── Vendas do mês: só uma linha pequena, sem card grande ──
const linha = limpa(await avaliar(`document.querySelector('.est-linha-mes')?.textContent`))
confere('vendas e lucro do mês numa linha pequena', /^Vendas do mês: R\$ [\d.,]+ \(\d+ vendas?\) · Lucro do mês: R\$ [\d.,]+$/.test(linha), linha)
confere('não existe mais o card grande "Vendido no mês"', titulos.every((t) => !/Vendido no mês/.test(t.texto)))
await foto('carteira-final')

// ── Excel: o "Relatório do mês" usa a mesma conta da carteira ──
await avaliar(`window.__arquivos = []; { const original = URL.createObjectURL; URL.createObjectURL = (b) => { window.__arquivos.push(b); return original(b) } }; window.alert = (m) => (window.__alertas = (window.__alertas || [])).push(String(m))`)
await avaliar(`document.getElementById('btnExcelMes').click()`)
for (let i = 0; i < 60 && !(await avaliar('window.__arquivos.length')); i++) await sleep(250)
const linhasExcel = await avaliar(`(async () => {
  if (!window.__arquivos.length) return null
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await window.__arquivos[0].arrayBuffer())
  const saida = []
  wb.eachSheet((aba) => aba.eachRow((linha) => {
    const v = linha.values.filter((x) => x !== null && x !== undefined).map((x) => (typeof x === 'object' && x.result !== undefined ? x.result : x))
    if (v.some((x) => /Na carteira|Pode retirar/.test(String(x)))) saida.push(v.join(' | '))
  }))
  return saida
})()`)
if (linhasExcel === null) {
  confere('Excel gerado (a biblioteca vem da internet)', false, 'arquivo não gerado; alertas: ' + JSON.stringify(await avaliar('window.__alertas || []')))
} else {
  confere('Excel: "Na carteira" = 12.200 e "Pode retirar agora" = 700, igual ao Dashboard',
    linhasExcel.some((l) => /^Na carteira \(dinheiro \+ Pix\) \| 12200\b/.test(l)) && linhasExcel.some((l) => /^Pode retirar agora \| 700\b.*acima da próxima meta/.test(l)), JSON.stringify(linhasExcel))
}

// ── O caminho exato do Caio: lançar a compra em Empresas com "Já paguei" → sai da carteira e do "pode retirar" ──
// (cada página recarrega o banco de mentira, então aqui o acerto é colocado direto no banco, com hora no passado)
await ir(`${base}/pages/empresas`)
await avaliar(`window.__db.carteira_acertos.push({ id: 'acerto-teste', user_id: 'u1', valor: 4172.17, created_at: new Date(Date.now() - 60000).toISOString() })`)
await avaliar(`document.getElementById('estBtnNovaCompra').click()`); await sleep(300)
await avaliar(`{
  const p = document.getElementById('estCompProduto'); p.value = 'p1'; p.dispatchEvent(new Event('change', { bubbles: true }))
  document.getElementById('estCompQtd').value = '5'; document.getElementById('estCompQtd').dispatchEvent(new Event('input', { bubbles: true }))
  document.getElementById('estCompCusto').value = '110'; document.getElementById('estCompCusto').dispatchEvent(new Event('input', { bubbles: true }))
}`)
const pagoMarcado = await avaliar(`document.getElementById('estCompPago').checked`)
await avaliar(`document.getElementById('estFormCompra').requestSubmit()`); await sleep(1200)
const contaDoCaio = await avaliar(`(async () => {
  const { calcularCarteira, sobraDaMeta } = await import('/js/carteira.js')
  const db = window.__db
  const cart = calcularCarteira({ acertos: db.carteira_acertos, pagamentosVenda: db.pagamentos_venda, pagamentosCompra: db.pagamentos_compra, retiradas: db.retiradas_lucro })
  return { saldo: cart.saldo, saiu: cart.saiuCompras, podeRetirar: sobraDaMeta(cart.saldo, 3526).podeRetirar }
})()`)
confere('Empresas: compra de 5 fardos a R$ 110 com "Já paguei" (marcado por padrão) tira R$ 550 da carteira',
  pagoMarcado && contaDoCaio.saiu === 550 && contaDoCaio.saldo === 3622.17, JSON.stringify({ pagoMarcado, ...contaDoCaio }))
confere('e o "pode retirar" (meta de 3.526) cai de 646,17 para 96,17, como o Caio pediu', contaDoCaio.podeRetirar === 96.17, String(contaDoCaio.podeRetirar))

// ── Celular ──
await ir(`${base}/pages/dashboard`)
await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true })
await sleep(400)
confere('celular: sem rolagem lateral na página', (await avaliar('document.documentElement.scrollWidth')) <= 390)
await foto('carteira-celular')

confere('nenhuma caixinha do navegador (alert/confirm) foi aberta', caixinhas.length === 0, caixinhas.join(' | '))
confere('nenhum erro de JavaScript', excecoes.length === 0, excecoes.join(' | '))
console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
try { const v = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).json(); const b = new WebSocket(v.webSocketDebuggerUrl); await new Promise((res) => b.addEventListener('open', res)); b.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch {}
await sleep(1200); proc.kill(); process.exit(falhas === 0 ? 0 : 1)
