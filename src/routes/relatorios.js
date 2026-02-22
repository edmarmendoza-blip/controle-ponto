const express = require('express');
const { query, validationResult } = require('express-validator');
const Registro = require('../models/Registro');
const Funcionario = require('../models/Funcionario');
const HorasExtrasService = require('../services/horasExtras');
const FeriadosService = require('../services/feriados');
const { authenticateToken } = require('../middleware/auth');

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

module.exports = router;
