# Testes automáticos da Planilha Inteligente

Esta pasta guarda os testes que provam que o app continua funcionando depois de cada mudança.
**Nada aqui vai para o ar** (a Vercel ignora `tests/`, ver `.vercelignore` na raiz) e **nada aqui toca no Supabase de produção**:
os testes usam um **banco de mentira** em memória, com dados inventados.

## Como rodar

Precisa de: **Node 22 ou mais novo** e o **Edge** ou o **Chrome** instalado (o teste acha sozinho; se não achar, defina
a variável `NAVEGADOR` com o caminho do programa).

```bash
cd tests
npm install          # só uma vez (instala o pacote usado pelo teste da função de avisos)
cd ..
node tests/executar.mjs
```

Cada teste mostra `✓ passou` ou `✗ FALHOU`, e no fim há um resumo. Se algum falhar, o comando termina com erro e mostra as
linhas que importam; o texto completo e as capturas de tela ficam em `tests/_resultados/` (essa pasta é ignorada pelo Git).

Outras formas de usar:

```bash
node tests/executar.mjs --lista                 # lista os testes
node tests/executar.mjs ataque                  # roda só o teste de ataque
node tests/executar.mjs ataque regressao        # roda mais de um
node tests/executar.mjs regressao --ref=HEAD~3  # compara as telas de hoje com as de 3 commits atrás
node tests/executar.mjs ataque --app=106155a    # roda o teste contra o app de OUTRO commit (veja abaixo)
```

### Como saber que um teste realmente detecta defeitos

Um teste que só sabe passar não prova nada. Use `--app=<commit>` para rodar o teste contra um app **que tinha o defeito**:

- `node tests/executar.mjs ataque --app=106155a` → **deve falhar** (`106155a` é o último commit antes da correção de segurança; o teste lista os
  campos que executaram código).
- `node tests/executar.mjs regressao --ref=04fb0ce` → **deve falhar** (`04fb0ce` é anterior ao botão Editar; o teste acusa as telas que mudaram).

Quando os dois falham nesses commits e passam no commit atual, você sabe que os testes enxergam o que prometem.

## O que cada teste confere

| Teste | O que prova |
|---|---|
| `ataque` | **Segurança (XSS):** um texto malicioso digitado em qualquer campo (nome de cliente, cidade, observação, endereço, estoque, entregas...) **não executa código** em nenhuma tela. Resultado esperado: 0 campos disparam. |
| `regressao` | **Nada mudou para quem usa dados normais:** monta o app em outro ponto do Git (`--ref`, padrão `HEAD` = último commit) e o app atual, com os mesmos dados difíceis (`João & Filhos`, `D'Ávila`, `Pet "Top"`), e compara o HTML e o texto de 8 telas. Antes de commitar, ele diz o que sua mudança alterou nas telas. |
| `editar-compra` | Botão Editar nas Compras: pagamento (caixinha "Continua paga por inteiro"), bloqueios, aviso de estoque negativo e falhas. |
| `editar-venda` | Botão Editar nas Vendas (solta e ligada a visita): pagamentos, custo preservado, estoque, falhas. |
| `excluir-visita` | Excluir visita que tem venda de estoque: as 3 opções e as falhas. |
| `calendario` | Entregas com dia marcado aparecem no calendário de Rotas. |
| `avisos-botao` | Botão "Ativar avisos": iPhone sem instalar, permissão negada, falha ao gravar. |
| `console-limpo` | Nenhuma página gera erro de JavaScript. |
| `funcao-avisos-calculo` | Cálculo do aviso diário (fuso de Brasília, vencidas, hoje, amanhã, centavos). |
| `funcao-avisos` | A função `avisos-diarios` inteira (segredo, modos `simular` e `somente_user_id`, aparelho expirado, 1000 linhas). Usa chaves de teste geradas na hora. |

## Como o comando funciona (por dentro)

1. Copia o app (`js`, `css`, `pages`, `icones`...) para uma pasta temporária e **troca `js/supabase.js` pelo banco de mentira**
   (`banco-de-mentira/supabase.js`).
2. Sobe um servidor local (`suporte/servidor.mjs`, só Node, sem instalar nada).
3. Roda cada teste no Edge ou no Chrome instalado no computador, controlado por código (protocolo de depuração do Chrome/Edge).
4. Apaga a pasta temporária e fecha o servidor.

O banco de mentira (`banco-de-mentira/supabase.js`) imita o que o app usa do Supabase (chaves estrangeiras, cascata,
`set null`, checagens) e tem **cenários** escolhidos pela marca `seed` no `localStorage`: `xss` (carga de ataque),
`normal` (dados difíceis), `guia`, `lucro`, `cobrancas`, `entregas`... Para criar um teste novo, copie um existente.

## Cuidados

- **Não coloque aqui nenhum dado de cliente, chave ou senha.** Os testes só usam dados inventados.
- Se mexer no app e um teste falhar, **primeiro entenda por quê**: pode ser um defeito que o teste encontrou.
- Um teste de ataque que passa **não prova que o app está 100% seguro**: ele cobre os campos e as telas que conhecemos. Quando criar
  uma tela nova que mostre texto digitado, acrescente o campo no cenário `xss`.
