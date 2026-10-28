// Contas da prioridade de visita (js/prioridade.js): prazo, último atendimento, situação e lista de atrasados.
import { nomePrazo, prazoValido, ultimoAtendimentoPorCliente, situacaoPrioridade, textoSituacao, atrasados, nomesResumidos } from '../js/prioridade.js'

let falhas = 0
const confere = (nome, ok, extra = '') => { if (!ok) falhas++; console.log(`${ok ? '✓' : '✗ FALHOU'} ${nome}${extra ? ' → ' + extra : ''}`) }
const HOJE = '2026-10-27'

// ── Prazo ──
confere('nomes: Semanal, Quinzenal, Mensal e "A cada N dias"', nomePrazo(7) === 'Semanal' && nomePrazo(15) === 'Quinzenal' && nomePrazo(30) === 'Mensal' && nomePrazo(10) === 'A cada 10 dias')
confere('prazo válido: 1 a 365, inteiro', prazoValido(1) === 1 && prazoValido('365') === 365 && prazoValido(0) === null && prazoValido(366) === null && prazoValido(2.5) === null && prazoValido('') === null && prazoValido(null) === null)

// ── Último atendimento: visita (qualquer, até "Não comprou") ou venda de estoque, o mais recente ──
const ult = ultimoAtendimentoPorCliente({
  visitas: [{ cliente_id: 'a', data_visita: '2026-10-01' }, { cliente_id: 'a', data_visita: '2026-10-20' }, { cliente_id: 'b', data_visita: '2026-09-01' }],
  vendas: [{ cliente_id: 'b', data_venda: '2026-10-25T10:00:00Z' }, { cliente_id: 'a', data_venda: '2026-10-05' }],
})
confere('pega a data mais recente entre visitas e vendas', ult.a === '2026-10-20' && ult.b === '2026-10-25', JSON.stringify(ult))

// ── Situação ──
const sit = (prazo, ultimoAtendimento, cadastro) => situacaoPrioridade({ prazo, ultimoAtendimento, cadastro, hoje: HOJE })
confere('sem prioridade → null', sit(null, '2026-10-01') === null && sit(0, '2026-10-01') === null)
let s = sit(7, '2026-10-24')
confere('semanal, 3 dias → em dia, faltam 4', s.estado === 'em-dia' && s.faltam === 4, JSON.stringify(s))
s = sit(7, '2026-10-20')
confere('semanal, exatamente 7 dias → visitar hoje', s.estado === 'hoje', JSON.stringify(s))
s = sit(7, '2026-10-19')
confere('semanal, 8 dias → atrasado 1', s.estado === 'atrasado' && s.atraso === 1, JSON.stringify(s))
s = sit(30, null, '2026-09-12T15:00:00Z')
confere('nunca atendido conta do cadastro (45 dias, mensal → atrasado 15)', s.estado === 'atrasado' && s.atraso === 15 && s.nuncaAtendido, JSON.stringify(s))
s = sit(30, null, '2026-10-22T15:00:00Z')
confere('recém cadastrado (5 dias, mensal) → em dia', s.estado === 'em-dia' && s.faltam === 25)
s = sit(7, '2026-10-30')
confere('atendimento com data futura não dá número negativo', s.estado === 'em-dia' && s.faltam === 7, JSON.stringify(s))

// ── Textos ──
confere('texto atrasado (plural e singular)', textoSituacao(sit(7, '2026-10-17')) === 'Semanal · atrasado há 3 dias' && textoSituacao(sit(7, '2026-10-19')) === 'Semanal · atrasado há 1 dia')
confere('texto hoje e em dia', textoSituacao(sit(15, '2026-10-12')) === 'Quinzenal · visitar hoje' && textoSituacao(sit(10, '2026-10-26')) === 'A cada 10 dias · em dia (faltam 9 dias)')

// ── Lista de atrasados: só atrasados, do mais atrasado para o menos ──
const clientes = [
  { id: '1', nome: 'Beta', visitar_a_cada_dias: 7 },          // 10 dias → atrasado 3
  { id: '2', nome: 'Alfa', visitar_a_cada_dias: 30, created_at: '2026-09-12' },  // nunca → atrasado 15
  { id: '3', nome: 'Gama', visitar_a_cada_dias: 7 },          // 2 dias → em dia
  { id: '4', nome: 'Delta', visitar_a_cada_dias: null },      // sem prioridade
  { id: '5', nome: 'Épsilon', visitar_a_cada_dias: 7 },       // 10 dias → atrasado 3 (empate: ordem alfabética)
]
const lista = atrasados(clientes, { 1: '2026-10-17', 3: '2026-10-25', 4: '2026-01-01', 5: '2026-10-17' }, HOJE)
confere('atrasados em ordem (mais atrasado primeiro; empate por nome)', JSON.stringify(lista.map((x) => x.cliente.nome)) === JSON.stringify(['Alfa', 'Beta', 'Épsilon']), JSON.stringify(lista.map((x) => x.cliente.nome)))

// ── Nomes resumidos ──
confere('nomes resumidos', nomesResumidos(['A']) === 'A' && nomesResumidos(['A', 'B']) === 'A e B' && nomesResumidos(['A', 'B', 'C']) === 'A, B e C' && nomesResumidos(['A', 'B', 'C', 'D', 'E']) === 'A, B, C e mais 2')

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
