# UX/UI AUDIT REPORT - Lar Digital
**Data:** 28/02/2026
**Versão analisada:** 2.6.0
**Analisado por:** Claude Opus 4.6 (UI/UX Pro Max)
**Escopo:** Todas as 20+ páginas do sistema, login, shared JS, app.js

---

## RESUMO EXECUTIVO

O sistema Lar Digital apresenta uma base sólida com Bootstrap 5, boa estrutura SPA e padrões consistentes de cards/tabelas. Porém, existem **problemas significativos** em acessibilidade, formatação de moeda, acentuação em português, confirmações nativas do browser, e responsividade de tabelas em mobile. A correção dos itens críticos e major elevaria significativamente a percepção profissional do sistema.

**Totais encontrados:**
- Críticos: 8
- Major: 18
- Minor: 24
- Quick Wins: 12

---

## CRITICAL ISSUES (Quebra usabilidade)

### C1. Vulnerabilidade XSS no showToast e modais
- **Página:** Todas (utils.js:33, app.js:94)
- **Problema:** `showToast()` usa `innerHTML` para inserir mensagens. Se a mensagem contiver HTML (ex: erro de API com `<script>`), será executado como código.
- **Impacto:** Segurança - possível injeção de scripts maliciosos
- **Correção:** Trocar `innerHTML` por `textContent` no corpo do toast. No modal body, usar `escapeAttr()` (já existe em app.js:4549) em TODOS os dados dinâmicos.

### C2. Formatação de moeda INCONSISTENTE entre páginas
- **Páginas:** cargos.html, holerites.html vs relatorios.html, funcionarios.html
- **Problema:**
  - `cargos.html:335-339` usa `Number(v).toFixed(2)` → mostra "50.00" (ponto em vez de vírgula, sem separador de milhar)
  - `holerites.html:250` usa `.toFixed(2).replace('.', ',')` → "50,00" (sem separador de milhar)
  - `relatorios.html:223` usa `toLocaleString('pt-BR')` → "1.000,00" (CORRETO)
  - `funcionarios.html:538` usa `toLocaleString('pt-BR')` → "1.000,00" (CORRETO)
- **Impacto:** Valores monetários exibidos de forma diferente em cada página. Valores grandes ficam ilegíveis ("R$ 1000.00" vs "R$ 1.000,00").
- **Correção:** Padronizar TODAS as páginas com: `'R$ ' + Number(v).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})`

### C3. Classes Tailwind dinâmicas não compilam (Dashboard)
- **Página:** dashboard.html:370-371
- **Problema:** Usa `bg-${info.color}-100` e `text-${info.color}-600` como classes dinâmicas. O Tailwind CSS purge/JIT NÃO gera classes que não aparecem literalmente no código.
- **Impacto:** Widget de pendências aparece sem cores (background transparente, texto sem cor)
- **Correção:** Usar classes explícitas com mapeamento: `const colorMap = { blue: 'bg-blue-100 text-blue-600', ... }`

### C4. Sem favicon, manifest ou meta tags de SEO
- **Página:** index.html, login.html
- **Problema:** Nenhum favicon configurado. Aba do browser mostra ícone genérico. Sem manifest.json para PWA. Sem `<meta name="description">`, `<meta name="theme-color">`.
- **Impacto:** Visual amador na aba do browser. App não instalável como PWA no celular. Sem branding visual.
- **Correção:** Criar favicon.svg/ico, apple-touch-icon.png, manifest.json, e adicionar meta tags.

### C5. Formulários sem associação label/input (Acessibilidade)
- **Páginas:** registros.html:188-208, cargos.html:175, funcionarios.html (modal inteiro), tarefas.html
- **Problema:** Labels `<label class="form-label">` existem mas SEM atributo `for="input-id"`. Inputs não têm `id` correspondente.
- **Impacto:** Screen readers não associam label ao campo. Clicar no label não foca o input. Viola WCAG 2.1 critério 1.3.1.
- **Correção:** Adicionar `for="campo-id"` em todos os labels e `id="campo-id"` nos inputs.

