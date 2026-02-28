# CLAUDE.md - Lar Digital

## REGRAS DE OURO - NUNCA VIOLAR

### Proteção do Sistema
1. **LAYOUT É SAGRADO** - O CSS, estrutura HTML e visual atual são APROVADOS pelo dono. NUNCA reescreva style.css, index.html ou app.js inteiros. Faça edições cirúrgicas: adicione, não substitua.
2. **ZERO REGRESSÃO** - Antes de implementar qualquer mudança, liste mentalmente tudo que pode quebrar. Ao adicionar algo novo, GARANTA que TUDO que já existe continua funcionando. Se uma feature parar de funcionar por causa da sua mudança, você falhou.
3. **BANCO É IRREVERSÍVEL** - NUNCA use DROP TABLE, DELETE sem WHERE, ou ALTER TABLE DROP COLUMN. Apenas ALTER TABLE ADD COLUMN. Migrações devem ser idempotentes (rodar 2x sem erro).
4. **ARQUIVOS EXISTENTES** - NUNCA reescreva um arquivo inteiro. Use inserções cirúrgicas. Se precisar mudar 5 linhas num arquivo de 500, mude apenas as 5 linhas.
5. **ESTRUTURA DE PASTAS** - NUNCA mude sem autorização explícita do usuário.

### Ambiente de Trabalho
6. **SANDBOX SEMPRE** - Trabalhe APENAS em `~/controle-ponto-sandbox`. NUNCA toque em `~/controle-ponto` (produção). O usuário faz o deploy quando aprovar.
7. **TESTE ANTES DE REPORTAR** - Após cada mudança, teste com `curl`. Nunca diga "pronto" sem testar.
8. **RESTART OBRIGATÓRIO** - Após qualquer alteração de código: `pm2 restart lardigital-sandbox`
9. **SEM SUDO** - O usuário `claude` não tem sudo. Se precisar de algo com sudo, gere um script e instrua o usuário.
10. **SEM PLAYWRIGHT** - Não use Playwright para testar a menos que explicitamente pedido. Use `curl` para testar APIs e `grep` para verificar HTML.

### Comunicação
11. **PORTUGUÊS SEMPRE** - Reporte status, erros e progresso em português brasileiro.
12. **SEJA ESPECÍFICO** - Não diga "ajustei o código". Diga "adicionei endpoint GET /api/cargos no arquivo routes/cargos.js, linha 45".
13. **REPORTE CHECKLIST** - Ao finalizar, mostre: ✅ feito e testado, ⚠️ parcial, ❌ não consegui (e por quê).

## PROCESSO DE MUDANÇA (OBRIGATÓRIO)

```
1. Recebo pedido de ajuste/feature
2. Leio o CLAUDE.md inteiro para contexto
3. Identifico quais arquivos serão afetados
4. Implemento no SANDBOX (~/controle-ponto-sandbox)
5. Testo CADA alteração com curl
6. Faço pm2 restart lardigital-sandbox
7. Reporto o que fiz em formato checklist
8. Usuário testa em https://sandbox.lardigital.app
9. Usuário aprova → ele faz o sync para produção
```

## REGRA DE DOCUMENTAÇÃO AUTOMÁTICA
TODA vez que implementar uma nova funcionalidade, melhoria ou correção significativa:

1. **ATUALIZAR O CLAUDE.md** imediatamente após implementar
2. Adicionar na seção correspondente (PÁGINAS, TABELAS, API ENDPOINTS, CRON JOBS, etc)
3. Se for feature nova, criar seção própria com:
   - Nome da feature
   - Fluxo de funcionamento
   - Tabelas/campos envolvidos
   - Endpoints criados
   - Regras de negócio
4. Se for melhoria de feature existente, atualizar a seção existente
5. Se criou nova tabela → adicionar em TABELAS DO BANCO
6. Se criou novo endpoint → adicionar em API ENDPOINTS
7. Se criou nova página → adicionar em PÁGINAS DO SISTEMA
8. Se criou novo cron job → adicionar em CRON JOBS

**O CLAUDE.md deve SEMPRE refletir o estado atual do sistema.**
**Se o código faz algo que o CLAUDE.md não descreve, o CLAUDE.md está desatualizado e deve ser corrigido.**
**Nunca diga "pronto" sem ter atualizado o CLAUDE.md.**

## PADRÕES DE CÓDIGO

### Backend (Node.js + Express)
```javascript
// SEMPRE: try/catch em toda rota async
router.get('/api/exemplo', auth, async (req, res) => {
  try {
    const resultado = await db.all('SELECT * FROM tabela');
    res.json({ success: true, data: resultado });
  } catch (error) {
    console.error('[Exemplo] Erro:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao processar' });
  }
});

// SEMPRE: validar inputs
if (!nome || !email) {
  return res.status(400).json({ success: false, error: 'Nome e email são obrigatórios' });
}

// SEMPRE: audit log em ações importantes
await db.run(`INSERT INTO audit_log (user_id, acao, detalhes, ip, created_at)
  VALUES (?, ?, ?, ?, datetime('now','localtime'))`,
  [req.user.id, 'criar_funcionario', JSON.stringify({ nome }), req.ip]);

// NUNCA: datetime('now') → SEMPRE: datetime('now', 'localtime')
// NUNCA: expor senhas ou tokens no response
// NUNCA: confiar só no frontend para validação
```

### Frontend (JavaScript Vanilla + Bootstrap 5)
```javascript
// SEMPRE: funções em camelCase
// SEMPRE: mensagens de erro em português
// SEMPRE: usar showToast() para feedback ao usuário
// SEMPRE: usar showConfirmModal() para ações destrutivas
// SEMPRE: usar o sistema de páginas existente (data-page="nomePagina")

// Para adicionar nova página:
// 1. Adicionar <li> na sidebar do index.html
// 2. Adicionar case no switch de renderização em app.js
// 3. Criar função renderNomePagina() em app.js
// NUNCA: criar arquivos HTML separados para páginas
```

### CSS
```css
/* NUNCA reescrever style.css inteiro */
/* Adicionar novos estilos NO FINAL do arquivo */
/* Usar as variáveis CSS existentes */
/* Manter responsividade (mobile-first) */
```

### Banco de Dados (SQLite)
```sql
-- SEMPRE: migrações idempotentes
CREATE TABLE IF NOT EXISTS nova_tabela (...);

-- NUNCA: DROP TABLE, DELETE sem WHERE
-- SEMPRE: datetime('now', 'localtime') para timestamps
-- SEMPRE: foreign keys referenciando tabelas existentes
```

## PROJETO

**Lar Digital** - Sistema completo de gestão de funcionários domésticos da Casa dos Bull.
- **Domínio produção:** https://lardigital.app
- **Domínio sandbox:** https://sandbox.lardigital.app
- **Servidor:** Digital Ocean Droplet (IP: 137.184.124.137)
- **Usuário deploy:** claude
- **Pasta produção:** /home/claude/controle-ponto (porta 3000) - NÃO MEXER
- **Pasta sandbox:** /home/claude/controle-ponto-sandbox (porta 3001) - TRABALHAR AQUI
- **Proprietário:** Edmar Mendoza Bull (edmarmbull@gmail.com)
- **PM2 produção:** controle-ponto
- **PM2 sandbox:** lardigital-sandbox

