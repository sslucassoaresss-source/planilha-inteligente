import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://exhhsaoggienjqalqxym.supabase.co'
const SUPABASE_KEY = 'sb_publishable_V4UdZ-FOO5OIIrRSdLcjsA_dTUVWThT'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Busca TODAS as linhas de uma tabela, ignorando o limite padrão de 1000
// linhas por consulta que o Supabase (PostgREST) aplica automaticamente.
// Sem isso, tabelas que passam de 1000 registros (ex: clientes) têm parte
// dos dados cortada silenciosamente, sem erro nenhum — só sumindo da tela.
//
// Funciona buscando em "páginas" de `tamanhoPagina` em `tamanhoPagina`
// linhas (usando .range()) até uma página voltar incompleta — sinal de
// que chegou ao fim da tabela.
export async function buscarTodasLinhas(tabela, { select = '*', order = null, tamanhoPagina = 1000 } = {}) {
  let todasLinhas = []
  let pagina = 0

  while (true) {
    const inicio = pagina * tamanhoPagina
    const fim = inicio + tamanhoPagina - 1

    let query = supabase.from(tabela).select(select).range(inicio, fim)
    if (order) query = query.order(order)

    const { data, error } = await query
    if (error) return { data: null, error }

    todasLinhas = todasLinhas.concat(data)

    if (data.length < tamanhoPagina) break
    pagina++
  }

  return { data: todasLinhas, error: null }
}