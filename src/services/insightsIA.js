const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('../config/database');
const Funcionario = require('../models/Funcionario');

class InsightsIA {
  static getClient() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY não configurada no .env');
    }
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  static getMessagesByDate(date) {
    return db.prepare(`
      SELECT wm.*, f.nome as funcionario_nome
      FROM whatsapp_mensagens wm
      LEFT JOIN funcionarios f ON wm.funcionario_id = f.id
      WHERE DATE(wm.created_at) = ?
      ORDER BY wm.created_at ASC
    `).all(date);
  }

  static getRegistrosByDate(date) {
    return db.prepare(`
      SELECT r.*, f.nome as funcionario_nome
      FROM registros r
      JOIN funcionarios f ON r.funcionario_id = f.id
      WHERE r.data = ?
      ORDER BY r.entrada ASC
    `).all(date);
  }

  // Format datetime string for display (already stored in local time via datetime('now','localtime'))
  static _toSaoPaulo(dateStr) {
    if (!dateStr) return dateStr;
    try {
      // Data is stored as local time (America/Sao_Paulo) via datetime('now','localtime')
      // Do NOT append 'Z' as that would treat it as UTC and subtract 3 hours
      const parts = dateStr.replace('T', ' ').split(/[- :]/);
      if (parts.length >= 5) {
        const d = parts[2] + '/' + parts[1] + '/' + parts[0] + ' ' + parts[3] + ':' + parts[4] + (parts[5] ? ':' + parts[5].split('.')[0] : '');
        return d;
      }
      return dateStr;
    } catch (e) {
      return dateStr;
    }
  }

  static buildPrompt(messages, registros, employees) {
    const messageList = messages.map(m => {
      const ts = this._toSaoPaulo(m.created_at);
      let line = `[${ts}] ${m.sender_name}: ${m.message_text || '(sem texto)'}`;
      if (m.media_type) line += ` [MÍDIA: ${m.media_type}${m.media_path ? ' - ' + m.media_path : ''}]`;
      return line;
    }).join('\n');

    const registroList = registros.map(r =>
      `${r.funcionario_nome}: entrada=${r.entrada || 'N/A'}, saida=${r.saida || 'N/A'}, tipo=${r.tipo}`
    ).join('\n');

    const employeeList = employees.map(e =>
      `${e.nome} (${e.cargo}, ${e.status})`
    ).join(', ');

    return `Você é um analista operacional da residência "Lar Digital" (Casa dos Bull).
Analise as mensagens do grupo WhatsApp e registros de ponto do dia e gere insights operacionais.

FUNCIONÁRIOS CADASTRADOS:
${employeeList || 'Nenhum cadastrado'}

REGISTROS DE PONTO DO DIA:
${registroList || 'Nenhum registro'}

MENSAGENS DO GRUPO (${messages.length} mensagens):
${messageList || 'Nenhuma mensagem'}

Analise e retorne APENAS um JSON válido (sem markdown, sem backticks) com esta estrutura:
{
  "resumo": "Resumo geral do dia em 2-3 frases",
  "presenca": {
    "presentes": ["nomes dos que registraram ponto ou mandaram mensagem"],
    "ausentes": ["nomes dos cadastrados que não apareceram"],
    "observacoes": "observações sobre pontualidade, atrasos, etc"
  },
  "problemas": [
    { "descricao": "descrição do problema", "gravidade": "alta|media|baixa", "sugestao": "sugestão de resolução" }
  ],
  "entregas": [
    { "descricao": "descrição da entrega/trabalho", "responsavel": "nome", "tem_foto": false }
  ],
  "tarefas": [
    { "descricao": "tarefa mencionada", "responsavel": "nome ou N/A", "status": "pendente|concluida|em_andamento" }
  ],
  "sugestoes": [
    { "titulo": "título curto", "descricao": "descrição detalhada", "prioridade": "alta|media|baixa" }
  ]
}

Se não houver informação suficiente para uma seção, retorne array vazio ou string vazia.
IMPORTANTE: Seja conciso. Máximo 3 itens por array. Descrições curtas (1-2 frases).
Responda SOMENTE com o JSON, sem texto adicional, sem markdown.`;
  }

  static async generateDailyInsights(date) {
    const messages = this.getMessagesByDate(date);
    const registros = this.getRegistrosByDate(date);
    const employees = Funcionario.getAll();

    if (messages.length === 0 && registros.length === 0) {
      return { success: false, message: 'Sem mensagens ou registros para esta data' };
    }

    const prompt = this.buildPrompt(messages, registros, employees);
    const client = this.getClient();

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text.trim();

    let insights;
    // Strip markdown fences if present
    let cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    try {
      insights = JSON.parse(cleaned);
    } catch (e) {
      // Try to extract JSON object from the response
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          insights = JSON.parse(jsonMatch[0]);
        } catch (e2) {
          // Last resort: fix common issues (trailing commas, unescaped quotes in strings)
          let fixed = jsonMatch[0]
            .replace(/,\s*([\]}])/g, '$1')  // trailing commas
            .replace(/[\x00-\x1f]/g, ' ');  // control chars
          insights = JSON.parse(fixed);
        }
      } else {
        throw new Error('Resposta da IA não é um JSON válido');
      }
    }

    this.saveInsight(date, JSON.stringify(insights), messages.length, 'claude-sonnet-4-6');

    return {
      success: true,
      data: date,
      insights,
      mensagens_analisadas: messages.length,
    };
  }

  static saveInsight(data, insightsJson, count, model) {
    db.prepare(`
      INSERT OR REPLACE INTO insights_ia (data, insights_json, mensagens_analisadas, modelo, created_at)
      VALUES (?, ?, ?, ?, datetime('now','localtime'))
    `).run(data, insightsJson, count, model);
  }

  static getByDate(date) {
    const row = db.prepare('SELECT * FROM insights_ia WHERE data = ?').get(date);
    if (row) {
      row.insights = JSON.parse(row.insights_json);
    }
    return row;
  }

  static getMessagesByRange(startDate, endDate) {
    return db.prepare(`
      SELECT wm.*, f.nome as funcionario_nome
      FROM whatsapp_mensagens wm
      LEFT JOIN funcionarios f ON wm.funcionario_id = f.id
      WHERE DATE(wm.created_at) BETWEEN ? AND ?
      ORDER BY wm.created_at ASC
    `).all(startDate, endDate);
  }

  static getRegistrosByRange(startDate, endDate) {
    return db.prepare(`
      SELECT r.*, f.nome as funcionario_nome
      FROM registros r
      JOIN funcionarios f ON r.funcionario_id = f.id
      WHERE r.data BETWEEN ? AND ?
      ORDER BY r.data ASC, r.entrada ASC
    `).all(startDate, endDate);
  }

  static buildPeriodPrompt(messages, registros, employees, startDate, endDate) {
    // Group messages by day with summary
    const byDay = {};
    for (const m of messages) {
      const day = (this._toSaoPaulo(m.created_at) || m.created_at).split(',')[0].split(' ')[0];
      if (!byDay[day]) byDay[day] = { msgs: [], senders: new Set(), entradas: 0, saidas: 0 };
      byDay[day].msgs.push(m);
      byDay[day].senders.add(m.funcionario_nome || m.sender_name);
      if (m.message_type === 'entrada') byDay[day].entradas++;
      if (m.message_type === 'saida') byDay[day].saidas++;
    }

    const dailySummary = Object.entries(byDay).sort().map(([day, data]) => {
      const senders = [...data.senders].filter(Boolean).join(', ');
      // Include up to 5 key messages (entradas, saidas, tasks)
      const keyMsgs = data.msgs
        .filter(m => m.message_type !== 'other' || /tarefa|problema|compra|mercado|escola|dentista|finaliz/i.test(m.message_text || ''))
        .slice(0, 5)
        .map(m => `  ${m.sender_name}: ${(m.message_text || '').slice(0, 80)}`)
        .join('\n');
      return `${day} | ${data.msgs.length} msgs | Presentes: ${senders} | Entradas: ${data.entradas}, Saídas: ${data.saidas}\n${keyMsgs}`;
    }).join('\n\n');

    // Registros summary
    const regSummary = registros.map(r =>
      `${r.data} ${r.funcionario_nome}: entrada=${r.entrada || 'N/A'}, saida=${r.saida || 'N/A'}`
    ).join('\n');

    const employeeList = employees.map(e => `${e.nome} (${e.cargo})`).join(', ');

    return `Você é um analista operacional da residência "Lar Digital" (Casa dos Bull).
Analise o PERÍODO de ${startDate} a ${endDate} (${Object.keys(byDay).length} dias com atividade, ${messages.length} mensagens totais).

FUNCIONÁRIOS CADASTRADOS:
${employeeList || 'Nenhum'}

REGISTROS DE PONTO DO PERÍODO:
${regSummary || 'Nenhum'}

RESUMO DIÁRIO DAS MENSAGENS:
${dailySummary || 'Nenhuma mensagem'}

Gere uma análise do PERÍODO COMPLETO. Retorne APENAS JSON válido (sem markdown):
{
  "resumo": "Resumo geral do período em 3-4 frases, com visão macro da operação",
  "presenca": {
    "ranking": [{"nome": "nome", "dias_presentes": 0, "primeira_msg_media": "HH:MM", "ultima_msg_media": "HH:MM"}],
    "ausencias_frequentes": ["nomes com muitas faltas"],
    "observacoes": "padrões de pontualidade, quem chega cedo/tarde"
  },
  "problemas_recorrentes": [
    {"descricao": "problema que se repetiu", "frequencia": "X vezes", "gravidade": "alta|media|baixa", "sugestao": "solução"}
  ],
  "destaques": [
    {"descricao": "destaque positivo ou negativo do período", "responsavel": "nome"}
  ],
  "padroes": [
    {"descricao": "padrão observado nas rotinas/comunicação", "tipo": "positivo|negativo|neutro"}
  ],
  "sugestoes": [
    {"titulo": "título", "descricao": "descrição", "prioridade": "alta|media|baixa"}
  ]
}

Seja conciso. Máximo 5 itens por array. Foque em padrões e tendências, não em eventos isolados.
Responda SOMENTE com JSON, sem texto adicional.`;
  }

  static async generatePeriodInsights(startDate, endDate) {
    const messages = this.getMessagesByRange(startDate, endDate);
    const registros = this.getRegistrosByRange(startDate, endDate);
    const employees = Funcionario.getAll();

    if (messages.length === 0 && registros.length === 0) {
      return { success: false, message: 'Sem mensagens ou registros para este período' };
    }

    const prompt = this.buildPeriodPrompt(messages, registros, employees, startDate, endDate);
    const client = this.getClient();

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text.trim();

    let insights;
    let cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    try {
      insights = JSON.parse(cleaned);
    } catch (e) {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          insights = JSON.parse(jsonMatch[0]);
        } catch (e2) {
          let fixed = jsonMatch[0]
            .replace(/,\s*([\]}])/g, '$1')
            .replace(/[\x00-\x1f]/g, ' ');
          insights = JSON.parse(fixed);
        }
      } else {
        throw new Error('Resposta da IA não é um JSON válido');
      }
    }

    // Save with key "period_START_END"
    const key = `period_${startDate}_${endDate}`;
    this.saveInsight(key, JSON.stringify(insights), messages.length, 'claude-sonnet-4-6');

    return {
      success: true,
      tipo: 'periodo',
      periodo: { inicio: startDate, fim: endDate },
      insights,
      mensagens_analisadas: messages.length,
    };
  }

  static async generateMelhoriasInsights() {
    const client = this.getClient();

    // Gather system usage stats
    const totalFuncionarios = db.prepare('SELECT COUNT(*) as cnt FROM funcionarios WHERE status = ?').get('ativo')?.cnt || 0;
    const totalRegistros = db.prepare('SELECT COUNT(*) as cnt FROM registros').get()?.cnt || 0;
    const totalMensagens = db.prepare('SELECT COUNT(*) as cnt FROM whatsapp_mensagens').get()?.cnt || 0;
    const totalInsights = db.prepare('SELECT COUNT(*) as cnt FROM insights_ia').get()?.cnt || 0;
    const totalFeriados = db.prepare('SELECT COUNT(*) as cnt FROM feriados').get()?.cnt || 0;
    const totalUsers = db.prepare('SELECT COUNT(*) as cnt FROM users').get()?.cnt || 0;

    // Recent activity (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const recentRegistros = db.prepare('SELECT COUNT(*) as cnt FROM registros WHERE data >= ?').get(thirtyDaysAgo)?.cnt || 0;
    const recentMensagens = db.prepare("SELECT COUNT(*) as cnt FROM whatsapp_mensagens WHERE created_at >= ?").get(thirtyDaysAgo)?.cnt || 0;

    // Employees with incomplete data
    const withoutPhone = db.prepare("SELECT COUNT(*) as cnt FROM funcionarios WHERE status = 'ativo' AND (telefone IS NULL OR telefone = '')").get()?.cnt || 0;
    const withoutAdmissao = db.prepare("SELECT COUNT(*) as cnt FROM funcionarios WHERE status = 'ativo' AND data_admissao IS NULL").get()?.cnt || 0;
    const withoutJornada = db.prepare("SELECT COUNT(*) as cnt FROM funcionarios WHERE status = 'ativo' AND (jornada_texto IS NULL OR jornada_texto = '')").get()?.cnt || 0;

    // Registros without saída
    const openRegistros = db.prepare("SELECT COUNT(*) as cnt FROM registros WHERE saida IS NULL AND entrada IS NOT NULL AND data >= ?").get(thirtyDaysAgo)?.cnt || 0;

    // WhatsApp status
    const whatsappEnabled = db.prepare("SELECT valor FROM configuracoes WHERE chave = 'whatsapp_enabled'").get();

    const employees = Funcionario.getAll();
    const employeeList = employees.map(e => `${e.nome} (${e.cargo || 'sem cargo'}, classificacao: ${e.classificacao || 'N/A'})`).join(', ');

    const prompt = `Você é um consultor de sistemas de gestão de RH. Analise o uso do sistema "Lar Digital" (gestão de funcionários domésticos) e sugira melhorias de funcionalidades e novas features.

DADOS DO SISTEMA:
- Funcionários ativos: ${totalFuncionarios}
- Funcionários: ${employeeList}
- Total de registros de ponto: ${totalRegistros} (${recentRegistros} nos últimos 30 dias)
- Total de mensagens WhatsApp: ${totalMensagens} (${recentMensagens} nos últimos 30 dias)
- Insights IA gerados: ${totalInsights}
- Feriados cadastrados: ${totalFeriados}
- Usuários do sistema: ${totalUsers}
- WhatsApp integração: ${whatsappEnabled?.valor === 'true' ? 'Ativa' : 'Inativa'}

PROBLEMAS DETECTADOS:
- Funcionários sem telefone cadastrado: ${withoutPhone}
- Funcionários sem data de admissão: ${withoutAdmissao}
- Funcionários sem jornada definida: ${withoutJornada}
- Registros de ponto sem saída (últimos 30 dias): ${openRegistros}

FUNCIONALIDADES ATUAIS:
- Dashboard com resumo do dia
- CRUD de funcionários (8 abas: dados pessoais, classificação, jornada, benefícios, VT, VA, PIX, comunicação)
- Registros de ponto (manual + WhatsApp)
- Relatórios mensais
- Feriados (SP 2026 + sync Google Calendar)
- WhatsApp bot (detecção de entrada/saída)
- Insights IA diários e por período
- Gráficos (horas, extras, presença)
- Holerites
- Férias
- Audit log
- 2FA

Retorne APENAS JSON válido (sem markdown) com esta estrutura:
{
  "resumo": "Avaliação geral do uso do sistema em 2-3 frases",
  "dados_incompletos": [
    {"problema": "descrição", "impacto": "alto|medio|baixo", "solucao": "como resolver"}
  ],
  "melhorias_existentes": [
    {"funcionalidade": "nome", "melhoria": "descrição da melhoria", "prioridade": "alta|media|baixa", "esforco": "baixo|medio|alto"}
  ],
  "novas_features": [
    {"titulo": "nome da feature", "descricao": "descrição detalhada", "beneficio": "como ajuda o usuario", "prioridade": "alta|media|baixa"}
  ],
  "automacoes": [
    {"titulo": "nome", "descricao": "o que automatizar", "gatilho": "quando executar"}
  ]
}

Máximo 5 itens por array. Foque em melhorias práticas para gestão doméstica.
Responda SOMENTE com JSON, sem texto adicional.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text.trim();
    let insights;
    let cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    try {
      insights = JSON.parse(cleaned);
    } catch (e) {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          insights = JSON.parse(jsonMatch[0]);
        } catch (e2) {
          let fixed = jsonMatch[0].replace(/,\s*([\]}])/g, '$1').replace(/[\x00-\x1f]/g, ' ');
          insights = JSON.parse(fixed);
        }
      } else {
        throw new Error('Resposta da IA não é um JSON válido');
      }
    }

    const key = `melhorias_${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })}`;
    this.saveInsight(key, JSON.stringify(insights), 0, 'claude-sonnet-4-6');

    return {
      success: true,
      tipo: 'melhorias',
      insights,
    };
  }

  static getAll(page = 1, limit = 10) {
    const offset = (page - 1) * limit;
    const total = db.prepare('SELECT COUNT(*) as count FROM insights_ia').get().count;
    const rows = db.prepare('SELECT * FROM insights_ia ORDER BY data DESC LIMIT ? OFFSET ?').all(limit, offset);
    rows.forEach(r => { r.insights = JSON.parse(r.insights_json); });
    return { data: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}

module.exports = InsightsIA;
