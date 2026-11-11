// Tema claro, escuro ou automático (igual ao Casa em Dia).
//
// 1. Um script pequeno no <head> de cada página aplica o tema ANTES de desenhar a tela
//    (sem ele, a página piscaria clara antes de ficar escura).
// 2. O botão do topo (antes do olho e do "Sair") abre uma janelinha com Automático, Claro e Escuro.
// 3. A escolha fica salva em cada aparelho: o celular pode estar no escuro e o computador no claro.
//    Automático apaga a escolha e segue o aparelho (inclusive quando ele troca sozinho à noite).
//
// O <html> sempre tem data-theme="light" ou "dark" (o tema que está valendo); o CSS só olha isso.

const CHAVE = 'pi_tema'
const html = document.documentElement
const aparelhoEscuro = window.matchMedia('(prefers-color-scheme: dark)')
const COR_DA_BARRA = { light: '#FFFFFF', dark: '#16212E' }

const OPCOES = [
  { valor: 'auto', nome: 'Automático', apoio: 'segue o aparelho' },
  { valor: 'light', nome: 'Claro' },
  { valor: 'dark', nome: 'Escuro' },
]

const ICONES = {
  light: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
  dark: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  auto: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
}

function escolhaSalva() {
  try {
    const v = localStorage.getItem(CHAVE)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto' // sem localStorage (navegação privada): segue o aparelho
  }
}

function aplicar(escolha) {
  const tema = escolha === 'auto' ? (aparelhoEscuro.matches ? 'dark' : 'light') : escolha
  html.dataset.theme = tema
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = COR_DA_BARRA[tema]
}

// A escolha também fica na memória da página: sem localStorage (navegação privada) ela não é
// salva, mas o botão continua mostrando o que está valendo
let escolhaAtual = escolhaSalva()

function salvar(escolha) {
  escolhaAtual = escolha
  try {
    if (escolha === 'auto') localStorage.removeItem(CHAVE)
    else localStorage.setItem(CHAVE, escolha)
  } catch { /* não deu para salvar: muda agora, só não lembra */ }
}

// No Automático, acompanha o aparelho quando ele troca de tema
aparelhoEscuro.addEventListener('change', () => { if (escolhaAtual === 'auto') aplicar('auto') })
aplicar(escolhaAtual)

function montarBotao() {
  const sair = document.getElementById('btnSair')
  if (!sair) return // páginas sem topo (login, sem conexão) só seguem o tema

  const caixa = document.createElement('div')
  caixa.className = 'tema-caixa'
  caixa.innerHTML = `
    <button type="button" class="btn-olho btn-tema" aria-haspopup="true" aria-expanded="false" aria-controls="temaMenu"></button>
    <div class="tema-menu" id="temaMenu" hidden>
      <fieldset>
        <legend>Tema</legend>
        ${OPCOES.map((o) => `
          <label class="tema-opcao">
            <input type="radio" name="tema" value="${o.valor}">
            <span class="tema-opcao-icone">${ICONES[o.valor]}</span>
            <span class="tema-opcao-nome">${o.nome}${o.apoio ? `<small>${o.apoio}</small>` : ''}</span>
          </label>`).join('')}
      </fieldset>
    </div>`
  const botao = caixa.querySelector('.btn-tema')
  const menu = caixa.querySelector('.tema-menu')

  function atualizarBotao() {
    const escolha = escolhaAtual
    botao.innerHTML = ICONES[escolha]
    const nome = OPCOES.find((o) => o.valor === escolha).nome
    botao.title = `Tema: ${nome}`
    botao.setAttribute('aria-label', `Tema: ${nome}. Trocar o tema`)
    menu.querySelector(`input[value="${escolha}"]`).checked = true
  }

  function abrir() {
    menu.hidden = false
    botao.setAttribute('aria-expanded', 'true')
    menu.querySelector('input:checked').focus()
  }

  function fechar(devolverFoco) {
    if (menu.hidden) return
    menu.hidden = true
    botao.setAttribute('aria-expanded', 'false')
    if (devolverFoco) botao.focus()
  }

  botao.addEventListener('click', () => (menu.hidden ? abrir() : fechar(true)))
  menu.addEventListener('change', (e) => {
    salvar(e.target.value)
    aplicar(e.target.value)
    atualizarBotao()
  })
  // Tocar numa opção (mesmo a que já estava) fecha a janelinha. Pelo teclado, as setas trocam
  // o tema sem fechar (no Chrome elas também disparam "click", por isso não se usa o click aqui);
  // Enter ou Esc fecham.
  menu.addEventListener('pointerup', (e) => { if (e.target.closest('.tema-opcao')) setTimeout(() => fechar(true), 0) })
  menu.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fechar(true) } })
  document.addEventListener('click', (e) => { if (!caixa.contains(e.target)) fechar(false) })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(true) })

  const olho = document.querySelector('.btn-olho:not(.btn-tema)')
  ;(olho || sair).before(caixa)
  atualizarBotao()
}

montarBotao()
