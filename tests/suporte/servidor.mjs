// Servidor de arquivos simples (só Node, sem instalar nada) para os testes de tela.
// Imita o que a Vercel faz com este projeto: "/pages/clientes" abre "pages/clientes.html".
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize, sep } from 'node:path'

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

async function achar(raiz, caminho) {
  const limpo = normalize(decodeURIComponent(caminho)).replace(/^([/\\])+/, '')
  const completo = join(raiz, limpo)
  if (!(completo + sep).startsWith(raiz + sep)) return null // nunca sai da pasta do app
  const candidatos = limpo === '' ? ['index.html'] : [limpo, `${limpo}.html`, join(limpo, 'index.html')]
  for (const c of candidatos) {
    const f = join(raiz, c)
    try { if ((await stat(f)).isFile()) return f } catch { /* tenta o próximo */ }
  }
  return null
}

// Sobe o servidor numa porta livre. Devolve { url, fechar }.
export function iniciarServidor(raiz) {
  const servidor = createServer(async (req, res) => {
    try {
      const caminho = new URL(req.url, 'http://x').pathname
      const arquivo = await achar(raiz, caminho)
      if (!arquivo) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('não existe'); return }
      res.writeHead(200, { 'Content-Type': TIPOS[extname(arquivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
      res.end(await readFile(arquivo))
    } catch {
      res.writeHead(500); res.end('erro')
    }
  })
  return new Promise((resolver) => {
    servidor.listen(0, '127.0.0.1', () => {
      resolver({ url: `http://127.0.0.1:${servidor.address().port}`, fechar: () => new Promise((r) => servidor.close(r)) })
    })
  })
}
