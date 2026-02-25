const { db } = require('../config/database');
const FeriadosService = require('../services/feriados');

class DashboardPresenca {
  static getPresencaHoje(data) {
    const rows = db.prepare(`
      SELECT
        f.id,
        f.nome,
        COALESCE(c.nome, f.cargo) as cargo,
        f.horario_entrada,
        r.entrada,
        r.saida
      FROM funcionarios f
      LEFT JOIN cargos c ON f.cargo_id = c.id
      LEFT JOIN registros r ON f.id = r.funcionario_id AND r.data = ?
      WHERE f.status = 'ativo'
        AND (c.precisa_bater_ponto = 1 OR (c.precisa_bater_ponto IS NULL AND c.id IS NULL))
      ORDER BY f.nome
    `).all(data);

    const funcionarios = rows.map(row => {
      let status = 'ausente';
      let minutos_atraso = 0;

      if (row.entrada) {
        if (row.saida) {
          status = 'saiu';
        } else {
          status = 'presente';
        }

        // Check lateness
        const esperado = row.horario_entrada || '08:00';
        if (row.entrada > esperado) {
          status = 'atrasado';
          const [eh, em] = esperado.split(':').map(Number);
          const [rh, rm] = row.entrada.split(':').map(Number);
          minutos_atraso = (rh * 60 + rm) - (eh * 60 + em);
        }
      }

      return {
        id: row.id,
        nome: row.nome,
        cargo: row.cargo,
        horario_esperado: row.horario_entrada || '08:00',
        entrada: row.entrada || null,
        saida: row.saida || null,
        status,
        minutos_atraso
      };
    });

    const resumo = {
      total: funcionarios.length,
      presentes: funcionarios.filter(f => f.status === 'presente').length,
      ausentes: funcionarios.filter(f => f.status === 'ausente').length,
      atrasados: funcionarios.filter(f => f.status === 'atrasado').length,
      sairam: funcionarios.filter(f => f.status === 'saiu').length
    };

    return { data, resumo, funcionarios };
  }

  static getPresencaMensal(mes, ano) {
    const diasUteis = FeriadosService.getWorkingDaysInMonth(mes, ano);
    const lastDay = new Date(ano, mes, 0).getDate();
    const dataInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const dataFim = `${ano}-${String(mes).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const funcionariosAtivos = db.prepare(`
      SELECT f.id, f.nome, COALESCE(c.nome, f.cargo) as cargo, f.horario_entrada
      FROM funcionarios f
      LEFT JOIN cargos c ON f.cargo_id = c.id
      WHERE f.status = 'ativo'
        AND (c.precisa_bater_ponto = 1 OR (c.precisa_bater_ponto IS NULL AND c.id IS NULL))
      ORDER BY f.nome
    `).all();

    const registros = db.prepare(`
      SELECT funcionario_id, data, entrada
      FROM registros
      WHERE data BETWEEN ? AND ?
    `).all(dataInicio, dataFim);

    // Index records by funcionario_id -> data
    const registroMap = {};
    for (const r of registros) {
      if (!registroMap[r.funcionario_id]) registroMap[r.funcionario_id] = {};
      registroMap[r.funcionario_id][r.data] = r;
    }

    // Build working days list
    const diasUteisList = [];
    for (let day = 1; day <= lastDay; day++) {
      const data = `${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayType = FeriadosService.getDayType(data);
      diasUteisList.push({ data, tipo: dayType.tipo });
    }

    const heatmap = [];
    const funcionariosData = funcionariosAtivos.map(func => {
      const esperado = func.horario_entrada || '08:00';
      let dias_trabalhados = 0;
      let faltas = 0;
      let atrasos = 0;
      let total_minutos_atraso = 0;

      for (const dia of diasUteisList) {
        const reg = registroMap[func.id]?.[dia.data];

        if (dia.tipo !== 'normal') {
          // Weekend/holiday
          heatmap.push({ data: dia.data, funcionario_id: func.id, status: dia.tipo });
          continue;
        }

        // Only count working days up to today
        if (dia.data > new Date().toISOString().split('T')[0]) {
          heatmap.push({ data: dia.data, funcionario_id: func.id, status: 'futuro' });
          continue;
        }

        if (reg && reg.entrada) {
          dias_trabalhados++;
          if (reg.entrada > esperado) {
            atrasos++;
            const [eh, em] = esperado.split(':').map(Number);
            const [rh, rm] = reg.entrada.split(':').map(Number);
            total_minutos_atraso += (rh * 60 + rm) - (eh * 60 + em);
            heatmap.push({ data: dia.data, funcionario_id: func.id, status: 'atrasado' });
          } else {
            heatmap.push({ data: dia.data, funcionario_id: func.id, status: 'presente' });
          }
        } else {
          faltas++;
          heatmap.push({ data: dia.data, funcionario_id: func.id, status: 'falta' });
        }
      }

      // Count working days up to today for accurate rate
      const today = new Date().toISOString().split('T')[0];
      const diasUteisPassados = diasUteisList.filter(d => d.tipo === 'normal' && d.data <= today).length;
      const taxa_assiduidade = diasUteisPassados > 0
        ? Math.round((dias_trabalhados / diasUteisPassados) * 10000) / 100
        : 0;

      return {
        id: func.id,
        nome: func.nome,
        cargo: func.cargo,
        dias_trabalhados,
        faltas,
        atrasos,
        taxa_assiduidade,
        media_minutos_atraso: atrasos > 0 ? Math.round(total_minutos_atraso / atrasos) : 0
      };
    });

    // Ranking sorted by taxa_assiduidade DESC
    const ranking = [...funcionariosData]
      .sort((a, b) => b.taxa_assiduidade - a.taxa_assiduidade)
      .map((f, i) => ({
        id: f.id,
        nome: f.nome,
        cargo: f.cargo,
        taxa_assiduidade: f.taxa_assiduidade,
        dias_trabalhados: f.dias_trabalhados,
        faltas: f.faltas,
        posicao: i + 1
      }));

    return {
      mes: parseInt(mes),
      ano: parseInt(ano),
      diasUteis,
      funcionarios: funcionariosData,
      heatmap,
      ranking
    };
  }
}

module.exports = DashboardPresenca;
