const express = require('express');
const { query, validationResult } = require('express-validator');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const Registro = require('../models/Registro');
const Funcionario = require('../models/Funcionario');
const HorasExtrasService = require('../services/horasExtras');
const FeriadosService = require('../services/feriados');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/export/excel
router.get('/excel', authenticateToken, [
  query('mes').isInt({ min: 1, max: 12 }).withMessage('Mês inválido'),
  query('ano').isInt({ min: 2020, max: 2099 }).withMessage('Ano inválido'),
  query('funcionarioId').optional().isInt().withMessage('ID funcionário inválido')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { mes, ano, funcionarioId } = req.query;
    const registros = Registro.getMonthlyReport(parseInt(mes), parseInt(ano), funcionarioId);
    const resumo = HorasExtrasService.calcularResumoMensal(registros);
    const mesNome = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][parseInt(mes)];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Controle de Ponto - Casa dos Bull';
    workbook.created = new Date();

    for (const func of Object.values(resumo)) {
      const sheet = workbook.addWorksheet(func.nome.substring(0, 31));

      // Header
      sheet.mergeCells('A1:H1');
      sheet.getCell('A1').value = `Relatório de Ponto - ${func.nome}`;
      sheet.getCell('A1').font = { size: 14, bold: true };
      sheet.getCell('A1').alignment = { horizontal: 'center' };

      sheet.mergeCells('A2:H2');
      sheet.getCell('A2').value = `${mesNome} ${ano} | Cargo: ${func.cargo} | R$ ${func.salario_hora.toFixed(2)}/hora`;
      sheet.getCell('A2').alignment = { horizontal: 'center' };

      // Column headers
      const headerRow = sheet.addRow([]);
      sheet.addRow(['Data', 'Dia', 'Entrada', 'Saída', 'Horas Trab.', 'H. Normais', 'H. Extras', 'Valor (R$)']);
      const hRow = sheet.getRow(4);
      hRow.font = { bold: true };
      hRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { horizontal: 'center' };
        cell.border = { bottom: { style: 'thin' } };
      });

      // Data rows
      const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      for (const reg of func.registros) {
        const date = new Date(reg.data + 'T12:00:00');
        const diaSemana = diasSemana[date.getDay()];
        const row = sheet.addRow([
          reg.data, diaSemana, reg.entrada || '-', reg.saida || '-',
          reg.horasTrabalhadas.toFixed(2), reg.horasNormais.toFixed(2),
          reg.horasExtras.toFixed(2), reg.valorTotal.toFixed(2)
        ]);
        row.eachCell(cell => { cell.alignment = { horizontal: 'center' }; });

        if (reg.tipoDia.tipo === 'feriado' || reg.tipoDia.tipo === 'domingo') {
          row.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
          });
        }
      }

      // Totals
      sheet.addRow([]);
      const totalRow = sheet.addRow([
        'TOTAIS', '', '', '', func.totalHorasTrabalhadas.toFixed(2),
        func.totalHorasNormais.toFixed(2), func.totalHorasExtras.toFixed(2),
        func.totalValor.toFixed(2)
      ]);
      totalRow.font = { bold: true };
      totalRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
        cell.alignment = { horizontal: 'center' };
      });

      sheet.addRow([]);
      sheet.addRow(['', '', '', 'Valor Horas Normais:', `R$ ${func.totalValorNormal.toFixed(2)}`]);
      sheet.addRow(['', '', '', 'Valor Horas Extras:', `R$ ${func.totalHorasExtraValor.toFixed(2)}`]);
      sheet.addRow(['', '', '', 'Valor Total:', `R$ ${func.totalValor.toFixed(2)}`]);

      // Column widths
      sheet.columns = [
        { width: 12 }, { width: 6 }, { width: 10 }, { width: 10 },
        { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }
      ];
    }

    if (Object.keys(resumo).length === 0) {
      const sheet = workbook.addWorksheet('Sem dados');
      sheet.getCell('A1').value = 'Nenhum registro encontrado para o período selecionado.';
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=ponto_${mesNome}_${ano}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Export excel error:', err);
    res.status(500).json({ error: 'Erro ao gerar Excel' });
  }
});

