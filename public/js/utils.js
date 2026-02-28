// ============================================================
// Utils - Funções utilitárias compartilhadas entre SPA e páginas
// ============================================================
(function () {
  'use strict';

  function formatDate(d) {
    if (!d) return '-';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  }

  function formatCurrency(v) {
    return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
  }

  function monthName(m) {
    return ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][parseInt(m)];
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast show align-items-center text-bg-${type} border-0`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">${message}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>`;
    container.appendChild(toast);
    const duration = (type === 'danger' || type === 'warning') ? 8000 : 4000;
    setTimeout(() => toast.remove(), duration);
  }

  window.Utils = { formatDate, formatCurrency, monthName, today, showToast };
  // Global alias for backward compatibility
  if (!window.showToast) window.showToast = showToast;
})();
