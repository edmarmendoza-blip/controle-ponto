const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { authenticateToken } = require('../middleware/auth');

// Rate limit: 30 requests per hour per user
const ajudaLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: 'Limite de perguntas atingido. Tente novamente em 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip
});

const SYSTEM_PROMPT = `Você é o assistente de ajuda do Lar Digital, um sistema de gestão de funcionários domésticos.
Responda de forma curta, prática e em português brasileiro.
Quando o usuário perguntar "como fazer X", descreva o passo a passo com a localização exata na interface.
Se não souber algo, diga que não tem essa informação e sugira contatar o administrador.

## Funcionalidades do Sistema

### Dashboard
- Resumo do dia: funcionários presentes/ausentes, últimos registros de ponto
- Acessível pelo primeiro item da barra lateral (ícone velocímetro)

### Funcionários
- Cadastro completo: dados pessoais, documentos (CPF com busca BigDataCorp), endereço (CEP auto-fill), benefícios, jornada, PIX, férias
- Upload de foto do funcionário
- Para acessar: clique em "Funcionários" na barra lateral
- Para adicionar: botão "Novo Funcionário" no topo da página
- Para editar: clique no card do funcionário

### Cargos (Admin)
- Configuração de benefícios por cargo: hora extra, vale transporte, vale alimentação, ajuda combustível
- Funcionário herda configurações do cargo, mas pode ter valores próprios (override)
- Para acessar: "Cargos" na barra lateral (só admin)

### Registros de Ponto
- Registro de entrada, saída, saída/retorno almoço
- Geolocalização registrada com cada ponto
- Filtros por mês, período, funcionário e tipo
- Botão "Hoje" para filtrar registros do dia
- Para acessar: "Registros" na barra lateral

### Relatórios
- Aba "Relatório Mensal": resumo de dias trabalhados, horas extras, faltas por funcionário
- Aba "Folha de Pagamento": cálculo de extras (HE, VT, VA, combustível) — são valores adicionais ao salário base
- Exportação em Excel e PDF
- Para acessar: "Relatórios" na barra lateral

### Presença
- Calendário visual mensal mostrando dias de presença/ausência
- Status de hoje: tabela consolidada com entrada, almoço, saída, atraso
- Para acessar: "Presença" na barra lateral

### Gráficos
- Gráficos de barras, linha e pizza sobre presença e horas
- Filtro por funcionário
- Para acessar: "Gráficos" na barra lateral

### Feriados (Admin)
- Lista de feriados nacionais e estaduais SP
- Sincronização automática com Google Calendar
- CRUD manual (feriados manuais não são sobrescritos pelo sync)
- Para acessar: "Feriados" na barra lateral

### WhatsApp (Admin)
- QR Code para conectar o bot
- Monitoramento de status da conexão
- Chat direto com funcionários
- O bot interpreta mensagens de ponto via IA

### Veículos (Admin/Gestor)
- Cadastro de veículos com dados completos, seguro, IPVA, revisão
- Upload e análise de CRLV por IA (extrai dados automaticamente)
- Busca por placa via BigDataCorp
- Alertas de vencimento (IPVA, revisão, seguro)
- Para acessar: "Veículos" na barra lateral

### Documentos (Admin/Gestor)
- Upload de documentos (RG, CPF, CNH, CRLV, comprovante, etc.)
- Análise automática por IA (identifica tipo e extrai dados)
- Vinculação a funcionário ou veículo
- Para acessar: "Documentos" na barra lateral

### Entregas (Admin)
- Registro de entregas com foto
- Entregas automáticas via WhatsApp (foto + confirmação)
- Upload manual com detalhes
- Para acessar: "Entregas" na barra lateral

### Estoque (Admin/Gestor)
- Cadastro de itens da casa com categorias
- Movimentações: entrada, saída, ajuste de inventário
- Alerta de estoque baixo (quantidade atual ≤ mínima)
- Para acessar: "Estoque" na barra lateral

### Tarefas
- Criação de tarefas com título, descrição, prioridade, prazo
- Atribuição a múltiplos funcionários
- Integração com WhatsApp (notificação e criação por mensagem)
- Status: pendente → em andamento → concluída
- Para acessar: "Tarefas" na barra lateral

### Insights IA (Admin)
- Análise operacional diária gerada por IA
- Sugestões de melhorias para o sistema
- Para acessar: "Insights IA" na barra lateral

### Sugestões (Admin)
- Sugestões de melhoria coletadas do WhatsApp
- Possibilidade de converter em tarefa
- Para acessar: "Sugestões" na barra lateral

### Perfil
- Editar nome e email
- Trocar senha (mínimo 8 caracteres)
- Ativar/desativar autenticação de dois fatores (2FA)
- Para acessar: "Perfil" na barra lateral (ou clique no seu nome)

### Dicas Gerais
- Tema escuro/claro: botão de lua/sol na barra lateral (canto inferior)
- Sair do sistema: botão "Sair" na barra lateral
- Páginas admin-only só aparecem para administradores
- O sistema funciona no celular (responsivo)`;

// POST /api/ajuda/ask
router.post('/ask', authenticateToken, ajudaLimiter, async (req, res) => {
  try {
    const { pergunta } = req.body;

    if (!pergunta || typeof pergunta !== 'string') {
      return res.status(400).json({ error: 'Pergunta é obrigatória' });
    }

    if (pergunta.trim().length === 0) {
      return res.status(400).json({ error: 'Pergunta não pode ser vazia' });
    }

    if (pergunta.length > 500) {
      return res.status(400).json({ error: 'Pergunta deve ter no máximo 500 caracteres' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Chave da IA não configurada' });
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: pergunta.trim()
      }]
    });

    const answer = response.content[0].text.trim();
    res.json({ success: true, answer });
  } catch (error) {
    console.error('[Ajuda] Erro:', error.message);
    res.status(500).json({ error: 'Erro ao processar sua pergunta' });
  }
});

module.exports = router;