## STACK TECNOLÓGICA
- **Backend:** Node.js 20 + Express + SQLite3
- **Frontend:** HTML + Bootstrap 5 + Bootstrap Icons + JavaScript vanilla (SPA single file)
- **Mapas:** Leaflet.js + OpenStreetMap
- **Gráficos:** Chart.js
- **WhatsApp:** whatsapp-web.js
- **Process Manager:** PM2
- **Reverse Proxy:** Nginx + Let's Encrypt SSL
- **E-mail SMTP:** Brevo (smtp-relay.brevo.com:587)
- **IMAP:** Gmail (imap.gmail.com:993)

## BRAND DESIGN SYSTEM (v2.9.0)
### Paleta de Cores
- **Graphite** `#0E1625` — sidebar bg, botões primários
- **Eucalyptus** `#697F71` — sidebar active, accents, links
- **Porcelain** `#F7F4EE` — body background
- **Mist** `#E7ECE8` — hover states, input backgrounds
- **Sand** `#D8CCB8` — secondary accent
- **Indigo** `#7279F8` — highlights, special badges
- **Ink** `#1B2430` — text principal
- **Muted** `#667085` — text secundário
- **Success** `#1F8F5F` / **Warning** `#C98A2E` / **Danger** `#B5473C`
- **Border** `#E8E4DE` — bordas de cards/tabelas

### Arquivos do Brand System
- `public/img/logo.svg` — logo grafite (para fundo claro)
- `public/img/logo-light.svg` — logo branco (para sidebar)
- `public/img/favicon.svg` — favicon (logo em fundo grafite)
- `public/css/brand.css` — variáveis CSS, classes ld-* (sidebar, cards, tables, badges, buttons, inputs, modals)
- `public/components/sidebar.html` — sidebar compartilhada (carregada via JS)

### Sidebar Compartilhada
- Arquivo: `public/components/sidebar.html`
- Carregada por `Shared.loadSidebar()` em `public/js/shared.js`
- Ativada com `<aside id="sidebar" class="ld-sidebar"></aside>` no HTML
- 6 grupos colapsáveis: Operação, Pessoas, Patrimônio, Financeiro, Comunicação, Sistema
- Estado dos grupos salvo em localStorage (`ld_sidebar_groups`)
- Classes: `.ld-sidebar`, `.ld-sidebar-item`, `.ld-sidebar-group`, `.ld-sidebar-item.active`
- User avatar com iniciais, role badge, botão sair

### Tailwind Config (todas as páginas)
```javascript
tailwind.config = {
  theme: { extend: {
    colors: { graphite:'#0E1625', eucalyptus:'#697F71', porcelain:'#F7F4EE',
      mist:'#E7ECE8', sand:'#D8CCB8', indigo:'#7279F8', ink:'#1B2430',
      muted:'#667085', success:'#1F8F5F', warning:'#C98A2E', danger:'#B5473C', border:'#E8E4DE' },
    borderRadius: { sm:'8px', md:'12px', lg:'16px' },
    boxShadow: { sm:'0 1px 3px rgba(14,22,37,0.04)', md:'0 4px 16px rgba(14,22,37,0.06)', lg:'0 8px 40px rgba(14,22,37,0.08)' },
    fontFamily: { sans: ['Inter','-apple-system','BlinkMacSystemFont','sans-serif'] }
  }}
}
```

### Padrão de Página (standalone Tailwind)
```html
<head>
  <link rel="icon" type="image/svg+xml" href="/img/favicon.svg">
  <meta name="theme-color" content="#0E1625">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>tailwind.config = { /* brand colors */ }</script>
  <link rel="stylesheet" href="/css/brand.css">
  <link href="bootstrap-icons CDN" rel="stylesheet">
</head>
<body class="bg-porcelain text-ink">
  <aside id="sidebar" class="ld-sidebar"></aside>
  <div id="sidebar-overlay" class="fixed inset-0 bg-black/30 z-30 hidden md:hidden"></div>
  <main class="ld-content min-h-screen">
    <header class="ld-header">...</header>
    <div class="p-4 md:p-6">...</div>
  </main>
</body>
```

### Regras de Design
- **SEM dark mode** — tema light-only (porcelain/white)
- **Prefixo ld-** em classes do brand.css para evitar conflito com Tailwind
- login.html usa Tailwind + brand.css (sem Bootstrap)
- index.html SPA mantém Bootstrap 5 + style.css (que tem as mesmas variáveis)

## VARIÁVEIS DE AMBIENTE (.env)
```
PORT=3001  # sandbox (produção=3000)
TZ=America/Sao_Paulo
JWT_SECRET=*** (ver .env)
JWT_EXPIRATION=24h
DB_PATH=./database-sandbox.sqlite  # sandbox (produção=database.sqlite)
NODE_ENV=production
WHATSAPP_GROUP_NAME=Casa dos Bull
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=edmarmbull@gmail.com
SMTP_PASS=*** (ver .env)
ALERT_EMAIL_TO=edmarmbull@gmail.com
HOLERITE_IMAP_HOST=imap.gmail.com
HOLERITE_IMAP_PORT=993
HOLERITE_IMAP_USER=edmarmbull@gmail.com
HOLERITE_IMAP_PASS=TROCAR_PELA_APP_PASSWORD
ANTHROPIC_API_KEY=TROCAR_PELA_CHAVE
TWO_FACTOR_ISSUER=LarDigital
APP_URL=https://lardigital.app
APP_NAME=Lar Digital
```

## FUSO HORÁRIO - CRÍTICO
**SEMPRE** America/Sao_Paulo (UTC-3) em todo lugar:
- `process.env.TZ = 'America/Sao_Paulo'` no início do server.js
- SQLite: `datetime('now', 'localtime')` NUNCA `datetime('now')`
- Cron jobs: `{ timezone: "America/Sao_Paulo" }`
- Frontend: `toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })`

## AUTENTICAÇÃO
- JWT + bcrypt | 3 roles: admin, gestor, viewer
- Admin: edmarmbull@gmail.com / Admin@2026!
- 2FA via speakeasy (opcional)
- Senha mínima: 8 caracteres (backend + frontend)
- Esqueci senha: botão no login → email com código → reset (rate limit: 5min entre envios, countdown 60s no frontend)
- Reenviar senha: botão na pág. usuários (admin) → gera temporária → email
- **Refresh Tokens**: access token JWT (24h) + refresh token opaco (30 dias)
  - Tabela: `refresh_tokens` (id, user_id, token, expires_at, created_at)
  - POST /api/auth/refresh: valida refresh token, gera novo access + novo refresh (rotação)
  - Máximo 5 refresh tokens ativos por usuário
  - Frontend: auto-refresh transparente no `api()` ao receber 401
  - Logout: limpa refresh token do banco
  - Login.html: salva refresh token em localStorage (`ponto_refresh_token`)
- **Rate Limiters** (src/middleware/rateLimiter.js):
  - `loginLimiter`: 10 req/15min por IP
  - `apiLimiter`: 100 req/min por IP
  - `paidApiLimiter`: 20 req/hora por usuário — aplicado em enrich-cpf, analyze-crlv, buscar-placa
- **Segurança de erros**: rotas NUNCA expõem err.message ao cliente (apenas console.error no servidor)

