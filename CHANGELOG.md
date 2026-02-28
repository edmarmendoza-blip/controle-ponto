# Changelog — Lar Digital

## v2.8.0 (2026-02-28)
### Novas funcionalidades
- **Prestadores de Serviço**: CRUD completo com visitas, pagamentos, frequência
  - Tabelas: prestadores, prestador_visitas, prestador_pagamentos
  - Frontend: prestadores.html (Tailwind, tabs cadastro/visitas/pagamentos)
  - WhatsApp: "cheguei"/"terminei" registra visita automaticamente
  - Cron diário 20:00: alerta prestadores fixos que não vieram
- **Email Inbox Inteligente**: IMAP Gmail → Claude Haiku → WhatsApp
  - Verifica emails a cada 5 min (UNSEEN)
  - Classifica: convite, nota_fiscal, boleto, contrato, orçamento, comunicado, propaganda, outro
  - Extrai texto de PDFs anexos (pdf-parse)
  - Notifica admin via WhatsApp com 4 opções de ação
  - Tabela email_inbox com status e dados extraídos
- **ElevenLabs**: Voice ID atualizada para RGymW84CSmfVugnA5tvA (Dorothy)
- **Relatório semanal**: Alterado de sexta para terça-feira 18:00
  - Novas seções: prestadores visitas, despesas pendentes, emails não processados
- **Sidebar**: Link Prestadores (bi-person-badge) em todas as 21 páginas HTML

### Dependências
- imap, mailparser, pdf-parse (para email inbox)

## v2.4.0 (2026-02-26)
### Correções
- **Presença**: Dashboard consolida 1 linha por funcionário (sem duplicatas de almoço)
- **WhatsApp documentos**: Fotos de documentos (CRLV, RG, CPF) detectadas ANTES de entregas/tarefas
- **WhatsApp documentos**: Criação automática de veículo/funcionário via confirmação SIM/NÃO
- **Timezone**: Todas as datas usam `toLocaleDateString('sv-SE', {timeZone: 'America/Sao_Paulo'})` em vez de `toISOString()` (UTC)
- **Timezone**: 3 registros corrigidos no banco (IDs 151, 161, 162) com data errada
- **WhatsApp fetch-missed**: Mensagens perdidas durante offline usam timestamp original e pedem confirmação

### Novas funcionalidades
- **Health check**: GET /api/health (público) — status do DB, WhatsApp, uptime
- **Backup automatizado**: scripts/backup-db.sh — backup diário com retenção de 30 dias
- **Deploy script**: scripts/deploy-production.sh — deploy completo em 1 comando
- **Nginx script**: scripts/update-nginx.sh — gzip, security headers, cache de assets
- **CHANGELOG.md**: Histórico de versões

## v2.3.0 (2026-02-26)
### Novas funcionalidades
- **Veículos**: CRUD completo, análise CRLV via Vision AI, busca placa BigDataCorp, alertas IPVA/revisão
- **Documentos**: Upload, análise Vision AI, vinculação a funcionário/veículo
- **Estoque**: CRUD itens, movimentações (entrada/saída/ajuste), alertas estoque baixo, categorias
- **Tarefas**: CRUD, multi-assign funcionários, prioridade/prazo, integração WhatsApp
- **Chat WhatsApp direto**: Histórico, enviar texto/mídia por funcionário
- **BigDataCorp CPF enrichment**: Auto-fill dados pessoais, accordion com dados brutos
- **Log de acessos**: Login/logout/falhas com IP e user-agent
- **Versão no rodapé**: version.json + GET /api/version

### Correções
- **Presença/Gráficos**: Filtram por `precisa_bater_ponto` e `aparece_relatorios` do cargo
- **Folha**: Labels "Total extras" (não "Total a pagar"), nota explicativa
- **Registros**: Filtros mês/período, badges almoço coloridos, botão Hoje
- **Login**: Placeholder genérico, link esqueci senha com rate limit
- **Funcionários**: Campos expandidos (CPF, RG, endereço, contatos), upload foto, herança cargo
- **WhatsApp**: Enable/disable via API, kill orphan Chrome, documento CREATE entities

## v2.2.0 (2026-02-25)
### Novas funcionalidades
- **Cargos**: Campo `aparece_relatorios` para excluir cargos de relatórios/cálculos
- **Relatórios**: Cálculos respeitam flags individuais do funcionário (HE, VT, VA)
- **Folha**: COALESCE para herança de valores cargo → funcionário
- **Dashboard**: Cards de presença consolidados
- **Gráficos**: Exclusão automática de cargos sem `precisa_bater_ponto`

## v2.1.0 (2026-02-24)
### Novas funcionalidades
- **Entregas via WhatsApp**: Confirmação SIM/NÃO, Vision AI para identificar entregas
- **Upload manual de entregas**: Modal com foto, destinatário, transportadora
- **Feriados**: Sync Google Calendar, CRUD manual, feriados SP 2026
- **WhatsApp IA**: Parser inteligente com Claude Sonnet para registro de ponto
- **Insights IA**: Página de análise operacional e sugestões de melhorias

## v2.0.0 (2026-02-22)
### Reconstrução completa com Claude Code
- SPA Bootstrap 5 com sidebar e navegação por páginas
- JWT + bcrypt autenticação com 3 roles (admin, gestor, viewer)
- 2FA via speakeasy (opcional)
- CRUD completo: Funcionários, Cargos, Registros, Usuários
- Relatórios mensais com export Excel/PDF
- Presença: Calendário visual mensal com heatmap
- Gráficos: Chart.js (barras, linha, pizza)
- WhatsApp: QR Code, status, reconectar, parser inteligente
- Audit log e perfil do usuário
- Esqueci senha via e-mail SMTP (Brevo)
- Fuso horário America/Sao_Paulo em todo o sistema
- PM2 process manager, Nginx reverse proxy, Let's Encrypt SSL

## v1.0.0 (2026-02-01)
### Sistema inicial (Manus)
- Versão original do sistema de controle de ponto
- Backend Node.js + Express + SQLite
- Frontend básico
