// Roda os testes automáticos da Planilha Inteligente com UM comando.
//
//   node tests/executar.mjs                      roda tudo
//   node tests/executar.mjs ataque regressao     roda só esses
//   node tests/executar.mjs --lista              mostra os testes disponíveis
//   node tests/executar.mjs --ref=HEAD~3         compara a "regressao" com outro ponto do Git (padrão: HEAD)
//   node tests/executar.mjs ataque --app=abc1234 roda o teste contra o app daquele commit (prova que o teste detecta defeitos)
//
// O que ele faz: monta uma cópia do app numa pasta temporária (com o BANCO DE MENTIRA no lugar do Supabase real),
// sobe um servidor local, roda cada teste num navegador de verdade (Edge ou Chrome) e limpa tudo no fim.
// Nada aqui toca no Supabase real nem em dados de clientes.
import { spawn, execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { iniciarServidor } from './suporte/servidor.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = resolve(AQUI, '..')

// tipo: 'navegador' (app + navegador), 'comparacao' (app antigo × app atual) ou 'node' (só lógica, sem navegador)
const TESTES = [
  { nome: 'ataque', arquivo: 'ataque.mjs', tipo: 'navegador', desc: 'Teste de ataque (XSS): texto malicioso em todo campo não pode executar código' },
  { nome: 'regressao', arquivo: 'regressao.mjs', tipo: 'comparacao', desc: 'Compara as telas do app em outro ponto do Git × o atual, com os mesmos dados difíceis' },
  { nome: 'editar-compra', arquivo: 'editar-compra.mjs', tipo: 'navegador', desc: 'Botão Editar nas Compras (pagamento, estoque negativo, falhas)' },
  { nome: 'editar-venda', arquivo: 'editar-venda.mjs', tipo: 'navegador', desc: 'Botão Editar nas Vendas (solta e de visita, pagamentos, falhas)' },
  { nome: 'excluir-visita', arquivo: 'excluir-visita.mjs', tipo: 'navegador', desc: 'Excluir visita com venda de estoque (3 opções)' },
  { nome: 'calendario', arquivo: 'calendario.mjs', tipo: 'navegador', desc: 'Entregas no calendário de Rotas' },
  { nome: 'avisos-botao', arquivo: 'avisos-botao.mjs', tipo: 'navegador', desc: 'Botão "Ativar avisos" (iPhone, permissão negada, falhas)' },
  { nome: 'console-limpo', arquivo: 'console-limpo.mjs', tipo: 'navegador', desc: 'Nenhuma página gera erro de JavaScript' },
  { nome: 'login', arquivo: 'login.mjs', tipo: 'navegador', desc: 'Tela de login (mostrar senha, "Entrando…", senha errada × falha de rede)' },
  { nome: 'clientes-bolinhas', arquivo: 'clientes-bolinhas.mjs', tipo: 'navegador', desc: 'Clientes: bolinha de cor da última compra, resumo por cor e filtro' },
  { nome: 'clientes-cores', arquivo: 'clientes-cores.mjs', tipo: 'node', desc: 'Contas das bolinhas (dias entre datas e limites 15/16 e 30/31)' },
  { nome: 'clientes-prioridade', arquivo: 'clientes-prioridade.mjs', tipo: 'navegador', desc: 'Prioridade de visita: selo, aviso, filtro, janela do cliente e Dashboard' },
  { nome: 'prioridade', arquivo: 'prioridade.mjs', tipo: 'node', desc: 'Contas da prioridade (em dia, hoje, atrasado, nunca atendido, ordem)' },
  { nome: 'funcao-avisos-calculo', arquivo: 'funcao-avisos-calculo.mjs', tipo: 'node', desc: 'Cálculo do aviso diário (fuso de Brasília, vencidas, hoje, amanhã)' },
  { nome: 'funcao-avisos', arquivo: 'funcao-avisos.mjs', tipo: 'node', pacotes: ['web-push'], desc: 'Função avisos-diarios inteira (segredo, modos de teste, aparelhos expirados)' },
]

const args = process.argv.slice(2)
if (args.includes('--ajuda') || args.includes('-h')) {
  console.log(readme())
  process.exit(0)
}
if (args.includes('--lista')) {
  console.log('Testes disponíveis:\n')
  TESTES.forEach((t) => console.log(`  ${t.nome.padEnd(24)} ${t.desc}`))
  process.exit(0)
}
const refArg = args.find((a) => a.startsWith('--ref='))
const REF = refArg ? refArg.slice('--ref='.length) : 'HEAD'
// --app=<commit>: roda os testes contra o app daquele commit (em vez dos arquivos atuais). Serve para provar que um teste
// realmente FALHA num app com defeito (ex.: --app=<commit antes da correção de segurança>).
const appArg = args.find((a) => a.startsWith('--app='))
const APP_REF = appArg ? appArg.slice('--app='.length) : null
const escolhidos = args.filter((a) => !a.startsWith('--'))
const desconhecidos = escolhidos.filter((n) => !TESTES.some((t) => t.nome === n))
if (desconhecidos.length) { console.error(`Teste(s) desconhecido(s): ${desconhecidos.join(', ')}. Use --lista.`); process.exit(2) }
const lista = TESTES.filter((t) => !escolhidos.length || escolhidos.includes(t.nome))

function readme() {
  return 'Uso: node tests/executar.mjs [teste ...] [--lista] [--ref=<ponto-do-git>]\nVeja tests/README.md.'
}

// Monta uma cópia do app em "destino". Com "ref", usa os arquivos daquele ponto do Git (para a regressão).
function montarApp(destino, ref) {
  mkdirSync(destino, { recursive: true })
  const itens = ['js', 'css', 'pages', 'icones', 'index.html', 'favicon.svg']
  if (!ref) {
    for (const i of itens) if (existsSync(join(RAIZ, i))) cpSync(join(RAIZ, i), join(destino, i), { recursive: true })
  } else {
    const arquivos = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', ...itens], { cwd: RAIZ }).toString().split('\n').filter(Boolean)
    for (const arq of arquivos) {
      const dados = execFileSync('git', ['show', `${ref}:${arq}`], { cwd: RAIZ, maxBuffer: 100 * 1024 * 1024 })
      mkdirSync(dirname(join(destino, arq)), { recursive: true })
      writeFileSync(join(destino, arq), dados)
    }
  }
  // o banco de mentira ocupa o lugar do Supabase real
  cpSync(join(AQUI, 'banco-de-mentira', 'supabase.js'), join(destino, 'js', 'supabase.js'))
}

function rodar(arquivo, argumentos) {
  return new Promise((resolver) => {
    const filho = spawn(process.execPath, [join(AQUI, arquivo), ...argumentos], { cwd: AQUI })
    let saida = ''
    filho.stdout.on('data', (d) => { saida += d })
    filho.stderr.on('data', (d) => { saida += d })
    const limite = setTimeout(() => { saida += '\n[tempo esgotado: 15 minutos]'; filho.kill() }, 15 * 60 * 1000)
    filho.on('close', (codigo) => { clearTimeout(limite); resolver({ codigo, saida }) })
  })
}

const trabalho = mkdtempSync(join(tmpdir(), 'planilha-testes-'))
const resultados = join(AQUI, '_resultados', new Date().toISOString().replace(/[:.]/g, '-'))
mkdirSync(resultados, { recursive: true })

let atual = null; let base = null
const precisaApp = lista.some((t) => t.tipo !== 'node')
const precisaBase = lista.some((t) => t.tipo === 'comparacao')
try {
  if (precisaApp) {
    montarApp(join(trabalho, 'app'), APP_REF)
    atual = await iniciarServidor(join(trabalho, 'app'))
  }
  if (precisaBase) {
    montarApp(join(trabalho, 'base'), REF)
    base = await iniciarServidor(join(trabalho, 'base'))
  }

  console.log(`Rodando ${lista.length} teste(s)${APP_REF ? ` contra o app do commit "${APP_REF}"` : ''}. Resultados e capturas de tela em: tests/_resultados/\n`)
  const resumo = []
  for (const t of lista) {
    process.stdout.write(`▶ ${t.nome.padEnd(24)} `)
    const inicio = Date.now()
    let r
    if (t.pacotes && !t.pacotes.every((p) => existsSync(join(AQUI, 'node_modules', p)))) {
      resumo.push({ t, estado: 'pulado' })
      console.log(`PULADO (rode "npm install" dentro de tests/ para instalar: ${t.pacotes.join(', ')})`)
      continue
    }
    const perfil = mkdtempSync(join(trabalho, 'perfil-'))
    const capturas = join(resultados, t.nome); mkdirSync(capturas, { recursive: true })
    if (t.tipo === 'navegador') r = await rodar(t.arquivo, [atual.url, perfil, capturas])
    else if (t.tipo === 'comparacao') r = await rodar(t.arquivo, [base.url, atual.url, perfil, capturas])
    else r = await rodar(t.arquivo, [])
    const segundos = Math.round((Date.now() - inicio) / 1000)
    writeFileSync(join(resultados, `${t.nome}.log`), r.saida)
    const passou = r.codigo === 0
    resumo.push({ t, estado: passou ? 'passou' : 'falhou', segundos })
    console.log(passou ? `✓ passou (${segundos}s)` : `✗ FALHOU (${segundos}s)`)
    if (!passou) {
      const linhas = r.saida.split('\n').filter((l) => /✗|FALHA|VULNER|DIFEREN|Error|erro/i.test(l)).slice(0, 12)
      linhas.forEach((l) => console.log('     ' + l.slice(0, 200)))
      console.log(`     (log completo: tests/_resultados/${resultados.split(/[\\/]/).pop()}/${t.nome}.log)`)
    }
  }

  const falharam = resumo.filter((x) => x.estado === 'falhou').length
  const pulados = resumo.filter((x) => x.estado === 'pulado').length
  console.log(`\n==== RESUMO: ${resumo.filter((x) => x.estado === 'passou').length} passaram, ${falharam} falharam, ${pulados} pulados (de ${resumo.length}) ====`)
  if (precisaBase) console.log(`(a "regressao" comparou o app em "${REF}" com o app atual)`)
  process.exitCode = falharam === 0 ? 0 : 1
} finally {
  if (atual) await atual.fechar()
  if (base) await base.fechar()
  try { rmSync(trabalho, { recursive: true, force: true }) } catch { /* o sistema limpa depois */ }
}