## PÁGINAS DO SISTEMA (sidebar - ordem exata)
1. **Dashboard** - Resumo do dia, presentes/ausentes, últimos registros
2. **Funcionários** - CRUD, todos os campos, benefícios, dropdown cargo
3. **Cargos** - CRUD com config de benefícios e regras por cargo
4. **Registros** - Ponto com geo, filtros, edição, tipos: entrada/saída/almoço
5. **Relatórios** - Mensal, export Excel/PDF
6. **Presença** - Calendário visual mensal (filtra por precisa_bater_ponto=1, exclui Dono da Casa/Governanta)
7. **Gráficos** - Chart.js: barras, linha, pizza (filtra por precisa_bater_ponto=1)
8. **Feriados** - SP 2026, sync auto, CRUD manual (manual=true prevalece)
9. **WhatsApp** - QR Code, status, reconectar, parser inteligente
10. **Veículos** - CRUD, CRLV Vision AI, busca por placa (BigDataCorp), alertas IPVA/revisão
11. **Documentos** - Upload, análise Vision AI, vinculação a funcionário/veículo, via WhatsApp
12. **Entregas** - Cards com thumbnail, upload manual com foto, confirmação WhatsApp (SIM/NÃO)
13. **Estoque** - CRUD itens, movimentações (entrada/saída/ajuste), alertas estoque baixo, categorias
14. **Compras** - Listas de compras, histórico de preços, notas fiscais, economia mensal (admin only, bi-cart4)
15. **Despesas** - Reembolso de despesas, aprovação/rejeição, comprovantes, relatório com gráficos (admin only, bi-receipt)
16. **Prestadores** - CRUD prestadores, visitas, pagamentos, frequência (admin only, bi-person-badge)
17. **Tarefas** - CRUD, multi-assign funcionários, prioridade/prazo, integração WhatsApp
18. **Insights IA** - Operacional + Melhorias (admin only)
19. **Sugestões** - Sugestões de melhoria geradas automaticamente do WhatsApp, converter em tarefa (admin only)
20. **Usuários** - CRUD, roles, permissões tarefas, excluir com confirmação, reenviar senha (admin only)
21. **Audit Log** - Log de ações (admin only)
22. **Log de Acessos** - Login/logout/falhas com IP e navegador (admin only, bi-door-open)
23. **Ajuda** - Chat com IA para dúvidas sobre o sistema (todos os usuários, bi-chat-left-dots)
24. **Perfil** - Editar dados, trocar senha, 2FA

## CADASTRO DE CARGOS
nome, precisa_bater_ponto, permite_hora_extra, permite_dia_extra,
valor_hora_extra, valor_dia_extra, recebe_vale_transporte, valor_vale_transporte,
recebe_vale_refeicao, valor_vale_refeicao, recebe_ajuda_combustivel,
valor_ajuda_combustivel, dorme_no_local, dias_dormida (JSON), tipo_dias_dormida (uteis|todos|customizado),
aparece_relatorios (default 1, exclui de todos os relatórios/gráficos quando 0),
ativo, created_at, updated_at
- Frontend: inativos ocultos por padrão, toggle "Mostrar inativos (X)" com contagem

## CADASTRO DE FUNCIONÁRIO
### Dados Pessoais
nome, cargo_id (FK→cargos), telefone, email_pessoal, foto
### Documentos
cpf (validação mod-11 no frontend, botão buscar dados via BigDataCorp), rg, data_nascimento
### Status
classificacao, status (ativo|desligado), data_admissao, data_desligamento
### Datas de Trabalho
data_inicio_trabalho, data_inicio_registro_carteira
- Cross-validation: registro_carteira >= inicio_trabalho, desligamento >= inicio_trabalho
### Endereço
endereco_cep (mask XXXXX-XXX, auto-fill via ViaCEP), endereco_rua, endereco_numero,
endereco_complemento, endereco_bairro, endereco_cidade, endereco_estado (dropdown 27 UFs)
### Contatos Adicionais
telefone_contato2, telefone_emergencia, nome_contato_emergencia
### Benefícios (herda do cargo, editável via checkboxes)
contabiliza_hora_extra, recebe_vt, recebe_va (tem_vale_alimentacao), contabiliza_feriado,
valor_hora_extra, valor_dia_extra, recebe_ajuda_combustivel, valor_ajuda_combustivel,
valor_va_dia
- Cargo change auto-fill: preenche campos vazios com defaults do cargo (HE, VT, VA, combustível)
### Jornada
Texto livre ou JSON: dias_semana, entrada, saída, carga diária
### VT: tipo (diario|pernoite|fixo), múltiplos transportes
### VA: tem_vale_alimentacao, valor_va_dia
### PIX (editável no form): pix_tipo (cpf|cnpj|email|telefone|aleatoria), pix_chave, pix_banco
- Exibido na folha de pagamento como badge
### Férias: período aquisitivo auto, status, alertas 60/30/7 dias
### Foto: upload via POST /api/funcionarios/:id/foto (multer, max 10MB, salva em /public/uploads/funcionarios/)

## TABELAS DO BANCO
users, funcionarios, cargos, registros, feriados (com manual boolean),
funcionario_transportes, entregas, holerites, email_logs,
audit_log, access_log, ferias, pending_confirmations,
tarefas, tarefa_funcionarios, whatsapp_chats, veiculos, documentos,
estoque_itens, estoque_movimentacoes, refresh_tokens,
listas_compras, lista_compras_itens, historico_precos, despesas,
prestadores, prestador_visitas, prestador_pagamentos, email_inbox

## ENTREGAS - FLUXO COMPLETO
### Via WhatsApp (automático com confirmação):
1. Foto chega no grupo WhatsApp
2. whatsapp-web.js salva foto em /uploads/whatsapp/{data}/
3. Vision AI (claude-haiku-4-5-20251001) analisa a imagem em português
4. Se identificada como entrega → cria pending_confirmation tipo='entrega' + pergunta "SIM ou NÃO"
5. Se SIM → busca pending_confirmation, Entrega.create() com dados, status='confirmed'
6. Se NÃO → status='rejected', bot responde "Entrega ignorada"
7. Vincula whatsapp_mensagem_id como FK
8. CHECK constraint: pending_confirmations.tipo inclui 'entrega' (migração automática)

### Via Website (upload manual):
1. Botão "Nova Entrega" na página Entregas
2. Modal com: upload foto, destinatário, remetente, transportadora, data/hora, recebido por, observação
3. POST /api/entregas/upload (multer, max 10MB, só imagens)
4. Foto salva em /public/uploads/entregas/

### Frontend:
- Cards com thumbnail clicável 80x80, data/hora, detalhes
- Modal de imagem ampliada
- Modal de edição de detalhes
- Filtros por data (de/até)

### Regras:
- Fotos que NÃO são entregas (selfies, prints, etc) são ignoradas (via confirmação SIM/NÃO)
- Cada foto gera no máximo 1 registro de entrega
- Campo descricao guarda a análise completa da Vision AI
- Thumbnails servidos via GET /uploads/entregas/{arquivo} ou /uploads/whatsapp/{data}/{arquivo}

## VEÍCULOS
### Tabela: veiculos
id, marca, modelo, ano_fabricacao, ano_modelo, cor, placa (UNIQUE), renavam, chassi,
combustivel (default 'flex'), km_atual, seguradora, seguro_apolice, seguro_vigencia_inicio,
seguro_vigencia_fim, seguro_valor, ipva_valor, ipva_vencimento, ipva_status (pendente|pago),
licenciamento_ano, licenciamento_status, ultima_revisao_data, ultima_revisao_km,
proxima_revisao_data, proxima_revisao_km, responsavel_id (FK→funcionarios),
crlv_foto_path, observacoes, status (ativo|inativo), created_at, updated_at

