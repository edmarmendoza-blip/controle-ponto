// ============================================================
// Shared Module - Common functionality for all pages
// ============================================================
(function () {
  'use strict';

  // Support both 'ponto_token' (original SPA) and 'token' (new pages)
  let token = localStorage.getItem('ponto_token') || localStorage.getItem('token');
  let currentUser = null;

  // --- API Helper ---
  let _refreshing = null;
  async function api(url, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
    if (res.status === 401 && !url.includes('/api/auth/login') && !url.includes('/api/auth/refresh')) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        const retryHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
        const retryRes = await fetch(url, { ...options, headers: { ...retryHeaders, ...options.headers } });
        if (retryRes.ok) {
          const ct = retryRes.headers.get('content-type');
          if (ct && ct.includes('application/json')) return retryRes.json();
          return retryRes;
        }
      }
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

  async function tryRefreshToken() {
    const refreshToken = localStorage.getItem('ponto_refresh_token');
    if (!refreshToken) return false;
    if (_refreshing) return _refreshing;
    _refreshing = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        });
        if (res.ok) {
          const data = await res.json();
          token = data.token;
          localStorage.setItem('ponto_token', data.token);
          localStorage.setItem('token', data.token);
          if (data.refreshToken) localStorage.setItem('ponto_refresh_token', data.refreshToken);
          return true;
        }
        localStorage.removeItem('ponto_refresh_token');
        return false;
      } catch (e) {
        return false;
      } finally {
        _refreshing = null;
      }
    })();
    return _refreshing;
  }

  // --- Auth ---
  function checkAuth() {
    if (!token) {
      window.location.href = '/login.html';
      return;
    }
    api('/api/auth/me').then(data => {
      const user = data.user || data;
      currentUser = user;
      const nameEl = document.getElementById('user-name');
      nameEl.textContent = user.name;
      // Make user name clickable to profile page
      if (nameEl && !nameEl.dataset.linked) {
        nameEl.style.cursor = 'pointer';
        nameEl.title = 'Meu Perfil';
        nameEl.addEventListener('click', () => { window.location.href = '/perfil.html'; });
        nameEl.dataset.linked = '1';
      }
      document.getElementById('user-role').textContent =
        user.role === 'admin' ? 'Administrador' : user.role === 'gestor' ? 'Gestor' : 'Visualizador';
      // Show admin-only items
      if (user.role === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
      }
      if (user.role === 'admin' || user.role === 'gestor') {
        document.querySelectorAll('.gestor-only').forEach(el => el.classList.remove('hidden'));
      }
      // Update sidebar avatar
      initSidebarUserAvatar();
      // Callback after auth
      if (window.onAuthReady) window.onAuthReady(user);
    }).catch(() => {
      logout();
    });
  }

  function logout() {
    localStorage.removeItem('ponto_token');
    localStorage.removeItem('token');
    localStorage.removeItem('ponto_refresh_token');
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

  // --- Utility functions (delegated to Utils when available) ---
  const showToast = window.Utils ? window.Utils.showToast : function(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast show align-items-center text-bg-${type} border-0`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `<div class="d-flex"><div class="toast-body">${message}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    container.appendChild(toast);
    const duration = (type === 'danger' || type === 'warning') ? 8000 : 4000;
    setTimeout(() => toast.remove(), duration);
  };
  const formatDate = window.Utils ? window.Utils.formatDate : function(d) {
    if (!d) return '-'; const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`;
  };
  const formatCurrency = window.Utils ? window.Utils.formatCurrency : function(v) {
    return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
  };
  const monthName = window.Utils ? window.Utils.monthName : function(m) {
    return ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][parseInt(m)];
  };
  const today = window.Utils ? window.Utils.today : function() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  };

  // --- Sidebar ---
  async function loadSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || sidebar.dataset.loaded) return;
    try {
      const res = await fetch('/components/sidebar.html');
      if (res.ok) {
        sidebar.innerHTML = await res.text();
        sidebar.dataset.loaded = '1';
        // Re-apply role visibility after sidebar loads
        if (currentUser) {
          if (currentUser.role === 'admin') {
            sidebar.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
          }
          if (currentUser.role === 'admin' || currentUser.role === 'gestor') {
            sidebar.querySelectorAll('.gestor-only').forEach(el => el.classList.remove('hidden'));
          }
        }
        initSidebarGroups();
        initSidebarActive();
        initSidebarMobile();
        initSidebarUserAvatar();
        // Reattach logout
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) logoutBtn.addEventListener('click', logout);
      }
    } catch (e) {
      console.error('[Shared] Failed to load sidebar:', e);
    }
  }

  function initSidebarActive() {
    const currentPage = window.location.pathname.split('/').pop().replace('.html', '') || 'dashboard';
    document.querySelectorAll('#sidebar a[data-page]').forEach(link => {
      if (link.dataset.page === currentPage) {
        link.classList.add('active');
        // Auto-expand parent group
        const group = link.closest('.ld-sidebar-group');
        if (group) group.classList.remove('collapsed');
      }
    });
  }

  function initSidebarGroups() {
    const saved = JSON.parse(localStorage.getItem('ld_sidebar_groups') || '{}');
    document.querySelectorAll('.ld-sidebar-group').forEach(group => {
      const key = group.dataset.group;
      if (key && saved[key] === false) {
        group.classList.add('collapsed');
      }
      const label = group.querySelector('.ld-sidebar-group-label');
      if (label) {
        label.addEventListener('click', () => {
          group.classList.toggle('collapsed');
          // Save state
          const states = {};
          document.querySelectorAll('.ld-sidebar-group').forEach(g => {
            if (g.dataset.group) states[g.dataset.group] = !g.classList.contains('collapsed');
          });
          localStorage.setItem('ld_sidebar_groups', JSON.stringify(states));
        });
      }
    });
  }

  function initSidebarMobile() {
    const toggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (toggle && sidebar) {
      toggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('hidden');
      });
      if (overlay) {
        overlay.addEventListener('click', () => {
          sidebar.classList.remove('open');
          overlay.classList.add('hidden');
        });
      }
    }
  }

  function initSidebarUserAvatar() {
    if (!currentUser) return;
    const avatarEl = document.getElementById('user-avatar');
    if (avatarEl && currentUser.name) {
      avatarEl.textContent = currentUser.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    }
  }

  function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    // If sidebar uses new brand system (loaded via loadSidebar or has ld-sidebar class)
    if (sidebar.classList.contains('ld-sidebar') || sidebar.dataset.loaded) {
      initSidebarActive();
      initSidebarMobile();
      return;
    }
    // Legacy sidebar support (inline blue sidebar in old pages)
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
    const overlay = document.getElementById('sidebar-overlay');
    if (toggle && sidebar) {
      toggle.addEventListener('click', () => {
        sidebar.classList.toggle('-translate-x-full');
        if (overlay) overlay.classList.toggle('hidden');
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
  async function init() {
    initTheme();
    // Load dynamic sidebar if placeholder exists
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('ld-sidebar') && !sidebar.dataset.loaded) {
      await loadSidebar();
    }
    checkAuth();
    initSidebar();

    // Logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // Theme toggle
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  }

  // --- Confirm Modal ---
  function showConfirmModal(message, onConfirm) {
    let modal = document.getElementById('shared-confirm-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'shared-confirm-modal';
      modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;';
      modal.innerHTML = `
        <div style="background:#fff;border-radius:8px;padding:24px;max-width:400px;width:90%;box-shadow:0 10px 40px rgba(0,0,0,0.2);">
          <p id="shared-confirm-message" style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.5;"></p>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button id="shared-confirm-cancel" style="padding:8px 18px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#374151;cursor:pointer;font-size:14px;">Cancelar</button>
            <button id="shared-confirm-ok" style="padding:8px 18px;border:none;border-radius:6px;background:#dc2626;color:#fff;cursor:pointer;font-size:14px;font-weight:500;">Confirmar</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      document.getElementById('shared-confirm-cancel').addEventListener('click', () => {
        modal.style.display = 'none';
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
      });
    }
    document.getElementById('shared-confirm-message').textContent = message;
    modal.style.display = 'flex';
    const okBtn = document.getElementById('shared-confirm-ok');
    const newOk = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);
    newOk.addEventListener('click', () => {
      modal.style.display = 'none';
      if (typeof onConfirm === 'function') onConfirm();
    });
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
    loadSidebar,
    showConfirmModal,
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
