// @ts-nocheck
// ============================================================
// avisos-diarios — Edge Function do Supabase (roda todo dia às 7h de Brasília)
// ------------------------------------------------------------
// Para cada pessoa que ativou os avisos (tabela push_subscriptions), confere:
//   • A RECEBER (vendas de produtos do estoque com valor em aberto): vencidas, que vencem hoje e amanhã
//   • A PAGAR (compras do estoque com valor em aberto): vencidas, que vencem hoje e amanhã
//   • ENTREGAS pendentes: sem dia marcado e atrasadas
// e manda UMA notificação com só as QUANTIDADES (sem nomes nem valores, para a tela bloqueada
// não mostrar dados). Se não há nada a avisar, não manda nada.
//
// Segurança:
//   • Só responde se o pedido trouxer o cabeçalho x-cron-segredo igual ao segredo CRON_SEGREDO.
//   • As chaves (VAPID_PRIVATE_KEY, CRON_SEGREDO) ficam nos "Secrets" do Supabase, NUNCA neste arquivo.
//   • Usa a chave de servidor que o próprio Supabase injeta (SUPABASE_SERVICE_ROLE_KEY).
//
// Modos de teste (todos exigem o segredo; combináveis):
//   {"teste": true}                 manda "Teste de aviso" no lugar do aviso real;
//   {"simular": true}               NÃO envia nada: devolve o texto que cada pessoa receberia (para conferir os números);
//   {"somente_user_id": "<uuid>"}   limita tudo a uma pessoa (ex.: testar só no aparelho do Lucas).
//
// As regras de data e de "valor em aberto" repetem as do Dashboard (js/estoque-dashboard.js).
// ============================================================

// ==LOGICA==
const FUSO = 'America/Sao_Paulo'

// "AAAA-MM-DD" de hoje no horário de Brasília (não do servidor, que fica em UTC)
function hojeEmBrasilia(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
}

