const Feriado = require('../models/Feriado');

// In-memory cache for getDayType() — avoids repeated DB queries for the same date
const _dayTypeCache = new Map();
let _dayTypeCacheTime = 0;
const _dayTypeCacheTTL = 5 * 60 * 1000; // 5 minutes

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

  // Invalidate cache (call when feriados are edited)
  static clearCache() {
    _dayTypeCache.clear();
    _dayTypeCacheTime = 0;
  }

  static getDayType(data) {
    // Reset cache if TTL expired
    const now = Date.now();
    if ((now - _dayTypeCacheTime) > _dayTypeCacheTTL) {
      _dayTypeCache.clear();
      _dayTypeCacheTime = now;
    }

    if (_dayTypeCache.has(data)) {
      return _dayTypeCache.get(data);
    }

    let result;
    const feriado = this.isHoliday(data);
    if (feriado) {
      result = { tipo: 'feriado', descricao: feriado.descricao, feriadoTipo: feriado.tipo };
    } else if (this.isDomingo(data)) {
      result = { tipo: 'domingo', descricao: 'Domingo' };
    } else if (this.isSabado(data)) {
      result = { tipo: 'sabado', descricao: 'Sábado' };
    } else {
      result = { tipo: 'normal', descricao: 'Dia útil' };
    }

    _dayTypeCache.set(data, result);
    return result;
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
