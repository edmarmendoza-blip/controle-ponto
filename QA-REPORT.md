# Relatório de QA — Lar Digital

**Data:** 2026-02-28
**Stack:** Node.js 20 + Express + SQLite (better-sqlite3) + Bootstrap 5 + JS Vanilla (SPA)
**Arquivos analisados:** 65+
**Versão:** 2.6.1

## Resumo Executivo

| Métrica | Valor |
|---|---|
| Total de issues | 74 |
| 🔴 Críticas | 11 |
| 🟠 Altas | 24 |
| 🟡 Médias | 29 |
| 🔵 Baixas/Info | 10 |
| **Score geral** | **5.8/10** |

O sistema tem uma base sólida (auth com refresh tokens, audit log, validação backend, prepared statements), mas apresenta vulnerabilidades de segurança importantes, problemas de performance em queries N+1 e índices ausentes, e dívida técnica significativa no frontend monolítico e código duplicado.

---

## 🔴 Issues Críticas (10)

| # | Categoria | Arquivo:Linha | Descrição | Fix Sugerido | Esforço |
|---|---|---|---|---|---|
| 1 | Segurança | `server.js:38` | **CORS totalmente aberto** — `app.use(cors())` aceita requisições de qualquer origem | Restringir: `cors({ origin: ['https://lardigital.app', 'https://sandbox.lardigital.app'] })` | ⚡ |
| 2 | Segurança | `src/routes/whatsapp.js:19` | **QR WhatsApp sem autenticação** — qualquer pessoa pode acessar `/api/whatsapp/qr` e sequestrar sessão | Adicionar `authenticateToken, requireAdmin` à rota | ⚡ |
| 3 | Segurança | `server.js:28-31` | **CSP com unsafe-inline em scriptSrc** — anula proteção contra XSS | Migrar scripts inline para .js separados e usar nonces CSP | 🏗️ |
| 4 | Segurança | `public/login.html:419` | **JWT em localStorage + unsafe-inline** — qualquer XSS rouba o token | Migrar para HttpOnly cookies com SameSite=Strict | 🏗️ |
| 5 | Performance | `src/routes/relatorios.js:155-184` | **N+1 queries na folha de pagamento** — 3 queries por funcionário (cargos, registros, VT) | Buscar todos os cargos e registros do mês em 1 query cada, agrupar por ID | 🔧 |
| 6 | Performance | `src/services/whatsapp.js:518,792,1264,1474` | **`Funcionario.getAll()` chamado em toda mensagem WhatsApp** — dezenas de queries/minuto | Cache em memória com TTL de 5 minutos | 🔧 |
| 7 | Bug | `src/config/database.js:16-17` | **`DROP TABLE audit_log`** em migração — perde dados existentes | Renomear para `_old` antes de recriar, ou migrar dados | 🔧 |
| 8 | Bug | `src/config/database.js:186-217` | **`DROP TABLE cargos`** em migração — se INSERT falhar, dados são destruídos | Verificar compatibilidade antes do DROP; usar transação | 🔧 |
| 9 | Bug | `public/js/app.js:4916` | **Estoque renderiza no container errado** — `getElementById('content')` deveria ser `'page-content'` | Trocar `'content'` por `'page-content'` | ⚡ |
| 10 | Código | `public/js/app.js:1-5357` | **Arquivo monolítico de 5357 linhas** — todo o frontend SPA em 1 arquivo, extremamente difícil de manter | Dividir em módulos por página | 🏢 |
| 11 | Performance | `src/config/database.js` | **Índice composto ausente em `registros(funcionario_id, data)`** — padrão de query mais executado (ponto, duplicatas, folha) usa 2 colunas mas só há índices individuais | `CREATE INDEX idx_registros_func_data ON registros(funcionario_id, data)` | ⚡ |

---

## 🟠 Issues de Alta Prioridade (24)