### API Endpoints
- GET /api/veiculos — lista (param: includeInactive=true)
- GET /api/veiculos/alerts — alertas IPVA, revisão (próximos 30 dias)
- GET /api/veiculos/:id — detalhes
- POST /api/veiculos — criar (gestor)
- PUT /api/veiculos/:id — atualizar (gestor)
- DELETE /api/veiculos/:id — soft delete (gestor)
- POST /api/veiculos/:id/crlv — upload foto CRLV (multer, max 10MB)
- POST /api/veiculos/analyze-crlv — Vision AI (claude-haiku-4-5-20251001) extrai dados do CRLV
- POST /api/veiculos/buscar-placa — BigDataCorp vehiclesv2 lookup por placa

### Frontend
- Sidebar: bi-car-front, após Cargos
- Cards com status, placa, responsável, alertas
- Modal CRUD com todas as seções: dados, seguro, IPVA, revisão, responsável
- Botão "Analisar CRLV": upload foto → IA extrai dados → auto-fill formulário
- Botão "Buscar Placa": consulta BigDataCorp → auto-fill marca/modelo/cor
- Toggle inativos (mesmo padrão de Cargos)

## BIGDATACORP INTEGRAÇÃO
- Token: BIGDATACORP_TOKEN no .env (JWT Bearer)
- **Veículos**: POST /api/veiculos/buscar-placa → BigDataCorp vehiclesv2 (plate lookup)
- **Funcionários**: POST /api/funcionarios/enrich-cpf → BigDataCorp peoplev2 (CPF lookup)
  - Retorna: nome, data_nascimento, rg, email, telefone, endereço completo
  - Frontend: botão de busca ao lado do campo CPF no modal de funcionário
  - Auto-fill: preenche campos vazios sem sobrescrever existentes
  - Audit log: registra consulta (CPF parcialmente mascarado)

## DOCUMENTOS
### Tabela: documentos
id, tipo (crlv|rg|cpf|cnh|comprovante_endereco|apolice_seguro|contrato|holerite|outro),
descricao, entidade_tipo (funcionario|veiculo), entidade_id, arquivo_path, arquivo_original,
dados_extraidos (JSON), enviado_por_whatsapp, whatsapp_mensagem_id, created_at

### API Endpoints
- GET /api/documentos — lista com filtros (tipo, entidade_tipo, entidade_id, dataInicio, dataFim)
- GET /api/documentos/:entidade_tipo/:entidade_id — documentos de uma entidade
- POST /api/documentos/upload — upload com multer (imagem/PDF, max 10MB)
- POST /api/documentos/analyze — Vision AI (claude-haiku-4-5-20251001) análise automática
- DELETE /api/documentos/:id — excluir (gestor)

### Frontend
- Sidebar: bi-file-earmark-text, após Veículos
- Cards com thumbnail, tipo badge, entidade, data
- Modal upload: tipo, entidade, arquivo, botão "Analisar com IA"
- IA identifica tipo, extrai dados, sugere vinculação com funcionário/veículo
- Filtros: tipo, entidade

### WhatsApp Integration
- Admin envia foto privada → bot analisa com Vision AI
- Se documento: identifica tipo, busca match (CPF→funcionário, placa→veículo)
- Pergunta "Deseja salvar? (Sim/Não)" via pending_confirmations (tipo='documento_upload')
- Sim → salva em documentos + move arquivo para pasta da entidade
- Não → descarta

### Storage structure
/uploads/documentos/funcionarios/{id}/, /uploads/documentos/veiculos/{id}/, /uploads/documentos/avulsos/

## FLUXO CARGOS → FUNCIONÁRIOS → RELATÓRIOS

### Regra fundamental: Employee overrides Cargo. Cargo is the default.

### Herança de valores (COALESCE)
```
salario_hora:    COALESCE(NULLIF(func.salario_hora, 0), cargo.valor_hora_extra, 0)
valor_hora_extra: COALESCE(NULLIF(func.valor_hora_extra, 0), cargo.valor_hora_extra, 0)
valor_dia_extra:  COALESCE(NULLIF(func.valor_dia_especial, 0), cargo.valor_dia_extra, 0)
vale_alimentacao: COALESCE(NULLIF(func.valor_va_dia, 0), cargo.valor_vale_refeicao, 0)
combustivel:      cargo.valor_ajuda_combustivel
```

### Funcionários LIST
- Query JOIN com cargos: `salario_hora_display`, `valor_hora_extra_display`, `valor_dia_extra_display`
- Frontend mostra `salario_hora_display` (valor real herdado do cargo)

### Funcionários EDIT
- Cargo é `<select>` dropdown carregado de GET /api/cargos
- Ao trocar cargo: auto-fill campos vazios/zero com defaults do cargo
- Campos com valor do funcionário são preservados (override)

### Relatório Mensal (tab 1)
- Usa mesma lógica de cálculo da Folha de Pagamento (API /api/relatorios/folha)
- Exclui "Dono(a) da Casa" automaticamente
- Colunas dinâmicas: esconde "Extras" se nenhum funcionário tem permiteHE
- Flags do cargo propagados na resposta: permiteHE, permiteDE, precisaBaterPonto

### Folha de Pagamento (tab 2)
- HE: só calcula se cargo.permite_hora_extra OU func.contabiliza_hora_extra
- Dia Extra: só calcula se cargo.permite_dia_extra
- VT: só mostra se cargo.recebe_vale_transporte OU func.recebe_vt
- VA: só mostra se cargo.recebe_vale_refeicao OU func.tem_vale_alimentacao
- Combustível: só mostra se cargo.recebe_ajuda_combustivel
- Cargo "Dono(a) da Casa": excluído completamente
- Se benefício não se aplica: mostra "-" em vez de R$ 0,00
- TOTAL por funcionário: soma apenas o que se aplica

### Migrações automáticas (database.js)
- Cargos essenciais criados automaticamente: Babá, Babá Folguista, Governanta, Caseiro
- Funcionários auto-vinculados a cargo_id por nome (Edmar/Carolina → Dono(a) da Casa)
- Defaults antigos resetados para herdar do cargo (valores zerados)

## LOG DE ACESSOS
- Tabela: access_log (user_id, user_nome, user_email, acao, ip, user_agent, created_at)
- Registra: login (sucesso), login_failed (falha), logout
- API: GET /api/auth/access-log (admin, filtros: acao, startDate, endDate, userId)
- Frontend: página "Log de Acessos" com tabela paginada e badges coloridos

## WHATSAPP + INTELIGÊNCIA ARTIFICIAL
As mensagens do grupo "Casa dos Bull" são interpretadas pela API Claude (Anthropic).
NÃO usar parser manual de palavras-chave. Usar IA para interpretar.

### Fluxo:
1. Mensagem chega no grupo WhatsApp
2. Enviar para API Claude com prompt de interpretação
3. API retorna JSON: {tipo, funcionario, horario, ajuste, confianca}
4. **Com horário explícito** (ex: "cheguei às 8:30"):
   - Confiança >= 90%: registrar automaticamente com o horário mencionado
   - Confiança 50-89%: pedir confirmação SIM/NÃO no WhatsApp
5. **Sem horário explícito** (ex: "cheguei", "voltando do almoço"):
   - Confiança >= 80%: registrar automaticamente com horário atual
   - Confiança 50-79%: pedir confirmação SIM/NÃO no WhatsApp
6. Confiança < 50%: ignorar (criar sugestão se msg >= 5 chars alfanuméricos)