### C6. Confirmações usam `confirm()` nativo do browser (9 ocorrências)
- **Páginas:** registros.html:402, feriados.html:432, cargos.html:452, funcionarios.html:1036, usuarios.html:462, ferias.html:502, perfil.html:355, sugestoes.html:431,444
- **Problema:** Diálogos nativos `confirm()` são visualmente inconsistentes com o design do app. Não podem ser estilizados. Texto sem acentos em algumas ocorrências ("funcionario", "nao serao").
- **Impacto:** Quebra a identidade visual. Parece app amadora. Texto com erros de português.
- **Correção:** Substituir TODOS por `showConfirmModal()` customizado (já existe padrão no app.js com `confirmAction()`).

### C7. Tabelas NÃO responsivas em mobile
- **Páginas:** relatórios (folha com 10+ colunas), audit-log, presença (heatmap), holerites
- **Problema:** Maioria das tabelas usa `.data-table` wrapper mas sem `overflow-x-auto` ou indicador de scroll horizontal. Em telas < 768px, tabelas ficam cortadas ou comprimidas.
- **Impacto:** Dados ilegíveis no celular. Usuário não sabe que pode scrollar horizontalmente.
- **Correção:** Adicionar `<div class="table-responsive">` wrapper em TODAS as tabelas. Adicionar indicador visual de scroll (gradiente ou seta).

### C8. Senha mínima inconsistente (6 vs 8 caracteres)
- **Páginas:** login.html:337, perfil.html:152, usuarios.html:165 vs login.html:328
- **Problema:** Formulário de esqueci-senha diz "mínimo 8 caracteres" mas inputs têm `minlength="6"`. CLAUDE.md diz 8.
- **Impacto:** Usuário pode criar senha de 6 chars que depois não funciona, ou vice-versa.
- **Correção:** Padronizar para `minlength="8"` em TODOS os campos de senha. Mensagem: "Mínimo 8 caracteres".

---

## MAJOR ISSUES (Parece não-profissional)

### M1. Dezenas de palavras sem acento em português
- **Páginas e ocorrências:**
  - presenca.html: "Presenca"→"Presença", "Mes"→"Mês", "Funcionario"→"Funcionário", "Uteis"→"Úteis", "Media"→"Média"
  - feriados.html: "Descricao"→"Descrição", "Acoes"→"Ações", "Terca"→"Terça", "Sabado"→"Sábado"
  - whatsapp.html: "Conexao"→"Conexão", "Reconexao"→"Reconexão", "Ate"→"Até"
  - cargos.html: "Gestao"→"Gestão", "Beneficios"→"Benefícios", "mes"→"mês"
  - insights.html: "Analise"→"Análise", "Diario"→"Diário", "Periodo"→"Período", "analisara"→"analisará", "Sugestoes"→"Sugestões", "Pagina"→"Página"
  - audit-log.html: "Usuario"→"Usuário", "Acao"→"Ação", "Pagina"→"Página"
  - perfil.html: "Informacoes"→"Informações", "Autenticacao"→"Autenticação", "Codigo"→"Código", "nao"→"não", "digitos"→"dígitos", "esta"→"está"
  - login.html: "Codigo"→"Código" (2FA label), "valido"→"válido" (erro email)
- **Impacto:** Sistema parece descuidado. Perde credibilidade profissional.
- **Correção:** Corrigir TODOS os acentos em TODOS os arquivos HTML.

### M2. Sidebar com ordem incorreta de itens
- **Página:** index.html:81-182
- **Problema:** Cargos aparece na posição 9 (após WhatsApp). CLAUDE.md especifica posição 3 (após Funcionários).
- **Impacto:** Fluxo lógico quebrado. Usuário cadastra cargo ANTES de funcionário, mas precisa navegar longe.
- **Correção:** Mover `<li>` de Cargos para logo após Funcionários.

### M3. Ícones duplicados na sidebar (Insights e Sugestões)
- **Página:** index.html:154,159
- **Problema:** Ambos usam `bi-lightbulb`. Usuário não consegue distinguir visualmente.
- **Correção:** Trocar Sugestões para `bi-chat-square-text` ou `bi-stars`.