| # | Categoria | Arquivo:Linha | Descrição | Fix Sugerido | Esforço |
|---|---|---|---|---|---|
| 11 | Segurança | `server.js:41` | `express.json()` sem limite de tamanho — suscetível a payloads gigantes | `express.json({ limit: '1mb' })` | ⚡ |
| 12 | Segurança | `src/routes/veiculos.js:69` | POST veículos sem nenhuma validação de body | Adicionar express-validator nos campos críticos | ⚡ |
| 13 | Segurança | `src/routes/estoque.js:54+` | GET/PUT/DELETE sem validação que `:id` é inteiro | `param('id').isInt()` | ⚡ |
| 14 | Segurança | `src/routes/documentos.js:27` | **Path traversal** — `entidade_id` usado direto no path sem sanitização | Validar `parseInt(entidade_id)` antes do multer | ⚡ |
| 15 | Segurança | `src/routes/whatsapp.js:329` | Upload de chat sem `fileFilter` — aceita qualquer tipo de arquivo | Filtrar por image/video/audio/pdf | ⚡ |
| 16 | Segurança | `src/routes/registros.js:88,124` | POST/PUT registros acessíveis a viewers (sem `requireGestor`) | Adicionar `requireGestor` | ⚡ |
| 17 | Segurança | `src/routes/funcionarios.js:330` | Audit log registra `req.body` inteiro — CPF, PIX, dados sensíveis no log | Sanitizar dados antes de logar | 🔧 |
| 18 | Performance | `src/config/database.js:47-662` | `PRAGMA table_info(funcionarios)` executado **7 vezes** no startup | Fazer 1 chamada e reutilizar resultado | ⚡ |
| 19 | Performance | `src/models/DashboardPresenca.js:129` | `getDayType()` chamado N×30 vezes sem cache (N funcs × dias do mês) | Cache por data com Map | 🔧 |
| 20 | Performance | `src/services/schedulers.js:70,95` | `setInterval()` sem guardar referência — memory leak em hot-reload | Armazenar IDs para `clearInterval()` no destroy | ⚡ |
| 21 | Performance | `src/services/horasExtras.js:5-11` | `getConfig()` consulta banco a cada chamada sem cache | Cache com TTL de 5 minutos | ⚡ |
| 22 | Performance | `src/services/whatsapp.js:679+` | `new Anthropic()` instanciado 5x por mensagem | Criar singleton `this._anthropicClient` | ⚡ |
| 23 | Bug | `src/services/whatsapp.js:28-30` | `_chatMemory` Map cresce indefinidamente — keys nunca são removidas | Limpeza periódica de keys com histórico vazio | ⚡ |
| 24 | Bug | `src/services/horasExtras.js:93-95` | Valores hardcoded como fallback (43.25, 320.00, 9.8) — podem gerar cálculos incorretos | Usar COALESCE no SQL ou centralizar defaults | 🔧 |
| 25 | DRY | `app.js:14-31` / `shared.js:10-28` | `api()`, `showToast()`, `formatDate()`, `formatCurrency()` **duplicadas** entre os 2 arquivos | Centralizar em shared.js e remover de app.js | ⚡ |
| 26 | UX | `index.html:76-177` | Sidebar sem `role="navigation"` nem `aria-label` | Adicionar atributos ARIA | ⚡ |
| 27 | UX | `index.html:192` | Botão toggle sidebar sem `aria-label` nem `aria-expanded` | Adicionar atributos de acessibilidade | ⚡ |
| 28 | Código | `app.js:650-1260` | `openFuncionarioModal()` com **610 linhas** — impossível manter | Dividir em sub-funções | 🏗️ |
| 29 | Testes | `tests/` (7 arquivos) | Cobertura <30% — sem testes para veículos, documentos, estoque, tarefas, WhatsApp, cargos | Priorizar testes para folha de pagamento e registros | 🏗️ |
| 30 | Padrão | `login.html` vs `index.html` | Login usa **Tailwind CSS**, resto usa **Bootstrap 5** — 2 frameworks CSS | Unificar em Bootstrap 5 | 🔧 |
| 31 | Performance | `server.js:49` | **Sem cache de arquivos estáticos** — `express.static()` sem `maxAge`/`etag`, cada page load re-baixa CSS/JS/imagens | `express.static(path, { maxAge: '1d', etag: true })` com no-cache para .html | ⚡ |
| 32 | Performance | `src/routes/whatsapp.js:170,205` + `documentos.js:123` + `veiculos.js:162` | **`fs.readFileSync()` para ler imagens** — bloqueia event loop em arquivos multi-MB para Vision AI | Usar `fs.promises.readFile()` (async) | ⚡ |
| 33 | Performance | `src/routes/auth.js` (15 instâncias) | **`require()` dentro de handlers** — bcryptjs, speakeasy, crypto importados dentro de funções em vez do topo | Mover todos os require() para o topo do arquivo | ⚡ |
| 34 | Performance | `src/config/database.js` | **Índice ausente em `access_log(created_at)`** — consultado com ORDER BY DESC em cada acesso admin | `CREATE INDEX idx_access_log_created ON access_log(created_at)` | ⚡ |

---

## 🟡 Issues de Média Prioridade (29)

