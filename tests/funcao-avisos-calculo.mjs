// Testa a parte de cálculo da Edge Function avisos-diarios (trecho entre ==LOGICA== e ==FIM-LOGICA==).
import { readFileSync } from 'node:fs'
const fonte = readFileSync(new URL('../supabase/functions/avisos-diarios/index.ts', import.meta.url), 'utf8')
const trecho = fonte.split('// ==LOGICA==')[1].split('// ==FIM-LOGICA==')[0]
const { hojeEmBrasilia, somarDias, montarAviso, classificarVencimento, faltaDaVenda, faltaDaCompra } =
  new Function(trecho + '\nreturn { hojeEmBrasilia, somarDias, montarAviso, classificarVencimento, faltaDaVenda, faltaDaCompra }')()

let falhas = 0
const confere = (nome, ok, extra = '') => { if (!ok) falhas++; console.log(`${ok ? '✓' : '✗ FALHOU'} ${nome}${extra ? ' → ' + extra : ''}`) }
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── Datas e fuso ──
confere('23h de 18/10 em Brasília (02:00 UTC do dia 19) ainda é dia 18', hojeEmBrasilia(new Date('2026-10-19T02:00:00Z')) === '2026-10-18', hojeEmBrasilia(new Date('2026-10-19T02:00:00Z')))
confere('7h de 19/10 em Brasília (10:00 UTC) é dia 19', hojeEmBrasilia(new Date('2026-10-19T10:00:00Z')) === '2026-10-19')
confere('meia-noite em Brasília (03:00 UTC) já é o dia novo', hojeEmBrasilia(new Date('2026-10-19T03:00:00Z')) === '2026-10-19' && hojeEmBrasilia(new Date('2026-10-19T02:59:00Z')) === '2026-10-18')
confere('somarDias: fim de mês e de ano', somarDias('2026-10-31', 1) === '2026-11-01' && somarDias('2026-12-31', 1) === '2027-01-01' && somarDias('2028-02-28', 1) === '2028-02-29')

const HOJE = '2026-10-19'
const AMANHA = '2026-10-20'
const venda = (venc, itens, pagos = []) => ({ vencimento: venc, venda_estoque_itens: itens.map(([q, p]) => ({ quantidade: q, preco_unitario: p })), pagamentos_venda: pagos.map((v) => ({ valor: v })) })
const compra = (venc, q, c, pagos = []) => ({ vencimento: venc, quantidade: q, custo_unitario: c, pagamentos_compra: pagos.map((v) => ({ valor: v })) })
const ent = (data, feitas) => ({ data_entrega: data, entrega_paradas: feitas.map((f) => ({ feita: f })) })

// ── Classificação ──
confere('vencimento: ontem=vencidas, hoje, amanhã, depois=nada, vazio=nada',
  classificarVencimento('2026-10-18', HOJE, AMANHA) === 'vencidas' && classificarVencimento(HOJE, HOJE, AMANHA) === 'hoje' && classificarVencimento(AMANHA, HOJE, AMANHA) === 'amanha' &&
  classificarVencimento('2026-10-21', HOJE, AMANHA) === null && classificarVencimento(null, HOJE, AMANHA) === null)

// ── Valor em aberto ──
confere('falta da venda: 5×26 − 100 pago = 30', faltaDaVenda(venda(HOJE, [[5, 26]], [100])) === 30)
confere('falta da venda: centavos (3×0,1 não gera 0,30000000000000004)', faltaDaVenda(venda(HOJE, [[3, 0.1]], [])) === 0.3)
confere('falta da compra: 10×150 − 500 = 1000', faltaDaCompra(compra(HOJE, 10, 150, [500])) === 1000)

// ── Mensagens ──
let a = montarAviso({ vendas: [], compras: [], entregas: [] }, HOJE)
confere('nada a avisar → null (não manda notificação)', a === null)

a = montarAviso({ vendas: [venda('2026-10-10', [[1, 100]])], compras: [], entregas: [] }, HOJE)
confere('1 vencida → "A receber: 1 vencida"', a?.corpo === 'A receber: 1 vencida', a?.corpo)

a = montarAviso({
  vendas: [venda('2026-10-10', [[1, 100]]), venda('2026-10-01', [[2, 50]]), venda(HOJE, [[1, 10]]), venda(AMANHA, [[1, 10]]), venda(AMANHA, [[3, 10]])],
  compras: [compra(HOJE, 10, 150), compra('2026-10-17', 1, 1)],
  entregas: [ent(null, [false, false]), ent('2026-10-15', [true, false]), ent('2026-10-25', [false])],
}, HOJE)
confere('combinado: plural e singular certos', a?.corpo === 'A receber: 2 vencidas, 1 vence hoje, 2 vencem amanhã\nA pagar: 1 vencida, 1 vence hoje\nEntregas: 1 sem dia marcado, 1 atrasada', JSON.stringify(a?.corpo))

a = montarAviso({ vendas: [venda(HOJE, [[2, 50]], [100]), venda(HOJE, [[2, 50]], [40])], compras: [compra(AMANHA, 2, 10, [20])], entregas: [] }, HOJE)
confere('totalmente pago não conta; parcialmente pago conta', a?.corpo === 'A receber: 1 vence hoje', JSON.stringify(a?.corpo))

a = montarAviso({ vendas: [venda('2026-10-21', [[1, 10]]), venda(null, [[1, 10]])], compras: [compra('2026-11-30', 1, 1)], entregas: [ent('2026-10-30', [false])] }, HOJE)
confere('vence depois de amanhã, sem vencimento e entrega futura → nada', a === null, JSON.stringify(a))

a = montarAviso({ vendas: [], compras: [], entregas: [ent(null, [true, true]), ent('2026-10-01', [true])] }, HOJE)
confere('entrega concluída (todas as paradas feitas) não avisa, mesmo atrasada ou sem dia', a === null, JSON.stringify(a))

a = montarAviso({ vendas: [], compras: [], entregas: [ent(null, [false])] }, HOJE)
confere('uma entrega sem dia → "Entrega: 1 sem dia marcado"', a?.corpo === 'Entrega: 1 sem dia marcado', JSON.stringify(a?.corpo))

a = montarAviso({ vendas: [venda('2026-10-10', [[1, 100]])], compras: [], entregas: [] }, HOJE)
confere('o aviso não traz nomes nem valores em reais', !/R\$|\d+,\d{2}/.test(a.corpo) && a.titulo === 'Planilha Inteligente' && a.url === 'pages/dashboard.html')

// ── Fonte da função: segredos e segurança ──
confere('nenhuma chave privada escrita no arquivo', !/VAPID_PRIVATE_KEY\s*=|CRON_SEGREDO\s*=|sb_secret_|d=[A-Za-z0-9_-]{40}/.test(fonte.replace('Deno.env.get(\'VAPID_PRIVATE_KEY\')', '')))
confere('exige o cabeçalho x-cron-segredo', fonte.includes("req.headers.get('x-cron-segredo') !== segredo") && fonte.includes("Deno.env.get('CRON_SEGREDO')"))
confere('apaga aparelho expirado (404/410)', fonte.includes('404') && fonte.includes('410') && fonte.includes('push_subscriptions').valueOf())

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
