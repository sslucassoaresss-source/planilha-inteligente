// Botão "ocultar valores": troca todo "R$ 1.234,56" da tela por "R$ ••••", para
// o Caio poder postar um print do app sem mostrar dinheiro.
//
// É só visual: não lê nem grava nada no banco, e os cálculos seguem usando os
// números reais. Como cada tela formata os valores em lugares diferentes, em
// vez de mexer em cada um este script vigia a página e mascara qualquer texto
// que pareça um valor em reais (inclusive os que aparecem depois, como a dica
// ao passar o mouse nas barras do gráfico ou os valores de telas novas).

const CHAVE = 'pi_ocultar_valores'
const MASCARA = 'R$ ••••'
// "R$ 1.234,56", com espaço comum ou espaço sem quebra (o que o toLocaleString usa)
const PADRAO_VALOR = /R\$[\s ]*[\d.]+(?:,\d+)?/g
const IGNORAR = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION'])

const originais = new WeakMap() // nó de texto -> texto original, para poder desfazer
let oculto = lerPreferencia()
let botao = null

function lerPreferencia() {
  try { return localStorage.getItem(CHAVE) === '1' } catch { return false }
}

function salvarPreferencia() {
  try { localStorage.setItem(CHAVE, oculto ? '1' : '0') } catch { /* sem armazenamento: só não lembra */ }
}

function mascarar(no) {
  const texto = no.nodeValue
  if (!texto || !texto.includes('R$')) return
  const novo = texto.replace(PADRAO_VALOR, MASCARA)
  if (novo === texto) return
  originais.set(no, texto)
  no.nodeValue = novo
}

function nosDeTexto(raiz) {
  const nos = []
  const andador = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && IGNORAR.has(n.parentElement.tagName))
      ? NodeFilter.FILTER_REJECT
      : NodeFilter.FILTER_ACCEPT,
  })
  while (andador.nextNode()) nos.push(andador.currentNode)
  return nos
}

function mascararTudo(raiz) {
  nosDeTexto(raiz).forEach(mascarar)
}

function restaurarTudo() {
  nosDeTexto(document.body).forEach((no) => {
    if (originais.has(no)) {
      no.nodeValue = originais.get(no)
      originais.delete(no)
    }
  })
}

const vigia = new MutationObserver((registros) => {
  if (!oculto) return
  // Pausa o vigia enquanto altera o texto, senão a nossa própria troca dispararia outra rodada.
  vigia.disconnect()
  for (const r of registros) {
    if (r.type === 'characterData') {
      mascarar(r.target)
    } else {
      r.addedNodes.forEach((n) => {
        if (n.nodeType === Node.TEXT_NODE) mascarar(n)
        else if (n.nodeType === Node.ELEMENT_NODE && !IGNORAR.has(n.tagName)) mascararTudo(n)
      })
    }
  }
  vigiar()
})

function vigiar() {
  vigia.observe(document.body, { childList: true, characterData: true, subtree: true })
}

const ICONE_ABERTO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>'
const ICONE_FECHADO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'

function atualizarBotao() {
  botao.innerHTML = oculto ? ICONE_FECHADO : ICONE_ABERTO
  botao.setAttribute('aria-pressed', String(oculto))
  botao.title = oculto ? 'Mostrar valores' : 'Ocultar valores'
  botao.setAttribute('aria-label', botao.title)
}

function alternar() {
  oculto = !oculto
  salvarPreferencia()
  atualizarBotao()
  vigia.disconnect()
  if (oculto) mascararTudo(document.body)
  else restaurarTudo()
  vigiar()
}

function iniciar() {
  const sair = document.getElementById('btnSair')
  if (!sair) return // páginas sem topo (ex.: login) não têm botão nem valores
  botao = document.createElement('button')
  botao.type = 'button'
  botao.className = 'btn-olho'
  botao.addEventListener('click', alternar)
  sair.before(botao)
  atualizarBotao()
  if (oculto) mascararTudo(document.body)
  vigiar()
}

iniciar()
