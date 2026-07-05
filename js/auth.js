import { supabase } from './supabase.js'

const form = document.getElementById('loginForm')
const errorMsg = document.getElementById('errorMsg')

form.addEventListener('submit', async (e) => {
  e.preventDefault()

  const email = document.getElementById('email').value
  const password = document.getElementById('password').value

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })

  if (error) {
    errorMsg.classList.add('show')
    return
  }

  // Login ok — redireciona pro dashboard
  window.location.href = 'pages/dashboard.html'
})