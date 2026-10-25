// Proteção de texto: tudo o que a pessoa digita (nome do cliente, cidade, observação...) pode conter
// caracteres que o navegador trataria como HTML (< > " ' &) e, sem proteção, executaria como código
// (ataque conhecido como XSS). esc() troca esses caracteres por versões inofensivas: o texto aparece na
// tela exatamente como foi digitado, e nada é executado.
//
// Use sempre que um valor digitado for colado dentro de um modelo de HTML (innerHTML), seja no texto
// ou dentro de um atributo entre aspas (title="...", data-xxx="..."):
//     el.innerHTML = `<td>${esc(cliente.nome)}</td>`
// Valores que não são texto digitado (números, ids, datas já formatadas) não precisam.

const SUBSTITUICOES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }

export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"'`]/g, (c) => SUBSTITUICOES[c])
}