### Config API:
- Endpoint: https://api.anthropic.com/v1/messages
- Model: claude-sonnet-4-20250514
- API Key: ANTHROPIC_API_KEY do .env

### Mensagens Privadas (DM):
- Bot escuta mensagens privadas via `onPrivateMessage()`
- Detecção: `!msg.from.endsWith('@g.us')`
- Permissão: user.role === 'admin' OU user.pode_criar_tarefas_whatsapp
- Chat armazenado em `whatsapp_chats` (tipo: texto/foto/audio/arquivo)
- Tarefas criadas via Claude Haiku (texto e foto)

### Áudio no WhatsApp:
- **Grupo**: Download e armazenamento em `/uploads/whatsapp/{DATA}/`, sem transcrição
- **Privado (autorizado)**: Detecta audio/ptt, salva em `/uploads/whatsapp/audios/`, responde pedindo texto
- Resposta: "🎤 Recebi seu áudio! Infelizmente ainda não consigo transcrever áudios. Por favor, envie como texto."
- Transcrição automática: NÃO implementada (futuramente: Whisper API ou similar)

### Debug Logging:
- `[WhatsApp] Message received: type=... from=... hasMedia=... body="..."` em toda mensagem
- `[WhatsApp] Private message: type=... from=... hasMedia=... body="..."` em mensagens privadas
- `[WhatsApp] Audio saved: /uploads/whatsapp/audios/{arquivo}` quando áudio é salvo
- Verificar com: `pm2 logs lardigital-sandbox --lines 50`

## CRON JOBS
- 20min: Health check WhatsApp → email se offline (schedulers.js, produção only)
- 30min: IMAP holerites
- Dia 01 08:00: Email fechamento mês
- Dia 05 08:00: Email holerites pendentes
- Mensal: Sync feriados via Google Calendar (respeitar manual=true)
- Diário 08:00: Alertas férias
- Diário 09:30: Alerta de ausência — verifica funcionários sem registro de entrada (WhatsApp DM / email)
- Terça 18:00: Resumo semanal via WhatsApp DM para admin (fallback email)
- Diário 20:00: Alerta prestadores fixos que não compareceram (WhatsApp DM / email)
- 5min: IMAP email inbox — verifica emails UNSEEN, classifica com Claude Haiku

## ALERTA DE AUSÊNCIA (G3)
- Scheduler diário às 09:30 (src/services/schedulers.js → checkAbsences)
- Filtra funcionários com cargo.precisa_bater_ponto=1 e cargo.aparece_relatorios=1
- Verifica se funcionário tem horario_entrada definido
- Ignora: fins de semana, feriados, funcionários de férias, quem já registrou entrada
- Tolerância: 15 minutos após horário esperado
- Alerta via WhatsApp DM para admin (fallback: email)
- Mensagem lista cada funcionário ausente com horário esperado e tempo de atraso
- Endpoint manual: POST /api/dashboard/presenca/check-ausencias (admin only)

## PRESTADORES DE SERVIÇO
### Tabelas
- `prestadores` (id, nome, telefone, email, empresa, cnpj, cpf, tipo [fixo|avulso], frequencia_tipo, frequencia_vezes, frequencia_dias JSON, servico_descricao, valor_visita, valor_mensal, pix_chave, pix_tipo, banco, agencia, conta, observacoes, status [ativo|inativo])
- `prestador_visitas` (id, prestador_id FK, data_entrada TEXT, data_saida TEXT, servico_realizado, valor_cobrado, avaliacao, observacao, fonte [manual|whatsapp])
- `prestador_pagamentos` (id, prestador_id FK, visita_id FK, valor, data_pagamento, metodo, comprovante_path, status, observacao)

### API Endpoints
- GET /api/prestadores — lista (param: includeInactive=true)
- GET /api/prestadores/:id — detalhes
- POST /api/prestadores — criar (gestor)
- PUT /api/prestadores/:id — atualizar (gestor)
- DELETE /api/prestadores/:id — soft delete (gestor)
- GET /api/prestadores/:id/visitas — listar visitas
- POST /api/prestadores/:id/visitas — registrar visita (gestor)
- GET /api/prestadores/:id/pagamentos — listar pagamentos
- POST /api/prestadores/:id/pagamentos — registrar pagamento com comprovante (gestor, multer)

### Frontend: prestadores.html (Tailwind)
- 3 tabs: Cadastro, Visitas, Pagamentos
- Stats: total ativos, visitas semana, pagamentos mês, prestadores fixos
- CRUD modal com frequência (checkboxes seg-dom para tipo=fixo)
- Modal visita com entrada/saída/serviço
- Modal pagamento com upload comprovante

### WhatsApp Integration
- Prestador identificado por telefone (últimos 8 dígitos)
- "Cheguei"/"Terminei" → registra visita entrada/saída automaticamente
- Prioridade: prestador verificado ANTES do ponto de funcionário
- Mensagem com emoji 🔧 e duração calculada na saída

### Cron
- Diário 20:00: checkPrestadorFrequency() — alerta admin sobre prestadores fixos ausentes

## EMAIL INBOX INTELIGENTE
### Tabela: email_inbox
id, message_id UNIQUE, from_email, from_name, subject, body_text, attachments_count, attachment_paths JSON, classificacao, dados_extraidos JSON, acao_sugerida, status [pendente|processado|ignorado], whatsapp_notified, created_at

### Serviço: emailInboxService.js
- IMAP: Gmail (imap.gmail.com:993), verifica UNSEEN a cada 5min
- Máx 10 emails por batch, marca como lido (markSeen: true)
- Parse com mailparser, PDF text extraction com pdf-parse
- Classificação Claude Haiku: convite|nota_fiscal|boleto|contrato|orcamento|comunicado|propaganda|outro
- Dados extraídos: date, time, location, value, person, description
- Ação sugerida: criar_evento|criar_tarefa|cadastrar_prestador|registrar_despesa|salvar_documento|ignorar
- Attachments salvos em /uploads/emails/{safeId}/
- WhatsApp: notifica admin (exceto propaganda) com 4 opções (1-4)
- pending_confirmation tipo='email_action' para resposta do admin

### API Endpoints
- GET /api/emails — lista com filtros (status, classificacao, dataInicio, dataFim, limit, offset)
- GET /api/emails/:id — detalhes
- PUT /api/emails/:id — atualizar status (gestor)

### .env
```
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=edmarmbull@gmail.com
IMAP_PASSWORD=*** (app password Gmail)
```

## FERIADOS - SYNC GOOGLE CALENDAR
- Sincronizar feriados do Google Calendar API (calendário público brasileiro)
- Cron mensal automático + botão manual "Sincronizar"
- Feriados com manual=true NUNCA são sobrescritos pelo sync
- Incluir feriados nacionais + estaduais SP + municipais SP

## FERIADOS SP 2026
01/01, 25/01, 17/02, 03/04, 21/04, 01/05, 04/06, 09/07, 07/09, 12/10, 02/11, 15/11, 20/11, 25/12

## VERSÃO DO SISTEMA
- Arquivo: `version.json` na raiz do projeto
- Endpoint: GET `/api/version` (retorna {version, date, env})
- Exibida no rodapé do index.html (canto inferior direito) e no copyright do login.html
- Formato de exibição: "v2.0.0 | Sandbox | 24/02/2026" (versão | ambiente capitalizado | data DD/MM/YYYY)
- Versão atual: 2.9.0

