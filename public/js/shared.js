// ============================================================
// Shared Module - Common functionality for all pages
// ============================================================
(function () {
  'use strict';

  // Support both 'ponto_token' (original SPA) and 'token' (new pages)
  const token = localStorage.getItem('ponto_token') || localStorage.getItem('token');
  let currentUser = null;

  // --- API Helper ---
  async function api(url, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
    if (res.status === 401 && !url.includes('/api/auth/login')) {
      logout();
      throw new Error('Sessão expirada');
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.errors?.[0]?.msg || `Erro ${res.status}`);
    }
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return res.json();
    }
    return res;
  }

  // --- Auth ---
  function checkAuth() {
    if (!token) {
      window.location.href = '/login.html';
      return;
    }
    api('/api/auth/me').then(user => {
      currentUser = user;
      document.getElementById('user-name').textContent = user.name;
      document.getElementById('user-role').textContent =
        user.role === 'admin' ? 'Administrador' : user.role === 'gestor' ? 'Gestor' : 'Visualizador';
      // Show admin-only items
      if (user.role === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
      }
      if (user.role === 'admin' || user.role === 'gestor') {
        document.querySelectorAll('.gestor-only').forEach(el => el.classList.remove('hidden'));
      }
      // Callback after auth
      if (window.onAuthReady) window.onAuthReady(user);
    }).catch(() => {
      logout();
    });
  }

  function logout() {
    localStorage.removeItem('ponto_token');
    localStorage.removeItem('token');
    window.location.href = '/login.html';
  }

  // --- Theme ---
  function initTheme() {
    const saved = localStorage.getItem('ponto_theme') || 'light';
    document.documentElement.classList.toggle('dark', saved === 'dark');
    updateThemeIcon(saved);
  }

  function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    const theme = isDark ? 'dark' : 'light';
    localStorage.setItem('ponto_theme', theme);
    updateThemeIcon(theme);
  }

  function updateThemeIcon(theme) {
    const icon = document.getElementById('theme-icon');
    if (icon) {
      icon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
    }
  }

  // --- Toast ---
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const colors = {
      success: 'bg-green-500',
      danger: 'bg-red-500',
      warning: 'bg-yellow-500',
      info: 'bg-blue-500'
    };
    const toast = document.createElement('div');
    toast.className = `${colors[type] || colors.success} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-slide-in`;
    toast.innerHTML = `
      <span>${message}</span>
      <button onclick="this.parentElement.remove()" class="ml-2 text-white/80 hover:text-white">&times;</button>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // --- Date helpers ---
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
    return new Date().toISOString().split('T')[0];
  }

  // --- Sidebar ---
  function initSidebar() {
    const currentPage = window.location.pathname.split('/').pop().replace('.html', '') || 'dashboard';
    document.querySelectorAll('#sidebar a[data-page]').forEach(link => {
      const page = link.dataset.page;
      if (page === currentPage) {
        link.classList.add('bg-blue-700', 'text-white');
        link.classList.remove('text-blue-100', 'hover:bg-blue-700/50');
      }
    });

    // Mobile toggle
    const toggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (toggle && sidebar) {
      toggle.addEventListener('click', () => {
        sidebar.classList.toggle('-translate-x-full');
        overlay.classList.toggle('hidden');
      });
      if (overlay) {
        overlay.addEventListener('click', () => {
          sidebar.classList.add('-translate-x-full');
          overlay.classList.add('hidden');
        });
      }
    }
  }

  // --- Init ---
  function init() {
    initTheme();
    checkAuth();
    initSidebar();

    // Logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // Theme toggle
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  }

  // Export
  window.Shared = {
    api,
    checkAuth,
    logout,
    showToast,
    formatDate,
    formatCurrency,
    monthName,
    today,
    toggleTheme,
    init,
    get currentUser() { return currentUser; },
    get token() { return token; }
  };

  // Global aliases for pages that call these directly
  window.showToast = showToast;
  window.applyRoleVisibility = function () {
    if (!currentUser) return;
    if (currentUser.role === 'admin') {
      document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    }
    if (currentUser.role === 'admin' || currentUser.role === 'gestor') {
      document.querySelectorAll('.gestor-only').forEach(el => el.classList.remove('hidden'));
    }
  };

  // Set current date in header
  function setCurrentDate() {
    const el = document.getElementById('current-date');
    if (el) {
      const now = new Date();
      const dias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
      el.textContent = `${dias[now.getDay()]}, ${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    }
  }

  // Auto-init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); setCurrentDate(); });
  } else {
    init();
    setCurrentDate();
  }
})();
