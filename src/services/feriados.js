const Feriado = require('../models/Feriado');

class FeriadosService {
  static isHoliday(data) {
    return Feriado.isHoliday(data);
  }

  static isDomingo(data) {
    const date = new Date(data + 'T12:00:00');
    return date.getDay() === 0;
  }

  static isSabado(data) {
    const date = new Date(data + 'T12:00:00');
    return date.getDay() === 6;
  }

  static getDayType(data) {
    const feriado = this.isHoliday(data);
    if (feriado) {
      return { tipo: 'feriado', descricao: feriado.descricao, feriadoTipo: feriado.tipo };
    }
    if (this.isDomingo(data)) {
      return { tipo: 'domingo', descricao: 'Domingo' };
    }
    if (this.isSabado(data)) {
      return { tipo: 'sabado', descricao: 'Sábado' };
    }
    return { tipo: 'normal', descricao: 'Dia útil' };
  }

  static getWorkingDaysInMonth(mes, ano) {
    const lastDay = new Date(ano, mes, 0).getDate();
    let workingDays = 0;
    for (let day = 1; day <= lastDay; day++) {
      const data = `${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayType = this.getDayType(data);
      if (dayType.tipo === 'normal') {
        workingDays++;
      }
    }
    return workingDays;
  }
}

module.exports = FeriadosService;
