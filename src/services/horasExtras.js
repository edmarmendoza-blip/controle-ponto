const { db } = require('../config/database');
const FeriadosService = require('./feriados');

class HorasExtrasService {
  static getConfig() {
    const configs = {};
    const rows = db.prepare('SELECT chave, valor FROM configuracoes').all();
    for (const row of rows) {
      configs[row.chave] = parseFloat(row.valor) || row.valor;
    }
    return configs;
  }

  static calcularHorasTrabalhadas(entrada, saida) {
    if (!entrada || !saida) return 0;
    const [eh, em] = entrada.split(':').map(Number);
    const [sh, sm] = saida.split(':').map(Number);
    const totalMinutos = (sh * 60 + sm) - (eh * 60 + em);
    return Math.max(0, totalMinutos / 60);
  }

  static calcularRegistro(registro, config = null) {
    if (!config) config = this.getConfig();

    const horasTrabalhadas = this.calcularHorasTrabalhadas(registro.entrada, registro.saida);
    const horasNormaisDia = config.horas_dia_normal || 8;
    const dayType = FeriadosService.getDayType(registro.data);

    let multiplicador = 1;
    let horasNormais = 0;
    let horasExtras = 0;
    let horasExtraValor = 0;

    if (dayType.tipo === 'feriado') {
      multiplicador = config.multiplicador_feriado || 2.0;
      horasExtras = horasTrabalhadas;
      horasNormais = 0;
    } else if (dayType.tipo === 'domingo') {
      multiplicador = config.multiplicador_domingo || 2.0;
      horasExtras = horasTrabalhadas;
      horasNormais = 0;
    } else {
      multiplicador = config.multiplicador_hora_extra || 1.5;
      if (horasTrabalhadas > horasNormaisDia) {
        horasNormais = horasNormaisDia;
        horasExtras = horasTrabalhadas - horasNormaisDia;
      } else {
        horasNormais = horasTrabalhadas;
        horasExtras = 0;
      }
    }

    const salarioHora = registro.salario_hora || 0;
    const valorNormal = horasNormais * salarioHora;
    horasExtraValor = horasExtras * salarioHora * multiplicador;

    return {
      horasTrabalhadas: Math.round(horasTrabalhadas * 100) / 100,
      horasNormais: Math.round(horasNormais * 100) / 100,
      horasExtras: Math.round(horasExtras * 100) / 100,
      multiplicador,
      valorNormal: Math.round(valorNormal * 100) / 100,
      horasExtraValor: Math.round(horasExtraValor * 100) / 100,
      valorTotal: Math.round((valorNormal + horasExtraValor) * 100) / 100,
      tipoDia: dayType
    };
  }

  static calcularFolhaRegistro(registro, funcionario) {
    const entrada = registro.entrada;
    const saida = registro.saida;

    // If entrada/saida empty or both 00:00 → everything zero
    if (!entrada || !saida || (entrada === '00:00' && saida === '00:00')) {
      return {
        horasTrabalhadas: 0,
        horasExtras: 0,
        tipoDia: FeriadosService.getDayType(registro.data),
        pgtoHoraExtra: 0,
        pgtoFDS: 0,
        totalDia: 0
      };
    }

    // Calculate hours worked, handling midnight crossing
    const [eh, em] = entrada.split(':').map(Number);
    const [sh, sm] = saida.split(':').map(Number);
    let totalMinutos = (sh * 60 + sm) - (eh * 60 + em);
    if (totalMinutos < 0) totalMinutos += 24 * 60; // midnight crossing
    const horasTrabalhadas = totalMinutos / 60;

    const dayType = FeriadosService.getDayType(registro.data);
    const jornada = funcionario.jornada_diaria || 9.8;
    const valorHoraExtra = funcionario.valor_hora_extra || 43.25;
    const valorDiaEspecial = funcionario.valor_dia_especial || 320.00;

    let horasExtras = 0;
    let pgtoHoraExtra = 0;
    let pgtoFDS = 0;

    if (dayType.tipo === 'feriado' || dayType.tipo === 'domingo' || dayType.tipo === 'sabado') {
      // Weekend/holiday: fixed payment per day if worked
      pgtoFDS = valorDiaEspecial;
      horasExtras = 0;
    } else {
      // Weekday: overtime = max(hours_worked - jornada, 0)
      horasExtras = Math.max(horasTrabalhadas - jornada, 0);
      pgtoHoraExtra = horasExtras * valorHoraExtra;
    }

    return {
      horasTrabalhadas: Math.round(horasTrabalhadas * 100) / 100,
      horasExtras: Math.round(horasExtras * 100) / 100,
      tipoDia: dayType,
      pgtoHoraExtra: Math.round(pgtoHoraExtra * 100) / 100,
      pgtoFDS: Math.round(pgtoFDS * 100) / 100,
      totalDia: Math.round((pgtoHoraExtra + pgtoFDS) * 100) / 100
    };
  }