### M4. Página 404 é texto puro sem estilo
- **Página:** app.js:420
- **Problema:** Mostra apenas `<p>Página não encontrada</p>` sem ícone, sem link para voltar.
- **Impacto:** Usuário fica perdido sem saber o que fazer.
- **Correção:** Adicionar empty-state com ícone, mensagem amigável e botão "Voltar ao Dashboard".

### M5. Dark mode - inputs com placeholder invisível no login
- **Página:** login.html:99-105
- **Problema:** Placeholder usa `#6b7280` em background `#1f2937`. Contraste insuficiente.
- **Impacto:** Usuário no dark mode não vê placeholder text.
- **Correção:** Mudar placeholder para `#9ca3af` ou mais claro.

### M6. Toast de erro some em 4 segundos (muito rápido)
- **Página:** Todas (utils.js:38, shared.js:143)
- **Problema:** Timeout fixo de 4000ms para TODOS os toasts, inclusive erros longos.
- **Impacto:** Usuário não consegue ler mensagem de erro antes de sumir.
- **Correção:** Erros: 8000ms. Sucesso: 4000ms. Ou adicionar parâmetro de duração.

### M7. Empty states inconsistentes entre páginas
- **Páginas diversas:**
  - BOM: cargos.html, entregas.html (ícone + mensagem + dica de ação)
  - RUIM: documentos "Nenhum documento encontrado" (texto puro, sem ícone)
  - RUIM: estoque "Nenhum item encontrado" (texto em célula de tabela)
  - RUIM: access-log "Nenhum registro" (sem ícone, sem dica)
- **Correção:** Padronizar: ícone grande + mensagem + sugestão de ação em TODAS as páginas.

### M8. Título da página é `<h2>` quando deveria ser `<h1>`
- **Página:** index.html:200
- **Problema:** Page title usa `<h2>` mas é o heading principal do conteúdo. Semanticamente deve ser `<h1>`.
- **Impacto:** SEO e acessibilidade prejudicados.
- **Correção:** Trocar para `<h1>` com mesmo estilo visual.

### M9. Sem skip-to-content link para navegação por teclado
- **Página:** index.html
- **Problema:** Usuário de teclado precisa navegar por TODA a sidebar antes de chegar ao conteúdo.
- **Impacto:** Viola WCAG 2.1 critério 2.4.1.
- **Correção:** Adicionar link invisível no topo: `<a href="#main-content" class="sr-only">Pular para conteúdo</a>`.

### M10. Botões de ação em tabelas muito pequenos no mobile
- **Páginas:** usuarios.html:322-336, ferias.html:380-391, registros, cargos
- **Problema:** Botões com `px-2 py-1.5` ou `btn-sm` ficam abaixo do mínimo de 44x44px para touch.
- **Impacto:** Difícil de tocar em celular. Usuário acerta botão errado.
- **Correção:** Garantir `min-width: 44px; min-height: 44px` em botões de ação mobile.

### M11. Formulário de funcionário excessivamente longo
- **Página:** funcionarios.html (modal com 250+ linhas de form)
- **Problema:** Todo o cadastro em um único modal scrollável. Sem tabs ou steps.
- **Impacto:** Usuário se perde no formulário. Intimidante para novos usuários.
- **Correção:** Dividir em tabs: Dados Pessoais | Documentos | Benefícios | Endereço | Jornada.

### M12. Validação de formulários mostra apenas toast genérico
- **Páginas:** app.js:1240, e diversas
- **Problema:** `showToast('Preencha todos os campos obrigatórios', 'danger')` sem indicar QUAIS campos.
- **Impacto:** Usuário precisa procurar qual campo está faltando.
- **Correção:** Adicionar classe `.is-invalid` nos campos vazios + mensagem inline.

### M13. Presença: barra de progresso usa só cor (sem texto)
- **Página:** presenca.html:330
- **Problema:** Progress bar mostra verde/amarelo/vermelho mas sem texto de porcentagem dentro.
- **Impacto:** Usuário daltônico não consegue distinguir status.
- **Correção:** Adicionar texto da porcentagem dentro da barra.