## REGISTROS DE PONTO - FILTROS
- Filtro por mês/ano (dropdown) ou período manual (data início/fim)
- Toggle automático: ao selecionar mês, desabilita inputs manuais e vice-versa
- Botão "Hoje": filtra registros do dia atual (seta mês vazio + datas de hoje)
- Inputs de data: type="date" com calendário nativo do browser
- Filtro por funcionário (dropdown)
- Filtro por tipo: Todos | Entrada/Saída | Almoço (filtra client-side pela observação)
- Badges coloridos: Saída Almoço (amarelo), Retorno Almoço (amarelo), Entrada (verde), Saída (vermelho), Completo (azul)
- Badge secundário de fonte: WA (whatsapp) ou Manual

## FOLHA DE PAGAMENTO - LABELS
- "Total extras do mês" (não "Total a pagar") — indica que são valores adicionais ao salário base
- Nota explicativa: "Valores adicionais ao salário base. Não inclui salário fixo."
- "Total Extras Geral" para soma de todos funcionários

## TAREFAS
### Tabelas
- `tarefas` (id, titulo, descricao, prioridade [alta|media|baixa], prazo, criado_por FK→users, status [pendente|em_andamento|concluida|cancelada], fonte [web|whatsapp], created_at, updated_at)
- `tarefa_funcionarios` (id, tarefa_id FK→tarefas, funcionario_id FK→funcionarios, status [pendente|em_andamento|concluida], concluida_em)

### API Endpoints
- GET /api/tarefas — lista com filtros (status, prioridade, funcionarioId)
- GET /api/tarefas/:id — detalhes com funcionários
- POST /api/tarefas — criar (requer admin/gestor ou pode_criar_tarefas)
- PUT /api/tarefas/:id — editar
- DELETE /api/tarefas/:id — excluir
- PUT /api/tarefas/:id/funcionario/:funcId/status — atualizar status individual

### Regras
- Tarefa auto-marca "concluida" quando todos os funcionários completam
- WhatsApp: notifica funcionários ao criar (mensagem privada)
- WhatsApp: detecta "tarefa concluída/terminei tarefa" no grupo → marca pendente mais antiga
- WhatsApp: usuários com pode_criar_tarefas_whatsapp podem criar tarefas por msg privada
- Permissões: admin/gestor sempre podem; viewers precisam flag pode_criar_tarefas

### Frontend
- Página com filtros (status, prioridade, funcionário), cards com prioridade colorida
- Modal CRUD: titulo, descrição, prioridade, prazo, status, funcionários (multi-select)
- Ações inline: marcar concluída, editar, excluir

## CHAT WHATSAPP DIRETO
### Tabela
- `whatsapp_chats` (id, funcionario_id FK→funcionarios, direcao [enviada|recebida], tipo [text|image|audio|video|document], conteudo, media_path, whatsapp_msg_id, created_at)

### API Endpoints
- GET /api/whatsapp/chat/:funcionario_id — histórico de mensagens
- POST /api/whatsapp/chat/:funcionario_id/send — enviar texto
- POST /api/whatsapp/chat/:funcionario_id/send-media — enviar mídia (multer upload)

### Frontend
- Botão "Chat" nos cards de funcionários (bi-chat-dots-fill)
- Modal de chat: histórico de mensagens, input de texto, botão enviar, upload de mídia
- Normalização de telefone: adiciona 55 se necessário, @c.us suffix

## PERMISSÕES DE TAREFAS (tabela users)
- telefone TEXT — telefone do usuário para matching WhatsApp
- pode_criar_tarefas INTEGER DEFAULT 0 — permite criar tarefas via web
- pode_criar_tarefas_whatsapp INTEGER DEFAULT 0 — permite criar tarefas via WhatsApp DM

## FORMATO DE TELEFONE
- Máscara: (XX) XXXXX-XXXX (aplicada em tempo real via input event)
- Armazenamento: apenas números no banco (11 dígitos)
- Exibição: formatPhone() converte números para formato com máscara, "-" se vazio
- Campos com máscara: func-telefone, func-telefone-contato2, func-telefone-emergencia, user-telefone-input

## SIDEBAR MOBILE
- sidebar-nav tem overflow-y:auto + -webkit-overflow-scrolling:touch para scroll no iPhone
- @supports (-webkit-touch-callout: none) aplica max-height: -webkit-fill-available

## PRESENÇA / GRÁFICOS - FILTRO POR CARGO
- Presença (hoje e mensal) e Gráficos filtram por `precisa_bater_ponto = 1` do cargo
- Exclui automaticamente: Dono(a) da Casa (cargo_id 82), Governanta (cargo_id 143), Assistente Pessoal (cargo_id 4)
- JOIN com cargos: `LEFT JOIN cargos c ON f.cargo_id = c.id WHERE (c.precisa_bater_ponto = 1 OR c.id IS NULL)`
- Presença hoje usa `toLocaleDateString('sv-SE', {timeZone:'America/Sao_Paulo'})` para data correta (não UTC)
- Dropdown de funcionários nos gráficos também filtra por precisa_bater_ponto
- API funcionarios.getAll() retorna campo `precisa_bater_ponto` do cargo

### Status de Hoje (tabela consolidada)
- 1 linha por funcionário por dia (consolida todos os registros)
- Colunas: Funcionário | Cargo | Esperado | Entrada | Almoço ↗ | Almoço ↙ | Saída | Status | Atraso
- Entrada = primeiro registro tipo entrada do dia
- Almoço ↗ = primeiro registro "saída almoço"
- Almoço ↙ = primeiro registro "retorno almoço"
- Saída = último registro tipo saída do dia
- Status: Presente (verde), Saiu (azul), Ausente (vermelho), Atrasado (amarelo)
- Atraso = diferença entre entrada e horário esperado (apenas se entrada > esperado)

### Regra de permissão HE no relatório mensal
- Se funcionário tem `contabiliza_hora_extra` definido (inclusive 0): usa o valor do funcionário
- Se funcionário tem `contabiliza_hora_extra` NULL: herda do cargo (`cargo_permite_hora_extra`)
- Mesma lógica em `/api/relatorios/folha` e `/api/relatorios/mensal`

## ESTOQUE E COMPRAS DA CASA
### Tabelas
- `estoque_itens` (id, nome, categoria, unidade, quantidade_atual, quantidade_minima, localizacao, ativo, created_at)
- `estoque_movimentacoes` (id, item_id FK→estoque_itens, tipo [entrada|saida|ajuste|compra], quantidade, observacao, registrado_por FK→users, fonte [manual|whatsapp], created_at)

### Categorias padrão
limpeza, cozinha, escritorio, banheiro, jardim, pet, medicamentos, ferramentas, outros

### Unidades
un, kg, g, L, ml, cx, pct, rolo, par, kit

### API Endpoints
- GET /api/estoque — lista itens (param: includeInactive=true)
- GET /api/estoque/alertas — itens com estoque abaixo do mínimo
- GET /api/estoque/categorias — categorias em uso
- GET /api/estoque/movimentacoes — últimas movimentações (param: limit)
- GET /api/estoque/:id — detalhes do item com movimentações
- POST /api/estoque — criar item (gestor)
- PUT /api/estoque/:id — atualizar item (gestor)
- DELETE /api/estoque/:id — soft delete (gestor)
- POST /api/estoque/:id/movimentacao — registrar movimentação

