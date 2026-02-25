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
- Esqueci senha: botão no login → email com código → reset (rate limit: 5min entre envios, countdown 60s no frontend)
- Reenviar senha: botão na pág. usuários (admin) → gera temporária → email

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
10. **Entregas** - Cards com thumbnail, upload manual com foto, confirmação WhatsApp (SIM/NÃO)
11. **Tarefas** - CRUD, multi-assign funcionários, prioridade/prazo, integração WhatsApp
12. **Insights IA** - Operacional + Melhorias (admin only)
13. **Usuários** - CRUD, roles, permissões tarefas, excluir com confirmação, reenviar senha (admin only)
14. **Audit Log** - Log de ações (admin only)
15. **Log de Acessos** - Login/logout/falhas com IP e navegador (admin only, bi-door-open)
16. **Perfil** - Editar dados, trocar senha, 2FA

## CADASTRO DE CARGOS
nome, precisa_bater_ponto, permite_hora_extra, permite_dia_extra,
valor_hora_extra, valor_dia_extra, recebe_vale_transporte, valor_vale_transporte,
recebe_vale_refeicao, valor_vale_refeicao, recebe_ajuda_combustivel,
valor_ajuda_combustivel, dorme_no_local, dias_dormida (JSON), tipo_dias_dormida (uteis|todos|customizado),
ativo, created_at, updated_at

## CADASTRO DE FUNCIONÁRIO
### Dados Pessoais
nome, cargo_id (FK→cargos), telefone, email_pessoal, foto
### Documentos
cpf (validação mod-11 no frontend), rg, data_nascimento
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
tarefas, tarefa_funcionarios, whatsapp_chats

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
4. Se confiança > 80%: registrar automaticamente
5. Se confiança 50-80%: pedir confirmação SIM/NÃO no WhatsApp
6. Se confiança < 50%: ignorar

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
- 20min: Health check WhatsApp → email se offline (schedulers.js)
- 30min: IMAP holerites
- Dia 01 08:00: Email fechamento mês
- Dia 05 08:00: Email holerites pendentes
- Mensal: Sync feriados via Google Calendar (respeitar manual=true)
- Diário: Alertas férias

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
- Versão atual: 2.0.0

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

## COMANDOS ÚTEIS
```bash
cd ~/controle-ponto-sandbox
pm2 restart lardigital-sandbox
pm2 logs lardigital-sandbox --lines 50
curl http://localhost:3001
sqlite3 database-sandbox.sqlite ".tables"
```
