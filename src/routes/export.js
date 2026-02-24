const express = require('express');
const { query, validationResult } = require('express-validator');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const Registro = require('../models/Registro');
const Funcionario = require('../models/Funcionario');
const HorasExtrasService = require('../services/horasExtras');
const FeriadosService = require('../services/feriados');
const { authenticateToken } = require('../middleware/auth');
const { db } = require('../config/database');

const router = express.Router();

// Helper: build folha data for a list of funcionarios
function buildFolhaData(mesInt, anoInt, funcionarioId) {
  let funcionarios;
  if (funcionarioId) {
    const func = Funcionario.findById(parseInt(funcionarioId));
    funcionarios = func ? [func] : [];
  } else {
    funcionarios = Funcionario.getAll();
  }

  const resultados = [];
  for (const func of funcionarios) {
    const registros = Registro.getMonthlyReport(mesInt, anoInt, func.id);
    const folha = HorasExtrasService.calcularFolha(registros, func);
    const r = folha.resumo;
    const diasTrab = r.diasTrabalhados || 0;
    const totalVT = func.recebe_vt ? Funcionario.calcularVT(func.id, diasTrab) : 0;
    const totalVA = func.tem_vale_alimentacao ? Math.round((func.valor_va_dia || 0) * diasTrab * 100) / 100 : 0;
    let totalAjudaCombustivel = 0;
    if (func.cargo_id) {
      const cargo = db.prepare('SELECT recebe_ajuda_combustivel, valor_ajuda_combustivel FROM cargos WHERE id = ?').get(func.cargo_id);
      if (cargo && cargo.recebe_ajuda_combustivel) totalAjudaCombustivel = cargo.valor_ajuda_combustivel || 0;
    }
    const totalGeral = Math.round(((r.totalPgtoHE || 0) + (r.totalPgtoFDS || 0) + totalVT + totalVA + totalAjudaCombustivel) * 100) / 100;

    resultados.push({
      func, registros: folha.registros, resumo: r,
      totalVT, totalVA, totalAjudaCombustivel, totalGeral
    });
  }
  return resultados;
}

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
    const mesInt = parseInt(mes);
    const anoInt = parseInt(ano);
    const folhas = buildFolhaData(mesInt, anoInt, funcionarioId);
    const mesNome = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][mesInt];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Lar Digital - Gestão da Casa';
    workbook.created = new Date();

    const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    let grandTotal = 0;

    for (const folha of folhas) {
      const { func, registros, resumo: r, totalVT, totalVA, totalAjudaCombustivel, totalGeral } = folha;
      if (registros.length === 0) continue;
      grandTotal += totalGeral;

      const sheet = workbook.addWorksheet(func.nome.substring(0, 31));

      // Header
      sheet.mergeCells('A1:J1');
      sheet.getCell('A1').value = `Valor dos Pagamentos - ${func.nome}`;
      sheet.getCell('A1').font = { size: 14, bold: true };
      sheet.getCell('A1').alignment = { horizontal: 'center' };

      sheet.mergeCells('A2:J2');
      const pixStr = func.pix_chave ? ` | PIX ${func.pix_tipo || ''}: ${func.pix_chave}${func.pix_banco ? ' (' + func.pix_banco + ')' : ''}` : '';
      sheet.getCell('A2').value = `${mesNome} ${anoInt} | Cargo: ${func.cargo || 'N/A'}${pixStr}`;
      sheet.getCell('A2').alignment = { horizontal: 'center' };

      // Column headers
      sheet.addRow([]);
      sheet.addRow(['Data', 'Dia', 'Entrada', 'Saída', 'H. Trab.', 'H. Extra', 'Tipo Dia', 'Pgto HE', 'Pgto FDS', 'Total Dia']);
      const hRow = sheet.getRow(4);
      hRow.font = { bold: true };
      hRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { horizontal: 'center' };
        cell.border = { bottom: { style: 'thin' } };
      });

      // Data rows
      for (const reg of registros) {
        const date = new Date(reg.data + 'T12:00:00');
        const tipoDia = reg.tipoDia || {};
        const isEspecial = tipoDia.tipo === 'feriado' || tipoDia.tipo === 'domingo' || tipoDia.tipo === 'sabado';
        const row = sheet.addRow([
          reg.data, diasSemana[date.getDay()], reg.entrada || '-', reg.saida || '-',
          (reg.horasTrabalhadas || 0).toFixed(2), (reg.horasExtras || 0).toFixed(2),
          tipoDia.descricao || 'Útil',
          (reg.pgtoHoraExtra || 0).toFixed(2), (reg.pgtoFDS || 0).toFixed(2),
          (reg.totalDia || 0).toFixed(2)
        ]);
        row.eachCell(cell => { cell.alignment = { horizontal: 'center' }; });
        if (isEspecial) {
          row.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
          });
        }
      }

      // Totals section
      sheet.addRow([]);
      const sepRow = sheet.addRow(['RESUMO DE PAGAMENTOS']);
      sepRow.font = { bold: true, size: 11 };

      const addSummaryRow = (label, value) => {
        const row = sheet.addRow(['', '', '', '', '', '', '', label, '', `R$ ${value.toFixed(2)}`]);
        row.getCell(8).font = { bold: false };
        row.getCell(10).font = { bold: true };
        row.getCell(10).alignment = { horizontal: 'right' };
        return row;
      };

      addSummaryRow('Horas Extras:', r.totalPgtoHE || 0);
      addSummaryRow('Dias Especiais (FDS/Feriado):', r.totalPgtoFDS || 0);
      if (totalVT > 0) addSummaryRow('Vale Transporte:', totalVT);
      if (totalVA > 0) addSummaryRow('Vale Alimentação:', totalVA);
      if (totalAjudaCombustivel > 0) addSummaryRow('Ajuda Combustível:', totalAjudaCombustivel);

      sheet.addRow([]);
      const totalRow = sheet.addRow(['', '', '', '', '', '', '', 'TOTAL A PAGAR:', '', `R$ ${totalGeral.toFixed(2)}`]);
      totalRow.getCell(8).font = { bold: true, size: 12 };
      totalRow.getCell(10).font = { bold: true, size: 12, color: { argb: 'FF16A34A' } };
      totalRow.getCell(10).alignment = { horizontal: 'right' };

      // Column widths
      sheet.columns = [
        { width: 12 }, { width: 6 }, { width: 10 }, { width: 10 },
        { width: 10 }, { width: 10 }, { width: 14 }, { width: 22 },
        { width: 10 }, { width: 14 }
      ];
    }

    // Summary sheet if multiple employees
    if (folhas.filter(f => f.registros.length > 0).length > 1) {
      const sumSheet = workbook.addWorksheet('Consolidado');
      sumSheet.mergeCells('A1:D1');
      sumSheet.getCell('A1').value = `Consolidado - ${mesNome} ${anoInt}`;
      sumSheet.getCell('A1').font = { size: 14, bold: true };
      sumSheet.getCell('A1').alignment = { horizontal: 'center' };

      sumSheet.addRow([]);
      const hdr = sumSheet.addRow(['Funcionário', 'Cargo', 'PIX', 'Total a Pagar']);
      hdr.font = { bold: true };
      hdr.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      });

      for (const folha of folhas) {
        if (folha.registros.length === 0) continue;
        const pix = folha.func.pix_chave ? `${folha.func.pix_tipo || ''}: ${folha.func.pix_chave}` : '-';
        sumSheet.addRow([folha.func.nome, folha.func.cargo || '-', pix, `R$ ${folha.totalGeral.toFixed(2)}`]);
      }

      sumSheet.addRow([]);
      const gtRow = sumSheet.addRow(['', '', 'TOTAL GERAL:', `R$ ${grandTotal.toFixed(2)}`]);
      gtRow.font = { bold: true, size: 12 };
      sumSheet.columns = [{ width: 25 }, { width: 20 }, { width: 25 }, { width: 18 }];
    }

    if (folhas.length === 0 || folhas.every(f => f.registros.length === 0)) {
      const sheet = workbook.addWorksheet('Sem dados');
      sheet.getCell('A1').value = 'Nenhum registro encontrado para o período selecionado.';
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=pagamentos_${mesNome}_${anoInt}.xlsx`);

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
    const mesInt = parseInt(mes);
    const anoInt = parseInt(ano);
    const folhas = buildFolhaData(mesInt, anoInt, funcionarioId);
    const mesNome = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][mesInt];

    const doc = new PDFDocument({ size: 'A4', margin: 40 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=pagamentos_${mesNome}_${anoInt}.pdf`);
    doc.pipe(res);

    const activeFolhas = folhas.filter(f => f.registros.length > 0);

    if (activeFolhas.length === 0) {
      doc.fontSize(16).text('Valor dos Pagamentos do Mês', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text('Nenhum registro encontrado para o período selecionado.');
      doc.end();
      return;
    }

    const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    let grandTotal = 0;

    activeFolhas.forEach((folha, idx) => {
      if (idx > 0) doc.addPage();
      const { func, registros, resumo: r, totalVT, totalVA, totalAjudaCombustivel, totalGeral } = folha;
      grandTotal += totalGeral;

      // Header
      doc.fontSize(16).text('Lar Digital - Valor dos Pagamentos', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(12).text(`${func.nome} - ${func.cargo || 'N/A'}`, { align: 'center' });
      const pixStr = func.pix_chave ? ` | PIX ${func.pix_tipo || ''}: ${func.pix_chave}` : '';
      doc.fontSize(10).text(`${mesNome} ${anoInt}${pixStr}`, { align: 'center' });
      doc.moveDown();

      // Table header
      const tableTop = doc.y;
      const colWidths = [58, 30, 45, 45, 45, 45, 55, 55, 55, 55];
      const cols = ['Data', 'Dia', 'Entrada', 'Saída', 'H.Trab', 'H.Extra', 'Tipo', 'Pgto HE', 'Pgto FDS', 'Total'];

      doc.fontSize(7);
      doc.rect(40, tableTop, 515, 16).fill('#2563EB');
      let x = 42;
      cols.forEach((col, i) => {
        doc.fillColor('#FFFFFF').text(col, x, tableTop + 4, { width: colWidths[i], align: 'center' });
        x += colWidths[i] + 1;
      });

      // Rows
      let y = tableTop + 20;
      for (const reg of registros) {
        if (y > 740) { doc.addPage(); y = 50; }
        const date = new Date(reg.data + 'T12:00:00');
        const tipoDia = reg.tipoDia || {};
        const isSpecial = tipoDia.tipo === 'feriado' || tipoDia.tipo === 'domingo' || tipoDia.tipo === 'sabado';

        if (isSpecial) {
          doc.rect(40, y - 2, 515, 14).fill('#FFF3CD');
        }

        doc.fillColor('#000000');
        x = 42;
        const values = [
          reg.data, diasSemana[date.getDay()], reg.entrada || '-', reg.saida || '-',
          (reg.horasTrabalhadas || 0).toFixed(2), (reg.horasExtras || 0).toFixed(2),
          (tipoDia.descricao || 'Útil').substring(0, 8),
          (reg.pgtoHoraExtra || 0) > 0 ? `R$${(reg.pgtoHoraExtra).toFixed(0)}` : '-',
          (reg.pgtoFDS || 0) > 0 ? `R$${(reg.pgtoFDS).toFixed(0)}` : '-',
          `R$${(reg.totalDia || 0).toFixed(0)}`
        ];
        values.forEach((val, i) => {
          doc.text(String(val), x, y, { width: colWidths[i], align: 'center' });
          x += colWidths[i] + 1;
        });
        y += 14;
      }

      // Summary
      y += 8;
      if (y > 700) { doc.addPage(); y = 50; }

      doc.rect(40, y - 2, 515, 18).fill('#E5E7EB');
      doc.fillColor('#000000').fontSize(9);
      doc.text(`Dias: ${r.diasTrabalhados || 0} (${r.diasTrabalhadosUteis || 0} úteis + ${r.diasTrabalhadosEspeciais || 0} especiais)`, 45, y + 2);
      doc.text(`H.Extras: ${(r.totalHorasExtras || 0).toFixed(1)}h`, 300, y + 2);

      y += 26;
      doc.fontSize(9);
      const summaryX = 300;
      doc.text(`Horas Extras: R$ ${(r.totalPgtoHE || 0).toFixed(2)}`, summaryX, y);
      y += 14;
      doc.text(`Dias Especiais: R$ ${(r.totalPgtoFDS || 0).toFixed(2)}`, summaryX, y);
      y += 14;
      if (totalVT > 0) { doc.text(`Vale Transporte: R$ ${totalVT.toFixed(2)}`, summaryX, y); y += 14; }
      if (totalVA > 0) { doc.text(`Vale Alimentação: R$ ${totalVA.toFixed(2)}`, summaryX, y); y += 14; }
      if (totalAjudaCombustivel > 0) { doc.text(`Ajuda Combustível: R$ ${totalAjudaCombustivel.toFixed(2)}`, summaryX, y); y += 14; }

      y += 4;
      doc.rect(summaryX - 5, y - 2, 220, 20).fill('#DCFCE7');
      doc.fillColor('#000000');
      doc.font('Helvetica-Bold').fontSize(11).text(`TOTAL A PAGAR: R$ ${totalGeral.toFixed(2)}`, summaryX, y + 2);
      doc.font('Helvetica');
    });

    // Grand total page if multiple employees
    if (activeFolhas.length > 1) {
      doc.addPage();
      doc.fontSize(16).text(`Consolidado - ${mesNome} ${anoInt}`, { align: 'center' });
      doc.moveDown();

      let y = doc.y;
      doc.fontSize(10);
      doc.rect(40, y, 515, 18).fill('#2563EB');
      doc.fillColor('#FFFFFF');
      doc.text('Funcionário', 45, y + 4, { width: 180 });
      doc.text('Cargo', 230, y + 4, { width: 100 });
      doc.text('PIX', 335, y + 4, { width: 120 });
      doc.text('Total', 460, y + 4, { width: 90, align: 'right' });
      y += 22;

      for (const folha of activeFolhas) {
        doc.fillColor('#000000');
        doc.text(folha.func.nome, 45, y, { width: 180 });
        doc.text(folha.func.cargo || '-', 230, y, { width: 100 });
        doc.text(folha.func.pix_chave ? `${folha.func.pix_tipo || ''}: ${folha.func.pix_chave}` : '-', 335, y, { width: 120 });
        doc.text(`R$ ${folha.totalGeral.toFixed(2)}`, 460, y, { width: 90, align: 'right' });
        y += 16;
      }

      y += 10;
      doc.rect(40, y - 2, 515, 22).fill('#DCFCE7');
      doc.fillColor('#000000');
      doc.font('Helvetica-Bold').fontSize(12).text(`TOTAL GERAL: R$ ${grandTotal.toFixed(2)}`, 45, y + 2, { width: 505, align: 'right' });
      doc.font('Helvetica');
    }

    doc.end();
  } catch (err) {
    console.error('Export PDF error:', err);
    res.status(500).json({ error: 'Erro ao gerar PDF' });
  }
});

module.exports = router;