### Movimentação automática de quantidade
- Entrada/Compra: quantidade_atual += quantidade
- Saída: quantidade_atual -= quantidade (mín 0)
- Ajuste: quantidade_atual = quantidade (inventário)

### Frontend
- Sidebar: bi-cart3, após Entregas
- Tabela com filtro por categoria e busca por nome
- Alerta de estoque baixo (quantidade_atual <= quantidade_minima)
- Modal CRUD para itens
- Modal de movimentação (entrada/saída/ajuste)
- Histórico de movimentações em modal modal-lg
- Toggle inativos (mesmo padrão)

## COMPRAS - LISTA DE COMPRAS
### Frontend: public/compras.html
- Sidebar: bi-cart4, após Entregas (admin only)
- 3 Tabs: Listas (cards com progresso), Histórico de Preços (busca + comparativo), Notas Fiscais (upload + grid)
- Modal nova/editar lista: nome, categoria, observações
- Modal marcar comprado: preço pago, estabelecimento, data

### Model: src/models/ListaCompras.js
- `normalizeName(name)` - lowercase, remove accents, trim, collapse spaces
- `getAllListas(includeCompleted)` / `findListaById(id)` / `createLista` / `updateLista` / `deleteLista`
- `getItens` / `addItem` / `updateItem` / `deleteItem` / `markAsBought` (insere em historico_precos)
- `searchPrecos(query)` / `getPrecoHistory(nome)` / `getComparativo(mes, ano)` / `addPreco`

### API: src/routes/listasCompras.js (montado em /api/listas-compras)
- GET / — listar (query: includeCompleted)
- GET /:id — detalhes com itens
- POST / — criar lista (requireGestor)
- PUT /:id — atualizar (requireGestor)
- DELETE /:id — excluir (requireGestor, cascade itens)
- GET /:id/itens — itens da lista
- POST /:id/itens — adicionar item (requireGestor)
- PUT /itens/:itemId — atualizar item (requireGestor)
- DELETE /itens/:itemId — excluir item (requireGestor)
- PUT /itens/:itemId/comprado — marcar comprado (requireGestor, preco_pago + estabelecimento)
- GET /historico-precos/search — buscar preços (query: q=termo)
- GET /historico-precos/comparativo — economia mensal (query: mes, ano)
- POST /notas-fiscais/processar — upload nota fiscal (multer, max 10MB)

### Tabelas
- `listas_compras` (id, nome, categoria, status [aberta|em_andamento|concluida], criado_por, observacoes, created_at, updated_at)
- `lista_compras_itens` (id, lista_id FK CASCADE, nome_item, quantidade, unidade, categoria_item, comprado, preco_pago, estabelecimento, data_compra, nota_fiscal_path, observacao, created_at)
- `historico_precos` (id, nome_item, nome_normalizado, preco, estabelecimento, categoria, fonte, nota_fiscal_path, data_compra, created_at)

### Categorias listas: mercado, padaria, hortifruti, acougue, limpeza, pet, farmacia, material_construcao, outro
### Categorias itens: alimento, bebida, limpeza, higiene, pet, hortifruti, carne, padaria, frios, congelados, outro
### Status: aberta → em_andamento → concluida

### WhatsApp Integration
- Nota fiscal (foto) → Vision AI extrai itens → salva em historico_precos → match com lista ativa → cria despesa
- "lista de compras" ou "enviar lista" → envia lista ativa formatada no grupo
- "adicionar na lista: X" → adiciona item à lista ativa
- "comprei X R$Y no Z" → marca item como comprado + registra preço

## DESPESAS E REEMBOLSOS
### Frontend: public/despesas.html
- Sidebar: bi-receipt-cutoff, após Compras (admin only)
- 3 Tabs: Todas (tabela paginada + filtros), Pendentes (aprovação rápida), Relatório (Chart.js)
- Stats: 4 cards (Pendentes/Aprovadas/Reembolsadas/Rejeitadas com valor R$)
- Charts: doughnut por categoria, bar por funcionário, line evolução 6 meses
- Modal detalhe: todos os campos + comprovante tamanho completo
- Modal nova despesa: funcionário, descrição, valor, categoria, estabelecimento, comprovante upload
- Modal rejeição: textarea para motivo
- Upload via FormData nativo (multipart)

### Model: src/models/Despesa.js
- `getAll(filters)` — paginado com JOIN funcionarios (status, funcionario_id, categoria, data_inicio, data_fim)
- `findById(id)` / `create(data)` / `update(id, data)` / `delete(id)`
- `approve(id, aprovadoPor)` / `reject(id, aprovadoPor, obs)` / `markReimbursed(id)`
- `getRelatorio(mes, ano)` — totais por status, porCategoria, porFuncionario, evolucaoMensal

### API: src/routes/despesas.js (montado em /api/despesas)
- GET / — listar com filtros (status, funcionario_id, categoria, data_inicio, data_fim, page, limit)
- GET /relatorio — relatório mensal (query: mes, ano)
- GET /:id — detalhes
- POST / — criar com comprovante (upload.single, requireGestor)
- PUT /:id — atualizar (requireGestor)
- POST /:id/aprovar — aprovar (requireGestor)
- POST /:id/rejeitar — rejeitar com observação (requireGestor)
- POST /:id/reembolsar — marcar reembolsado (requireGestor)
- DELETE /:id — excluir (requireGestor)

### Tabela: despesas
id, funcionario_id FK, descricao, valor, categoria, estabelecimento, data_despesa,
comprovante_path, dados_extraidos JSON, fonte (whatsapp|manual), fonte_chat,
status (pendente|aprovado|rejeitado|reembolsado), aprovado_por, data_aprovacao,
data_reembolso, observacao, created_at, updated_at

### Categorias: mercado, padaria, hortifruti, farmacia, transporte, material_construcao, limpeza, pet, manutencao, outro
### Fluxo de status: pendente → aprovado → reembolsado | pendente → rejeitado
### Regras: só pendente pode aprovar/rejeitar, só aprovado pode reembolsar, hard delete (sem soft delete)
### Storage: /public/uploads/comprovantes/comprovante-{timestamp}.{ext}

### WhatsApp Integration
- Comprovante PIX/pagamento (foto) → Vision AI extrai valor → cria despesa → notifica admin
- Nota fiscal (foto) → extrai itens + total → cria despesa + registra preços
- Admin aprovação via DM: responde com "aprovar" ou "rejeitar"

## APARECE_RELATORIOS - FILTRO POR CARGO
- Campo `aparece_relatorios INTEGER DEFAULT 1` na tabela cargos
- Cargos com aparece_relatorios=0 são excluídos de: Dashboard Presença, Relatórios, Folha, Gráficos
- Dono(a) da Casa auto-configurado com aparece_relatorios=0
- Checkbox no modal de cargo: "Aparece nos Relatórios"
- Filtro aplicado em: DashboardPresenca, Registro.getDashboardSummary, relatorios.js, renderGraficos

## BIGDATACORP - DADOS SALVOS
- Campo `bigdatacorp_data TEXT` na tabela funcionarios
- Ao consultar CPF via BigDataCorp, resposta raw é salva automaticamente
- Accordion colapsável no modal de funcionário: "Dados BigDataCorp (API)"
- Mostra: Status CPF, Nome, Nascimento, Telefones, Endereços, E-mails
- Accordion populado tanto na consulta quanto ao abrir funcionário com dados salvos