### M14. Gráficos: sem loading state durante geração
- **Página:** relatorios-graficos.html
- **Problema:** Charts renderizam sem spinner enquanto API busca dados.
- **Impacto:** Usuário vê área vazia sem saber se está carregando.
- **Correção:** Adicionar spinner enquanto Chart.js processa.

### M15. Versioning inconsistente nos scripts
- **Página:** index.html:12,250-251
- **Problema:** style.css?v=3, utils.js?v=1, app.js?v=4. Versões diferentes e desatualizadas.
- **Impacto:** Cache do browser pode servir versão antiga.
- **Correção:** Usar versão do sistema (2.6.0) ou hash de build em todos os recursos.

### M16. Chat WhatsApp: altura fixa de 350px
- **Página:** app.js:4956-4969
- **Problema:** Container do chat tem altura fixa. Em mobile, ocupa pouco da tela.
- **Impacto:** Experiência ruim em telas pequenas e grandes.
- **Correção:** Usar `max-height: 60vh` ou similar responsivo.

### M17. Filtros não persistem ao navegar entre páginas
- **Páginas:** Todas com filtros (registros, relatórios, presença, tarefas)
- **Problema:** Ao trocar de página e voltar, filtros resetam para default.
- **Impacto:** Usuário perde contexto de trabalho.
- **Correção:** Salvar filtros em `sessionStorage` por página.

### M18. Sem indicador de filtro ativo
- **Páginas:** Todas com filtros
- **Problema:** Não há badge/chip mostrando quais filtros estão aplicados.
- **Impacto:** Usuário não sabe se resultados estão filtrados ou se realmente não há dados.
- **Correção:** Adicionar "Filtros ativos: Mês: Fev, Funcionário: Maria" como badges.

---

## MINOR ISSUES (Bom corrigir)

### m1. Login: sem indicador de requisitos de senha
- **Página:** login.html:337
- Campo de senha não mostra "Mínimo 8 caracteres" como helper text.

### m2. Login: campo TOTP sem feedback visual de erro
- **Página:** login.html:540
- Erro no código 2FA mostra texto mas não destaca o campo com borda vermelha.

### m3. Login: sucesso mostrado por apenas 500ms
- **Página:** login.html:585
- Botão "Sucesso!" com checkmark aparece por 500ms antes do redirect. Muito rápido.

### m4. Login: toggle de tema no login confuso
- **Página:** login.html:164-189
- Theme toggle na tela de login é inesperado. Usuário não logou ainda.

### m5. Registros: observação truncada sem tooltip
- **Página:** registros.html:324
- Coluna de observação cortada sem `title` attribute para ver o texto completo.

### m6. WhatsApp: mensagem truncada em 80 chars sem expansão
- **Página:** whatsapp.html:316
- Sem click-to-expand ou tooltip para ver mensagem completa.

### m7. Relatórios: abreviações sem explicação
- **Página:** relatorios.html:442-454
- Headers "H.Trab", "Pgto HE", "Pgto FDS" sem tooltip explicativo.

### m8. Relatórios: ano como input number em vez de dropdown
- **Página:** relatorios.html:126-144
- Input `type="number"` permite digitar anos inválidos (2099, -5).

### m9. Feriados: feriados manuais sem distinção visual
- **Página:** feriados.html
- Feriados com `manual=true` não têm badge ou ícone diferenciando de sincronizados.

### m10. Insights: texto longo sem expand/collapse
- **Página:** insights.html:309-339
- Cards de insight truncam texto sem opção de expandir.

### m11. Audit-log: headers all-caps difíceis de ler
- **Página:** audit-log.html:168-176
- `uppercase tracking-wider` em headers torna leitura mais difícil.

### m12. Audit-log: detalhes truncados em 80 chars
- **Página:** audit-log.html:257-268
- JSON de detalhes cortado sem opção de ver completo.

### m13. Veículos: alertas não destacados na listagem principal
- **Página:** veículos
- Alertas de IPVA/revisão existem em endpoint separado mas não são visíveis na lista.

### m14. Férias: cálculo de período usa 29 dias em vez de 30
- **Página:** ferias.html:453-458
- Auto-fill de data final adiciona 29 dias ao invés do período legal de 30.

