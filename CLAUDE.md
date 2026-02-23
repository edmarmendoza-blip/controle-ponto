# CLAUDE.md - Lar Digital

## Projeto
**Lar Digital** - Sistema completo de gestão de funcionários domésticos da Casa dos Bull.
- **Domínio:** lardigital.app
- **Servidor:** Digital Ocean Droplet (IP: 137.184.124.137)
- **Usuário deploy:** claude (/home/claude/controle-ponto)
- **Proprietário:** Edmar Mendoza Bull (edmarmbull@gmail.com)

## Stack Tecnológica
- **Backend:** Node.js 20 + Express + SQLite3
- **Frontend:** HTML + Bootstrap 5 + Bootstrap Icons + JavaScript vanilla
- **Mapas:** Leaflet.js + OpenStreetMap
- **Gráficos:** Chart.js
- **WhatsApp:** whatsapp-web.js
- **Process Manager:** PM2
- **Reverse Proxy:** Nginx + Let's Encrypt SSL
- **E-mail:** Brevo SMTP (smtp-relay.brevo.com:587)

## Variáveis de Ambiente (.env)
```
PORT=3000
TZ=America/Sao_Paulo
JWT_SECRET=casadosbull_jwt_secret_2026_super_seguro
JWT_EXPIRATION=24h
DB_PATH=./database.sqlite
NODE_ENV=production
WHATSAPP_GROUP_NAME=Casa dos Bull
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=edmarmbull@gmail.com
SMTP_PASS=TROCAR_PELA_CHAVE_BREVO
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

## Fuso Horário
**SEMPRE** America/Sao_Paulo (UTC-3). Em todo lugar:
- `process.env.TZ = 'America/Sao_Paulo'` no início do server.js
- SQLite: usar `datetime('now', 'localtime')` nunca `datetime('now')`
- Cron jobs: `{ timezone: "America/Sao_Paulo" }`
- Frontend: `toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })`

## Idioma
- Todo o frontend em **português brasileiro**
- Mensagens de erro, labels, botões, tudo em pt-BR
- API responses podem ser em inglês (status codes padrão)

## Autenticação e Autorização
- JWT com bcrypt para senhas
- 3 roles: **admin** (acesso total), **gestor** (dashboard/registros/relatórios), **viewer** (somente leitura)
- Admin padrão: edmarmbull@gmail.com / Admin@2026!
- 2FA opcional via speakeasy (TOTP - Google Authenticator/Authy)
- "Lembrar dispositivo 30 dias" via cookie httpOnly
- **Esqueci minha senha:** botão na tela de login → envia código por e-mail → tela de reset

## Páginas do Sistema (sidebar)
1. **Dashboard** - Resumo do dia, funcionários presentes/ausentes, últimos registros
2. **Funcionários** - CRUD completo com todos os campos (ver seção abaixo)
3. **Registros** - Gestão de ponto com geolocalização, filtros, edição manual
4. **Relatórios** - Relatório mensal, exportação Excel e PDF
5. **Presença** - Calendário visual de presença
6. **Gráficos** - Chart.js: barras (horas/mês), linha (extras), pizza (tipos)
7. **Feriados** - Lista feriados SP 2026, sync Google Calendar, CRUD manual
8. **WhatsApp** - Conexão com QR Code, status, reconectar
9. **Insights IA** - (admin only)
10. **Usuários** - CRUD com roles (admin only)
11. **Audit Log** - Log de ações dos usuários (admin only)
12. **Perfil** - Editar dados, trocar senha, configurar 2FA

## Cadastro de Funcionário - Campos Completos
### Dados Pessoais
- nome, cargo, telefone, email_pessoal, foto

### Classificação e Status
- classificacao: operacional | assistente_pessoal | dono_casa | outro
- status: ativo | desligado
- data_admissao, data_desligamento, motivo_desligamento

### Benefícios (checkboxes)
- contabiliza_hora_extra, recebe_vt, recebe_va, contabiliza_feriado
- Pré-configurados por classificação mas customizáveis

### Jornada de Trabalho
- Campo texto livre em português (ex: "Sexta a segunda, 08:00-17:00")
- Pode usar Claude API para converter em JSON estruturado
- Campos: dias_semana, horario_entrada, horario_saida, carga_horaria_diaria

### Vale-Transporte
- Tipo: diario | pernoite | fixo
- Múltiplos transportes por funcionário (tabela funcionario_transportes)
- Cada transporte: tipo_transporte, nome_linha, valor_trecho
- Cálculo diário: soma trechos × 2 × dias trabalhados
- Cálculo pernoite: soma trechos × 2 (só entrada/saída do período)
- Cálculo fixo: valor_fixo_transporte mensal

### Vale-Alimentação
- tem_vale_alimentacao (boolean), valor_va_dia (decimal)
- Cálculo: valor × dias trabalhados no mês

### Chave PIX
- pix_tipo: cpf | telefone | email | aleatoria
- pix_chave, pix_banco
- Validação formato conforme tipo

### Férias
- Período aquisitivo calculado automaticamente pela data_admissao
- Status: sem_direito | direito_adquirido | agendada | em_ferias | gozada
- Alertas e-mail: 60/30/7 dias antes do vencimento

### Comunicação
- notificacoes_ativas (boolean)
- Config por tipo: resumo_semanal, aviso_holerite, comprovante_pagamento, lembrete_ponto

## Tabelas do Banco (SQLite)
- **users** - id, email, password_hash, nome, role, two_factor_secret, two_factor_enabled, created_at
- **funcionarios** - todos os campos acima
- **registros** - id, funcionario_id, tipo, data_hora, latitude, longitude, fonte, observacao
- **feriados** - id, data, nome, tipo (nacional/estadual/municipal), created_at
- **funcionario_transportes** - id, funcionario_id, tipo_transporte, nome_linha, valor_trecho
- **entregas** - id, funcionario_id, data_hora, imagem_path, destinatario, remetente, transportadora
- **holerites** - id, funcionario_id, mes_referencia, valor_liquido, pdf_path, status
- **email_logs** - id, funcionario_id, tipo, assunto, enviado_em, aberto_em, status
- **audit_log** - id, user_id, acao, detalhes, ip, created_at
- **ferias** - id, funcionario_id, inicio, fim, status, created_at

## API Endpoints
### Auth
- POST /api/auth/login
- POST /api/auth/register
- POST /api/auth/forgot-password
- POST /api/auth/reset-password
- POST /api/auth/verify-2fa

### Users
- GET/POST/PUT/DELETE /api/users
- PUT /api/users/me/password
- GET /api/audit-log

### Funcionários
- GET/POST/PUT/DELETE /api/funcionarios

### Registros
- GET/POST/PUT/DELETE /api/registros

### Relatórios
- GET /api/relatorios/mensal
- GET /api/relatorios/feriados
- GET /api/relatorios/vale-transporte
- GET /api/relatorios/vale-alimentacao

### Export
- GET /api/export/excel
- GET /api/export/pdf

### Feriados
- GET /api/feriados
- POST /api/feriados/sync

### Entregas
- GET /api/entregas
- PUT /api/entregas/:id

### Holerites
- GET /api/holerites
- PUT /api/holerites/:id
- POST /api/holerites/check-email

### Comunicação
- GET /api/comunicacao/engajamento
- POST /api/comunicacao/enviar-teste/:id

### WhatsApp
- GET /api/whatsapp/status
- GET /api/whatsapp/qr

### Férias
- GET /api/ferias
- POST /api/ferias

## Cron Jobs
- **A cada 5 min:** Health check WhatsApp → alerta e-mail se offline
- **A cada 30 min:** Verificar IMAP para holerites
- **Dia 01 às 08:00:** E-mail fechamento mês + previsão próximo mês
- **Dia 05 às 08:00:** E-mail admin com holerites pendentes
- **Mensal:** Sync feriados Google Calendar
- **Diário:** Verificar alertas de férias (60/30/7 dias)

## Feriados São Paulo 2026
01/01 Confraternização, 25/01 Aniversário SP, 17/02 Carnaval, 03/04 Sexta Santa, 21/04 Tiradentes, 01/05 Trabalho, 04/06 Corpus Christi, 09/07 Revolução Constitucionalista, 07/09 Independência, 12/10 Aparecida, 02/11 Finados, 15/11 Proclamação, 20/11 Consciência Negra, 25/12 Natal.

## Regras Importantes
1. **NUNCA** apagar dados - sempre soft delete (status: desligado)
2. **NUNCA** expor senhas ou tokens no frontend
3. **SEMPRE** validar inputs no backend (não confiar só no frontend)
4. **SEMPRE** registrar ações no audit_log
5. **SEMPRE** usar try/catch em rotas async
6. **NUNCA** usar datetime('now') no SQLite - usar datetime('now', 'localtime')
7. **SEMPRE** retornar mensagens de erro em português
8. **SEMPRE** testar com pm2 restart após alterações
9. **NÃO** precisa de sudo - o usuário claude não tem sudo
10. Para comandos sudo, gerar script e instruir para rodar como root

## Infraestrutura
- **Nginx:** /etc/nginx/sites-available/controle-ponto
- **PM2:** ecosystem.config.js na raiz do projeto
- **SSL:** Let's Encrypt via certbot
- **Firewall:** UFW - portas 22, 80, 443 abertas; 3000 bloqueada (acesso só via Nginx)
- **Uploads:** /home/claude/controle-ponto/uploads/ (entregas, holerites, fotos)

## Comandos Úteis
```bash
pm2 list                    # Ver status do app
pm2 logs --lines 50         # Ver logs recentes
pm2 restart all             # Reiniciar app
pm2 save                    # Salvar config PM2
sqlite3 database.sqlite     # Acessar banco
curl http://localhost:3000   # Testar app
```