## WHATSAPP - DOCUMENTOS CREATE
- Ao receber documento via WhatsApp e não encontrar entidade correspondente:
  - Se placa: cria novo veículo automaticamente com dados extraídos
  - Se CPF/nome: cria novo funcionário automaticamente com dados extraídos
  - Mensagem de confirmação informa sobre a criação
- Confirmação "SIM": cria entidade + salva documento vinculado
- Confirmação "NÃO": rejeita sem criar

## CENTRAL DE AJUDA (Chat IA)
### Rota: src/routes/ajuda.js
- POST /api/ajuda/ask — envia pergunta ao Claude Haiku, retorna resposta
- Body: `{ pergunta: "texto" }` (max 500 caracteres)
- Response: `{ success: true, answer: "..." }`
- Model: claude-haiku-4-5-20251001 (rápido e barato)
- Rate limit: 30 req/hora por usuário
- Auth: qualquer usuário logado (admin, gestor, viewer)
- System prompt: descrição completa das funcionalidades do Lar Digital
- Sem histórico no banco — chat client-side apenas (perdido ao sair da página)

### Frontend: public/ajuda.html
- Página Tailwind standalone com chat IA
- Sidebar: bi-chat-left-dots, visível para TODOS os usuários, antes de Perfil
- 6 sugestões rápidas: registrar ponto, gerar relatório, adicionar funcionário, ver presença, cadastrar veículo, trocar senha
- Bolhas de mensagem: user (azul, direita), bot (branco/cinza, esquerda com ícone robot)
- Indicador "digitando..." com animação bounce
- Dark mode completo, responsivo
- Formatação markdown básica na resposta (bold, code, listas)

## HEALTH CHECK
- Endpoint: GET /api/health (público, sem auth)
- Retorna: status, version, env, timestamp, services (database, whatsapp, last_whatsapp_message, uptime)
- Status: "healthy" (tudo ok) ou "degraded" (DB com problemas)

## SCRIPTS
- `scripts/backup-db.sh` — Backup do banco SQLite, retenção 30 dias, destino ~/backups/lardigital/
- `scripts/deploy-production.sh <versão>` — Deploy completo: backup → rsync → version.json → npm install → pm2 restart → health check
- `scripts/update-nginx.sh` — Gzip, security headers, cache de assets (executar como root)
- Cron backup: `0 3 * * * /home/claude/controle-ponto/scripts/backup-db.sh`

## WHATSAPP — DETECÇÃO DE FOTOS (PRIORIDADE)
Quando uma foto é recebida no grupo, a ordem de processamento é:
1. **Documento** (CRLV, RG, CPF, CNH, apólice): detecta via Vision AI → pede confirmação → cria/vincula veículo ou funcionário
2. **Nota Fiscal** (cupom fiscal com itens e preços, CNPJ): extrai itens → salva em historico_precos → tenta match com lista de compras ativa → cria despesa
3. **Comprovante** (PIX, transferência bancária, recibo de pagamento): extrai valor → cria despesa → notifica admin para aprovação
4. **Entrega** (pacote, encomenda): detecta via Vision AI → pede confirmação SIM/NÃO → registra entrega
5. **Outros** (selfie, serviço, etc): cria sugestão de melhoria se texto >= 5 chars
- Classificações são MUTUAMENTE EXCLUSIVAS (apenas um tipo por foto)
- Fotos NUNCA criam tarefas automaticamente (tarefas só por texto ou mensagem privada)
- Vision AI prompt classifica: DOCUMENTO | NOTA_FISCAL | COMPROVANTE | ENTREGA | OUTRO

## WHATSAPP — FETCH MISSED MESSAGES
- Endpoint: POST /api/whatsapp/fetch-missed (admin, body: {limit: N})
- Busca últimas N mensagens do grupo quando bot fica offline
- Usa timestamp original da mensagem (não hora atual)
- Pede confirmação SIM/NÃO para registros de ponto retroativos
- Mensagens já armazenadas no DB são ignoradas (INSERT OR IGNORE)


## ELEVENLABS — ÁUDIO NO WHATSAPP
- Serviço: src/services/elevenlabs.js
- Env: ELEVENLABS_API_KEY no .env
- **STT (Speech-to-Text)**: POST https://api.elevenlabs.io/v1/speech-to-text
  - Modelo: scribe_v1, idioma: por (português)
  - Rate limit: 20 transcrições/hora
  - Duração máxima: 5 minutos
- **TTS (Text-to-Speech)**: POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}
  - Modelo: eleven_multilingual_v2
  - Voice padrão: ThT5KcBeYPX3keUQqHPh (Dorothy)
  - Limite: 500 caracteres
  - Output: MP3 em /public/uploads/whatsapp/tts/
- **Fluxo grupo**: áudio recebido → transcreve → processa como texto → responde com áudio + texto
- **Fluxo privado**: áudio recebido → transcreve → processa como tarefa/conversa → responde com áudio + texto
- **Fallback**: sem API key → salva áudio, pede envio por texto

## SUGESTÕES DE MELHORIA
### Tabela: sugestoes_melhoria
id, titulo, descricao, prioridade (alta|media|baixa), categoria, fonte, fonte_tipo (texto|audio|imagem),
imagem_path, audio_path, transcricao, whatsapp_mensagem_id, remetente_nome, remetente_telefone,
status (pendente|em_analise|convertida|ignorada), convertida_tarefa_id FK→tarefas, created_at, updated_at

### API Endpoints
- GET /api/sugestoes — lista com filtros (status, categoria, dataInicio, dataFim)
- PUT /api/sugestoes/:id — atualizar (gestor)
- POST /api/sugestoes/:id/converter-tarefa — converte em tarefa (gestor)
- DELETE /api/sugestoes/:id — excluir (gestor)

### Criação automática via WhatsApp
- Mensagens que NÃO são: ponto, documento, entrega, tarefa → geradas como sugestão
- Claude Haiku interpreta mensagem → gera título, descrição, categoria, prioridade
- Bot responde com detalhes e pergunta "Criar como tarefa? (Sim/Não)"
- Sim → pending_confirmation → converte em tarefa
- Não → descarta confirmação

### Frontend (sugestoes.html)
- Sidebar: bi-lightbulb, após Férias (admin-only)
- Cards com status, prioridade, categoria, remetente, data
- Stats: pendentes, em análise, convertidas, total
- Filtros: status, categoria
- Modal de detalhe com edição de título/descrição/prioridade/status
- Botões: Converter em Tarefa, Salvar, Excluir

## RESUMO SEMANAL (WhatsApp)
- **Scheduler**: sexta-feira às 18:00 (schedulers.js, `_scheduleWeekly`)
- **Destinatário**: admin (DM privada via `sendPrivateMessage`)
- **Fallback**: se WhatsApp offline, envia por email
- **Conteúdo**: presença da semana (seg-sex), horas por funcionário, entregas, estoque baixo, tarefas concluídas, confirmações expiradas
- **Método**: `Schedulers.sendWeeklySummary()` em src/services/schedulers.js
- **WhatsApp DM**: `whatsappService.sendPrivateMessage(phone, text)` — novo método genérico para enviar mensagem privada a qualquer número

## COMANDOS ÚTEIS
```bash
cd ~/controle-ponto-sandbox
pm2 restart lardigital-sandbox
pm2 logs lardigital-sandbox --lines 50
curl http://localhost:3001/api/health
sqlite3 database-sandbox.sqlite ".tables"
bash ~/controle-ponto/scripts/deploy-production.sh 2.4.1
bash ~/controle-ponto/scripts/backup-db.sh
```