### m15. Férias: `toISOString()` pode causar problema de timezone
- **Página:** ferias.html:272-303
- Deveria usar `toLocaleDateString('sv-SE', {timeZone:'America/Sao_Paulo'})`.

### m16. Entregas: botão "Extrair Detalhes (OCR)" enganoso
- **Página:** entregas.html:333-335
- Usa Vision AI da Anthropic, não OCR. Texto confunde o usuário.

### m17. Estoque: sem importação em massa
- **Página:** estoque
- Sem opção de importar CSV/Excel para cadastro inicial.

### m18. Tarefas: tarefas atrasadas pouco visíveis
- **Página:** tarefas
- Apenas borda vermelha. Deveria ter badge "ATRASADA" ou destaque maior.

### m19. Gráficos: download PNG sem escolha de nome
- **Página:** relatorios-graficos.html:574-595
- Arquivo baixado com nome genérico sem prompt.

### m20. Gráficos: cores repetem com mais de 10 funcionários
- **Página:** relatorios-graficos.html:484-530
- Paleta de cores insuficiente para muitos funcionários.

### m21. Modal fecha ao clicar fora sem aviso
- **Páginas:** Todas
- Modais com formulário preenchido fecham sem perguntar "Tem certeza?".

### m22. Sem paginação na maioria das tabelas
- **Páginas:** Funcionários, registros (mensal), cargos, feriados
- Apenas audit-log tem paginação. Outras listam tudo de uma vez.

### m23. Loading spinner sem aria-label
- **Página:** app.js:399
- Spinner de carregamento não tem `role="status"` ou `aria-label` para screen readers.

### m24. Inputs numéricos sem `min="0"` em cargos
- **Página:** cargos.html:194-243
- Permite digitar valores negativos para hora extra, VA, VT.

---

## QUICK WINS (Fácil corrigir, grande impacto)

### Q1. Corrigir TODOS os acentos em português (~30min)
- Buscar e substituir em todos os HTML: "Periodo"→"Período", "Conexao"→"Conexão", etc.
- **Impacto:** Profissionalismo imediato.

### Q2. Padronizar formatCurrency em 2 arquivos (~10min)
- cargos.html e holerites.html: trocar `.toFixed(2)` por `.toLocaleString('pt-BR', ...)`
- **Impacto:** Valores monetários legíveis em todo o sistema.

### Q3. Adicionar `<div class="table-responsive">` em tabelas (~15min)
- Envolver tabelas existentes com div responsivo.
- **Impacto:** Tabelas usáveis em mobile.

### Q4. Trocar `confirm()` nativo por `confirmAction()` (~30min)
- 9 ocorrências. Já existe a função `confirmAction()` pronta.
- **Impacto:** Consistência visual em ações destrutivas.

### Q5. Adicionar favicon.svg (~5min)
- Criar SVG simples com ícone da casa/relógio e adicionar `<link rel="icon">`.
- **Impacto:** Branding profissional na aba do browser.

### Q6. Aumentar toast timeout de erros para 8s (~2min)
- Mudar timeout para 8000ms quando type === 'danger'.
- **Impacto:** Usuário consegue ler mensagens de erro.

### Q7. Mover Cargos na sidebar (~2min)
- Mover o `<li>` de Cargos para após Funcionários no index.html.
- **Impacto:** Navegação lógica.

### Q8. Trocar ícone de Sugestões (~1min)
- Mudar `bi-lightbulb` para `bi-chat-square-text` ou `bi-stars`.
- **Impacto:** Distinção visual entre Insights e Sugestões.

### Q9. Adicionar `title` em textos truncados (~10min)
- Adicionar `title="${textoCompleto}"` em colunas com `truncate`.
- **Impacto:** Usuário pode ver conteúdo completo no hover.

### Q10. Corrigir minlength de senha para 8 (~5min)
- Mudar `minlength="6"` para `minlength="8"` em perfil.html e usuarios.html.
- **Impacto:** Consistência com regra de negócio.

### Q11. Adicionar `for` nos labels dos formulários (~20min)
- Adicionar associações label/input em formulários principais.
- **Impacto:** Acessibilidade e usabilidade (clicar no label foca input).

