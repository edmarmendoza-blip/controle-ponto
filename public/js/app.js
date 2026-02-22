// ============================================================
// Controle de Ponto - Casa dos Bull - SPA Frontend
// ============================================================

(function () {
  'use strict';

  // --- State ---
  let token = localStorage.getItem('ponto_token');
  let currentUser = null;
  let currentPage = 'dashboard';

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

  // --- Toast ---
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast show align-items-center text-bg-${type} border-0`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">${message}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // --- Modal helpers ---
  function openModal(title, bodyHtml, footerHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-footer').innerHTML = footerHtml || '';
    const modal = new bootstrap.Modal(document.getElementById('app-modal'));
    modal.show();
    return modal;
  }

  function closeModal() {
    const el = document.getElementById('app-modal');
    const modal = bootstrap.Modal.getInstance(el);
    if (modal) modal.hide();
  }

  function confirmAction(message, callback) {
    document.getElementById('confirm-body').textContent = message;
    const modal = new bootstrap.Modal(document.getElementById('confirm-modal'));
    const btn = document.getElementById('confirm-btn');
    const handler = () => {
      btn.removeEventListener('click', handler);
      modal.hide();
      callback();
    };
    btn.addEventListener('click', handler);
    modal.show();
  }

  // --- Date helpers ---
  function today() {
    return new Date().toISOString().split('T')[0];
  }

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

  // --- Auth ---
  function showLogin() {
    document.getElementById('login-screen').classList.remove('d-none');
    document.getElementById('main-app').classList.add('d-none');
  }

  function showApp() {
    document.getElementById('login-screen').classList.add('d-none');
    document.getElementById('main-app').classList.remove('d-none');
    document.getElementById('user-name').textContent = currentUser.name;
    document.getElementById('current-date').textContent = formatDate(today());
    // Role-based sidebar visibility
    document.querySelectorAll('.nav-admin-only').forEach(el => {
      el.classList.toggle('d-none', currentUser.role !== 'admin');
    });
    // Gestor permissions: same as admin for funcionarios
    const isGestorOrAdmin = currentUser.role === 'admin' || currentUser.role === 'gestor';
    document.querySelectorAll('.nav-gestor-only').forEach(el => {
      el.classList.toggle('d-none', !isGestorOrAdmin);
    });
    navigateTo('dashboard');
  }

  function logout() {
    token = null;
    currentUser = null;
    localStorage.removeItem('ponto_token');
    showLogin();
  }

  async function checkAuth() {
    if (!token) { showLogin(); return; }
    try {
      const data = await api('/api/auth/me');
      currentUser = data.user;
      showApp();
    } catch {
      showLogin();
    }
  }

  // Login form handler
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    const spinner = document.getElementById('login-spinner');
    const errorEl = document.getElementById('login-error');
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    btn.disabled = true;
    spinner.classList.remove('d-none');
    errorEl.classList.add('d-none');

    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      token = data.token;
      currentUser = data.user;
      localStorage.setItem('ponto_token', token);
      showApp();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('d-none');
    } finally {
      btn.disabled = false;
      spinner.classList.add('d-none');
    }
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', logout);

  // --- Navigation ---
  function navigateTo(page) {
    currentPage = page;
    document.querySelectorAll('.sidebar-nav a').forEach(a => {
      a.classList.toggle('active', a.dataset.page === page);
    });
    const titles = {
      dashboard: 'Dashboard',
      funcionarios: 'Funcionários',
      registros: 'Registros de Ponto',
      relatorios: 'Relatórios',
      feriados: 'Feriados',
      whatsapp: 'WhatsApp',
      graficos: 'Gráficos Comparativos',
      presenca: 'Dashboard de Presença',
      usuarios: 'Gerenciar Usuários',
      perfil: 'Meu Perfil',
      auditlog: 'Log de Auditoria'
    };
    document.getElementById('page-title').textContent = titles[page] || page;
    renderPage(page);
  }

  document.querySelectorAll('.sidebar-nav a').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(a.dataset.page);
      // Close mobile sidebar
      document.getElementById('sidebar').classList.remove('mobile-open');
    });
  });

  // Sidebar toggle
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    if (window.innerWidth <= 768) {
      sidebar.classList.toggle('mobile-open');
    } else {
      sidebar.classList.toggle('collapsed');
    }
  });

  // --- Page Router ---
  function renderPage(page) {
    const content = document.getElementById('page-content');
    content.innerHTML = '<div class="loading-spinner"><div class="spinner-border text-primary"></div></div>';
    switch (page) {
      case 'dashboard': renderDashboard(); break;
      case 'funcionarios': renderFuncionarios(); break;
      case 'registros': renderRegistros(); break;
      case 'relatorios': renderRelatorios(); break;
      case 'feriados': renderFeriados(); break;
      case 'whatsapp': renderWhatsApp(); break;
      case 'graficos': renderGraficos(); break;
      case 'presenca': renderPresenca(); break;
      case 'usuarios': renderUsuarios(); break;
      case 'perfil': renderPerfil(); break;
      case 'auditlog': renderAuditLog(); break;
      default: content.innerHTML = '<p>Página não encontrada</p>';
    }
  }

  // ============================================================
  // DASHBOARD
  // ============================================================
  async function renderDashboard() {
    const content = document.getElementById('page-content');
    try {
      const summary = await api('/api/registros/dashboard');
      const total = summary.length;
      const trabalhando = summary.filter(s => s.status_atual === 'trabalhando').length;
      const saiu = summary.filter(s => s.status_atual === 'saiu').length;
      const ausente = summary.filter(s => s.status_atual === 'nao_registrou').length;

      content.innerHTML = `
        <div class="row g-3 mb-4">
          <div class="col-6 col-lg-3">
            <div class="stat-card">
              <div class="stat-icon icon-blue"><i class="bi bi-people"></i></div>
              <div class="stat-value">${total}</div>
              <div class="stat-label">Total Funcionários</div>
            </div>
          </div>
          <div class="col-6 col-lg-3">
            <div class="stat-card">
              <div class="stat-icon icon-green"><i class="bi bi-check-circle"></i></div>
              <div class="stat-value">${trabalhando}</div>
              <div class="stat-label">Trabalhando</div>
            </div>
          </div>
          <div class="col-6 col-lg-3">
            <div class="stat-card">
              <div class="stat-icon icon-yellow"><i class="bi bi-box-arrow-right"></i></div>
              <div class="stat-value">${saiu}</div>
              <div class="stat-label">Saíram</div>
            </div>
          </div>
          <div class="col-6 col-lg-3">
            <div class="stat-card">
              <div class="stat-icon icon-red"><i class="bi bi-x-circle"></i></div>
              <div class="stat-value">${ausente}</div>
              <div class="stat-label">Ausentes</div>
            </div>
          </div>
        </div>
        <div class="page-header">
          <h3><i class="bi bi-clock me-2"></i>Ponto de Hoje - ${formatDate(today())}</h3>
          <button class="btn btn-primary btn-sm" onclick="App.openRegistroModal()">
            <i class="bi bi-plus-lg"></i> Novo Registro
          </button>
        </div>
        <div class="row g-3" id="dashboard-cards">
          ${summary.length === 0 ? '<div class="col-12"><div class="empty-state"><i class="bi bi-inbox"></i><p>Nenhum funcionário ativo cadastrado</p></div></div>' : ''}
          ${summary.map(emp => {
            const initials = emp.nome.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            let statusBadge = '';
            if (emp.status_atual === 'trabalhando') statusBadge = '<span class="badge-status badge-trabalhando">Trabalhando</span>';
            else if (emp.status_atual === 'saiu') statusBadge = '<span class="badge-status badge-saiu">Saiu</span>';
            else statusBadge = '<span class="badge-status badge-ausente">Ausente</span>';
            return `
              <div class="col-12 col-md-6 col-xl-4">
                <div class="employee-card">
                  <div class="emp-avatar">${initials}</div>
                  <div class="emp-info">
                    <div class="emp-name">${emp.nome}</div>
                    <div class="emp-cargo">${emp.cargo}</div>
                  </div>
                  <div class="emp-times">
                    ${emp.entrada ? `<div class="time-in"><i class="bi bi-arrow-right-circle"></i> ${emp.entrada}</div>` : ''}
                    ${emp.saida ? `<div class="time-out"><i class="bi bi-arrow-left-circle"></i> ${emp.saida}</div>` : ''}
                    <div class="mt-1">${statusBadge}</div>
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>`;
    } catch (err) {
      content.innerHTML = `<div class="alert alert-danger">Erro ao carregar dashboard: ${err.message}</div>`;
    }
  }

  // ============================================================
  // FUNCIONÁRIOS
  // ============================================================
  let showInactive = false;

  async function renderFuncionarios() {
    const content = document.getElementById('page-content');
    try {
      const allFuncionarios = await api('/api/funcionarios?includeInactive=true');
      const funcionarios = showInactive ? allFuncionarios : allFuncionarios.filter(f => f.status === 'ativo');
      const inactiveCount = allFuncionarios.filter(f => f.status === 'inativo').length;
      const isAdmin = currentUser.role === 'admin';
      const canManage = currentUser.role === 'admin' || currentUser.role === 'gestor';

      content.innerHTML = `
        <div class="page-header">
          <h3><i class="bi bi-people me-2"></i>${funcionarios.length} funcionário(s)</h3>
          <div class="d-flex gap-2 align-items-center">
            ${inactiveCount > 0 ? `<button class="btn btn-sm ${showInactive ? 'btn-secondary' : 'btn-outline-secondary'}" id="btn-toggle-inactive">
              <i class="bi bi-eye${showInactive ? '-slash' : ''}"></i> ${showInactive ? 'Ocultar' : 'Mostrar'} inativos (${inactiveCount})
            </button>` : ''}
            ${canManage ? '<button class="btn btn-primary btn-sm" onclick="App.openFuncionarioModal()"><i class="bi bi-plus-lg"></i> Novo Funcionário</button>' : ''}
          </div>
        </div>
        <div class="data-table">
          <table class="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Cargo</th>
                <th>Salário/Hora</th>
                <th>Telefone</th>
                <th>Horário</th>
                <th>Status</th>
                ${canManage ? '<th>Ações</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${funcionarios.length === 0 ? `<tr><td colspan="${canManage ? 7 : 6}" class="text-center text-muted py-4">Nenhum funcionário cadastrado</td></tr>` : ''}
              ${funcionarios.map(f => `
                <tr>
                  <td><strong>${f.nome}</strong></td>
                  <td>${f.cargo}</td>
                  <td>${formatCurrency(f.salario_hora)}</td>
                  <td>${f.telefone || '-'}</td>
                  <td>${f.horario_entrada || '08:00'}</td>
                  <td><span class="badge-status badge-${f.status}">${f.status === 'ativo' ? 'Ativo' : 'Inativo'}</span></td>
                  ${canManage ? `
                    <td class="text-nowrap">
                      <button class="btn btn-action btn-outline-primary btn-edit-func" data-id="${f.id}" title="Editar"><i class="bi bi-pencil"></i></button>
                      ${f.status === 'ativo' ? `<button class="btn btn-action btn-outline-danger ms-1 btn-del-func" data-id="${f.id}" data-nome="${f.nome.replace(/"/g, '&quot;')}" title="Desativar"><i class="bi bi-person-x"></i></button>` : ''}
                    </td>` : ''}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

      // Attach event listeners
      content.querySelectorAll('.btn-edit-func').forEach(btn => {
        btn.addEventListener('click', () => openFuncionarioModal(parseInt(btn.dataset.id)));
      });
      content.querySelectorAll('.btn-del-func').forEach(btn => {
        btn.addEventListener('click', () => deleteFuncionario(parseInt(btn.dataset.id), btn.dataset.nome));
      });
      const toggleBtn = document.getElementById('btn-toggle-inactive');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => { showInactive = !showInactive; renderFuncionarios(); });
      }
    } catch (err) {
      content.innerHTML = `<div class="alert alert-danger">Erro: ${err.message}</div>`;
    }
  }

  function openFuncionarioModal(id) {
    const isEdit = !!id;
    const title = isEdit ? 'Editar Funcionário' : 'Novo Funcionário';

    const body = `
      <form id="func-form">
        <div class="mb-3">
          <label class="form-label">Nome</label>
          <input type="text" class="form-control" id="func-nome" required>
        </div>
        <div class="mb-3">
          <label class="form-label">Cargo</label>
          <input type="text" class="form-control" id="func-cargo" required>
        </div>
        <div class="mb-3">
          <label class="form-label">Salário/Hora (R$)</label>
          <input type="number" class="form-control" id="func-salario" step="0.01" min="0" required>
        </div>
        <div class="mb-3">
          <label class="form-label">Telefone</label>
          <input type="text" class="form-control" id="func-telefone" placeholder="(11) 99999-0000">
        </div>
        <div class="mb-3">
          <label class="form-label">Horário de Entrada</label>
          <input type="time" class="form-control" id="func-horario-entrada" value="08:00">
        </div>
        ${isEdit ? `
          <div class="mb-3">
            <label class="form-label">Status</label>
            <select class="form-select" id="func-status">
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
            </select>
          </div>` : ''}
      </form>`;

    const footer = `
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary" onclick="App.saveFuncionario(${id || 'null'})">Salvar</button>`;

    openModal(title, body, footer);

    if (isEdit) {
      api(`/api/funcionarios/${id}`).then(f => {
        document.getElementById('func-nome').value = f.nome;
        document.getElementById('func-cargo').value = f.cargo;
        document.getElementById('func-salario').value = f.salario_hora;
        document.getElementById('func-telefone').value = f.telefone || '';
        document.getElementById('func-horario-entrada').value = f.horario_entrada || '08:00';
        document.getElementById('func-status').value = f.status;
      });
    }
  }

  async function saveFuncionario(id) {
    const data = {
      nome: document.getElementById('func-nome').value,
      cargo: document.getElementById('func-cargo').value,
      salario_hora: parseFloat(document.getElementById('func-salario').value),
      telefone: document.getElementById('func-telefone').value || null,
      horario_entrada: document.getElementById('func-horario-entrada').value || '08:00'
    };

    if (!data.nome || !data.cargo || isNaN(data.salario_hora)) {
      showToast('Preencha todos os campos obrigatórios', 'danger');
      return;
    }

    if (id) {
      const statusEl = document.getElementById('func-status');
      if (statusEl) data.status = statusEl.value;
    }

    try {
      if (id) {
        await api(`/api/funcionarios/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('Funcionário atualizado com sucesso');
      } else {
        await api('/api/funcionarios', { method: 'POST', body: JSON.stringify(data) });
        showToast('Funcionário criado com sucesso');
      }
      closeModal();
      renderFuncionarios();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  function deleteFuncionario(id, nome) {
    confirmAction(`Deseja desativar o funcionário "${nome}"?`, async () => {
      try {
        await api(`/api/funcionarios/${id}`, { method: 'DELETE' });
        showToast('Funcionário desativado com sucesso');
        renderFuncionarios();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });
  }

  // ============================================================
  // REGISTROS
  // ============================================================
  async function renderRegistros() {
    const content = document.getElementById('page-content');
    try {
      const funcionarios = await api('/api/funcionarios');
      const dataAtual = today();

      content.innerHTML = `
        <div class="filter-bar">
          <div>
            <label class="form-label">Data</label>
            <input type="date" class="form-control" id="reg-filter-data" value="${dataAtual}">
          </div>
          <div>
            <label class="form-label">Funcionário</label>
            <select class="form-select" id="reg-filter-func">
              <option value="">Todos</option>
              ${funcionarios.map(f => `<option value="${f.id}">${f.nome}</option>`).join('')}
            </select>
          </div>
          <div>
            <button class="btn btn-primary" onclick="App.filterRegistros()">
              <i class="bi bi-search"></i> Buscar
            </button>
          </div>
          <div class="ms-auto">
            <button class="btn btn-success" onclick="App.openRegistroModal()">
              <i class="bi bi-plus-lg"></i> Novo Registro
            </button>
          </div>
        </div>
        <div id="registros-table"></div>`;

      filterRegistros();
    } catch (err) {
      content.innerHTML = `<div class="alert alert-danger">Erro: ${err.message}</div>`;
    }
  }

  async function filterRegistros() {
    const container = document.getElementById('registros-table');
    const data = document.getElementById('reg-filter-data').value;
    const funcId = document.getElementById('reg-filter-func').value;

    container.innerHTML = '<div class="loading-spinner"><div class="spinner-border spinner-border-sm text-primary"></div></div>';

    try {
      let url = `/api/registros?data=${data}`;
      if (funcId) url += `&funcionarioId=${funcId}`;
      const registros = await api(url);
      const isAdmin = currentUser.role === 'admin';

      container.innerHTML = `
        <div class="data-table">
          <table class="table">
            <thead>
              <tr>
                <th>Funcionário</th>
                <th>Cargo</th>
                <th>Data</th>
                <th>Entrada</th>
                <th>Saída</th>
                <th>Tipo</th>
                <th>Local</th>
                <th>Obs.</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${registros.length === 0 ? '<tr><td colspan="9" class="text-center text-muted py-4">Nenhum registro encontrado</td></tr>' : ''}
              ${registros.map(r => `
                <tr>
                  <td><strong>${r.funcionario_nome}</strong></td>
                  <td>${r.cargo}</td>
                  <td>${formatDate(r.data)}</td>
                  <td>${r.entrada || '-'}</td>
                  <td>${r.saida || '-'}</td>
                  <td><span class="badge bg-${r.tipo === 'whatsapp' ? 'success' : 'secondary'} bg-opacity-10 text-${r.tipo === 'whatsapp' ? 'success' : 'secondary'}">${r.tipo}</span></td>
                  <td>${r.latitude && r.longitude ? `<a class="location-link" onclick="App.showLocationMap(${r.latitude}, ${r.longitude})" title="Ver no mapa"><i class="bi bi-geo-alt-fill"></i></a>` : '<i class="bi bi-geo-alt text-muted"></i>'}</td>
                  <td>${r.observacao || '-'}</td>
                  <td>
                    <button class="btn btn-action btn-outline-primary" onclick="App.openRegistroModal(${r.id})" title="Editar"><i class="bi bi-pencil"></i></button>
                    ${isAdmin ? `<button class="btn btn-action btn-outline-danger ms-1" onclick="App.deleteRegistro(${r.id})" title="Excluir"><i class="bi bi-trash"></i></button>` : ''}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    } catch (err) {
      container.innerHTML = `<div class="alert alert-danger">Erro: ${err.message}</div>`;
    }
  }

  // Geolocation helper
  let currentGeoLat = null;
  let currentGeoLng = null;

  function captureGeolocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          currentGeoLat = pos.coords.latitude;
          currentGeoLng = pos.coords.longitude;
          const locEl = document.getElementById('reg-location-status');
          if (locEl) locEl.innerHTML = `<i class="bi bi-geo-alt-fill text-success"></i> ${currentGeoLat.toFixed(5)}, ${currentGeoLng.toFixed(5)}`;
          const mapEl = document.getElementById('reg-map');
          if (mapEl && typeof L !== 'undefined') {
            mapEl.style.display = 'block';
            const map = L.map('reg-map').setView([currentGeoLat, currentGeoLng], 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              attribution: '&copy; OpenStreetMap'
            }).addTo(map);
            L.marker([currentGeoLat, currentGeoLng]).addTo(map);
            setTimeout(() => map.invalidateSize(), 200);
          }
        },
        () => {
          const locEl = document.getElementById('reg-location-status');
          if (locEl) locEl.innerHTML = '<i class="bi bi-geo-alt text-muted"></i> Localização não disponível';
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  }

  function showLocationMap(lat, lng) {
    const body = `<div id="location-detail-map" class="map-container" style="height:350px;"></div>
      <p class="mt-2 text-muted text-center">${lat.toFixed(6)}, ${lng.toFixed(6)}</p>`;
    const modal = openModal('Localização do Registro', body, '');
    setTimeout(() => {
      const map = L.map('location-detail-map').setView([lat, lng], 16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);
      L.marker([lat, lng]).addTo(map);
      document.getElementById('app-modal').addEventListener('shown.bs.modal', () => map.invalidateSize(), { once: true });
      setTimeout(() => map.invalidateSize(), 300);
    }, 200);
  }

  async function openRegistroModal(id) {
    const isEdit = !!id;
    currentGeoLat = null;
    currentGeoLng = null;
    const funcionarios = await api('/api/funcionarios');

    const body = `
      <form id="reg-form">
        <div class="mb-3">
          <label class="form-label">Funcionário</label>
          <select class="form-select" id="reg-funcionario" ${isEdit ? 'disabled' : ''} required>
            <option value="">Selecione...</option>
            ${funcionarios.map(f => `<option value="${f.id}">${f.nome}</option>`).join('')}
          </select>
        </div>
        <div class="mb-3">
          <label class="form-label">Data</label>
          <input type="date" class="form-control" id="reg-data" value="${today()}" required>
        </div>
        <div class="row">
          <div class="col-6 mb-3">
            <label class="form-label">Entrada</label>
            <input type="time" class="form-control" id="reg-entrada">
          </div>
          <div class="col-6 mb-3">
            <label class="form-label">Saída</label>
            <input type="time" class="form-control" id="reg-saida">
          </div>
        </div>
        <div class="mb-3">
          <label class="form-label">Observação</label>
          <textarea class="form-control" id="reg-obs" rows="2"></textarea>
        </div>
        <div class="mb-3">
          <label class="form-label">Localização</label>
          <div id="reg-location-status"><i class="bi bi-geo-alt text-muted"></i> Capturando localização...</div>
          <div id="reg-map" class="map-container" style="display:none;"></div>
        </div>
      </form>`;

    const footer = `
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary" onclick="App.saveRegistro(${id || 'null'})">Salvar</button>`;

    openModal(isEdit ? 'Editar Registro' : 'Novo Registro', body, footer);

    if (isEdit) {
      const r = await api(`/api/registros/${id}`);
      document.getElementById('reg-funcionario').value = r.funcionario_id;
      document.getElementById('reg-data').value = r.data;
      document.getElementById('reg-entrada').value = r.entrada || '';
      document.getElementById('reg-saida').value = r.saida || '';
      document.getElementById('reg-obs').value = r.observacao || '';
      if (r.latitude && r.longitude) {
        currentGeoLat = r.latitude;
        currentGeoLng = r.longitude;
        const locEl = document.getElementById('reg-location-status');
        locEl.innerHTML = `<i class="bi bi-geo-alt-fill text-success"></i> ${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}`;
        const mapEl = document.getElementById('reg-map');
        mapEl.style.display = 'block';
        setTimeout(() => {
          const map = L.map('reg-map').setView([r.latitude, r.longitude], 15);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
          L.marker([r.latitude, r.longitude]).addTo(map);
          setTimeout(() => map.invalidateSize(), 200);
        }, 200);
      } else {
        captureGeolocation();
      }
    } else {
      captureGeolocation();
    }
  }

  async function saveRegistro(id) {
    const data = {
      funcionario_id: parseInt(document.getElementById('reg-funcionario').value),
      data: document.getElementById('reg-data').value,
      entrada: document.getElementById('reg-entrada').value || null,
      saida: document.getElementById('reg-saida').value || null,
      observacao: document.getElementById('reg-obs').value || null,
      latitude: currentGeoLat,
      longitude: currentGeoLng
    };

    if (!data.funcionario_id || !data.data) {
      showToast('Preencha funcionário e data', 'danger');
      return;
    }

    try {
      if (id) {
        await api(`/api/registros/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('Registro atualizado com sucesso');
      } else {
        await api('/api/registros', { method: 'POST', body: JSON.stringify(data) });
        showToast('Registro criado com sucesso');
      }
      closeModal();
      if (currentPage === 'registros') filterRegistros();
      else if (currentPage === 'dashboard') renderDashboard();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  function deleteRegistro(id) {
    confirmAction('Deseja excluir este registro de ponto?', async () => {
      try {
        await api(`/api/registros/${id}`, { method: 'DELETE' });
        showToast('Registro excluído com sucesso');
        filterRegistros();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });
  }

  // ============================================================
  // RELATÓRIOS
  // ============================================================
  async function renderRelatorios() {
    const content = document.getElementById('page-content');
    const now = new Date();
    const mesAtual = now.getMonth() + 1;
    const anoAtual = now.getFullYear();

    try {
      const funcionarios = await api('/api/funcionarios');

      content.innerHTML = `
        <div class="filter-bar">
          <div>
            <label class="form-label">Mês</label>
            <select class="form-select" id="rel-mes">
              ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => `<option value="${m}" ${m === mesAtual ? 'selected' : ''}>${monthName(m)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">Ano</label>
            <input type="number" class="form-control" id="rel-ano" value="${anoAtual}" min="2020" max="2099">
          </div>
          <div>
            <label class="form-label">Funcionário</label>
            <select class="form-select" id="rel-func">
              <option value="">Todos</option>
              ${funcionarios.map(f => `<option value="${f.id}">${f.nome}</option>`).join('')}
            </select>
          </div>
          <div>
            <button class="btn btn-primary" onclick="App.loadRelatorio()">
              <i class="bi bi-search"></i> Gerar
            </button>
          </div>
          <div class="ms-auto d-flex gap-2">
            <button class="btn btn-success btn-sm" onclick="App.exportExcel()">
              <i class="bi bi-file-earmark-excel"></i> Excel
            </button>
            <button class="btn btn-danger btn-sm" onclick="App.exportPDF()">
              <i class="bi bi-file-earmark-pdf"></i> PDF
            </button>
          </div>
        </div>
        <div id="relatorio-content"></div>`;

      loadRelatorio();
    } catch (err) {
      content.innerHTML = `<div class="alert alert-danger">Erro: ${err.message}</div>`;
    }
  }

  async function loadRelatorio() {
    const container = document.getElementById('relatorio-content');
    const mes = document.getElementById('rel-mes').value;
    const ano = document.getElementById('rel-ano').value;
    const funcId = document.getElementById('rel-func').value;

    container.innerHTML = '<div class="loading-spinner"><div class="spinner-border text-primary"></div></div>';

    try {
      let url = `/api/relatorios/mensal?mes=${mes}&ano=${ano}`;
      if (funcId) url += `&funcionarioId=${funcId}`;
      const data = await api(url);

      if (data.funcionarios.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="bi bi-clipboard-x"></i><p>Nenhum registro encontrado para o período</p></div>';
        return;
      }

      let html = `
        <div class="row g-3 mb-4">
          <div class="col-md-3">
            <div class="stat-card">
              <div class="stat-icon icon-blue"><i class="bi bi-calendar-check"></i></div>
              <div class="stat-value">${data.diasUteis}</div>
              <div class="stat-label">Dias Úteis no Mês</div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="stat-card">
              <div class="stat-icon icon-green"><i class="bi bi-people"></i></div>
              <div class="stat-value">${data.funcionarios.length}</div>
              <div class="stat-label">Funcionários</div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="stat-card">
              <div class="stat-icon icon-yellow"><i class="bi bi-clock-history"></i></div>
              <div class="stat-value">${data.funcionarios.reduce((s, f) => s + f.totalHorasExtras, 0).toFixed(1)}</div>
              <div class="stat-label">Total H. Extras</div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="stat-card">
              <div class="stat-icon icon-red"><i class="bi bi-cash-stack"></i></div>
              <div class="stat-value">${formatCurrency(data.funcionarios.reduce((s, f) => s + f.totalValor, 0))}</div>
              <div class="stat-label">Custo Total</div>
            </div>
          </div>
        </div>`;

      for (const func of data.funcionarios) {
        html += `
          <div class="summary-card mb-4">
            <h5><i class="bi bi-person me-2"></i>${func.nome} - ${func.cargo} (${formatCurrency(func.salario_hora)}/h)</h5>
            <div class="row mb-3">
              <div class="col-md-8">
                <div class="data-table">
                  <table class="table table-sm">
                    <thead>
                      <tr>
                        <th>Data</th><th>Dia</th><th>Entrada</th><th>Saída</th>
                        <th>Horas</th><th>Extras</th><th>Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${func.registros.map(r => {
                        const date = new Date(r.data + 'T12:00:00');
                        const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
                        const isSpecial = r.tipoDia.tipo === 'feriado' || r.tipoDia.tipo === 'domingo';
                        return `
                          <tr class="${isSpecial ? 'table-warning' : ''}">
                            <td>${formatDate(r.data)}</td>
                            <td>${dias[date.getDay()]}</td>
                            <td>${r.entrada || '-'}</td>
                            <td>${r.saida || '-'}</td>
                            <td>${r.horasTrabalhadas.toFixed(2)}</td>
                            <td>${r.horasExtras > 0 ? `<span class="text-warning fw-bold">${r.horasExtras.toFixed(2)}</span>` : '0.00'}</td>
                            <td>${formatCurrency(r.valorTotal)}</td>
                          </tr>`;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
              <div class="col-md-4">
                <div class="summary-card" style="background: #F8FAFC;">
                  <h5>Resumo</h5>
                  <div class="summary-item"><span class="label">Dias Trabalhados</span><span class="value">${func.diasTrabalhados}</span></div>
                  <div class="summary-item"><span class="label">Horas Trabalhadas</span><span class="value">${func.totalHorasTrabalhadas.toFixed(2)}</span></div>
                  <div class="summary-item"><span class="label">Horas Normais</span><span class="value">${func.totalHorasNormais.toFixed(2)}</span></div>
                  <div class="summary-item"><span class="label">Horas Extras</span><span class="value text-warning">${func.totalHorasExtras.toFixed(2)}</span></div>
                  <div class="summary-item"><span class="label">Valor Normal</span><span class="value">${formatCurrency(func.totalValorNormal)}</span></div>
                  <div class="summary-item"><span class="label">Valor H. Extras</span><span class="value text-warning">${formatCurrency(func.totalHorasExtraValor)}</span></div>
                  <hr>
                  <div class="summary-item"><span class="label fw-bold">Total</span><span class="value text-primary fs-5">${formatCurrency(func.totalValor)}</span></div>
                </div>
              </div>
            </div>
          </div>`;
      }

      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = `<div class="alert alert-danger">Erro: ${err.message}</div>`;
    }
  }

  function exportExcel() {
    const mes = document.getElementById('rel-mes').value;
    const ano = document.getElementById('rel-ano').value;
    const funcId = document.getElementById('rel-func').value;
    let url = `/api/export/excel?mes=${mes}&ano=${ano}`;
    if (funcId) url += `&funcionarioId=${funcId}`;
    downloadFile(url, `ponto_${monthName(mes)}_${ano}.xlsx`);
  }

  function exportPDF() {
    const mes = document.getElementById('rel-mes').value;
    const ano = document.getElementById('rel-ano').value;
    const funcId = document.getElementById('rel-func').value;
    let url = `/api/export/pdf?mes=${mes}&ano=${ano}`;
    if (funcId) url += `&funcionarioId=${funcId}`;
    downloadFile(url, `ponto_${monthName(mes)}_${ano}.pdf`);
  }

  async function downloadFile(url, filename) {
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Erro ao gerar arquivo');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast('Arquivo gerado com sucesso');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  // ============================================================
  // FERIADOS
  // ============================================================
  async function renderFeriados() {
    const content = document.getElementById('page-content');
    const anoAtual = new Date().getFullYear();
    const isAdmin = currentUser.role === 'admin';

    content.innerHTML = `
      <div class="filter-bar">
        <div>
          <label class="form-label">Ano</label>
          <select class="form-select" id="fer-ano">
            ${[anoAtual - 1, anoAtual, anoAtual + 1].map(a => `<option value="${a}" ${a === anoAtual ? 'selected' : ''}>${a}</option>`).join('')}
          </select>
        </div>
        <div>
          <button class="btn btn-primary" onclick="App.loadFeriados()">
            <i class="bi bi-search"></i> Buscar
          </button>
        </div>
        ${isAdmin ? `
          <div class="ms-auto d-flex gap-2">
            <button class="btn btn-info btn-sm" onclick="App.syncFeriados()" id="btn-sync-feriados">
              <i class="bi bi-cloud-download"></i> Sincronizar Google Calendar
            </button>
            <button class="btn btn-success btn-sm" onclick="App.openFeriadoModal()">
              <i class="bi bi-plus-lg"></i> Novo Feriado
            </button>
          </div>` : ''}
      </div>
      <div id="feriados-table"></div>`;

    // Load sync status
    try {
      const syncStatus = await api('/api/feriados/sync-status');
      if (syncStatus.lastSync) {
        const syncDate = new Date(syncStatus.lastSync);
        const syncInfo = document.createElement('div');
        syncInfo.className = 'text-muted small mt-2 text-end';
        syncInfo.innerHTML = `<i class="bi bi-clock"></i> Última sincronização: ${syncDate.toLocaleString('pt-BR')}`;
        content.querySelector('.filter-bar').appendChild(syncInfo);
      }
    } catch (e) {}

    loadFeriados();
  }

  async function syncFeriados() {
    const btn = document.getElementById('btn-sync-feriados');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Sincronizando...';
    }
    try {
      const ano = document.getElementById('fer-ano').value;
      const result = await api('/api/feriados/sync', {
        method: 'POST',
        body: JSON.stringify({ year: parseInt(ano) })
      });
      showToast(result.message);
      loadFeriados();
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-cloud-download"></i> Sincronizar Google Calendar';
      }
    }
  }

  async function loadFeriados() {
    const container = document.getElementById('feriados-table');
    const ano = document.getElementById('fer-ano').value;
    const isAdmin = currentUser.role === 'admin';

    container.innerHTML = '<div class="loading-spinner"><div class="spinner-border spinner-border-sm text-primary"></div></div>';

    try {
      const feriados = await api(`/api/feriados?ano=${ano}`);
      const tipoBadges = {
        nacional: 'bg-primary',
        estadual: 'bg-info',
        municipal: 'bg-success',
        facultativo: 'bg-warning text-dark'
      };

      container.innerHTML = `
        <div class="data-table">
          <table class="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Dia</th>
                <th>Descrição</th>
                <th>Tipo</th>
                ${isAdmin ? '<th>Ações</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${feriados.length === 0 ? `<tr><td colspan="${isAdmin ? 5 : 4}" class="text-center text-muted py-4">Nenhum feriado cadastrado para ${ano}</td></tr>` : ''}
              ${feriados.map(f => {
                const date = new Date(f.data + 'T12:00:00');
                const dias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
                return `
                  <tr>
                    <td>${formatDate(f.data)}</td>
                    <td>${dias[date.getDay()]}</td>
                    <td><strong>${f.descricao}</strong></td>
                    <td><span class="badge ${tipoBadges[f.tipo] || 'bg-secondary'}">${f.tipo}</span></td>
                    ${isAdmin ? `
                      <td>
                        <button class="btn btn-action btn-outline-primary" onclick="App.openFeriadoModal(${f.id})" title="Editar"><i class="bi bi-pencil"></i></button>
                        <button class="btn btn-action btn-outline-danger ms-1" onclick="App.deleteFeriado(${f.id}, '${f.descricao.replace(/'/g, "\\'")}')" title="Excluir"><i class="bi bi-trash"></i></button>
                      </td>` : ''}
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`;
    } catch (err) {
      container.innerHTML = `<div class="alert alert-danger">Erro: ${err.message}</div>`;
    }
  }

  function openFeriadoModal(id) {
    const isEdit = !!id;
    const anoAtual = new Date().getFullYear();

    const body = `
      <form id="fer-form">
        <div class="mb-3">
          <label class="form-label">Data</label>
          <input type="date" class="form-control" id="fer-data" required>
        </div>
        <div class="mb-3">
          <label class="form-label">Descrição</label>
          <input type="text" class="form-control" id="fer-descricao" required>
        </div>
        <div class="mb-3">
          <label class="form-label">Tipo</label>
          <select class="form-select" id="fer-tipo" required>
            <option value="nacional">Nacional</option>
            <option value="estadual">Estadual</option>
            <option value="municipal">Municipal</option>
            <option value="facultativo">Facultativo</option>
          </select>
        </div>
        <div class="mb-3">
          <label class="form-label">Ano</label>
          <input type="number" class="form-control" id="fer-ano-input" value="${anoAtual}" min="2020" max="2099" required>
        </div>
      </form>`;

    const footer = `
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary" onclick="App.saveFeriado(${id || 'null'})">Salvar</button>`;

    openModal(isEdit ? 'Editar Feriado' : 'Novo Feriado', body, footer);

    if (isEdit) {
      api(`/api/feriados/${id}`).then(f => {
        document.getElementById('fer-data').value = f.data;
        document.getElementById('fer-descricao').value = f.descricao;
        document.getElementById('fer-tipo').value = f.tipo;
        document.getElementById('fer-ano-input').value = f.ano;
      });
    }
  }

  async function saveFeriado(id) {
    const data = {
      data: document.getElementById('fer-data').value,
      descricao: document.getElementById('fer-descricao').value,
      tipo: document.getElementById('fer-tipo').value,
      ano: parseInt(document.getElementById('fer-ano-input').value)
    };

    if (!data.data || !data.descricao || !data.tipo || !data.ano) {
      showToast('Preencha todos os campos', 'danger');
      return;
    }

    try {
      if (id) {
        await api(`/api/feriados/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('Feriado atualizado com sucesso');
      } else {
        await api('/api/feriados', { method: 'POST', body: JSON.stringify(data) });
        showToast('Feriado criado com sucesso');
      }
      closeModal();
      loadFeriados();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  function deleteFeriado(id, desc) {
    confirmAction(`Deseja excluir o feriado "${desc}"?`, async () => {
      try {
        await api(`/api/feriados/${id}`, { method: 'DELETE' });
        showToast('Feriado excluído com sucesso');
        loadFeriados();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });
  }

  // ============================================================
  // GRAFICOS (Charts)
  // ============================================================
  let chartInstances = [];

  function destroyCharts() {
    chartInstances.forEach(c => c.destroy());
    chartInstances = [];
  }

  async function renderGraficos() {
    const content = document.getElementById('page-content');
    const now = new Date();
    const mesAtual = now.getMonth() + 1;
    const anoAtual = now.getFullYear();

    try {
      const funcionarios = await api('/api/funcionarios');

      content.innerHTML = `
        <div class="filter-bar">
          <div>
            <label class="form-label">Mês</label>
            <select class="form-select" id="chart-mes">
              ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => `<option value="${m}" ${m === mesAtual ? 'selected' : ''}>${monthName(m)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">Ano</label>
            <input type="number" class="form-control" id="chart-ano" value="${anoAtual}" min="2020" max="2099">
          </div>
          <div>
            <label class="form-label">Funcionário</label>
            <select class="form-select" id="chart-func">
              <option value="">Todos</option>
              ${funcionarios.map(f => `<option value="${f.id}">${f.nome}</option>`).join('')}
            </select>
          </div>
          <div>
            <button class="btn btn-primary" onclick="App.loadGraficos()">
              <i class="bi bi-graph-up"></i> Gerar Gráficos
            </button>
          </div>
        </div>
        <div id="charts-container">
          <div class="row g-4">
            <div class="col-lg-8">
              <div class="chart-container">
                <h5 class="mb-3"><i class="bi bi-bar-chart me-2"></i>Horas por Funcionário</h5>
                <div class="chart-canvas-wrapper"><canvas id="chart-bar"></canvas></div>
              </div>
            </div>
            <div class="col-lg-4">
              <div class="chart-container">
                <h5 class="mb-3"><i class="bi bi-pie-chart me-2"></i>Distribuição de Horas</h5>
                <div class="chart-canvas-wrapper"><canvas id="chart-pie"></canvas></div>
              </div>
            </div>
            <div class="col-12">
              <div class="chart-container">
                <h5 class="mb-3"><i class="bi bi-graph-up me-2"></i>Tendência Diária de Horas</h5>
                <div class="chart-canvas-wrapper"><canvas id="chart-line"></canvas></div>
              </div>
            </div>
          </div>
        </div>`;

      loadGraficos();
    } catch (err) {
      content.innerHTML = `<div class="alert alert-danger">Erro: ${err.message}</div>`;
    }
  }

  async function loadGraficos() {
    const mes = document.getElementById('chart-mes').value;
    const ano = document.getElementById('chart-ano').value;
    const funcId = document.getElementById('chart-func').value;

    try {
      let url = `/api/relatorios/comparativo?mes=${mes}&ano=${ano}`;
      if (funcId) url += `&funcionarioId=${funcId}`;
      const data = await api(url);

      destroyCharts();

      // Bar Chart: Hours per employee
      const barCtx = document.getElementById('chart-bar');
      if (barCtx) {
        const barChart = new Chart(barCtx, {
          type: 'bar',
          data: {
            labels: data.employeeHours.map(e => e.nome),
            datasets: [
              {
                label: 'Horas Normais',
                data: data.employeeHours.map(e => e.horasNormais),
                backgroundColor: 'rgba(37, 99, 235, 0.7)',
                borderColor: 'rgba(37, 99, 235, 1)',
                borderWidth: 1
              },
              {
                label: 'Horas Extras',
                data: data.employeeHours.map(e => e.horasExtras),
                backgroundColor: 'rgba(245, 158, 11, 0.7)',
                borderColor: 'rgba(245, 158, 11, 1)',
                borderWidth: 1
              }
            ]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } },
            scales: { x: { stacked: true, title: { display: true, text: 'Horas' } }, y: { stacked: true } }
          }
        });
        chartInstances.push(barChart);
      }

      // Pie Chart: Distribution
      const pieCtx = document.getElementById('chart-pie');
      if (pieCtx) {
        const pieChart = new Chart(pieCtx, {
          type: 'doughnut',
          data: {
            labels: ['Horas Normais', 'Horas Extras', 'Feriado/Domingo'],
            datasets: [{
              data: [data.distribution.normal, data.distribution.overtime, data.distribution.holiday],
              backgroundColor: [
                'rgba(37, 99, 235, 0.7)',
                'rgba(245, 158, 11, 0.7)',
                'rgba(239, 68, 68, 0.7)'
              ],
              borderColor: [
                'rgba(37, 99, 235, 1)',
                'rgba(245, 158, 11, 1)',
                'rgba(239, 68, 68, 1)'
              ],
              borderWidth: 1
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } }
          }
        });
        chartInstances.push(pieChart);
      }

      // Line Chart: Daily trend
      const lineCtx = document.getElementById('chart-line');
      if (lineCtx) {
        const lineChart = new Chart(lineCtx, {
          type: 'line',
          data: {
            labels: data.dailyTrend.map(d => formatDate(d.data)),
            datasets: [
              {
                label: 'Total Horas',
                data: data.dailyTrend.map(d => d.total),
                borderColor: 'rgba(37, 99, 235, 1)',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                fill: true,
                tension: 0.3
              },
              {
                label: 'Horas Extras',
                data: data.dailyTrend.map(d => d.extras),
                borderColor: 'rgba(245, 158, 11, 1)',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                fill: true,
                tension: 0.3
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } },
            scales: {
              y: { title: { display: true, text: 'Horas' }, beginAtZero: true },
              x: { ticks: { maxRotation: 45 } }
            }
          }
        });
        chartInstances.push(lineChart);
      }

      if (data.employeeHours.length === 0) {
        document.getElementById('charts-container').innerHTML = '<div class="empty-state"><i class="bi bi-bar-chart"></i><p>Nenhum dado encontrado para o período selecionado</p></div>';
      }
    } catch (err) {
      showToast('Erro ao carregar gráficos: ' + err.message, 'danger');
    }
  }

  // ============================================================
  // PRESENÇA
  // ============================================================
  async function renderPresenca() {
    const content = document.getElementById('page-content');
    const now = new Date();
    const mesAtual = now.getMonth() + 1;
    const anoAtual = now.getFullYear();

    content.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-4">
        <h4 class="mb-0"><i class="bi bi-calendar-check me-2"></i>Dashboard de Presença</h4>
      </div>

      <!-- Cards resumo do dia -->
      <div id="presenca-cards" class="row g-3 mb-4">
        <div class="loading-spinner"><div class="spinner-border text-primary"></div></div>
      </div>

      <!-- Tabela do dia -->
      <div class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center">
          <h5 class="mb-0"><i class="bi bi-clock me-2"></i>Status de Hoje</h5>
        </div>
        <div class="card-body p-0">
          <div id="presenca-tabela-hoje" class="table-responsive">
            <div class="loading-spinner p-4"><div class="spinner-border text-primary"></div></div>
          </div>
        </div>
      </div>

      <!-- Filtros mensais -->
      <div class="filter-bar mb-4">
        <div>
          <label class="form-label">Mês</label>
          <select class="form-select" id="presenca-mes">
            ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => '<option value="' + m + '" ' + (m === mesAtual ? 'selected' : '') + '>' + monthName(m) + '</option>').join('')}
          </select>
        </div>
        <div>
          <label class="form-label">Ano</label>
          <input type="number" class="form-control" id="presenca-ano" value="${anoAtual}" min="2020" max="2099">
        </div>
        <div>
          <button class="btn btn-primary" onclick="App.loadPresencaMensal()">
            <i class="bi bi-search"></i> Atualizar
          </button>
        </div>
      </div>

      <!-- Gráfico de assiduidade + Ranking -->
      <div class="row g-4 mb-4">
        <div class="col-lg-8">
          <div class="chart-container">
            <h5 class="mb-3"><i class="bi bi-bar-chart me-2"></i>Taxa de Assiduidade por Funcionário</h5>
            <div class="chart-canvas-wrapper"><canvas id="chart-assiduidade"></canvas></div>
          </div>
        </div>
        <div class="col-lg-4">
          <div class="card">
            <div class="card-header"><h5 class="mb-0"><i class="bi bi-trophy me-2"></i>Ranking de Assiduidade</h5></div>
            <div class="card-body p-0" id="presenca-ranking">
              <div class="loading-spinner p-4"><div class="spinner-border text-primary"></div></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Heatmap -->
      <div class="card mb-4">
        <div class="card-header"><h5 class="mb-0"><i class="bi bi-grid-3x3 me-2"></i>Calendário de Presença</h5></div>
        <div class="card-body p-0">
          <div id="presenca-heatmap" class="table-responsive">
            <div class="loading-spinner p-4"><div class="spinner-border text-primary"></div></div>
          </div>
        </div>
      </div>`;

    loadPresencaHoje();
    loadPresencaMensal();
  }

  async function loadPresencaHoje() {
    try {
      const data = await api('/api/dashboard/presenca/hoje');

      document.getElementById('presenca-cards').innerHTML = `
        <div class="col-6 col-lg-3">
          <div class="stat-card">
            <div class="stat-icon icon-blue"><i class="bi bi-people"></i></div>
            <div class="stat-value">${data.resumo.total}</div>
            <div class="stat-label">Total</div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="stat-card">
            <div class="stat-icon icon-green"><i class="bi bi-check-circle"></i></div>
            <div class="stat-value">${data.resumo.presentes + data.resumo.sairam}</div>
            <div class="stat-label">Presentes</div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="stat-card">
            <div class="stat-icon icon-red"><i class="bi bi-x-circle"></i></div>
            <div class="stat-value">${data.resumo.ausentes}</div>
            <div class="stat-label">Ausentes</div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="stat-card">
            <div class="stat-icon icon-yellow"><i class="bi bi-exclamation-triangle"></i></div>
            <div class="stat-value">${data.resumo.atrasados}</div>
            <div class="stat-label">Atrasados</div>
          </div>
        </div>`;

      const statusBadge = (status) => {
        const map = {
          presente: '<span class="badge bg-success">Presente</span>',
          atrasado: '<span class="badge bg-warning text-dark">Atrasado</span>',
          ausente: '<span class="badge bg-danger">Ausente</span>',
          saiu: '<span class="badge bg-info">Saiu</span>'
        };
        return map[status] || status;
      };

      if (data.funcionarios.length === 0) {
        document.getElementById('presenca-tabela-hoje').innerHTML = '<div class="empty-state"><i class="bi bi-people"></i><p>Nenhum funcionário ativo</p></div>';
        return;
      }

      document.getElementById('presenca-tabela-hoje').innerHTML = `
        <table class="table table-hover mb-0">
          <thead>
            <tr>
              <th>Funcionário</th>
              <th>Cargo</th>
              <th>Horário Esperado</th>
              <th>Entrada</th>
              <th>Saída</th>
              <th>Status</th>
              <th>Atraso</th>
            </tr>
          </thead>
          <tbody>
            ${data.funcionarios.map(f => `
              <tr>
                <td><strong>${f.nome}</strong></td>
                <td>${f.cargo}</td>
                <td>${f.horario_esperado}</td>
                <td>${f.entrada || '-'}</td>
                <td>${f.saida || '-'}</td>
                <td>${statusBadge(f.status)}</td>
                <td>${f.minutos_atraso > 0 ? f.minutos_atraso + ' min' : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
    } catch (err) {
      document.getElementById('presenca-cards').innerHTML = '<div class="alert alert-danger">Erro: ' + err.message + '</div>';
    }
  }

  async function loadPresencaMensal() {
    const mes = document.getElementById('presenca-mes')?.value;
    const ano = document.getElementById('presenca-ano')?.value;
    if (!mes || !ano) return;

    try {
      const data = await api('/api/dashboard/presenca/mensal?mes=' + mes + '&ano=' + ano);

      destroyCharts();

      // Bar Chart: Assiduidade
      const barCtx = document.getElementById('chart-assiduidade');
      if (barCtx && data.funcionarios.length > 0) {
        const colors = data.funcionarios.map(f =>
          f.taxa_assiduidade >= 90 ? 'rgba(34, 197, 94, 0.7)' :
          f.taxa_assiduidade >= 70 ? 'rgba(245, 158, 11, 0.7)' :
          'rgba(239, 68, 68, 0.7)'
        );
        const borderColors = data.funcionarios.map(f =>
          f.taxa_assiduidade >= 90 ? 'rgba(34, 197, 94, 1)' :
          f.taxa_assiduidade >= 70 ? 'rgba(245, 158, 11, 1)' :
          'rgba(239, 68, 68, 1)'
        );

        const chart = new Chart(barCtx, {
          type: 'bar',
          data: {
            labels: data.funcionarios.map(f => f.nome),
            datasets: [{
              label: 'Taxa de Assiduidade (%)',
              data: data.funcionarios.map(f => f.taxa_assiduidade),
              backgroundColor: colors,
              borderColor: borderColors,
              borderWidth: 1
            }]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { min: 0, max: 100, title: { display: true, text: '%' } }
            }
          }
        });
        chartInstances.push(chart);
      }

      // Ranking
      if (data.ranking.length > 0) {
        const medalha = (pos) => {
          if (pos === 1) return '<span style="font-size:1.2em">&#129351;</span>';
          if (pos === 2) return '<span style="font-size:1.2em">&#129352;</span>';
          if (pos === 3) return '<span style="font-size:1.2em">&#129353;</span>';
          return '<span class="badge bg-secondary">' + pos + '</span>';
        };

        const barColor = (taxa) =>
          taxa >= 90 ? 'bg-success' : taxa >= 70 ? 'bg-warning' : 'bg-danger';

        document.getElementById('presenca-ranking').innerHTML = `
          <ul class="list-group list-group-flush">
            ${data.ranking.map(r => `
              <li class="list-group-item d-flex align-items-center gap-2">
                ${medalha(r.posicao)}
                <div class="flex-grow-1">
                  <div class="fw-bold">${r.nome}</div>
                  <div class="small text-muted">${r.cargo} &middot; ${r.dias_trabalhados}/${data.diasUteis} dias</div>
                  <div class="progress mt-1" style="height: 6px;">
                    <div class="progress-bar ${barColor(r.taxa_assiduidade)}" style="width: ${r.taxa_assiduidade}%"></div>
                  </div>
                </div>
                <span class="fw-bold">${r.taxa_assiduidade}%</span>
              </li>
            `).join('')}
          </ul>`;
      } else {
        document.getElementById('presenca-ranking').innerHTML = '<div class="p-3 text-muted text-center">Sem dados</div>';
      }

      // Heatmap as HTML table
      if (data.heatmap.length > 0) {
        const funcIds = [...new Set(data.heatmap.map(h => h.funcionario_id))];
        const funcNames = {};
        data.funcionarios.forEach(f => { funcNames[f.id] = f.nome; });

        const daysInMonth = new Date(ano, mes, 0).getDate();
        const days = Array.from({length: daysInMonth}, (_, i) => i + 1);

        const heatmapMap = {};
        data.heatmap.forEach(h => {
          const day = parseInt(h.data.split('-')[2]);
          heatmapMap[h.funcionario_id + '-' + day] = h.status;
        });

        const cellColor = (status) => {
          const map = {
            presente: 'background-color: rgba(34, 197, 94, 0.6)',
            atrasado: 'background-color: rgba(245, 158, 11, 0.6)',
            falta: 'background-color: rgba(239, 68, 68, 0.6)',
            feriado: 'background-color: rgba(156, 163, 175, 0.3)',
            domingo: 'background-color: rgba(156, 163, 175, 0.3)',
            sabado: 'background-color: rgba(156, 163, 175, 0.3)',
            futuro: 'background-color: rgba(229, 231, 235, 0.3)'
          };
          return map[status] || '';
        };

        const cellTitle = (status) => {
          const map = {
            presente: 'Presente',
            atrasado: 'Atrasado',
            falta: 'Falta',
            feriado: 'Feriado',
            domingo: 'Domingo',
            sabado: 'Sábado',
            futuro: '-'
          };
          return map[status] || '';
        };

        document.getElementById('presenca-heatmap').innerHTML = `
          <table class="table table-sm table-bordered mb-0 text-center presenca-heatmap-table">
            <thead>
              <tr>
                <th class="text-start" style="min-width:120px">Funcionário</th>
                ${days.map(d => '<th style="padding:2px 4px">' + d + '</th>').join('')}
              </tr>
            </thead>
            <tbody>
              ${funcIds.map(fid => `
                <tr>
                  <td class="text-start text-nowrap"><strong>${funcNames[fid] || fid}</strong></td>
                  ${days.map(d => {
                    const status = heatmapMap[fid + '-' + d] || '';
                    return '<td style="' + cellColor(status) + ';padding:2px 4px" title="' + cellTitle(status) + '">&nbsp;</td>';
                  }).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="d-flex gap-3 p-2 small text-muted flex-wrap">
            <span><span style="display:inline-block;width:12px;height:12px;background:rgba(34,197,94,0.6);border-radius:2px"></span> Presente</span>
            <span><span style="display:inline-block;width:12px;height:12px;background:rgba(245,158,11,0.6);border-radius:2px"></span> Atrasado</span>
            <span><span style="display:inline-block;width:12px;height:12px;background:rgba(239,68,68,0.6);border-radius:2px"></span> Falta</span>
            <span><span style="display:inline-block;width:12px;height:12px;background:rgba(156,163,175,0.3);border-radius:2px"></span> Fim de semana/Feriado</span>
          </div>`;
      } else {
        document.getElementById('presenca-heatmap').innerHTML = '<div class="empty-state"><i class="bi bi-grid-3x3"></i><p>Nenhum dado para o período</p></div>';
      }

    } catch (err) {
      showToast('Erro ao carregar dados mensais: ' + err.message, 'danger');
    }
  }

  // ============================================================
  // WHATSAPP
  // ============================================================
  async function renderWhatsApp() {
    const content = document.getElementById('page-content');
    try {
      const status = await api('/api/whatsapp/status');
      const isConnected = status.status === 'connected';
      const isInitializing = status.status === 'initializing';
      const statusColor = isConnected ? 'success' : isInitializing ? 'info' : status.status === 'waiting_qr' ? 'warning' : 'danger';
      const statusText = isConnected ? 'Conectado' : isInitializing ? 'Conectando...' : status.status === 'waiting_qr' ? 'Aguardando QR Code' : 'Desconectado';

      content.innerHTML = `
        <div class="row g-3 mb-4">
          <div class="col-md-6">
            <div class="stat-card">
              <div class="stat-icon icon-${isConnected ? 'green' : 'red'}"><i class="bi bi-whatsapp"></i></div>
              <div class="stat-value"><span class="badge bg-${statusColor} fs-6">${statusText}</span></div>
              <div class="stat-label">Status da Conexao</div>
            </div>
          </div>
          <div class="col-md-6">
            <div class="stat-card">
              <div class="stat-icon icon-blue"><i class="bi bi-people"></i></div>
              <div class="stat-value">${status.group ? 'Sim' : 'Nao'}</div>
              <div class="stat-label">Grupo Encontrado</div>
            </div>
          </div>
        </div>

        <div class="summary-card mb-4">
          <h5><i class="bi bi-qr-code me-2"></i>QR Code / Conexao</h5>
          ${isConnected
            ? '<div class="text-center py-4"><i class="bi bi-check-circle text-success" style="font-size:3rem;"></i><p class="mt-2 text-success fw-bold">WhatsApp conectado e monitorando o grupo!</p></div>'
            : isInitializing
            ? '<div class="text-center py-4"><div class="spinner-border text-info" role="status"></div><p class="mt-2 text-info fw-bold">Conectando ao WhatsApp...</p></div>'
            : `<div class="text-center py-3">
                <p>Escaneie o QR Code para conectar o WhatsApp ao sistema.</p>
                <div class="d-flex justify-content-center gap-2">
                  <a href="/api/whatsapp/qr" target="_blank" class="btn btn-success">
                    <i class="bi bi-qr-code me-1"></i> Abrir QR Code
                  </a>
                  ${status.status === 'disconnected' ? `<button class="btn btn-warning" onclick="App.reconnectWhatsApp()">
                    <i class="bi bi-arrow-clockwise me-1"></i> Reconectar
                  </button>` : ''}
                </div>
              </div>`
          }
        </div>

        ${isConnected ? `
        <div class="summary-card mb-4">
          <h5><i class="bi bi-send me-2"></i>Enviar Mensagem de Teste</h5>
          <div class="input-group">
            <input type="text" class="form-control" id="wa-test-msg" placeholder="Digite uma mensagem..." value="Teste do bot de controle de ponto!">
            <button class="btn btn-success" onclick="App.sendWhatsAppTest()">
              <i class="bi bi-send"></i> Enviar
            </button>
          </div>
        </div>` : ''}

        <div class="summary-card">
          <h5><i class="bi bi-info-circle me-2"></i>Como Funciona</h5>
          <ul class="mb-0">
            <li>Funcionarios enviam mensagens no grupo do WhatsApp</li>
            <li><strong>Entrada:</strong> cheguei, bom dia, chegando, entrada, presente</li>
            <li><strong>Saida:</strong> fui, saindo, tchau, indo embora, ate amanha</li>
            <li>O bot identifica o funcionario pelo telefone ou nome</li>
            <li>Se nao encontrar cadastro, cria automaticamente</li>
            <li>Todas as mensagens do grupo sao armazenadas</li>
          </ul>
        </div>`;
    } catch (err) {
      content.innerHTML = `<div class="alert alert-danger">Erro: ${err.message}</div>`;
    }
  }

  async function sendWhatsAppTest() {
    const msg = document.getElementById('wa-test-msg').value;
    if (!msg) { showToast('Digite uma mensagem', 'warning'); return; }
    try {
      await api('/api/whatsapp/test', { method: 'POST', body: JSON.stringify({ message: msg }) });
      showToast('Mensagem enviada no grupo!');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  async function reconnectWhatsApp() {
    try {
      showToast('Iniciando reconexao...', 'info');
      await api('/api/whatsapp/reconnect', { method: 'POST' });
      showToast('Reconexao iniciada! Aguarde...');
      setTimeout(() => renderWhatsApp(), 3000);
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  // ============================================================
  // USUARIOS (admin only)
  // ============================================================
  async function renderUsuarios() {
    const content = document.getElementById('page-content');
    if (currentUser.role !== 'admin') {
      content.innerHTML = '<div class="alert alert-danger">Acesso restrito a administradores</div>';
      return;
    }
    try {
      const users = await api('/api/auth/users');
      content.innerHTML = `
        <div class="page-header">
          <h3><i class="bi bi-person-gear me-2"></i>${users.length} usuário(s)</h3>
          <button class="btn btn-primary btn-sm" onclick="App.openUsuarioModal()">
            <i class="bi bi-plus-lg"></i> Novo Usuário
          </button>
        </div>
        <div class="data-table">
          <table class="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Criado em</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td><strong>${u.name}</strong></td>
                  <td>${u.email}</td>
                  <td><span class="badge bg-${u.role === 'admin' ? 'danger' : u.role === 'gestor' ? 'warning text-dark' : 'secondary'}">${u.role}</span></td>
                  <td><span class="badge-status badge-${u.active ? 'ativo' : 'inativo'}">${u.active ? 'Ativo' : 'Inativo'}</span></td>
                  <td>${formatDate(u.created_at ? u.created_at.split(' ')[0] || u.created_at.split('T')[0] : '')}</td>
                  <td class="text-nowrap">
                    <button class="btn btn-action btn-outline-primary" onclick="App.openUsuarioModal(${u.id})" title="Editar"><i class="bi bi-pencil"></i></button>
                    ${u.id !== currentUser.id && u.active ? `<button class="btn btn-action btn-outline-danger ms-1" onclick="App.deleteUsuario(${u.id}, '${u.name.replace(/'/g, "\\'")}')" title="Desativar"><i class="bi bi-person-x"></i></button>` : ''}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    } catch (err) {
      content.innerHTML = `<div class="alert alert-danger">Erro: ${err.message}</div>`;
    }
  }

  function openUsuarioModal(id) {
    const isEdit = !!id;
    const body = `
      <form id="user-form">
        <div class="mb-3">
          <label class="form-label">Nome</label>
          <input type="text" class="form-control" id="user-name-input" required>
        </div>
        <div class="mb-3">
          <label class="form-label">Email</label>
          <input type="email" class="form-control" id="user-email-input" required>
        </div>
        <div class="mb-3">
          <label class="form-label">${isEdit ? 'Nova Senha (deixe em branco para manter)' : 'Senha'}</label>
          <input type="password" class="form-control" id="user-password-input" ${isEdit ? '' : 'required'} minlength="6">
        </div>
        <div class="mb-3">
          <label class="form-label">Role</label>
          <select class="form-select" id="user-role-input" required>
            <option value="viewer">Viewer</option>
            <option value="gestor">Gestor</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        ${isEdit ? `
        <div class="mb-3">
          <label class="form-label">Status</label>
          <select class="form-select" id="user-active-input">
            <option value="1">Ativo</option>
            <option value="0">Inativo</option>
          </select>
        </div>` : ''}
      </form>`;

    const footer = `
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary" onclick="App.saveUsuario(${id || 'null'})">Salvar</button>`;

    openModal(isEdit ? 'Editar Usuário' : 'Novo Usuário', body, footer);

    if (isEdit) {
      api('/api/auth/users').then(users => {
        const u = users.find(x => x.id === id);
        if (u) {
          document.getElementById('user-name-input').value = u.name;
          document.getElementById('user-email-input').value = u.email;
          document.getElementById('user-role-input').value = u.role;
          document.getElementById('user-active-input').value = u.active ? '1' : '0';
        }
      });
    }
  }

  async function saveUsuario(id) {
    const data = {
      name: document.getElementById('user-name-input').value,
      email: document.getElementById('user-email-input').value,
      role: document.getElementById('user-role-input').value
    };
    const password = document.getElementById('user-password-input').value;
    if (password) data.password = password;

    if (id) {
      const activeEl = document.getElementById('user-active-input');
      if (activeEl) data.active = parseInt(activeEl.value);
    }

    if (!data.name || !data.email || !data.role) {
      showToast('Preencha todos os campos obrigatórios', 'danger');
      return;
    }
    if (!id && !password) {
      showToast('Senha obrigatória para novo usuário', 'danger');
      return;
    }

    try {
      if (id) {
        await api(`/api/auth/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('Usuário atualizado com sucesso');
      } else {
        await api('/api/auth/users', { method: 'POST', body: JSON.stringify(data) });
        showToast('Usuário criado com sucesso');
      }
      closeModal();
      renderUsuarios();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  function deleteUsuario(id, name) {
    confirmAction(`Deseja desativar o usuário "${name}"?`, async () => {
      try {
        await api(`/api/auth/users/${id}`, { method: 'DELETE' });
        showToast('Usuário desativado com sucesso');
        renderUsuarios();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });
  }

  // ============================================================
  // PERFIL
  // ============================================================
  async function renderPerfil() {
    const content = document.getElementById('page-content');
    const roleBadge = currentUser.role === 'admin' ? 'danger' : currentUser.role === 'gestor' ? 'warning text-dark' : 'secondary';

    content.innerHTML = `
      <div class="row g-4">
        <div class="col-md-6">
          <div class="summary-card">
            <h5><i class="bi bi-person-circle me-2"></i>Informações do Usuário</h5>
            <div class="summary-item"><span class="label">Nome</span><span class="value">${currentUser.name}</span></div>
            <div class="summary-item"><span class="label">Email</span><span class="value">${currentUser.email}</span></div>
            <div class="summary-item"><span class="label">Role</span><span class="value"><span class="badge bg-${roleBadge}">${currentUser.role}</span></span></div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="summary-card">
            <h5><i class="bi bi-key me-2"></i>Alterar Senha</h5>
            <form id="password-form">
              <div class="mb-3">
                <label class="form-label">Senha Atual</label>
                <input type="password" class="form-control" id="profile-current-pw" required>
              </div>
              <div class="mb-3">
                <label class="form-label">Nova Senha</label>
                <input type="password" class="form-control" id="profile-new-pw" required minlength="6">
              </div>
              <div class="mb-3">
                <label class="form-label">Confirmar Nova Senha</label>
                <input type="password" class="form-control" id="profile-confirm-pw" required minlength="6">
              </div>
              <button type="submit" class="btn btn-primary">
                <i class="bi bi-check-lg"></i> Alterar Senha
              </button>
            </form>
          </div>
        </div>
      </div>`;

    document.getElementById('password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword = document.getElementById('profile-current-pw').value;
      const newPassword = document.getElementById('profile-new-pw').value;
      const confirmPassword = document.getElementById('profile-confirm-pw').value;

      if (newPassword !== confirmPassword) {
        showToast('As senhas não coincidem', 'danger');
        return;
      }
      try {
        await api('/api/auth/password', {
          method: 'PUT',
          body: JSON.stringify({ currentPassword, newPassword })
        });
        showToast('Senha alterada com sucesso');
        document.getElementById('password-form').reset();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });
  }

  // ============================================================
  // AUDIT LOG (admin only)
  // ============================================================
  async function renderAuditLog() {
    const content = document.getElementById('page-content');
    if (currentUser.role !== 'admin') {
      content.innerHTML = '<div class="alert alert-danger">Acesso restrito a administradores</div>';
      return;
    }

    let users = [];
    try { users = await api('/api/auth/users'); } catch (e) {}

    content.innerHTML = `
      <div class="filter-bar">
        <div>
          <label class="form-label">Data Início</label>
          <input type="date" class="form-control" id="audit-start">
        </div>
        <div>
          <label class="form-label">Data Fim</label>
          <input type="date" class="form-control" id="audit-end">
        </div>
        <div>
          <label class="form-label">Usuário</label>
          <select class="form-select" id="audit-user">
            <option value="">Todos</option>
            ${users.map(u => `<option value="${u.id}">${u.name}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="form-label">Entidade</label>
          <select class="form-select" id="audit-entity">
            <option value="">Todas</option>
            <option value="user">Usuário</option>
            <option value="funcionario">Funcionário</option>
            <option value="registro">Registro</option>
            <option value="feriado">Feriado</option>
          </select>
        </div>
        <div>
          <button class="btn btn-primary" onclick="App.loadAuditLog()">
            <i class="bi bi-search"></i> Buscar
          </button>
        </div>
      </div>
      <div id="audit-table"></div>`;

    loadAuditLog();
  }

  let auditPage = 1;
  async function loadAuditLog(page) {
    if (page) auditPage = page;
    const container = document.getElementById('audit-table');
    container.innerHTML = '<div class="loading-spinner"><div class="spinner-border spinner-border-sm text-primary"></div></div>';

    const startDate = document.getElementById('audit-start').value;
    const endDate = document.getElementById('audit-end').value;
    const userId = document.getElementById('audit-user').value;
    const entityType = document.getElementById('audit-entity').value;

    let url = `/api/auth/audit-log?page=${auditPage}`;
    if (startDate) url += `&startDate=${startDate}`;
    if (endDate) url += `&endDate=${endDate}`;
    if (userId) url += `&userId=${userId}`;
    if (entityType) url += `&entityType=${entityType}`;

    try {
      const data = await api(url);
      const actionLabels = {
        create: '<span class="badge bg-success">Criar</span>',
        update: '<span class="badge bg-warning text-dark">Editar</span>',
        delete: '<span class="badge bg-danger">Excluir</span>',
        login: '<span class="badge bg-info">Login</span>',
        password_change: '<span class="badge bg-secondary">Senha</span>',
        sync: '<span class="badge bg-primary">Sync</span>'
      };

      container.innerHTML = `
        <div class="data-table">
          <table class="table">
            <thead>
              <tr>
                <th>Data/Hora</th>
                <th>Usuário</th>
                <th>Ação</th>
                <th>Entidade</th>
                <th>ID</th>
                <th>Detalhes</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              ${data.logs.length === 0 ? '<tr><td colspan="7" class="text-center text-muted py-4">Nenhum registro encontrado</td></tr>' : ''}
              ${data.logs.map(log => {
                let details = '';
                try { details = log.details ? JSON.stringify(JSON.parse(log.details), null, 0).substring(0, 80) : '-'; } catch(e) { details = log.details || '-'; }
                return `
                  <tr>
                    <td class="text-nowrap">${log.created_at || '-'}</td>
                    <td>${log.user_name || '-'}</td>
                    <td>${actionLabels[log.action] || log.action}</td>
                    <td>${log.entity_type || '-'}</td>
                    <td>${log.entity_id || '-'}</td>
                    <td><small class="text-muted">${details}</small></td>
                    <td><small>${log.ip_address || '-'}</small></td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        ${data.pages > 1 ? `
        <nav class="mt-3">
          <ul class="pagination justify-content-center">
            <li class="page-item ${data.page <= 1 ? 'disabled' : ''}">
              <a class="page-link" href="#" onclick="App.loadAuditLog(${data.page - 1}); return false;">Anterior</a>
            </li>
            <li class="page-item disabled"><span class="page-link">Página ${data.page} de ${data.pages}</span></li>
            <li class="page-item ${data.page >= data.pages ? 'disabled' : ''}">
              <a class="page-link" href="#" onclick="App.loadAuditLog(${data.page + 1}); return false;">Próxima</a>
            </li>
          </ul>
        </nav>` : ''}`;
    } catch (err) {
      container.innerHTML = `<div class="alert alert-danger">Erro: ${err.message}</div>`;
    }
  }

  // ============================================================
  // Public API (for onclick handlers in HTML)
  // ============================================================
  window.App = {
    openFuncionarioModal: openFuncionarioModal,
    saveFuncionario: saveFuncionario,
    deleteFuncionario: deleteFuncionario,
    openRegistroModal: openRegistroModal,
    saveRegistro: saveRegistro,
    deleteRegistro: deleteRegistro,
    filterRegistros: filterRegistros,
    loadRelatorio: loadRelatorio,
    exportExcel: exportExcel,
    exportPDF: exportPDF,
    loadFeriados: loadFeriados,
    openFeriadoModal: openFeriadoModal,
    saveFeriado: saveFeriado,
    deleteFeriado: deleteFeriado,
    sendWhatsAppTest: sendWhatsAppTest,
    reconnectWhatsApp: reconnectWhatsApp,
    openUsuarioModal: openUsuarioModal,
    saveUsuario: saveUsuario,
    deleteUsuario: deleteUsuario,
    loadAuditLog: loadAuditLog,
    showLocationMap: showLocationMap,
    syncFeriados: syncFeriados,
    loadGraficos: loadGraficos,
    loadPresencaMensal: loadPresencaMensal
  };

  // --- Init ---
  checkAuth();

})();
