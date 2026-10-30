// Pergunta de confirmação em janela própria, no lugar do confirm() do navegador:
// título curto, frases curtas e botões grandes (mais fácil de ler para quem tem dislexia).
//
//   const ok = await perguntar({ titulo, linhas: ['frase 1', 'frase 2'], sim: 'Sim, apagar', nao: 'Não', perigo: true })
//
// As linhas são texto puro (nunca HTML). O botão que começa selecionado é o "Não": um Enter sem
// querer não confirma nada. Esc ou clicar fora também respondem "Não".

let janela = null

function montar() {
  janela = document.createElement('div')
  janela.className = 'modal-overlay pergunta-overlay'
  janela.innerHTML = `
    <div class="modal pergunta-modal" role="alertdialog" aria-modal="true" aria-labelledby="perguntaTitulo">
      <div class="modal-topo"><h2 id="perguntaTitulo"></h2></div>
      <div class="pergunta-linhas"></div>
      <div class="modal-rodape">
        <button type="button" class="btn-secundario pergunta-nao"></button>
        <button type="button" class="btn-primario pergunta-sim"></button>
      </div>
    </div>`
  document.body.appendChild(janela)
}

export function perguntar({ titulo, linhas = [], sim = 'Sim', nao = 'Não', perigo = false, verde = false }) {
  if (!janela) montar()
  // A cor acompanha a frente (verde no estoque); "perigo" deixa o botão do sim vermelho
  janela.classList.toggle('frente-verde', verde)
  janela.querySelector('#perguntaTitulo').textContent = titulo
  const caixa = janela.querySelector('.pergunta-linhas')
  caixa.replaceChildren(...linhas.map((t) => { const p = document.createElement('p'); p.textContent = t; return p }))
  const btSim = janela.querySelector('.pergunta-sim')
  const btNao = janela.querySelector('.pergunta-nao')
  btSim.textContent = sim
  btNao.textContent = nao
  btSim.classList.toggle('pergunta-perigo', perigo)
  janela.classList.add('aberto')
  btNao.focus()

  return new Promise((responder) => {
    const fim = (resposta) => {
      janela.classList.remove('aberto')
      btSim.removeEventListener('click', clicouSim)
      btNao.removeEventListener('click', clicouNao)
      janela.removeEventListener('click', clicouFora)
      document.removeEventListener('keydown', tecla, true)
      responder(resposta)
    }
    const clicouSim = () => fim(true)
    const clicouNao = () => fim(false)
    const clicouFora = (e) => { if (e.target === janela) fim(false) }
    const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); fim(false) } }
    btSim.addEventListener('click', clicouSim)
    btNao.addEventListener('click', clicouNao)
    janela.addEventListener('click', clicouFora)
    document.addEventListener('keydown', tecla, true)
  })
}