### Q12. Melhorar 404 page (~5min)
- Trocar `<p>` simples por empty-state com ícone e botão "Voltar".
- **Impacto:** Melhor orientação para usuário perdido.

---

## PAGE-BY-PAGE FINDINGS

### LOGIN (login.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | Visual | Dark mode: placeholder invisível em inputs | Major |
| 2 | Usability | Sem indicador de requisitos de senha (mínimo 8 chars) | Minor |
| 3 | Usability | Fluxo esqueci-senha sem indicador de progresso (step 1/2) | Minor |
| 4 | Feedback | Sucesso aparece por 500ms apenas | Minor |
| 5 | i18n | Typo: "Codigo 2FA" → "Código 2FA" | Major |
| 6 | i18n | Typo: "e-mail valido" → "e-mail válido" | Major |
| 7 | Acessibilidade | Toggle tema sem context para login page | Minor |
| 8 | Acessibilidade | Botão toggle senha sem focus visible | Minor |
| 9 | Branding | Sem favicon na aba | Major |
| 10 | Segurança | Campo senha não limpa após erro de login | Minor |

### DASHBOARD (dashboard.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | Critical | Classes Tailwind dinâmicas `bg-${color}-100` não compilam | Critical |
| 2 | Acessibilidade | Spinner sem aria-label | Minor |
| 3 | Acessibilidade | Badges de status sem alt text | Minor |
| 4 | Usability | Stats sem ação (ex: "3 atrasados" sem link para ver quem) | Minor |

### FUNCIONÁRIOS (funcionarios.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | Usability | Formulário muito longo sem tabs/steps | Major |
| 2 | Currency | Usa `toLocaleString` correto | OK |
| 3 | Validação | CPF tem validação visual real-time (borda verde/vermelha) | OK |
| 4 | Validação | Outros campos só validam no submit | Minor |
| 5 | Acessibilidade | Labels sem `for` attribute | Critical |
| 6 | Confirm | Usa `confirm()` nativo para desativar | Major |
| 7 | Usability | BigDataCorp accordion só aparece após primeira consulta | Minor |

### CARGOS (cargos.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | Currency | Usa `.toFixed(2)` sem separador brasileiro | Critical |
| 2 | i18n | "Gestao", "Beneficios", "mes" sem acento | Major |
| 3 | Validação | Campo "Nome" com `*` mas sem `required` no HTML | Major |
| 4 | Validação | Inputs numéricos permitem negativo (sem `min="0"`) | Minor |
| 5 | Confirm | Usa `confirm()` nativo | Major |
| 6 | Empty State | Excelente: ícone + mensagem + dica de ação | OK |
| 7 | i18n | "Dormida" é arcaico → "Pernoite" | Minor |

### REGISTROS (registros.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | Acessibilidade | Labels sem `for` attribute nos 5 campos do form | Critical |
| 2 | Usability | Observação truncada sem tooltip | Minor |
| 3 | Confirm | Usa `confirm()` nativo para excluir | Major |
| 4 | Validação | Não verifica se entrada > saída (hora) | Minor |
| 5 | Filtro | Smart toggle mês/data é bom | OK |
| 6 | Filtro | Sem botão "Limpar filtros" | Minor |
| 7 | Badges | WA/Manual fonte badges bem implementados | OK |

### RELATÓRIOS (relatorios.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | Currency | Usa `toLocaleString('pt-BR')` correto | OK |
| 2 | Responsive | Folha com 10+ colunas sem scroll horizontal | Critical |
| 3 | Usability | Abreviações (H.Trab, Pgto HE) sem tooltip | Minor |
| 4 | Usability | Ano como input number permite valores inválidos | Minor |
| 5 | Visual | Tabs bem implementadas | OK |
| 6 | Empty State | Bom: "Selecione filtros e clique Gerar" | OK |
| 7 | Export | Botões Excel/PDF com ícone + cor + texto | OK |
| 8 | Loading | Spinner "Gerando relatório..." presente | OK |

### PRESENÇA (presenca.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | i18n | "Presenca", "Mes", "Funcionario", "Uteis", "Media" sem acento | Major |
| 2 | Acessibilidade | Progress bar usa só cor (sem texto %) | Major |
| 3 | Visual | Heatmap mensal muito comprimido | Minor |
| 4 | Usability | Sem legenda de cores no heatmap | Minor |
| 5 | Stats | Cards de resumo bem implementados | OK |

