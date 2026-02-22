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
      whatsapp: 'WhatsApp'
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

      content.innerHTML = `
        <div class="page-header">
          <h3><i class="bi bi-people me-2"></i>${funcionarios.length} funcionário(s)</h3>
          <div class="d-flex gap-2 align-items-center">
            ${inactiveCount > 0 ? `<button class="btn btn-sm ${showInactive ? 'btn-secondary' : 'btn-outline-secondary'}" id="btn-toggle-inactive">
              <i class="bi bi-eye${showInactive ? '-slash' : ''}"></i> ${showInactive ? 'Ocultar' : 'Mostrar'} inativos (${inactiveCount})
            </button>` : ''}
            ${isAdmin ? '<button class="btn btn-primary btn-sm" onclick="App.openFuncionarioModal()"><i class="bi bi-plus-lg"></i> Novo Funcionário</button>' : ''}
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
                <th>Status</th>
                ${isAdmin ? '<th>Ações</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${funcionarios.length === 0 ? `<tr><td colspan="${isAdmin ? 6 : 5}" class="text-center text-muted py-4">Nenhum funcionário cadastrado</td></tr>` : ''}
              ${funcionarios.map(f => `
                <tr>
                  <td><strong>${f.nome}</strong></td>
                  <td>${f.cargo}</td>
                  <td>${formatCurrency(f.salario_hora)}</td>
                  <td>${f.telefone || '-'}</td>
                  <td><span class="badge-status badge-${f.status}">${f.status === 'ativo' ? 'Ativo' : 'Inativo'}</span></td>
                  ${isAdmin ? `
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
        document.getElementById('func-status').value = f.status;
      });
    }
  }

  async function saveFuncionario(id) {
    const data = {
      nome: document.getElementById('func-nome').value,
      cargo: document.getElementById('func-cargo').value,
      salario_hora: parseFloat(document.getElementById('func-salario').value),
      telefone: document.getElementById('func-telefone').value || null
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
                <th>Obs.</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${registros.length === 0 ? '<tr><td colspan="8" class="text-center text-muted py-4">Nenhum registro encontrado</td></tr>' : ''}
              ${registros.map(r => `
                <tr>
                  <td><strong>${r.funcionario_nome}</strong></td>
                  <td>${r.cargo}</td>
                  <td>${formatDate(r.data)}</td>
                  <td>${r.entrada || '-'}</td>
                  <td>${r.saida || '-'}</td>
                  <td><span class="badge bg-${r.tipo === 'whatsapp' ? 'success' : 'secondary'} bg-opacity-10 text-${r.tipo === 'whatsapp' ? 'success' : 'secondary'}">${r.tipo}</span></td>
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

  async function openRegistroModal(id) {
    const isEdit = !!id;
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
    }
  }

  async function saveRegistro(id) {
    const data = {
      funcionario_id: parseInt(document.getElementById('reg-funcionario').value),
      data: document.getElementById('reg-data').value,
      entrada: document.getElementById('reg-entrada').value || null,
      saida: document.getElementById('reg-saida').value || null,
      observacao: document.getElementById('reg-obs').value || null
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
          <div class="ms-auto">
            <button class="btn btn-success btn-sm" onclick="App.openFeriadoModal()">
              <i class="bi bi-plus-lg"></i> Novo Feriado
            </button>
          </div>` : ''}
      </div>
      <div id="feriados-table"></div>`;

    loadFeriados();
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
  // WHATSAPP
  // ============================================================
  async function renderWhatsApp() {
    const content = document.getElementById('page-content');
    try {
      const status = await api('/api/whatsapp/status');
      const isConnected = status.status === 'connected';
      const statusColor = isConnected ? 'success' : status.status === 'waiting_qr' ? 'warning' : 'danger';
      const statusText = isConnected ? 'Conectado' : status.status === 'waiting_qr' ? 'Aguardando QR Code' : 'Desconectado';

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
            : `<div class="text-center py-3">
                <p>Escaneie o QR Code para conectar o WhatsApp ao sistema.</p>
                <a href="/api/whatsapp/qr" target="_blank" class="btn btn-success">
                  <i class="bi bi-qr-code me-1"></i> Abrir QR Code
                </a>
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
    sendWhatsAppTest: sendWhatsAppTest
  };

  // --- Init ---
  checkAuth();

})();
