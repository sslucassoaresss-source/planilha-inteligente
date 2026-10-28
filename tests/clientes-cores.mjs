// Contas das bolinhas de última compra (js/clientes-cores.js): dias entre datas e faixa de cor, com os limites.
import { hojeISO, diasEntre, faixaUltimaCompra, textoHaDias } from '../js/clientes-cores.js'

let falhas = 0
const confere = (nome, ok, extra = '') => { if (!ok) falhas++; console.log(`${ok ? '✓' : '✗ FALHOU'} ${nome}${extra ? ' → ' + extra : ''}`) }

// ── Dias entre datas ──
confere('mesmo dia = 0', diasEntre('2026-10-27', '2026-10-27') === 0)
confere('virada de mês (31/10 → 01/11) = 1', diasEntre('2026-10-31', '2026-11-01') === 1)
confere('virada de ano (31/12 → 01/01) = 1', diasEntre('2026-12-31', '2027-01-01') === 1)
confere('ano bissexto (28/02 → 01/03/2028) = 2', diasEntre('2028-02-28', '2028-03-01') === 2)
confere('aceita data com hora (só o dia conta)', diasEntre('2026-10-12T23:59:00Z', '2026-10-27') === 15)
confere('hojeISO usa o dia do aparelho', hojeISO(new Date(2026, 9, 5, 23, 30)) === '2026-10-05')

// ── Faixas (verde até 15, amarela até 30, vermelha depois, cinza nunca) ──
const cor = (d) => faixaUltimaCompra(d).classe
confere('0 dias → verde', cor(0) === 'verde')
confere('15 dias → verde (limite)', cor(15) === 'verde')
confere('16 dias → amarela', cor(16) === 'amarela')
confere('30 dias → amarela (limite)', cor(30) === 'amarela')
confere('31 dias → vermelha', cor(31) === 'vermelha')
confere('400 dias → vermelha', cor(400) === 'vermelha')
confere('nunca comprou → cinza', cor(null) === 'cinza' && cor(undefined) === 'cinza')
confere('data no futuro conta como hoje (verde)', cor(-3) === 'verde')

// ── Texto ──
confere('textos: hoje, ontem, há N dias', textoHaDias(0) === 'hoje' && textoHaDias(1) === 'ontem' && textoHaDias(16) === 'há 16 dias')

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