### GRÁFICOS (relatorios-graficos.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | Loading | Sem spinner durante geração dos charts | Major |
| 2 | Visual | Dark mode cores adaptativas | OK |
| 3 | Responsive | Grid responsivo `1col / 2col` implementado | OK |
| 4 | Usability | Download PNG sem escolha de nome | Minor |
| 5 | Scalability | Cores repetem com 10+ funcionários | Minor |

### FERIADOS (feriados.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | i18n | "Descricao", "Acoes", "Terca", "Sabado" sem acento | Major |
| 2 | Confirm | Usa `confirm()` nativo | Major |
| 3 | Visual | Feriados passados com opacidade reduzida | OK |
| 4 | Visual | Feriados manuais sem distinção visual | Minor |
| 5 | Sync | Botão sync com loading state | OK |
| 6 | Empty State | Excelente com sugestões de ação | OK |

### WHATSAPP (whatsapp.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | i18n | "Conexao", "Reconexao", "Ate" sem acento | Major |
| 2 | Visual | Status com dot animado (verde/amarelo/vermelho) | OK |
| 3 | QR Code | Auto-refresh a cada 10s | OK |
| 4 | Usability | Mensagem truncada em 80 chars sem expansão | Minor |
| 5 | Usability | Sem indicador de "última verificação" | Minor |
| 6 | Reconnect | Botão com loading state | OK |

### VEÍCULOS
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | Visual | Alertas IPVA/revisão não destacados na lista | Minor |
| 2 | Usability | CRLV Vision AI + Busca Placa funcionam | OK |
| 3 | Toggle | Inativos com toggle | OK |

### DOCUMENTOS
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | Empty State | Texto puro sem ícone "Nenhum documento encontrado" | Major |
| 2 | Usability | Upload com Vision AI | OK |
| 3 | Visual | Cards com thumbnail | OK |

### ENTREGAS (entregas.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | i18n | Botão "Extrair Detalhes (OCR)" enganoso (usa Vision AI) | Minor |
| 2 | Visual | Cards com thumbnail responsivos | OK |
| 3 | Empty State | Bom com ícone e mensagem | OK |
| 4 | Usability | Info card explica fluxo automático | OK |

### ESTOQUE
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | Empty State | Texto puro em célula de tabela | Major |
| 2 | Usability | Busca real-time funciona | OK |
| 3 | Usability | Sem importação em massa | Minor |
| 4 | Visual | Alerta estoque baixo no topo | OK |

### TAREFAS
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | Visual | Tarefas atrasadas pouco visíveis | Minor |
| 2 | Usability | Multi-select funcionários com checkboxes | OK |
| 3 | Filtros | Status/prioridade/funcionário | OK |
| 4 | Usability | Sem percentual de conclusão | Minor |

### INSIGHTS IA (insights.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | i18n | "Analise", "Diario", "Periodo", "Pagina" sem acento (7+ ocorrências) | Major |
| 2 | Usability | Texto truncado sem expand | Minor |
| 3 | Paginação | Funciona mas sem atalhos de teclado | Minor |

### SUGESTÕES (sugestoes.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | Confirm | Usa `confirm()` nativo (2x) | Major |
| 2 | Visual | Cards com status/prioridade badges | OK |
| 3 | Usability | Converter em tarefa funciona | OK |
| 4 | Validação | Não valida campos vazios ao salvar | Minor |

### USUÁRIOS (usuarios.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | Confirm | Reenviar senha usa `confirm()` nativo | Major |
| 2 | Visual | Modal de delete dedicado com ícone | OK |
| 3 | Badges | Role e 2FA badges bem implementados | OK |
| 4 | Responsive | Botões de ação apertados em mobile | Major |

### AUDIT LOG (audit-log.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | i18n | "Usuario", "Acao", "Pagina" sem acento | Major |
| 2 | Visual | Headers all-caps difíceis de ler | Minor |
| 3 | Usability | Detalhes truncados em 80 chars | Minor |
| 4 | Paginação | Implementada | OK |
| 5 | Filtros | 6 filtros em grid | OK |

