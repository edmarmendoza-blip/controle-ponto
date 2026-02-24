const express = require('express');
const { query, validationResult } = require('express-validator');
const Registro = require('../models/Registro');
const Funcionario = require('../models/Funcionario');
const HorasExtrasService = require('../services/horasExtras');
const FeriadosService = require('../services/feriados');
const { authenticateToken } = require('../middleware/auth');
const { db } = require('../config/database');

const router = express.Router();

// GET /api/relatorios/mensal
router.get('/mensal', authenticateToken, [
  query('mes').isInt({ min: 1, max: 12 }).withMessage('Mês inválido (1-12)'),
  query('ano').isInt({ min: 2020, max: 2099 }).withMessage('Ano inválido'),
  query('funcionarioId').optional().isInt().withMessage('ID funcionário inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { mes, ano, funcionarioId } = req.query;
    const registros = Registro.getMonthlyReport(parseInt(mes), parseInt(ano), funcionarioId);
    const resumo = HorasExtrasService.calcularResumoMensal(registros);
    const diasUteis = FeriadosService.getWorkingDaysInMonth(parseInt(mes), parseInt(ano));

    res.json({
      mes: parseInt(mes),
      ano: parseInt(ano),
      diasUteis,
      funcionarios: Object.values(resumo)
    });
  } catch (err) {
    console.error('Relatório mensal error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/relatorios/diario
router.get('/diario', authenticateToken, [
  query('data').isDate().withMessage('Data inválida')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { data } = req.query;
    const registros = Registro.getByDate(data);
    const config = HorasExtrasService.getConfig();
    const dayType = FeriadosService.getDayType(data);

    const detalhes = registros.map(reg => {
      const calc = HorasExtrasService.calcularRegistro(reg, config);
      return { ...reg, ...calc };
    });

    res.json({
      data,
      tipoDia: dayType,
      registros: detalhes
    });
  } catch (err) {
    console.error('Relatório diário error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/relatorios/funcionario/:id
router.get('/funcionario/:id', authenticateToken, [
  query('mes').isInt({ min: 1, max: 12 }).withMessage('Mês inválido'),
  query('ano').isInt({ min: 2020, max: 2099 }).withMessage('Ano inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const funcionario = Funcionario.findById(req.params.id);
    if (!funcionario) {
      return res.status(404).json({ error: 'Funcionário não encontrado' });
    }

    const { mes, ano } = req.query;
    const registros = Registro.getMonthlyReport(parseInt(mes), parseInt(ano), req.params.id);
    const resumo = HorasExtrasService.calcularResumoMensal(registros);
    const diasUteis = FeriadosService.getWorkingDaysInMonth(parseInt(mes), parseInt(ano));

    res.json({
      funcionario,
      mes: parseInt(mes),
      ano: parseInt(ano),
      diasUteis,
      resumo: resumo[req.params.id] || {
        totalHorasTrabalhadas: 0,
        totalHorasNormais: 0,
        totalHorasExtras: 0,
        totalValorNormal: 0,
        totalHorasExtraValor: 0,
        totalValor: 0,
        diasTrabalhados: 0,
        registros: []
      }
    });
  } catch (err) {
    console.error('Relatório funcionário error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/relatorios/folha
router.get('/folha', authenticateToken, [
  query('mes').isInt({ min: 1, max: 12 }).withMessage('Mês inválido (1-12)'),
  query('ano').isInt({ min: 2020, max: 2099 }).withMessage('Ano inválido'),
  query('funcionarioId').optional().isInt().withMessage('ID funcionário inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { mes, ano, funcionarioId } = req.query;
    const mesInt = parseInt(mes);
    const anoInt = parseInt(ano);

    // Get all active employees or specific one
    let funcionarios;
    if (funcionarioId) {
      const func = Funcionario.findById(parseInt(funcionarioId));
      if (!func) return res.status(404).json({ error: 'Funcionário não encontrado' });
      funcionarios = [func];
    } else {
      funcionarios = Funcionario.getAll();
    }

    const resultados = [];
    for (const func of funcionarios) {
      // Get cargo config for conditional calculations
      let cargo = null;
      if (func.cargo_id) {
        cargo = db.prepare('SELECT * FROM cargos WHERE id = ?').get(func.cargo_id);
      }

      // Skip "Dono(a) da Casa" entirely
      const cargoNome = (func.cargo_nome || func.cargo || '').toLowerCase();
      if (cargoNome.includes('dono') || cargoNome.includes('dona')) continue;

      // Determine what applies: employee overrides, fallback to cargo
      const precisaBaterPonto = cargo ? cargo.precisa_bater_ponto : 1;
      const permiteHE = (func.contabiliza_hora_extra || (cargo && cargo.permite_hora_extra)) ? true : false;
      const permiteDE = (cargo && cargo.permite_dia_extra) ? true : false;
      const recebeVT = (func.recebe_vt || (cargo && cargo.recebe_vale_transporte)) ? true : false;
      const recebeVA = (func.tem_vale_alimentacao || func.recebe_va || (cargo && cargo.recebe_vale_refeicao)) ? true : false;
      const recebeCombustivel = (cargo && cargo.recebe_ajuda_combustivel) ? true : false;

      // Use employee values first, fallback to cargo defaults
      const valorHE = func.valor_hora_extra || (cargo && cargo.valor_hora_extra) || 0;
      const valorDE = func.valor_dia_especial || (cargo && cargo.valor_dia_extra) || 0;
      const funcComValores = { ...func, valor_hora_extra: valorHE, valor_dia_especial: valorDE };

      const registros = Registro.getMonthlyReport(mesInt, anoInt, func.id);
      const folha = precisaBaterPonto ? HorasExtrasService.calcularFolha(registros, funcComValores) : { resumo: { diasTrabalhados: 0, diasTrabalhadosUteis: 0, diasTrabalhadosEspeciais: 0, totalHorasTrabalhadas: 0, totalHorasExtras: 0, totalPgtoHE: 0, totalPgtoFDS: 0 }, registros: [] };
      const r = folha.resumo;

      const diasTrab = r.diasTrabalhados || 0;
      const totalPgtoHE = permiteHE ? (r.totalPgtoHE || 0) : 0;
      const totalPgtoFDS = permiteDE ? (r.totalPgtoFDS || 0) : 0;
      const totalVT = recebeVT ? Funcionario.calcularVT(func.id, diasTrab) : null;
      const totalVA = recebeVA ? Math.round((func.valor_va_dia || (cargo && cargo.valor_vale_refeicao) || 0) * diasTrab * 100) / 100 : null;
      const totalAjudaCombustivel = recebeCombustivel ? ((cargo && cargo.valor_ajuda_combustivel) || 0) : null;

      const totalGeral = Math.round((totalPgtoHE + totalPgtoFDS + (totalVT || 0) + (totalVA || 0) + (totalAjudaCombustivel || 0)) * 100) / 100;

      resultados.push({
        funcionario: {
          nome: func.nome,
          cargo: func.cargo_nome || func.cargo,
          valor_hora_extra: valorHE,
          valor_dia_especial: valorDE,
          jornada_diaria: func.jornada_diaria || 9.8,
          pix_tipo: func.pix_tipo || null,
          pix_chave: func.pix_chave || null,
          pix_banco: func.pix_banco || null,
          permiteHE, permiteDE, recebeVT, recebeVA, recebeCombustivel, precisaBaterPonto
        },
        resumo: {
          diasTrabalhados: diasTrab,
          diasTrabalhadosUteis: r.diasTrabalhadosUteis || 0,
          diasTrabalhadosEspeciais: r.diasTrabalhadosEspeciais || 0,
          totalHorasTrabalhadas: r.totalHorasTrabalhadas || 0,
          totalHorasExtras: permiteHE ? (r.totalHorasExtras || 0) : 0,
          totalHorasNormais: Math.round(((r.totalHorasTrabalhadas || 0) - (r.totalHorasExtras || 0)) * 100) / 100,
          totalPgtoHE,
          totalPgtoFDS,
          totalVT,
          totalVA,
          totalAjudaCombustivel,
          totalGeral
        },
        registros: folha.registros
      });
    }

    res.json({
      mes: mesInt,
      ano: anoInt,
      folhas: resultados
    });
  } catch (err) {
    console.error('Relatório folha error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/relatorios/comparativo
router.get('/comparativo', authenticateToken, [
  query('mes').isInt({ min: 1, max: 12 }).withMessage('Mês inválido'),
  query('ano').isInt({ min: 2020, max: 2099 }).withMessage('Ano inválido'),
  query('funcionarioId').optional().isInt().withMessage('ID funcionário inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { mes, ano, funcionarioId } = req.query;
    const registros = Registro.getMonthlyReport(parseInt(mes), parseInt(ano), funcionarioId);
    const config = HorasExtrasService.getConfig();

    // Hours per employee (bar chart data)
    const employeeHours = {};
    // Daily hours trend (line chart data)
    const dailyHours = {};
    // Overtime distribution (pie chart data)
    let totalNormal = 0;
    let totalOvertime = 0;
    let totalHoliday = 0;

    for (const reg of registros) {
      const calc = HorasExtrasService.calcularRegistro(reg, config);

      // Aggregate per employee
      if (!employeeHours[reg.funcionario_id]) {
        employeeHours[reg.funcionario_id] = {
          nome: reg.funcionario_nome,
          horasTrabalhadas: 0,
          horasExtras: 0,
          horasNormais: 0
        };
      }
      employeeHours[reg.funcionario_id].horasTrabalhadas += calc.horasTrabalhadas;
      employeeHours[reg.funcionario_id].horasExtras += calc.horasExtras;
      employeeHours[reg.funcionario_id].horasNormais += calc.horasNormais;

      // Aggregate per day
      if (!dailyHours[reg.data]) {
        dailyHours[reg.data] = { total: 0, normal: 0, extras: 0 };
      }
      dailyHours[reg.data].total += calc.horasTrabalhadas;
      dailyHours[reg.data].normal += calc.horasNormais;
      dailyHours[reg.data].extras += calc.horasExtras;

      // Pie chart distribution
      totalNormal += calc.horasNormais;
      if (calc.tipoDia.tipo === 'feriado' || calc.tipoDia.tipo === 'domingo') {
        totalHoliday += calc.horasExtras;
      } else {
        totalOvertime += calc.horasExtras;
      }
    }

    // Round values
    for (const emp of Object.values(employeeHours)) {
      emp.horasTrabalhadas = Math.round(emp.horasTrabalhadas * 100) / 100;
      emp.horasExtras = Math.round(emp.horasExtras * 100) / 100;
      emp.horasNormais = Math.round(emp.horasNormais * 100) / 100;
    }

    // Sort daily data by date
    const sortedDays = Object.keys(dailyHours).sort();
    const dailyTrend = sortedDays.map(d => ({
      data: d,
      total: Math.round(dailyHours[d].total * 100) / 100,
      normal: Math.round(dailyHours[d].normal * 100) / 100,
      extras: Math.round(dailyHours[d].extras * 100) / 100
    }));

    res.json({
      employeeHours: Object.values(employeeHours),
      dailyTrend,
      distribution: {
        normal: Math.round(totalNormal * 100) / 100,
        overtime: Math.round(totalOvertime * 100) / 100,
        holiday: Math.round(totalHoliday * 100) / 100
      }
    });
  } catch (err) {
    console.error('Relatório comparativo error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/relatorios/feriados
router.get('/feriados', authenticateToken, [
  query('mes').optional().isInt({ min: 1, max: 12 }).withMessage('Mês inválido'),
  query('ano').isInt({ min: 2020, max: 2099 }).withMessage('Ano inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { mes, ano } = req.query;
    const anoInt = parseInt(ano);
    const Feriado = require('../models/Feriado');
    let feriados = Feriado.getAll(anoInt);

    if (mes) {
      const mesStr = String(mes).padStart(2, '0');
      feriados = feriados.filter(f => f.data.substring(5, 7) === mesStr);
    }

    // For each holiday, check if any employee worked
    const registrosPorFeriado = feriados.map(f => {
      const registros = Registro.getByDate(f.data);
      const trabalharam = registros.filter(r => r.entrada && r.saida);
      return {
        ...f,
        funcionarios_trabalharam: trabalharam.length,
        detalhes: trabalharam.map(r => ({
          funcionario_id: r.funcionario_id,
          nome: r.funcionario_nome,
          entrada: r.entrada,
          saida: r.saida
        }))
      };
    });

    res.json({ ano: anoInt, mes: mes ? parseInt(mes) : null, feriados: registrosPorFeriado });
  } catch (err) {
    console.error('Relatório feriados error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/relatorios/vale-transporte
router.get('/vale-transporte', authenticateToken, [
  query('mes').isInt({ min: 1, max: 12 }).withMessage('Mês inválido'),
  query('ano').isInt({ min: 2020, max: 2099 }).withMessage('Ano inválido'),
  query('funcionarioId').optional().isInt().withMessage('ID funcionário inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { mes, ano, funcionarioId } = req.query;
    const mesInt = parseInt(mes);
    const anoInt = parseInt(ano);

    let funcionarios;
    if (funcionarioId) {
      const func = Funcionario.findById(parseInt(funcionarioId));
      if (!func) return res.status(404).json({ error: 'Funcionário não encontrado' });
      funcionarios = [func];
    } else {
      funcionarios = Funcionario.getAll();
    }

    const resultados = funcionarios.filter(f => f.recebe_vt).map(func => {
      const registros = Registro.getMonthlyReport(mesInt, anoInt, func.id);
      const diasTrabalhados = registros.filter(r => r.entrada && r.saida).length;
      const totalVT = Funcionario.calcularVT(func.id, diasTrabalhados);
      const transportes = Funcionario.getTransportes(func.id);
      return {
        funcionario_id: func.id,
        nome: func.nome,
        cargo: func.cargo,
        tipo_transporte: func.tipo_transporte || 'diario',
        dias_trabalhados: diasTrabalhados,
        transportes,
        total_vt: totalVT
      };
    });

    res.json({ mes: mesInt, ano: anoInt, vales: resultados });
  } catch (err) {
    console.error('Relatório VT error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/relatorios/vale-alimentacao
router.get('/vale-alimentacao', authenticateToken, [
  query('mes').isInt({ min: 1, max: 12 }).withMessage('Mês inválido'),
  query('ano').isInt({ min: 2020, max: 2099 }).withMessage('Ano inválido'),
  query('funcionarioId').optional().isInt().withMessage('ID funcionário inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { mes, ano, funcionarioId } = req.query;
    const mesInt = parseInt(mes);
    const anoInt = parseInt(ano);

    let funcionarios;
    if (funcionarioId) {
      const func = Funcionario.findById(parseInt(funcionarioId));
      if (!func) return res.status(404).json({ error: 'Funcionário não encontrado' });
      funcionarios = [func];
    } else {
      funcionarios = Funcionario.getAll();
    }

    const resultados = funcionarios.filter(f => f.tem_vale_alimentacao).map(func => {
      const registros = Registro.getMonthlyReport(mesInt, anoInt, func.id);
      const diasTrabalhados = registros.filter(r => r.entrada && r.saida).length;
      const valorDiarioVA = func.valor_va_dia || 0;
      return {
        funcionario_id: func.id,
        nome: func.nome,
        cargo: func.cargo,
        dias_trabalhados: diasTrabalhados,
        valor_diario_va: valorDiarioVA,
        total_va: Math.round(diasTrabalhados * valorDiarioVA * 100) / 100
      };
    });

    res.json({ mes: mesInt, ano: anoInt, vales: resultados });
  } catch (err) {
    console.error('Relatório VA error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