| # | Categoria | Arquivo:Linha | Descrição | Fix Sugerido | Esforço |
|---|---|---|---|---|---|
| 35 | Segurança | `src/models/Funcionario.js:121` | LIKE sem escape de `%` e `_` — wildcard matching indesejado | Escapar caracteres especiais no input | ⚡ |
| 36 | Segurança | `src/models/Documento.js:11` | Bug na cláusula `dataFim` — concatenação SQL do `" 23:59:59"` | Concatenar no JavaScript antes do param | ⚡ |
| 37 | Segurança | `src/routes/auth.js:93` | Senha mínima de 6 caracteres — muito fraca | Exigir 8+ caracteres | ⚡ |
| 38 | Segurança | `src/middleware/auth.js:6` | **Token blacklist em memória** — perdida no `pm2 restart`, tokens de logout ficam válidos até expirar (24h) | Armazenar blacklist no SQLite ou reduzir JWT para 1h | 🔧 |
| 39 | Segurança | `src/middleware/rateLimiter.js` | Rate limiter genérico — endpoints com API paga sem limite específico | Criar limiters para enrich-cpf, analyze-crlv, buscar-placa | 🔧 |
| 40 | Segurança | `src/routes/estoque.js:105` | Movimentação de estoque acessível a viewers | Adicionar `requireGestor` | ⚡ |
| 41 | Segurança | `src/routes/whatsapp.js:261+` | Chat WhatsApp acessível a qualquer role | Adicionar `requireGestor` ou `requireAdmin` | ⚡ |
| 42 | Segurança | `server.js:34` | `upgradeInsecureRequests: null` desativado | Habilitar em produção | ⚡ |
| 43 | Segurança | `src/routes/veiculos.js:178` | `err.message` exposto ao cliente — pode vazar info interna | Retornar mensagem genérica, logar detalhes | ⚡ |
| 44 | Bug | `src/services/whatsapp.js:1424` | Download de media duplicado — já baixado na linha 1125 | Reutilizar `_downloadedMedia` | ⚡ |
| 45 | Bug | `src/services/schedulers.js:237` | `sendMonthlyClosing()` sem filtro `aparece_relatorios` — inclui cargos que não deveriam | Filtrar por `aparece_relatorios = 1` | 🔧 |
| 46 | Bug | `src/services/whatsapp.js:750-755` | Race condition em confirmações — UPDATE e INSERT sem transação | Envolver em `db.transaction()` | ⚡ |
| 47 | Bug | `shared.js:8` | Token `const` — se renovado na sessão, shared.js usa o antigo | Trocar para `let` ou ler do localStorage a cada chamada | ⚡ |
| 48 | Bug | `app.js:3911` | `openVeiculoModal()` passa 4 params para `openModal()` que aceita 3 — `'modal-lg'` ignorado | Adicionar 4º param `size` em `openModal()` | ⚡ |
| 49 | Bug | `src/models/Funcionario.js:150-160` | `replaceTransportes()` faz DELETE+INSERT sem transação — se INSERT falhar, dados perdidos | Envolver em `db.transaction()` | ⚡ |
| 50 | Bug | `src/models/Estoque.js:71-93` | `registrarMovimentacao()` INSERT+UPDATE sem transação — crash entre eles corrompe quantidade | Envolver em `db.transaction()` | ⚡ |
| 51 | Performance | `public/js/app.js` (showLocationMap) | Mapa Leaflet criado a cada abertura sem `map.remove()` no fechar — memory leak | Guardar referência e remover no `hidden.bs.modal` | ⚡ |
| 52 | Performance | `src/services/insightsIA.js:10-11` | Novo `Anthropic()` instanciado a cada chamada de insights | Criar singleton no módulo | ⚡ |
| 53 | Performance | `src/services/whatsapp.js:328` | `expireOldConfirmations()` chamado em toda mensagem recebida | Throttle: executar no máximo a cada 5 minutos | ⚡ |
| 54 | Performance | `src/models/Funcionario.js:39` | `findById()` retorna `bigdatacorp_data` (JSON grande) em toda chamada via `SELECT f.*` | Excluir campo e criar `getBigDataCorpData(id)` separado | ⚡ |
| 55 | DRY | `5 arquivos` | **Parsing JSON de IA duplicado 5x** — strip markdown fences + JSON.parse + regex fallback repetido em insightsIA, veiculos, documentos, whatsapp routes | Extrair `parseAIJsonResponse(text)` utilitário | ⚡ |
| 56 | UX | `app.js` (múltiplos) | Loading states ausentes na maioria das chamadas API | Adicionar `showLoading()`/`hideLoading()` nas operações demoradas | 🔧 |
| 57 | UX | `app.js:3648,3839,4193,5098` | `confirm()` nativo em vez de `confirmAction()` — UX inconsistente | Substituir por `confirmAction()` em todos os deletes | ⚡ |
| 58 | UX | `app.js` (gráficos) | Gráficos vazios sem mensagem explicativa | Verificar datasets vazio e mostrar "Sem dados" | ⚡ |
| 59 | Acessibilidade | `app.js` (modais) | Modais sem `aria-labelledby` nos forms | Adicionar referência ao título do modal | ⚡ |
| 60 | Acessibilidade | `index.html:9-11` | CDN links sem SRI (Subresource Integrity) | Adicionar hashes `integrity` e `crossorigin` | ⚡ |
| 61 | Paginação | `funcionarios, documentos, veiculos, entregas` | **Sem paginação** — endpoints retornam TODOS os registros, payload cresce indefinidamente | Adicionar `?page=1&limit=50` nos endpoints de lista | 🔧 |
| 62 | Índices | `src/config/database.js` | Índices ausentes em `documentos(entidade_tipo, entidade_id)` e `estoque_movimentacoes(item_id)` | Criar índices compostos | ⚡ |
| 63 | DB | `src/config/database.js:372` | **UNIQUE constraint ausente em `feriados(data)`** — permite feriados duplicados, `INSERT OR IGNORE` não funciona | Adicionar constraint UNIQUE na coluna data | ⚡ |