### LOG DE ACESSOS
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | Empty State | "Nenhum registro" sem ícone | Major |
| 2 | Date | Usa `toLocaleString` com timezone | OK |

### PERFIL (perfil.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | i18n | "Informacoes", "Autenticacao", "Codigo", "nao", "digitos", "esta" sem acento | Major |
| 2 | Confirm | Desativar 2FA usa `confirm()` nativo | Major |
| 3 | 2FA | 4 estados bem implementados | OK |
| 4 | Visual | QR code com manual secret key | OK |
| 5 | Validação | `minlength="6"` deveria ser 8 | Critical |

### HOLERITES (holerites.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | Currency | Usa `.toFixed(2).replace('.', ',')` sem separador de milhar | Critical |
| 2 | Responsive | Tabela com muitas colunas sem scroll | Major |
| 3 | Print | Estilos de impressão existem mas sem page breaks | Minor |
| 4 | Visual | Header azul com bom contraste | OK |

### FÉRIAS (ferias.html)
| # | Tipo | Issue | Severidade |
|---|------|-------|-----------|
| 1 | Confirm | Cancelar férias usa `confirm()` nativo | Major |
| 2 | Cálculo | Auto-fill usa 29 dias (deveria ser 30) | Minor |
| 3 | Timezone | `toISOString()` pode dar data errada | Minor |
| 4 | Badges | Status com cores bem mapeadas | OK |

---

## SCORE POR CATEGORIA

| Categoria | Score | Notas |
|-----------|-------|-------|
| Visual/Design | 7/10 | Bom uso de Bootstrap, cards e cores. Falta polish. |
| Hierarquia | 7/10 | Stats cards no topo, ações claras. Sidebar desordenada. |
| Usabilidade | 6/10 | Muitos confirm() nativos, form longo, filtros sem persistência. |
| Mobile | 5/10 | Sidebar responsiva OK, mas tabelas e modais quebram. |
| Consistência | 5/10 | Currency e empty states variam entre páginas. |
| Empty States | 6/10 | Algumas páginas excelentes, outras sem tratamento. |
| Loading | 7/10 | Spinners presentes na maioria, mas inconsistentes. |
| Erros | 6/10 | Toast funciona mas genérico. Timeout curto. |
| Feedback | 8/10 | showToast() bem usado para CRUD. |
| Navegação | 7/10 | Sidebar funcional mas ordem incorreta. |
| Formulários | 5/10 | Faltam labels associados, validação inline, tabs. |
| Acessibilidade | 4/10 | Muitas lacunas: labels, ARIA, contraste, focus. |
| Português | 4/10 | Dezenas de palavras sem acento. |

**Score geral: 5.9/10**

---

## PRIORIZAÇÃO RECOMENDADA

### Sprint 1 - Quick Wins (1-2 dias)
1. Q1: Corrigir acentos em português
2. Q2: Padronizar formatCurrency
3. Q4: Trocar confirm() por confirmAction()
4. Q5: Adicionar favicon
5. Q7: Reordenar sidebar
6. Q8: Trocar ícone Sugestões
7. Q10: Corrigir minlength senha
8. Q12: Melhorar 404

### Sprint 2 - Responsividade (2-3 dias)
1. Q3: Adicionar table-responsive
2. C3: Corrigir classes Tailwind dinâmicas
3. M10: Touch targets em botões mobile
4. M16: Chat WhatsApp responsivo

### Sprint 3 - Acessibilidade (2-3 dias)
1. Q11: Labels com for nos formulários
2. M9: Skip-to-content link
3. M13: Texto em progress bars
4. m23: aria-label em spinners
5. M8: h1 no título da página

### Sprint 4 - UX Aprimorado (3-5 dias)
1. M7: Padronizar empty states
2. M11: Tabs no form de funcionário
3. M12: Validação inline nos forms
4. M6: Toast timeout variável
5. M17: Persistência de filtros
6. M18: Indicador de filtros ativos

---

*Relatório gerado automaticamente. Nenhuma alteração foi feita no código.*
