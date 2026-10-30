// Carteira do Caio (dinheiro em espécie + Pix) e quanto ele pode retirar sem faltar para a próxima meta.
// Só cálculo, sem banco e sem tela, para poder ser testado sozinho (tests/carteira.mjs).
//
//   Na carteira  = valor do último "Acertar" (o que ele digitou que tinha)
//                  + vendas recebidas − compras pagas − retiradas lançadas DEPOIS desse acerto
//   Pode retirar = o que a carteira tem acima da próxima meta (nunca negativo)
//   Falta        = quanto falta na carteira para a próxima meta (quando ela é maior)
//
// "Depois do acerto" usa a hora em que cada lançamento foi criado (created_at). Lançamento sem
// hora conhecida conta como anterior ao acerto. Compra "a pagar" não mexe na carteira até ser paga.

const centavos = (v) => Math.round((Number(v) || 0) * 100) / 100

function instante(valor) {
  const t = Date.parse(valor)
  return Number.isNaN(t) ? null : t
}

// O acerto mais recente (pela hora de criação) de uma lista
export function ultimoAcerto(acertos = []) {
  return acertos.reduce((ultimo, a) => {
    const t = instante(a.created_at)
    if (t === null) return ultimo
    return !ultimo || t > instante(ultimo.created_at) ? a : ultimo
  }, null)
}

// Soma os valores criados depois do instante de referência
function somarDepois(lista, desde) {
  return lista.reduce((s, x) => {
    const t = instante(x.created_at)
    return t !== null && t > desde ? s + (Number(x.valor) || 0) : s
  }, 0)
}

export function calcularCarteira({ acertos = [], pagamentosVenda = [], pagamentosCompra = [], retiradas = [] }) {
  const acerto = ultimoAcerto(acertos)
  if (!acerto) return null
  const desde = instante(acerto.created_at)
  const entrou = centavos(somarDepois(pagamentosVenda, desde))
  const saiuCompras = centavos(somarDepois(pagamentosCompra, desde))
  const retirado = centavos(somarDepois(retiradas, desde))
  return {
    saldo: centavos(Number(acerto.valor) + entrou - saiuCompras - retirado),
    base: centavos(acerto.valor),
    acertadoEm: acerto.created_at,
    entrou,
    saiuCompras,
    retirado,
  }
}

// Aviso do pró-labore (dia 5 de cada mês, confirmado pelo Caio em 29/10): aparece do dia 5 em diante e some quando
// já existe uma retirada no mês a partir do dia 5. hoje e as datas no formato 'AAAA-MM-DD'.
export const DIA_DO_PRO_LABORE = 5

export function lembrarProLabore(hoje, retiradas = []) {
  if (Number(String(hoje).slice(8, 10)) < DIA_DO_PRO_LABORE) return false
  const desde = `${String(hoje).slice(0, 7)}-${String(DIA_DO_PRO_LABORE).padStart(2, '0')}`
  return !retiradas.some((r) => {
    const dia = String(r.data_retirada || '').slice(0, 10)
    return dia >= desde && dia <= hoje
  })
}

export function sobraDaMeta(saldo, meta) {
  const diferenca = centavos((Number(saldo) || 0) - (Number(meta) || 0))
  return { podeRetirar: Math.max(0, diferenca), falta: Math.max(0, -diferenca) }
}