---

## 🔵 Melhorias Sugeridas (11)

| # | Categoria | Descrição | Esforço |
|---|---|---|---|
| 64 | Logging | Implementar logger estruturado (winston/pino) em vez de 107+ console.log espalhados | 🔧 |
| 65 | Código | Extrair validação CPF para função reutilizável `isValidCPF(cpf)` (duplicada em 2 pontos) | ⚡ |
| 66 | Código | Extrair `renderChatMessage(msg)` — lógica duplicada entre openChat e sendChat | ⚡ |
| 67 | Código | Extrair `BASE_SELECT_COLUMNS` em Registro.js — colunas SELECT duplicadas 3x | ⚡ |
| 68 | Frontend | Modularizar app.js em ES modules por página | 🏢 |
| 69 | Testes | Testes de integração end-to-end (criar func → bater ponto → gerar relatório) | 🏗️ |
| 70 | Acessibilidade | Adicionar `<caption>` e `scope="col"` nas tabelas para leitores de tela | 🔧 |
| 71 | Acessibilidade | Validação frontend mais robusta (email, telefone, datas) além do `required` HTML | 🔧 |
| 72 | Arquitetura | **Sidebar HTML duplicada em 17+ páginas** — novo link exige editar todos os arquivos | Carregar sidebar via `fetch()` + fragment HTML compartilhado, ou SSR com EJS | 🏗️ |
| 73 | Arquitetura | **Migrações inline sem versionamento** — 300+ linhas de IF/ALTER/try-catch em `database.js` | Criar tabela `migrations` com versão e arquivos .sql separados | 🏗️ |
| 74 | Servidor | **Graceful shutdown não fecha SQLite** — WAL checkpoint pode não ser flushed | Adicionar `db.close()` no shutdown handler de `server.js` | ⚡ |

---

## 🟢 Pontos Positivos

O projeto tem qualidades significativas que merecem destaque:

1. **Prepared Statements em todo lugar** — Todas as queries SQLite usam parâmetros `?`, sem concatenação de strings de usuário. Models usam whitelist `ALL_FIELDS`.
2. **bcrypt com salt 12** — Hash de senhas robusto com custo adequado.
3. **Helmet habilitado** — Headers de segurança básicos ativos.
4. **Tratamento de erros consistente** — Todas as rotas Express seguem padrão `try/catch` com resposta 500 padronizada.
5. **Audit log abrangente** — Ações críticas registradas com user_id, IP e detalhes.
6. **Access log** — Login/logout/falhas registrados com IP e User-Agent.
7. **Validação backend robusta** — `express-validator` com mensagens em português em rotas críticas.
8. **Sistema de permissões 3 roles** — admin/gestor/viewer com middleware granular.
9. **2FA via TOTP** — Implementado corretamente com speakeasy.
10. **Herança Cargo→Funcionário com COALESCE** — Lógica elegante de defaults com override individual.
11. **Estados vazios tratados** — Mensagens amigáveis quando não há dados.
12. **Feedback com Toast** — `showToast()` usado consistentemente para CRUD.
13. **Responsividade mobile** — Media queries, sidebar colapsável, fixes iOS Safari.
14. **Fuso horário global** — America/Sao_Paulo configurado em todos os layers.
15. **Migrações idempotentes** — `CREATE TABLE IF NOT EXISTS` e `ALTER TABLE ADD COLUMN` com try/catch.
16. **Rotas bem organizadas** — Separação por domínio (registros, funcionários, relatórios, etc.).
17. **Serviços separados** — WhatsApp, schedulers, audit log, insights IA bem isolados.

