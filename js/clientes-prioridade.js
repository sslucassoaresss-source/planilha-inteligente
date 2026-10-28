// Prioridade de visita na tela de Clientes: selo embaixo do nome de cada cliente prioritário
// ("Semanal · atrasado há 3 dias") e, acima da tabela, o aviso de quem está fora do prazo,
// com um botão que mostra só esses (regras em prioridade.js).
//
// SÓ LEITURA, e sem mexer no desenho do clientes.js: o selo é acrescentado por cima das
// linhas que ele desenha e se refaz sozinho quando a lista é redesenhada.
// Abrir a página com ?prioridade=atrasados (link do Dashboard) já liga o filtro.

import { supabase, buscarTodasLinhas } from './supabase.js'
import { hojeISO } from './clientes-cores.js'
import { ultimoAtendimentoPorCliente, situacaoPrioridade, textoSituacao, atrasados } from './prioridade.js'
import { esc } from './seguranca.js'

const { data: { session } } = await supabase.auth.getSession()
// Sem sessão, o clientes.js já manda para o login.
if (session) iniciar()

function iniciar() {
  const corpo = document.getElementById('listaClientes')
  const tabelaWrapper = document.getElementById('tabelaWrapper')
  if (!corpo || !tabelaWrapper) return

  const hoje = hojeISO()
  let situacoes = null   // cliente_id -> situação (só os que têm prioridade)
  let filtroLigado = new URLSearchParams(location.search).get('prioridade') === 'atrasados'

  const aviso = document.createElement('div')
  aviso.className = 'cp-aviso'
  aviso.style.display = 'none'
  tabelaWrapper.parentNode.insertBefore(aviso, tabelaWrapper)

  function marcarLinha(tr) {
    const id = tr.querySelector('[data-id]')?.dataset.id
    const s = situacoes?.[id]
    tr.dataset.prioridade = s ? s.estado : ''
    const celulaNome = tr.querySelector('td')
    let selo = celulaNome?.querySelector('.cp-selo')
    if (!s) { selo?.remove(); return }
    if (!selo) {
      selo = document.createElement('span')
      celulaNome.appendChild(selo)
    }
    selo.className = `cp-selo cp-${s.estado}`
    selo.textContent = textoSituacao(s)
  }

  function marcarTodas() { corpo.querySelectorAll('tr').forEach(marcarLinha) }

  function aplicarFiltro() {
    if (filtroLigado) corpo.dataset.filtroPrioridade = 'atrasado'
    else delete corpo.dataset.filtroPrioridade
  }

  function desenharAviso(lista) {
    if (!lista.length) {
      aviso.style.display = 'none'
      filtroLigado = false
      aplicarFiltro()
      return
    }
    const nomes = lista.slice(0, 3).map((x) => `<strong>${esc(x.cliente.nome)}</strong>`).join(', ')
    const resto = lista.length > 3 ? ` e mais ${lista.length - 3}` : ''
    const n = lista.length
    aviso.innerHTML =
      `<span class="cp-aviso-icone" aria-hidden="true">⚠</span>` +
      `<span class="cp-aviso-texto">${n} ${n === 1 ? 'cliente prioritário está' : 'clientes prioritários estão'} sem visita no prazo: ${nomes}${resto}.</span>` +
      `<button type="button" class="cp-aviso-botao" aria-pressed="${filtroLigado}">${filtroLigado ? 'Mostrar todos' : 'Ver só esses'}</button>`
    aviso.style.display = 'flex'
  }

  aviso.addEventListener('click', (e) => {
    if (!e.target.closest('.cp-aviso-botao')) return
    filtroLigado = !filtroLigado
    aplicarFiltro()
    desenharAviso(listaAtrasados)
  })

  let listaAtrasados = []

  // Depois de salvar um cliente (a prioridade pode ter mudado), a próxima vez que a lista for
  // redesenhada recarrega os dados; numa simples busca, só remarca as linhas.
  let recarregarNaProxima = false
  document.getElementById('formCliente')?.addEventListener('submit', () => { recarregarNaProxima = true })

  new MutationObserver(() => {
    if (recarregarNaProxima) { recarregarNaProxima = false; carregar(); return }
    if (situacoes) marcarTodas()
  }).observe(corpo, { childList: true })

  async function carregar() {
    const [clientes, visitas, vendas] = await Promise.all([
      buscarTodasLinhas('clientes', { select: 'id, nome, visitar_a_cada_dias, created_at', order: 'id' }),
      buscarTodasLinhas('visitas', { select: 'cliente_id, data_visita', order: 'id' }),
      buscarTodasLinhas('vendas_estoque', { select: 'cliente_id, data_venda', order: 'id' }),
    ])
    if (clientes.error || visitas.error || vendas.error) {
      console.error('Erro ao carregar a prioridade dos clientes:', clientes.error || visitas.error || vendas.error)
      return
    }
    const ultimos = ultimoAtendimentoPorCliente({ visitas: visitas.data, vendas: vendas.data })
    situacoes = {}
    clientes.data.forEach((c) => {
      const s = situacaoPrioridade({ prazo: c.visitar_a_cada_dias, ultimoAtendimento: ultimos[c.id], cadastro: c.created_at, hoje })
      if (s) situacoes[c.id] = s
    })
    listaAtrasados = atrasados(clientes.data, ultimos, hoje)
    marcarTodas()
    aplicarFiltro()
    desenharAviso(listaAtrasados)
  }

  carregar()
}
