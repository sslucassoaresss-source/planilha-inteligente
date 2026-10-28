import { supabase } from './supabase.js'

const form = document.getElementById('loginForm')
const errorMsg = document.getElementById('errorMsg')
const btnEntrar = document.getElementById('btnEntrar')
const campoSenha = document.getElementById('password')
const btnVerSenha = document.getElementById('btnVerSenha')

const MSG_SENHA = 'E-mail ou senha incorretos. Tente novamente.'
const MSG_REDE = 'Não consegui falar com o servidor. Confira sua internet e tente de novo.'

function mostrarErro(texto) {
  errorMsg.textContent = texto
  errorMsg.classList.add('show')
}

// Botão Entrar: mostra que está trabalhando e impede o segundo clique
function carregando(sim) {
  btnEntrar.disabled = sim
  btnEntrar.innerHTML = sim ? '<span class="girando" aria-hidden="true"></span>Entrando…' : 'Entrar'
}

// Falha de rede (sem internet, servidor fora) não é "senha errada"
function ehFalhaDeRede(error) {
  if (!navigator.onLine) return true
  const texto = `${error?.name || ''} ${error?.message || ''}`
  return error?.status === 0 || /fetch|network|failed to/i.test(texto)
}

btnVerSenha.addEventListener('click', () => {
  const mostrar = campoSenha.type === 'password'
  campoSenha.type = mostrar ? 'text' : 'password'
  btnVerSenha.setAttribute('aria-pressed', String(mostrar))
  btnVerSenha.setAttribute('aria-label', mostrar ? 'Esconder senha' : 'Mostrar senha')
  campoSenha.focus()
})

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  if (btnEntrar.disabled) return

  errorMsg.classList.remove('show')
  carregando(true)

  const email = document.getElementById('email').value
  const password = campoSenha.value

  let error
  try {
    ({ error } = await supabase.auth.signInWithPassword({ email, password }))
  } catch (falha) {
    error = falha
  }

  if (error) {
    carregando(false)
    mostrarErro(ehFalhaDeRede(error) ? MSG_REDE : MSG_SENHA)
    return
  }

  // Login ok — redireciona pro dashboard
  window.location.href = 'pages/dashboard.html'
})
