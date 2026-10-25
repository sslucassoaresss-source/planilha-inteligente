// Descobre o navegador (Edge ou Chrome) usado pelos testes de tela. Nos testes: import { EDGE } from './suporte/navegador.mjs'
// Para usar outro caminho: defina a variável de ambiente NAVEGADOR (ex.: NAVEGADOR="C:/caminho/chrome.exe").
import { existsSync } from 'node:fs'

const CANDIDATOS = [
  process.env.NAVEGADOR,
  // Windows
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  // macOS
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  // Linux
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

export const EDGE = CANDIDATOS.find((c) => existsSync(c))

if (!EDGE) {
  throw new Error(
    'Não encontrei o Edge nem o Chrome neste computador.\n' +
    'Instale um deles, ou diga onde está com a variável NAVEGADOR (ex.: NAVEGADOR="C:/caminho/msedge.exe").',
  )
}