  static calcularFolha(registros, funcionario) {
    let totalHorasTrabalhadas = 0;
    let totalHorasExtras = 0;
    let totalPgtoHE = 0;
    let totalPgtoFDS = 0;
    let diasTrabalhadosUteis = 0;
    let diasTrabalhadosEspeciais = 0;
    const detalhes = [];

    for (const registro of registros) {
      const calc = this.calcularFolhaRegistro(registro, funcionario);
      totalHorasTrabalhadas += calc.horasTrabalhadas;
      totalHorasExtras += calc.horasExtras;
      totalPgtoHE += calc.pgtoHoraExtra;
      totalPgtoFDS += calc.pgtoFDS;

      if (calc.horasTrabalhadas > 0) {
        const isEspecial = calc.tipoDia.tipo === 'feriado' || calc.tipoDia.tipo === 'domingo' || calc.tipoDia.tipo === 'sabado';
        if (isEspecial) {
          diasTrabalhadosEspeciais++;
        } else {
          diasTrabalhadosUteis++;
        }
      }

      detalhes.push({
        data: registro.data,
        entrada: registro.entrada,
        saida: registro.saida,
        ...calc
      });
    }

    const totalMensal = totalPgtoHE + totalPgtoFDS;

    return {
      funcionario: {
        id: funcionario.id,
        nome: funcionario.nome,
        cargo: funcionario.cargo,
        valor_hora_extra: funcionario.valor_hora_extra || 43.25,
        valor_dia_especial: funcionario.valor_dia_especial || 320.00,
        jornada_diaria: funcionario.jornada_diaria || 9.8
      },
      registros: detalhes,
      resumo: {
        totalHorasTrabalhadas: Math.round(totalHorasTrabalhadas * 100) / 100,
        totalHorasExtras: Math.round(totalHorasExtras * 100) / 100,
        totalPgtoHE: Math.round(totalPgtoHE * 100) / 100,
        totalPgtoFDS: Math.round(totalPgtoFDS * 100) / 100,
        totalMensal: Math.round(totalMensal * 100) / 100,
        diasTrabalhadosUteis,
        diasTrabalhadosEspeciais,
        diasTrabalhados: diasTrabalhadosUteis + diasTrabalhadosEspeciais
      }
    };
  }

  static calcularResumoMensal(registros) {
    const config = this.getConfig();
    const resumoPorFuncionario = {};

    for (const registro of registros) {
      const calc = this.calcularRegistro(registro, config);
      const funcId = registro.funcionario_id;

      if (!resumoPorFuncionario[funcId]) {
        resumoPorFuncionario[funcId] = {
          funcionario_id: funcId,
          nome: registro.funcionario_nome,
          cargo: registro.cargo,
          salario_hora: registro.salario_hora,
          totalHorasTrabalhadas: 0,
          totalHorasNormais: 0,
          totalHorasExtras: 0,
          totalValorNormal: 0,
          totalHorasExtraValor: 0,
          totalValor: 0,
          diasTrabalhados: 0,
          registros: []
        };
      }

      const r = resumoPorFuncionario[funcId];
      r.totalHorasTrabalhadas += calc.horasTrabalhadas;
      r.totalHorasNormais += calc.horasNormais;
      r.totalHorasExtras += calc.horasExtras;
      r.totalValorNormal += calc.valorNormal;
      r.totalHorasExtraValor += calc.horasExtraValor;
      r.totalValor += calc.valorTotal;
      if (calc.horasTrabalhadas > 0) r.diasTrabalhados++;
      r.registros.push({
        ...registro,
        ...calc
      });
    }

    // Round totals
    for (const func of Object.values(resumoPorFuncionario)) {
      func.totalHorasTrabalhadas = Math.round(func.totalHorasTrabalhadas * 100) / 100;
      func.totalHorasNormais = Math.round(func.totalHorasNormais * 100) / 100;
      func.totalHorasExtras = Math.round(func.totalHorasExtras * 100) / 100;
      func.totalValorNormal = Math.round(func.totalValorNormal * 100) / 100;
      func.totalHorasExtraValor = Math.round(func.totalHorasExtraValor * 100) / 100;
      func.totalValor = Math.round(func.totalValor * 100) / 100;
    }

    return resumoPorFuncionario;
  }
}

module.exports = HorasExtrasService;