---

## 📋 Plano de Ação Recomendado

### Sprint 1 — Urgente (Segurança + Bugs + Índices) ⚡

- [ ] **#1** Restringir CORS para domínios específicos (`server.js:38`)
- [ ] **#2** Adicionar auth no endpoint QR WhatsApp (`whatsapp.js:19`)
- [ ] **#9** Corrigir container do Estoque (`app.js:4916`)
- [ ] **#11** Criar índice composto `registros(funcionario_id, data)` — melhora dramática nas queries mais executadas
- [ ] **#12** Limitar tamanho do `express.json()` (`server.js:41`)
- [ ] **#15** Sanitizar `entidade_id` no upload de documentos
- [ ] **#16** Adicionar `fileFilter` no upload de chat
- [ ] **#17** Adicionar `requireGestor` em POST/PUT registros
- [ ] **#31** Habilitar cache de estáticos (`express.static` com maxAge)
- [ ] **#34** Criar índice `access_log(created_at)`
- [ ] **#40** Adicionar `requireGestor` em movimentação estoque
- [ ] **#41** Restringir chat WhatsApp por role

### Sprint 2 — Importante (Performance + Validação) 🔧

- [ ] **#5** Resolver N+1 queries na folha de pagamento
- [ ] **#6** Cache de `Funcionario.getAll()` no WhatsApp (TTL 5min)
- [ ] **#19** Cache de `getDayType()` para dashboard/folha
- [ ] **#22** Singleton do Anthropic SDK (5 instâncias → 1)
- [ ] **#32** Trocar `fs.readFileSync()` por `fs.promises.readFile()` (4 arquivos)
- [ ] **#33** Mover `require()` para topo de `auth.js` (15 instâncias)
- [ ] **#13-14** Validação de inputs em veículos e estoque
- [ ] **#18** Sanitizar dados sensíveis no audit log
- [ ] **#25** Eliminar duplicação app.js / shared.js
- [ ] **#45** Filtrar `aparece_relatorios` no monthly closing
- [ ] **#46, #49, #50** Transações em confirmações, transportes e estoque
- [ ] **#55** Extrair `parseAIJsonResponse()` utilitário

### Sprint 3 — Qualidade (UX + Código) 🏗️

- [ ] **#30** Unificar CSS (Tailwind pages → Bootstrap)
- [ ] **#38** Token blacklist persistente (SQLite) ou JWT curto (1h)
- [ ] **#56** Adicionar loading states nas chamadas API
- [ ] **#57** Substituir `confirm()` por `confirmAction()`
- [ ] **#26-27** Atributos ARIA na sidebar
- [ ] **#37** Aumentar senha mínima para 8 caracteres
- [ ] **#62** Criar índices em `documentos` e `estoque_movimentacoes`
- [ ] **#63** UNIQUE constraint em `feriados(data)`

### Backlog — Futuro 🏢

- [ ] **#3-4** Eliminar `unsafe-inline` do CSP + migrar JWT para HttpOnly cookies
- [ ] **#10/68** Modularizar app.js (5357 linhas → módulos por página)
- [ ] **#29/69** Aumentar cobertura de testes (< 30% atual)
- [ ] **#64** Logger estruturado (winston/pino)
- [ ] **#72** Sidebar compartilhada (fragment HTML carregado via fetch)
- [ ] **#73** Sistema de migrações com versionamento

---

## 📊 Métricas do Projeto

| Métrica | Valor |
|---|---|
| Arquivos JS (excl. node_modules) | 52 |
| Total de linhas JS | ~18.000 |
| Maior arquivo frontend | `app.js` — 5.483 linhas |
| Maior arquivo backend | `whatsapp.js` — 1.949 linhas |
| Arquivos > 300 linhas | 12 |
| Cobertura de testes estimada | ~30% (7 de ~23 módulos testados) |
| Arquivos de teste | 7 |
| console.log/error em produção | ~107 |
| Dependências (package.json) | ~25 |
| Tabelas no banco | 18 |
| Endpoints API | ~70+ |
| Páginas HTML standalone (Tailwind) | 17 |
| Instâncias duplicadas Anthropic SDK | 5 |
| require() dentro de handlers | 15 (só auth.js) |
| Índices de banco ausentes | 4 |
