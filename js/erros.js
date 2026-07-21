// Ajuda a diferenciar duas situações bem diferentes quando uma chamada ao
// Supabase falha:
//
// 1. O servidor recusou o pedido (RLS, campo obrigatório, etc.) — o dado
//    NÃO foi salvo, tentar de novo é seguro.
// 2. A conexão caiu/deu timeout no meio do envio — o servidor pode ter
//    recebido e salvo antes da resposta voltar pro navegador. Nesse caso,
//    mandar o usuário "tentar de novo" sem ressalva arrisca duplicar um
//    registro que já foi salvo (foi o que aconteceu com um rep em campo,
//    sinal instável: viu "erro ao salvar", reabriu o app e o dado já estava lá).
//
// Erros vindos do Postgrest/Postgres quase sempre trazem um `code` (ex:
// "23505", "42501", "PGRST116"). Uma falha de rede/timeout é capturada pelo
// supabase-js como uma exceção do fetch, sem esse code — é o sinal que
// usamos aqui pra escolher a mensagem certa.
export function mensagemErro(error, acao = 'salvar') {
  const semConexao = typeof navigator !== 'undefined' && navigator.onLine === false
  const pareceFalhaDeRede = semConexao ||
    !error?.code ||
    /failed to fetch|networkerror|load failed|timeout|network request failed/i.test(error?.message || '')

  return pareceFalhaDeRede
    ? `Não deu para confirmar se foi salvo — a conexão pode ter caído no meio do envio. Confira antes de tentar ${acao} de novo, para não duplicar.`
    : `Erro ao ${acao}. Tente novamente.`
}
