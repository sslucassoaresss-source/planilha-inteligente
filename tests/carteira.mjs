// Contas da carteira (js/carteira.js): acerto mais recente, o que entra e sai depois dele, e a sobra da meta.
import { ultimoAcerto, calcularCarteira, sobraDaMeta, lembrarProLabore } from '../js/carteira.js'

let falhas = 0
const confere = (nome, ok, extra = '') => { if (!ok) falhas++; console.log(`${ok ? '✓' : '✗ FALHOU'} ${nome}${extra ? ' → ' + extra : ''}`) }

// ── Sem acerto: o app não sabe a carteira ──
confere('sem acerto → null (o card pede para acertar)', calcularCarteira({ acertos: [] }) === null)

// ── Acerto mais recente ──
const acertos = [
  { valor: 1000, created_at: '2026-10-20T10:00:00+00:00' },
  { valor: 4172.17, created_at: '2026-10-29T21:00:00.123456+00:00' },  // formato do Supabase (microssegundos)
  { valor: 500, created_at: '2026-10-25T10:00:00+00:00' },
]
confere('usa o acerto mais recente (mesmo fora de ordem e com microssegundos)', ultimoAcerto(acertos).valor === 4172.17)

// ── Movimentos: só os criados DEPOIS do acerto contam ──
const c = calcularCarteira({
  acertos,
  pagamentosVenda: [
    { valor: 260, created_at: '2026-10-29T20:17:27+00:00' },      // antes do acerto: já estava na carteira
    { valor: 180, created_at: '2026-10-30T12:00:00+00:00' },      // venda recebida depois: entra
    { valor: 90.5, created_at: '2026-10-31T09:00:00+00:00' },     // entra
    { valor: 999, created_at: null },                             // sem hora: não conta
  ],
  pagamentosCompra: [
    { valor: 550, created_at: '2026-10-30T13:00:00+00:00' },      // compra paga depois (exemplo do Caio): sai
    { valor: 6386, created_at: '2026-10-28T10:00:00+00:00' },     // antes do acerto: não sai de novo
  ],
  retiradas: [
    { valor: 300, created_at: '2026-11-10T09:00:00+00:00' },      // pró-labore: sai
  ],
})
confere('entrou depois do acerto = 270,50', c.entrou === 270.5, String(c.entrou))
confere('saiu em compras depois do acerto = 550', c.saiuCompras === 550, String(c.saiuCompras))
confere('retirado depois do acerto = 300', c.retirado === 300, String(c.retirado))
confere('carteira = 4172,17 + 270,50 − 550 − 300 = 3592,67', c.saldo === 3592.67, String(c.saldo))
confere('guarda o valor e a hora do acerto usado', c.base === 4172.17 && c.acertadoEm === '2026-10-29T21:00:00.123456+00:00')

// ── Exemplo do Caio: carteira 4.172 e meta 3.526 → pode tirar 646 ──
let s = sobraDaMeta(4172.17, 3526)
confere('4.172,17 com meta de 3.526 → pode tirar 646,17 e não falta nada', s.podeRetirar === 646.17 && s.falta === 0, JSON.stringify(s))
s = sobraDaMeta(3000, 3526)
confere('carteira menor que a meta → pode tirar 0 e faltam 526', s.podeRetirar === 0 && s.falta === 526, JSON.stringify(s))
s = sobraDaMeta(3526, 3526)
confere('carteira igual à meta → 0 e 0', s.podeRetirar === 0 && s.falta === 0)
s = sobraDaMeta(800, 0)
confere('sem meta → pode tirar tudo', s.podeRetirar === 800)
confere('centavos sem erro de arredondamento (0,1 + 0,2)', sobraDaMeta(0.3, 0.1).podeRetirar === 0.2)

// ── Compra de 550 tira 550 da carteira e do "pode retirar" (pedido do Caio) ──
const antes = calcularCarteira({ acertos: [{ valor: 4172.17, created_at: '2026-10-29T21:00:00Z' }] })
const depois = calcularCarteira({ acertos: [{ valor: 4172.17, created_at: '2026-10-29T21:00:00Z' }], pagamentosCompra: [{ valor: 550, created_at: '2026-10-29T22:00:00Z' }] })
confere('compra paga de 550 diminui a carteira em 550', antes.saldo - depois.saldo === 550)
confere('e diminui o "pode retirar" em 550 (646,17 → 96,17)', sobraDaMeta(depois.saldo, 3526).podeRetirar === 96.17, String(sobraDaMeta(depois.saldo, 3526).podeRetirar))

// ── Aviso do pró-labore (dia 5) ──
confere('dia 4: ainda não avisa', lembrarProLabore('2026-11-04', []) === false)
confere('dia 5 sem retirada: avisa', lembrarProLabore('2026-11-05', []) === true)
confere('dia 15 sem retirada: continua avisando (se abrir o app depois do dia 5)', lembrarProLabore('2026-11-15', []) === true)
confere('retirada no dia 5 do mês: some', lembrarProLabore('2026-11-15', [{ data_retirada: '2026-11-05' }]) === false)
confere('retirada antes do dia 5 não conta como pró-labore', lembrarProLabore('2026-11-15', [{ data_retirada: '2026-11-03' }]) === true)
confere('retirada do mês passado não conta', lembrarProLabore('2026-11-15', [{ data_retirada: '2026-10-12' }]) === true)

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
