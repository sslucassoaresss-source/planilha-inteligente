// ============================================================
// sw.js — Service worker do app instalado
// ------------------------------------------------------------
// Um "service worker" é um pequeno programa que o navegador guarda
// e que fica entre o app e a internet. Aqui ele faz UMA coisa só:
// quando não há internet, em vez da página de erro do navegador,
// mostra a tela "Sem conexão" (offline.html).
//
// Decisões de segurança/simplicidade:
// - Guarda só a tela "Sem conexão" e o visual dela (CSS e ícones).
//   NENHUM dado de cliente, venda ou comissão fica guardado aqui:
//   eles vêm sempre do Supabase.
// - Com internet, tudo vem da rede, como antes: as atualizações
//   publicadas pela Vercel aparecem na hora.
// - Pedidos para outros sites (Supabase, CDN) passam direto.
//
// Ao mudar a lista abaixo, troque a VERSAO para o celular atualizar.
// ============================================================

const VERSAO = 'planilha-inteligente-v1';
const GUARDADOS = ['offline.html', 'css/style.css', 'favicon.svg', 'icones/icone-192.png'];

// Instalação: guarda a tela "Sem conexão"
self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(VERSAO).then((cache) => cache.addAll(GUARDADOS)));
  self.skipWaiting();
});

// Ativação: apaga guardados de versões antigas
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// Cada pedido: tenta a internet; se falhar, usa o que foi guardado
self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET' || new URL(pedido.url).origin !== self.location.origin) return;

  // Telas (navegação): sempre da internet, sem usar a cópia que o
  // navegador guarda sozinho — senão, sem internet, abriria uma tela
  // antiga que não consegue buscar os dados
  const buscar = pedido.mode === 'navigate' ? fetch(pedido, { cache: 'no-store' }) : fetch(pedido);

  evento.respondWith(
    buscar.catch(async () => {
      const guardado = await caches.match(pedido);
      if (guardado) return guardado;
      // Abrir uma tela sem internet → "Sem conexão"
      if (pedido.mode === 'navigate') return caches.match('offline.html');
      return Response.error();
    }),
  );
});