// GET /api/export/pdf
router.get('/pdf', authenticateToken, [
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
    const resumo = HorasExtrasService.calcularResumoMensal(registros);
    const mesNome = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][parseInt(mes)];

    const doc = new PDFDocument({ size: 'A4', margin: 40 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=ponto_${mesNome}_${ano}.pdf`);
    doc.pipe(res);

    const funcs = Object.values(resumo);

    if (funcs.length === 0) {
      doc.fontSize(16).text('Relatório de Ponto', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text('Nenhum registro encontrado para o período selecionado.');
      doc.end();
      return;
    }

    funcs.forEach((func, idx) => {
      if (idx > 0) doc.addPage();

      // Header
      doc.fontSize(16).text('Controle de Ponto - Casa dos Bull', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(12).text(`${func.nome} - ${func.cargo}`, { align: 'center' });
      doc.fontSize(10).text(`${mesNome} ${ano} | Salário/hora: R$ ${func.salario_hora.toFixed(2)}`, { align: 'center' });
      doc.moveDown();

      // Table header
      const tableTop = doc.y;
      const colWidths = [65, 35, 50, 50, 55, 55, 55, 60];
      const cols = ['Data', 'Dia', 'Entrada', 'Saída', 'H.Trab', 'H.Norm', 'H.Extra', 'Valor'];

      doc.fontSize(8);
      doc.rect(40, tableTop, 515, 18).fill('#2563EB');
      let x = 45;
      cols.forEach((col, i) => {
        doc.fillColor('#FFFFFF').text(col, x, tableTop + 5, { width: colWidths[i], align: 'center' });
        x += colWidths[i] + 2;
      });

      // Rows
      const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      let y = tableTop + 22;

      for (const reg of func.registros) {
        if (y > 750) {
          doc.addPage();
          y = 50;
        }

        const date = new Date(reg.data + 'T12:00:00');
        const diaSemana = diasSemana[date.getDay()];
        const isSpecial = reg.tipoDia.tipo === 'feriado' || reg.tipoDia.tipo === 'domingo';

        if (isSpecial) {
          doc.rect(40, y - 2, 515, 14).fill('#FFF3CD');
        }

        doc.fillColor('#000000');
        x = 45;
        const values = [
          reg.data, diaSemana, reg.entrada || '-', reg.saida || '-',
          reg.horasTrabalhadas.toFixed(2), reg.horasNormais.toFixed(2),
          reg.horasExtras.toFixed(2), `R$${reg.valorTotal.toFixed(2)}`
        ];
        values.forEach((val, i) => {
          doc.text(val, x, y, { width: colWidths[i], align: 'center' });
          x += colWidths[i] + 2;
        });
        y += 16;
      }

      // Totals
      y += 10;
      doc.rect(40, y - 2, 515, 18).fill('#E5E7EB');
      doc.fillColor('#000000').fontSize(9);
      doc.text(`Dias: ${func.diasTrabalhados}`, 45, y + 2);
      doc.text(`H.Trab: ${func.totalHorasTrabalhadas.toFixed(2)}`, 150, y + 2);
      doc.text(`H.Extra: ${func.totalHorasExtras.toFixed(2)}`, 280, y + 2);
      doc.text(`Total: R$ ${func.totalValor.toFixed(2)}`, 400, y + 2);

      y += 30;
      doc.fontSize(9);
      doc.text(`Valor Horas Normais: R$ ${func.totalValorNormal.toFixed(2)}`, 300, y);
      doc.text(`Valor Horas Extras: R$ ${func.totalHorasExtraValor.toFixed(2)}`, 300, y + 14);
      doc.font('Helvetica-Bold').text(`Valor Total: R$ ${func.totalValor.toFixed(2)}`, 300, y + 28);
      doc.font('Helvetica');
    });

    doc.end();
  } catch (err) {
    console.error('Export PDF error:', err);
    res.status(500).json({ error: 'Erro ao gerar PDF' });
  }
});

module.exports = router;