// Soma dias a uma data "AAAA-MM-DD" sem passar por fuso (para não "virar o dia")
function somarDias(dataStr, dias) {
  const [a, m, d] = dataStr.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

const arredonda2 = (v) => Math.round((Number(v) || 0) * 100) / 100

// Classifica um vencimento em relação a hoje; devolve null se não precisa avisar
function classificarVencimento(vencimento, hoje, amanha) {
  if (!vencimento) return null
  const v = String(vencimento).slice(0, 10)
  if (v < hoje) return 'vencidas'
  if (v === hoje) return 'hoje'
  if (v === amanha) return 'amanha'
  return null
}

// Quantas cobranças/contas em aberto há em cada situação
function contarVencimentos(lista, hoje, amanha) {
  const n = { vencidas: 0, hoje: 0, amanha: 0 }
  for (const x of lista) {
    if (!(x.falta > 0.004)) continue // já pago por inteiro
    const s = classificarVencimento(x.vencimento, hoje, amanha)
    if (s) n[s]++
  }
  return n
}

const faltaDaVenda = (v) => {
  const total = (v.venda_estoque_itens || []).reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0)
  const pago = (v.pagamentos_venda || []).reduce((s, p) => s + Number(p.valor), 0)
  return arredonda2(arredonda2(total) - arredonda2(pago))
}
const faltaDaCompra = (c) => {
  const total = arredonda2(Number(c.quantidade) * Number(c.custo_unitario))
  const pago = (c.pagamentos_compra || []).reduce((s, p) => s + Number(p.valor), 0)
  return arredonda2(total - arredonda2(pago))
}

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`

// Monta o texto do aviso de UMA pessoa; devolve null se não há nada a avisar
function montarAviso({ vendas, compras, entregas }, hoje) {
  const amanha = somarDias(hoje, 1)
  const receber = contarVencimentos(vendas.map((v) => ({ vencimento: v.vencimento, falta: faltaDaVenda(v) })), hoje, amanha)
  const pagar = contarVencimentos(compras.map((c) => ({ vencimento: c.vencimento, falta: faltaDaCompra(c) })), hoje, amanha)

  const pendentes = entregas.filter((e) => (e.entrega_paradas || []).some((p) => !p.feita))
  const semDia = pendentes.filter((e) => !e.data_entrega).length
  const atrasadas = pendentes.filter((e) => e.data_entrega && String(e.data_entrega).slice(0, 10) < hoje).length

  const partesVenc = (n) => [
    n.vencidas ? plural(n.vencidas, 'vencida', 'vencidas') : '',
    n.hoje ? plural(n.hoje, 'vence hoje', 'vencem hoje') : '',
    n.amanha ? plural(n.amanha, 'vence amanhã', 'vencem amanhã') : '',
  ].filter(Boolean)

  const linhas = []
  const r = partesVenc(receber)
  if (r.length) linhas.push(`A receber: ${r.join(', ')}`)
  const p = partesVenc(pagar)
  if (p.length) linhas.push(`A pagar: ${p.join(', ')}`)
  const e = [semDia ? plural(semDia, 'sem dia marcado', 'sem dia marcado') : '', atrasadas ? plural(atrasadas, 'atrasada', 'atrasadas') : ''].filter(Boolean)
  if (e.length) linhas.push(`${pendentes.length === 1 ? 'Entrega' : 'Entregas'}: ${e.join(', ')}`)

  if (!linhas.length) return null
  return { titulo: 'Planilha Inteligente', corpo: linhas.join('\n'), url: 'pages/dashboard.html', tag: 'avisos-diarios' }
}
// ==FIM-LOGICA==

import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import webpush from 'npm:web-push@3.6.7'

const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

// Lê todas as linhas de uma consulta (o Supabase devolve no máximo 1000 por vez)
async function lerTudo(montar) {
  const tudo = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar().range(de, de + 999)
    if (error) throw error
    tudo.push(...data)
    if (data.length < 1000) break
  }
  return tudo
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405)
  const segredo = Deno.env.get('CRON_SEGREDO')
  if (!segredo || req.headers.get('x-cron-segredo') !== segredo) return json({ erro: 'Não autorizado.' }, 401)

  let corpo = {}
  try { corpo = await req.json() } catch { /* corpo vazio é normal no agendador */ }

  const publica = Deno.env.get('VAPID_PUBLIC_KEY')
  const privada = Deno.env.get('VAPID_PRIVATE_KEY')
  const assunto = Deno.env.get('VAPID_SUBJECT')
  if (!publica || !privada || !assunto) return json({ erro: 'Faltam as chaves VAPID nos Secrets.' }, 500)
  webpush.setVapidDetails(assunto, publica, privada)

  const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  const hoje = hojeEmBrasilia()
  const amanha = somarDias(hoje, 1)

  try {
    let aparelhos = await lerTudo(() => supabase.from('push_subscriptions').select('*').order('created_at'))
    if (corpo.somente_user_id) aparelhos = aparelhos.filter((a) => a.user_id === corpo.somente_user_id)
    const resumo = { hoje, aparelhos: aparelhos.length, pessoas: 0, enviados: 0, semAviso: 0, removidos: 0, falhas: 0 }
    if (corpo.simular) resumo.simulacao = []
    if (!aparelhos.length) return json(resumo)

    const porPessoa = {}
    aparelhos.forEach((a) => { (porPessoa[a.user_id] = porPessoa[a.user_id] || []).push(a) })
    const pessoas = Object.keys(porPessoa)
    resumo.pessoas = pessoas.length

    for (const userId of pessoas) {
      let aviso
      if (corpo.teste) {
        aviso = { titulo: 'Planilha Inteligente', corpo: 'Teste de aviso: está funcionando ✅', url: 'pages/dashboard.html', tag: 'teste-avisos' }
      } else {
        const [vendas, compras, entregas] = await Promise.all([
          lerTudo(() => supabase.from('vendas_estoque').select('id, vencimento, venda_estoque_itens(quantidade, preco_unitario), pagamentos_venda(valor)').eq('user_id', userId).lte('vencimento', amanha).order('id')),
          lerTudo(() => supabase.from('compras_estoque').select('id, vencimento, quantidade, custo_unitario, pagamentos_compra(valor)').eq('user_id', userId).lte('vencimento', amanha).order('id')),
          lerTudo(() => supabase.from('entregas').select('id, data_entrega, entrega_paradas(feita)').eq('user_id', userId).order('id')),
        ])
        aviso = montarAviso({ vendas, compras, entregas }, hoje)
      }
      if (!aviso) { resumo.semAviso++; if (corpo.simular) resumo.simulacao.push({ pessoa: userId, aparelhos: porPessoa[userId].length, aviso: null }); continue }
      if (corpo.simular) { resumo.simulacao.push({ pessoa: userId, aparelhos: porPessoa[userId].length, aviso: aviso.corpo }); continue }

      for (const a of porPessoa[userId]) {
        try {
          await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, JSON.stringify(aviso), { TTL: 60 * 60 * 12, urgency: 'normal' })
          resumo.enviados++
        } catch (erro) {
          // 404/410: o aparelho não existe mais (app desinstalado ou avisos desligados) -> limpa da tabela
          if (erro.statusCode === 404 || erro.statusCode === 410) {
            await supabase.from('push_subscriptions').delete().eq('id', a.id)
            resumo.removidos++
          } else {
            console.error('Falha ao enviar aviso:', erro.statusCode, erro.body || erro.message)
            resumo.falhas++
          }
        }
      }
    }
    return json(resumo)
  } catch (erro) {
    console.error('Erro nos avisos diários:', erro)
    return json({ erro: 'Erro ao montar os avisos.' }, 500)
  }
})
