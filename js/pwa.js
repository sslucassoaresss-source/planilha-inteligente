// ============================================================
// pwa.js — Liga o app instalado
// ------------------------------------------------------------
// Registra o service worker (sw.js, na raiz do projeto), que dá ao
// app a tela "Sem conexão" quando o celular está sem internet.
// Incluído em todas as páginas.
// ============================================================

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // O endereço é montado a partir deste arquivo (js/pwa.js → ../sw.js),
    // então funciona tanto na tela de login quanto nas páginas em pages/.
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {
      // Falhar aqui não atrapalha o app: só fica sem a tela offline
    });
  });
}
