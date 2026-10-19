// Botão "🔔 Ativar avisos" do Dashboard: registra este aparelho para receber, todo dia de manhã, uma
// notificação com cobranças vencidas, contas a pagar e entregas sem dia (quem envia é uma função
// do Supabase, ver a Parte C). Aqui só pedimos a permissão e guardamos o "endereço" do aparelho.
//
// Módulo independente: o dashboard.js não é tocado. Se o aparelho não suporta notificações, o botão
// não aparece e o app segue normal. No iPhone só funciona com o app instalado na tela inicial.

import { supabase } from './supabase.js'
import { mensagemErro } from './erros.js'

// Chave PÚBLICA de envio (pode ficar no código; a privada fica só nos segredos do Supabase)
const CHAVE_PUBLICA = 'BPjkB9repLBNztirXYXN92RYsIF5rK1-uIjZoaWa4I-s-fZ5pIWZX1O4tZiDZvYs_Srr3aPkKUQR74iOxVFsshE'

const { data: { session } } = await supabase.auth.getSession()
const area = document.getElementById('avisosArea')
if (session && area) iniciar(session.user.id)

function iniciar(userId) {
  const suporta = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const ehIphone = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const instalado = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true

  const mostrarDica = (texto) => { area.innerHTML = ''; const s = document.createElement('span'); s.className = 'avisos-dica'; s.textContent = texto; area.appendChild(s) }
  const mostrarBotao = (texto, titulo, aoClicar) => {
    area.innerHTML = ''
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn-secundario'
    b.textContent = texto
    b.title = titulo
    b.addEventListener('click', async () => { b.disabled = true; try { await aoClicar() } finally { b.disabled = false } })
    area.appendChild(b)
  }

  // "AAAA-_" (base64 de URL) -> bytes, no formato que o navegador pede
  function chaveEmBytes(base64url) {
    const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  }

  async function ativar() {
    // A permissão precisa ser pedida direto do toque no botão (regra do iPhone)
    const permissao = await Notification.requestPermission()
    if (permissao !== 'granted') {
      if (permissao === 'denied') mostrarDica('Avisos bloqueados. Libere em Ajustes do iPhone → Notificações → Planilha.')
      return
    }
    let assinatura
    try {
      const registro = await navigator.serviceWorker.ready
      assinatura = (await registro.pushManager.getSubscription())
        || (await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveEmBytes(CHAVE_PUBLICA) }))
      const dados = assinatura.toJSON()
      const { error } = await supabase.from('push_subscriptions').upsert({
        user_id: userId,
        endpoint: dados.endpoint,
        p256dh: dados.keys.p256dh,
        auth: dados.keys.auth,
        user_agent: navigator.userAgent.slice(0, 200),
      }, { onConflict: 'user_id,endpoint' })
      if (error) throw error
    } catch (erro) {
      console.error('Erro ao ativar os avisos:', erro)
      // Sem "meio caminho": se não deu para guardar o aparelho, cancela a inscrição também
      try { await assinatura?.unsubscribe() } catch { /* nada a fazer */ }
      alert(mensagemErro(erro, 'ativar os avisos'))
      return
    }
    await desenhar()
  }

  async function desativar() {
    try {
      const registro = await navigator.serviceWorker.ready
      const assinatura = await registro.pushManager.getSubscription()
      if (assinatura) {
        const { error } = await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', assinatura.endpoint)
        if (error) throw error
        await assinatura.unsubscribe()
      }
    } catch (erro) {
      console.error('Erro ao desativar os avisos:', erro)
      alert(mensagemErro(erro, 'desativar os avisos'))
      return
    }
    await desenhar()
  }

  async function desenhar() {
    if (!suporta) {
      // iPhone no Safari comum: o recurso só existe com o app instalado
      if (ehIphone && !instalado) mostrarDica('Para receber avisos: toque em Compartilhar → Adicionar à Tela de Início e abra o app por lá.')
      else area.innerHTML = ''
      return
    }
    if (Notification.permission === 'denied') { mostrarDica('Avisos bloqueados. Libere nas configurações de notificações do aparelho.'); return }
    let assinatura = null
    try { assinatura = await (await navigator.serviceWorker.ready).pushManager.getSubscription() } catch { /* segue sem */ }
    if (assinatura && Notification.permission === 'granted') {
      mostrarBotao('🔔 Avisos ativados', 'Clique para desativar os avisos neste aparelho', async () => {
        if (confirm('Desativar os avisos neste aparelho?')) await desativar()
      })
    } else {
      mostrarBotao('🔔 Ativar avisos', 'Receba um aviso toda manhã com cobranças, contas a pagar e entregas sem dia', ativar)
    }
  }

  desenhar()
}
