// ============================================================
// Lar Digital - Gestão da Casa - SPA Frontend
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
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function formatDate(d) {
    if (!d) return '-';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  }

  function formatCurrency(v) {
    return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
  }

  function maskPhone(value) {
    const nums = (value || '').replace(/\D/g, '').slice(0, 11);
    if (nums.length === 0) return '';
    if (nums.length <= 2) return '(' + nums;
    if (nums.length <= 7) return '(' + nums.slice(0,2) + ') ' + nums.slice(2);
    return '(' + nums.slice(0,2) + ') ' + nums.slice(2,7) + '-' + nums.slice(7);
  }

  function formatPhone(value) {
    if (!value) return '-';
    return maskPhone(value);
  }

  function applyPhoneMask(inputId) {
    const el = document.getElementById(inputId);
    if (el) el.addEventListener('input', () => { el.value = maskPhone(el.value); });
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
    // Load version
    fetch('/api/version').then(r => r.json()).then(v => {
      const el = document.getElementById('app-version');
      if (el && v.version) {
        const envLabel = v.env ? v.env.charAt(0).toUpperCase() + v.env.slice(1) : '';
        const dateLabel = v.date ? v.date.split('-').reverse().join('/') : '';
        el.textContent = 'v' + v.version + (envLabel ? ' | ' + envLabel : '') + (dateLabel ? ' | ' + dateLabel : '');
      }
    }).catch(() => {});
  }

  function logout() {
    // Log logout before clearing token
    if (token) {
      fetch('/api/auth/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }).catch(() => {});
    }
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

  // --- Forgot Password ---
  document.getElementById('forgot-password-link').addEventListener('click', (e) => {
    e.preventDefault();
    const form = document.getElementById('forgot-password-form');
    form.classList.toggle('d-none');
    document.getElementById('forgot-step1').classList.remove('d-none');
    document.getElementById('forgot-step2').classList.add('d-none');
    document.getElementById('forgot-message').classList.add('d-none');
  });

  document.getElementById('forgot-send-btn').addEventListener('click', async () => {
    const email = document.getElementById('forgot-email').value;
    const msgEl = document.getElementById('forgot-message');
    const btn = document.getElementById('forgot-send-btn');
    if (!email) { msgEl.textContent = 'Informe o email'; msgEl.className = 'small mt-2 text-danger'; return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Enviando...';
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (res.status === 429) {
        msgEl.textContent = data.error;
        msgEl.className = 'small mt-2 text-danger';
        btn.disabled = false;
        btn.textContent = 'Enviar código';
        return;
      }
      msgEl.textContent = 'Se o email existir, um código foi enviado.';
      msgEl.className = 'small mt-2 text-success';
      document.getElementById('forgot-step1').classList.add('d-none');
      document.getElementById('forgot-step2').classList.remove('d-none');
      // Countdown 60s on button (in case user goes back)
      let secs = 60;
      btn.textContent = `Reenviar em ${secs}s...`;
      const countdown = setInterval(() => {
        secs--;
        if (secs <= 0) { clearInterval(countdown); btn.disabled = false; btn.textContent = 'Enviar código'; }
        else btn.textContent = `Reenviar em ${secs}s...`;
      }, 1000);
    } catch (err) {
      msgEl.textContent = 'Erro ao enviar. Tente novamente.';
      msgEl.className = 'small mt-2 text-danger';
      btn.disabled = false;
      btn.textContent = 'Enviar código';
    }
  });

  document.getElementById('forgot-reset-btn').addEventListener('click', async () => {
    const email = document.getElementById('forgot-email').value;
    const code = document.getElementById('forgot-code').value;
    const newPassword = document.getElementById('forgot-new-password').value;
    const msgEl = document.getElementById('forgot-message');
    if (!code || !newPassword) { msgEl.textContent = 'Preencha código e nova senha'; msgEl.className = 'small mt-2 text-danger'; return; }
    if (newPassword.length < 6) { msgEl.textContent = 'Senha deve ter no mínimo 6 caracteres'; msgEl.className = 'small mt-2 text-danger'; return; }
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword })
      });
      const data = await res.json();
      if (res.ok) {
        msgEl.textContent = 'Senha redefinida com sucesso! Faça login.';
        msgEl.className = 'small mt-2 text-success';
        document.getElementById('forgot-password-form').classList.add('d-none');
      } else {
        msgEl.textContent = data.error || 'Código inválido ou expirado';
        msgEl.className = 'small mt-2 text-danger';
      }
    } catch (err) {
      msgEl.textContent = 'Erro ao redefinir senha';
      msgEl.className = 'small mt-2 text-danger';
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
      auditlog: 'Log de Auditoria',
      tarefas: 'Tarefas',
      accesslog: 'Log de Acessos'
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
      case 'insights': renderInsightsIA(); break;
      case 'cargos': renderCargos(); break;
      case 'veiculos': renderVeiculos(); break;
      case 'documentos': renderDocumentos(); break;
      case 'entregas': renderEntregas(); break;
      case 'tarefas': renderTarefas(); break;
      case 'accesslog': renderAccessLog(); break;
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
                  <td class="d-flex align-items-center gap-2">${f.foto ? '<img src="' + f.foto + '" class="rounded-circle" style="width:32px;height:32px;object-fit:cover" alt="">' : '<i class="bi bi-person-circle text-muted" style="font-size:1.5rem"></i>'}<strong>${f.nome}</strong></td>
                  <td>${f.cargo_nome || f.cargo || '-'}</td>
                  <td>${formatCurrency(f.salario_hora_display || f.salario_hora)}</td>
                  <td>${formatPhone(f.telefone)}</td>
                  <td>${f.horario_entrada || '08:00'}</td>
                  <td><span class="badge-status badge-${f.status}">${f.status === 'ativo' ? 'Ativo' : 'Inativo'}</span></td>
                  ${canManage ? `
                    <td class="text-nowrap">
                      <button class="btn btn-action btn-outline-primary btn-edit-func" data-id="${f.id}" title="Editar"><i class="bi bi-pencil"></i></button>
                      ${f.telefone ? `<button class="btn btn-action btn-outline-success ms-1" onclick="App.openChatModal(${f.id}, '${f.nome.replace(/'/g, "\\'")}')" title="Chat WhatsApp"><i class="bi bi-chat-dots"></i></button>` : ''}
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

    const ufs = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

    const body = `
      <form id="func-form">
        <h6 class="text-muted mb-2"><i class="bi bi-person me-1"></i>Dados Pessoais</h6>
        <div class="row">
          <div class="col-md-6 mb-3">
            <label class="form-label">Nome <span class="text-danger">*</span></label>
            <input type="text" class="form-control" id="func-nome" required>
          </div>
          <div class="col-md-6 mb-3">
            <label class="form-label">Cargo <span class="text-danger">*</span></label>
            <select class="form-select" id="func-cargo" required>
              <option value="">Selecione...</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div class="col-md-4 mb-3">
            <label class="form-label">Telefone</label>
            <input type="text" class="form-control" id="func-telefone" placeholder="(11) 99999-0000">
          </div>
          <div class="col-md-4 mb-3">
            <label class="form-label">Email Pessoal</label>
            <input type="email" class="form-control" id="func-email-pessoal" placeholder="email@exemplo.com">
          </div>
          <div class="col-md-4 mb-3">
            <label class="form-label">Salário/Hora (R$) <span class="text-danger">*</span></label>
            <input type="number" class="form-control" id="func-salario" step="0.01" min="0" required>
          </div>
        </div>

        <hr><h6 class="text-muted mb-2"><i class="bi bi-card-text me-1"></i>Documentos</h6>
        <div class="row">
          <div class="col-md-4 mb-3">
            <label class="form-label">CPF</label>
            <div class="input-group">
              <input type="text" class="form-control" id="func-cpf" placeholder="000.000.000-00" maxlength="14">
              <button class="btn btn-outline-primary" type="button" id="btn-enrich-cpf" title="Buscar dados por CPF (BigDataCorp)">
                <i class="bi bi-search"></i>
              </button>
            </div>
          </div>
          <div class="col-md-4 mb-3">
            <label class="form-label">RG</label>
            <input type="text" class="form-control" id="func-rg">
          </div>
          <div class="col-md-4 mb-3">
            <label class="form-label">Data de Nascimento</label>
            <input type="date" class="form-control" id="func-data-nascimento">
          </div>
        </div>

        <hr><h6 class="text-muted mb-2"><i class="bi bi-calendar3 me-1"></i>Datas</h6>
        <div class="row">
          <div class="col-md-3 mb-3">
            <label class="form-label">Admissão</label>
            <input type="date" class="form-control" id="func-data-admissao">
          </div>
          <div class="col-md-3 mb-3">
            <label class="form-label">Início Trabalho</label>
            <input type="date" class="form-control" id="func-data-inicio-trabalho">
          </div>
          <div class="col-md-3 mb-3">
            <label class="form-label">Registro Carteira</label>
            <input type="date" class="form-control" id="func-data-inicio-registro-carteira">
          </div>
          <div class="col-md-3 mb-3">
            <label class="form-label">Desligamento</label>
            <input type="date" class="form-control" id="func-data-desligamento">
          </div>
        </div>

        <hr><h6 class="text-muted mb-2"><i class="bi bi-geo-alt me-1"></i>Endereço</h6>
        <div class="row">
          <div class="col-md-3 mb-3">
            <label class="form-label">CEP</label>
            <input type="text" class="form-control" id="func-endereco-cep" placeholder="00000-000" maxlength="9">
          </div>
          <div class="col-md-6 mb-3">
            <label class="form-label">Rua</label>
            <input type="text" class="form-control" id="func-endereco-rua">
          </div>
          <div class="col-md-3 mb-3">
            <label class="form-label">Número</label>
            <input type="text" class="form-control" id="func-endereco-numero">
          </div>
        </div>
        <div class="row">
          <div class="col-md-3 mb-3">
            <label class="form-label">Complemento</label>
            <input type="text" class="form-control" id="func-endereco-complemento">
          </div>
          <div class="col-md-3 mb-3">
            <label class="form-label">Bairro</label>
            <input type="text" class="form-control" id="func-endereco-bairro">
          </div>
          <div class="col-md-3 mb-3">
            <label class="form-label">Cidade</label>
            <input type="text" class="form-control" id="func-endereco-cidade">
          </div>
          <div class="col-md-3 mb-3">
            <label class="form-label">Estado</label>
            <select class="form-select" id="func-endereco-estado">
              <option value="">UF</option>
              ${ufs.map(u => '<option value="' + u + '">' + u + '</option>').join('')}
            </select>
          </div>
        </div>

        <hr><h6 class="text-muted mb-2"><i class="bi bi-telephone me-1"></i>Contatos Adicionais</h6>
        <div class="row">
          <div class="col-md-4 mb-3">
            <label class="form-label">Telefone 2</label>
            <input type="text" class="form-control" id="func-telefone-contato2" placeholder="(11) 99999-0000">
          </div>
          <div class="col-md-4 mb-3">
            <label class="form-label">Contato Emergência</label>
            <input type="text" class="form-control" id="func-nome-contato-emergencia" placeholder="Nome do contato">
          </div>
          <div class="col-md-4 mb-3">
            <label class="form-label">Tel. Emergência</label>
            <input type="text" class="form-control" id="func-telefone-emergencia" placeholder="(11) 99999-0000">
          </div>
        </div>

        <hr><h6 class="text-muted mb-2"><i class="bi bi-camera me-1"></i>Foto</h6>
        <div class="row align-items-center">
          <div class="col-md-3 mb-3 text-center">
            <div id="func-foto-preview">
              <i class="bi bi-person-circle" style="font-size:4rem;color:#ccc"></i>
            </div>
          </div>
          <div class="col-md-9 mb-3">
            <input type="file" class="form-control" id="func-foto-input" accept="image/*">
            <small class="text-muted">JPG, PNG ou WebP. Máx 10MB.</small>
          </div>
        </div>

        <hr><h6 class="text-muted mb-2"><i class="bi bi-wallet2 me-1"></i>Folha de Pagamento</h6>
        <div class="row">
          <div class="col-md-3 mb-3">
            <label class="form-label">Hora Extra (R$)</label>
            <input type="number" class="form-control" id="func-valor-hora-extra" step="0.01" min="0" placeholder="Herda do cargo">
          </div>
          <div class="col-md-3 mb-3">
            <label class="form-label">Dia Especial (R$)</label>
            <input type="number" class="form-control" id="func-valor-dia-especial" step="0.01" min="0" placeholder="Herda do cargo">
          </div>
          <div class="col-md-3 mb-3">
            <label class="form-label">Jornada Diária (h)</label>
            <input type="number" class="form-control" id="func-jornada-diaria" step="0.01" min="0" value="9.8">
          </div>
          <div class="col-md-3 mb-3">
            <label class="form-label">Horário Entrada</label>
            <input type="time" class="form-control" id="func-horario-entrada" value="08:00">
          </div>
        </div>
        <div class="row">
          <div class="col-md-6 mb-3">
            <div class="form-check form-switch"><input type="checkbox" class="form-check-input" id="func-contabiliza-he"><label class="form-check-label" for="func-contabiliza-he">Contabiliza hora extra</label></div>
            <div class="form-check form-switch"><input type="checkbox" class="form-check-input" id="func-recebe-vt"><label class="form-check-label" for="func-recebe-vt">Recebe vale transporte</label></div>
            <div class="form-check form-switch"><input type="checkbox" class="form-check-input" id="func-recebe-va"><label class="form-check-label" for="func-recebe-va">Recebe vale alimentação</label></div>
            <div class="form-check form-switch"><input type="checkbox" class="form-check-input" id="func-recebe-combustivel"><label class="form-check-label" for="func-recebe-combustivel">Recebe ajuda combustível</label></div>
          </div>
          <div class="col-md-3 mb-3">
            <label class="form-label">VA/dia (R$)</label>
            <input type="number" class="form-control" id="func-valor-va-dia" step="0.01" min="0" placeholder="Herda do cargo">
          </div>
          <div class="col-md-3 mb-3">
            <label class="form-label">Combustível (R$)</label>
            <input type="number" class="form-control" id="func-valor-combustivel" step="0.01" min="0" placeholder="Herda do cargo">
          </div>
        </div>

        <hr><h6 class="text-muted mb-2"><i class="bi bi-qr-code me-1"></i>PIX</h6>
        <div class="row">
          <div class="col-md-3 mb-3">
            <label class="form-label">Tipo PIX</label>
            <select class="form-select" id="func-pix-tipo">
              <option value="">Não cadastrado</option>
              <option value="cpf">CPF</option>
              <option value="cnpj">CNPJ</option>
              <option value="email">E-mail</option>
              <option value="telefone">Telefone</option>
              <option value="aleatoria">Chave aleatória</option>
            </select>
          </div>
          <div class="col-md-5 mb-3">
            <label class="form-label">Chave PIX</label>
            <input type="text" class="form-control" id="func-pix-chave" placeholder="CPF, e-mail, telefone ou chave aleatória">
          </div>
          <div class="col-md-4 mb-3">
            <label class="form-label">Banco</label>
            <input type="text" class="form-control" id="func-pix-banco" placeholder="Ex: Nubank, Itaú">
          </div>
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

    // Use modal-lg for the expanded form
    const modalEl = document.getElementById('app-modal');
    modalEl.querySelector('.modal-dialog').classList.add('modal-lg');
    modalEl.addEventListener('hidden.bs.modal', function handler() {
      modalEl.querySelector('.modal-dialog').classList.remove('modal-lg');
      modalEl.removeEventListener('hidden.bs.modal', handler);
    });

    openModal(title, body, footer);

    // CPF validation helper
    function validarCPF(cpf) {
      cpf = cpf.replace(/\D/g, '');
      if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
      for (let t = 9; t < 11; t++) {
        let d = 0;
        for (let c = 0; c < t; c++) d += parseInt(cpf.charAt(c)) * ((t + 1) - c);
        d = ((10 * d) % 11) % 10;
        if (parseInt(cpf.charAt(t)) !== d) return false;
      }
      return true;
    }

    // CPF enrichment function (reusable)
    async function enrichCPF(cpfVal, silent) {
      const enrichBtn = document.getElementById('btn-enrich-cpf');
      if (cpfVal.length !== 11 || !validarCPF(cpfVal)) { if (!silent) showToast('CPF inválido', 'warning'); return; }
      if (enrichBtn) { enrichBtn.disabled = true; enrichBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>'; }
      try {
        const resp = await api('/api/funcionarios/enrich-cpf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cpf: cpfVal })
        });
        if (!resp.success) { if (!silent) showToast(resp.message || 'CPF não encontrado', 'warning'); return; }
        const d = resp.data;
        const setIf = (id, val) => { if (val) { const el = document.getElementById(id); if (el && !el.value) el.value = val; } };
        setIf('func-nome', d.nome);
        setIf('func-rg', d.rg);
        setIf('func-data-nascimento', d.data_nascimento);
        setIf('func-email-pessoal', d.email_pessoal);
        if (d.telefone) {
          const tel = document.getElementById('func-telefone');
          if (tel && !tel.value) { tel.value = d.telefone; tel.dispatchEvent(new Event('input')); }
        }
        if (d.endereco_cep) {
          const cep = document.getElementById('func-endereco-cep');
          if (cep && !cep.value) { cep.value = d.endereco_cep; cep.dispatchEvent(new Event('input')); }
        }
        setIf('func-endereco-rua', d.endereco_rua);
        setIf('func-endereco-numero', d.endereco_numero);
        setIf('func-endereco-complemento', d.endereco_complemento);
        setIf('func-endereco-bairro', d.endereco_bairro);
        setIf('func-endereco-cidade', d.endereco_cidade);
        if (d.endereco_estado) {
          const uf = document.getElementById('func-endereco-estado');
          if (uf && !uf.value) uf.value = d.endereco_estado;
        }
        showToast('Dados preenchidos via BigDataCorp', 'success');
      } catch (err) {
        if (!silent) showToast('Erro: ' + err.message, 'danger');
      } finally {
        if (enrichBtn) { enrichBtn.disabled = false; enrichBtn.innerHTML = '<i class="bi bi-search"></i>'; }
      }
    }

    // CPF mask + real-time validation indicator
    const cpfInput = document.getElementById('func-cpf');
    if (cpfInput) {
      cpfInput.addEventListener('input', function() {
        let v = this.value.replace(/\D/g, '').substring(0, 11);
        if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
        else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
        else if (v.length > 3) v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
        this.value = v;
        // Visual validation indicator
        const raw = v.replace(/\D/g, '');
        if (raw.length === 11) {
          this.style.borderColor = validarCPF(raw) ? '#198754' : '#dc3545';
          this.style.boxShadow = validarCPF(raw) ? '0 0 0 0.15rem rgba(25,135,84,.25)' : '0 0 0 0.15rem rgba(220,53,69,.25)';
        } else {
          this.style.borderColor = '';
          this.style.boxShadow = '';
        }
      });
      // Auto-search on blur
      cpfInput.addEventListener('blur', function() {
        const raw = this.value.replace(/\D/g, '');
        if (raw.length === 11 && validarCPF(raw)) {
          const nome = document.getElementById('func-nome');
          const rg = document.getElementById('func-rg');
          if ((!nome || !nome.value) || (!rg || !rg.value)) {
            enrichCPF(raw, true);
          }
        }
      });
    }

    // Enrich CPF button
    const enrichBtn = document.getElementById('btn-enrich-cpf');
    if (enrichBtn) {
      enrichBtn.addEventListener('click', function() {
        const cpfVal = (document.getElementById('func-cpf').value || '').replace(/\D/g, '');
        enrichCPF(cpfVal, false);
      });
    }

    // Apply phone masks
    applyPhoneMask('func-telefone');
    applyPhoneMask('func-telefone-contato2');
    applyPhoneMask('func-telefone-emergencia');

    // CEP auto-fill via ViaCEP
    const cepInput = document.getElementById('func-endereco-cep');
    if (cepInput) {
      cepInput.addEventListener('input', function() {
        let v = this.value.replace(/\D/g, '').substring(0, 8);
        if (v.length > 5) v = v.replace(/(\d{5})(\d{1,3})/, '$1-$2');
        this.value = v;
      });
      cepInput.addEventListener('blur', async function() {
        const cep = this.value.replace(/\D/g, '');
        if (cep.length === 8) {
          try {
            const resp = await fetch('https://viacep.com.br/ws/' + cep + '/json/');
            const data = await resp.json();
            if (!data.erro) {
              const fill = (id, val) => { const el = document.getElementById(id); if (el && !el.value) el.value = val || ''; };
              fill('func-endereco-rua', data.logradouro);
              fill('func-endereco-bairro', data.bairro);
              fill('func-endereco-cidade', data.localidade);
              const estadoEl = document.getElementById('func-endereco-estado');
              if (estadoEl) estadoEl.value = data.uf || '';
            }
          } catch(e) { /* ViaCEP indisponível */ }
        }
      });
    }

    // Load cargos dropdown
    api('/api/cargos').then(cargos => {
      const select = document.getElementById('func-cargo');
      const cargosList = Array.isArray(cargos) ? cargos : [];
      cargosList.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.nome;
        select.appendChild(opt);
      });

      // Auto-fill benefits from cargo when selected (only if employee has no override)
      select.addEventListener('change', function() {
        const cargo = cargosList.find(c => c.id == this.value);
        if (cargo) {
          const fill = (elId, val) => { const el = document.getElementById(elId); if (el && !parseFloat(el.value)) el.value = val || 0; };
          fill('func-valor-hora-extra', cargo.valor_hora_extra);
          fill('func-valor-dia-especial', cargo.valor_dia_extra);
          fill('func-salario', cargo.valor_hora_extra);
          // PIX, VT, VA, combustível fields from cargo
          const fillCheck = (elId, val) => { const el = document.getElementById(elId); if (el) el.checked = !!val; };
          fillCheck('func-contabiliza-he', cargo.permite_hora_extra);
          fillCheck('func-recebe-vt', cargo.recebe_vale_transporte);
          fillCheck('func-recebe-va', cargo.recebe_vale_refeicao);
          fillCheck('func-recebe-combustivel', cargo.recebe_ajuda_combustivel);
          fill('func-valor-combustivel', cargo.valor_ajuda_combustivel);
          fill('func-valor-va-dia', cargo.valor_vale_refeicao);
        }
      });

      if (isEdit) {
        api(`/api/funcionarios/${id}`).then(f => {
          document.getElementById('func-nome').value = f.nome;
          document.getElementById('func-cargo').value = f.cargo_id || '';
          document.getElementById('func-salario').value = f.salario_hora_display || f.salario_hora || 0;
          document.getElementById('func-telefone').value = maskPhone(f.telefone || '');
          document.getElementById('func-email-pessoal').value = f.email_pessoal || '';
          document.getElementById('func-horario-entrada').value = f.horario_entrada || '08:00';
          document.getElementById('func-valor-hora-extra').value = f.valor_hora_extra_display || f.valor_hora_extra || 0;
          document.getElementById('func-valor-dia-especial').value = f.valor_dia_extra_display || f.valor_dia_especial || 0;
          document.getElementById('func-jornada-diaria').value = f.jornada_diaria || 9.8;
          // New fields
          document.getElementById('func-cpf').value = f.cpf || '';
          document.getElementById('func-rg').value = f.rg || '';
          document.getElementById('func-data-nascimento').value = f.data_nascimento || '';
          document.getElementById('func-data-admissao').value = f.data_admissao || '';
          document.getElementById('func-data-inicio-trabalho').value = f.data_inicio_trabalho || '';
          document.getElementById('func-data-inicio-registro-carteira').value = f.data_inicio_registro_carteira || '';
          document.getElementById('func-data-desligamento').value = f.data_desligamento || '';
          document.getElementById('func-endereco-cep').value = f.endereco_cep || '';
          document.getElementById('func-endereco-rua').value = f.endereco_rua || '';
          document.getElementById('func-endereco-numero').value = f.endereco_numero || '';
          document.getElementById('func-endereco-complemento').value = f.endereco_complemento || '';
          document.getElementById('func-endereco-bairro').value = f.endereco_bairro || '';
          document.getElementById('func-endereco-cidade').value = f.endereco_cidade || '';
          document.getElementById('func-endereco-estado').value = f.endereco_estado || '';
          document.getElementById('func-telefone-contato2').value = maskPhone(f.telefone_contato2 || '');
          document.getElementById('func-nome-contato-emergencia').value = f.nome_contato_emergencia || '';
          document.getElementById('func-telefone-emergencia').value = maskPhone(f.telefone_emergencia || '');
          // Benefits checkboxes
          const setCheck = (elId, val) => { const el = document.getElementById(elId); if (el) el.checked = !!val; };
          setCheck('func-contabiliza-he', f.contabiliza_hora_extra);
          setCheck('func-recebe-vt', f.recebe_vt);
          setCheck('func-recebe-va', f.tem_vale_alimentacao);
          setCheck('func-recebe-combustivel', f.recebe_ajuda_combustivel);
          document.getElementById('func-valor-va-dia').value = f.valor_va_dia || 0;
          document.getElementById('func-valor-combustivel').value = f.valor_ajuda_combustivel || 0;
          // PIX fields
          document.getElementById('func-pix-tipo').value = f.pix_tipo || '';
          document.getElementById('func-pix-chave').value = f.pix_chave || '';
          document.getElementById('func-pix-banco').value = f.pix_banco || '';
          // Foto preview
          if (f.foto) {
            document.getElementById('func-foto-preview').innerHTML = '<img src="' + f.foto + '" class="rounded" style="width:80px;height:80px;object-fit:cover" alt="Foto">';
          }
          const statusEl = document.getElementById('func-status');
          if (statusEl) statusEl.value = f.status;
          // Auto-enrich if CPF filled but key fields empty
          if (f.cpf && f.cpf.replace(/\D/g, '').length === 11) {
            const raw = f.cpf.replace(/\D/g, '');
            if ((!f.rg && !f.data_nascimento) || (!f.endereco_rua && !f.endereco_cep)) {
              setTimeout(() => enrichCPF(raw, true), 500);
            }
            // Trigger visual validation
            const ci = document.getElementById('func-cpf');
            if (ci) ci.dispatchEvent(new Event('input'));
          }
        });
      }
    });
  }

  async function saveFuncionario(id) {
    const cargoSelect = document.getElementById('func-cargo');
    const cargoId = parseInt(cargoSelect.value);
    const cargoNome = cargoSelect.options[cargoSelect.selectedIndex]?.text || '';
    const getVal = (elId) => { const el = document.getElementById(elId); return el ? el.value : ''; };
    const data = {
      nome: getVal('func-nome'),
      cargo: cargoNome,
      cargo_id: cargoId || null,
      salario_hora: parseFloat(getVal('func-salario')),
      telefone: (getVal('func-telefone') || '').replace(/\D/g, '') || null,
      email_pessoal: getVal('func-email-pessoal') || null,
      horario_entrada: getVal('func-horario-entrada') || '08:00',
      valor_hora_extra: parseFloat(getVal('func-valor-hora-extra')) || 0,
      valor_dia_especial: parseFloat(getVal('func-valor-dia-especial')) || 0,
      jornada_diaria: parseFloat(getVal('func-jornada-diaria')) || 9.8,
      cpf: getVal('func-cpf') || null,
      rg: getVal('func-rg') || null,
      data_nascimento: getVal('func-data-nascimento') || null,
      data_admissao: getVal('func-data-admissao') || null,
      data_inicio_trabalho: getVal('func-data-inicio-trabalho') || null,
      data_inicio_registro_carteira: getVal('func-data-inicio-registro-carteira') || null,
      data_desligamento: getVal('func-data-desligamento') || null,
      endereco_cep: getVal('func-endereco-cep') || null,
      endereco_rua: getVal('func-endereco-rua') || null,
      endereco_numero: getVal('func-endereco-numero') || null,
      endereco_complemento: getVal('func-endereco-complemento') || null,
      endereco_bairro: getVal('func-endereco-bairro') || null,
      endereco_cidade: getVal('func-endereco-cidade') || null,
      endereco_estado: getVal('func-endereco-estado') || null,
      telefone_contato2: (getVal('func-telefone-contato2') || '').replace(/\D/g, '') || null,
      nome_contato_emergencia: getVal('func-nome-contato-emergencia') || null,
      telefone_emergencia: (getVal('func-telefone-emergencia') || '').replace(/\D/g, '') || null,
      // Benefits
      contabiliza_hora_extra: document.getElementById('func-contabiliza-he')?.checked ? 1 : 0,
      recebe_vt: document.getElementById('func-recebe-vt')?.checked ? 1 : 0,
      tem_vale_alimentacao: document.getElementById('func-recebe-va')?.checked ? 1 : 0,
      recebe_ajuda_combustivel: document.getElementById('func-recebe-combustivel')?.checked ? 1 : 0,
      valor_va_dia: parseFloat(getVal('func-valor-va-dia')) || 0,
      valor_ajuda_combustivel: parseFloat(getVal('func-valor-combustivel')) || 0,
      // PIX
      pix_tipo: getVal('func-pix-tipo') || null,
      pix_chave: getVal('func-pix-chave') || null,
      pix_banco: getVal('func-pix-banco') || null
    };

    // Date cross-validation
    if (data.data_inicio_registro_carteira && data.data_inicio_trabalho && data.data_inicio_registro_carteira < data.data_inicio_trabalho) {
      showToast('Data registro carteira não pode ser anterior ao início do trabalho', 'danger');
      return;
    }
    if (data.data_desligamento && data.data_inicio_trabalho && data.data_desligamento < data.data_inicio_trabalho) {
      showToast('Data desligamento não pode ser anterior ao início do trabalho', 'danger');
      return;
    }

    // CPF validation (if filled)
    if (data.cpf) {
      const cpfDigits = data.cpf.replace(/\D/g, '');
      if (cpfDigits.length === 11) {
        const allSame = cpfDigits.split('').every(d => d === cpfDigits[0]);
        if (allSame) { showToast('CPF inválido', 'danger'); return; }
        const calcDigit = (cpf, len) => { let sum = 0; for (let i = 0; i < len; i++) sum += parseInt(cpf[i]) * (len + 1 - i); const r = 11 - (sum % 11); return r > 9 ? 0 : r; };
        const d1 = calcDigit(cpfDigits, 9);
        const d2 = calcDigit(cpfDigits, 10);
        if (parseInt(cpfDigits[9]) !== d1 || parseInt(cpfDigits[10]) !== d2) { showToast('CPF inválido (dígitos verificadores)', 'danger'); return; }
      }
    }

    if (!data.nome || !cargoId || isNaN(data.salario_hora)) {
      showToast('Preencha todos os campos obrigatórios', 'danger');
      return;
    }

    if (id) {
      const statusEl = document.getElementById('func-status');
      if (statusEl) data.status = statusEl.value;
    }

    try {
      let funcId = id;
      if (id) {
        await api(`/api/funcionarios/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('Funcionário atualizado com sucesso');
      } else {
        const result = await api('/api/funcionarios', { method: 'POST', body: JSON.stringify(data) });
        funcId = result.id;
        showToast('Funcionário criado com sucesso');
      }
      // Upload foto if selected
      const fotoInput = document.getElementById('func-foto-input');
      if (fotoInput && fotoInput.files.length > 0 && funcId) {
        const formData = new FormData();
        formData.append('foto', fotoInput.files[0]);
        const token = localStorage.getItem('ponto_token');
        await fetch(`/api/funcionarios/${funcId}/foto`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token },
          body: formData
        });
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
      const now = new Date();
      const mesAtual = now.getMonth() + 1;
      const anoAtual = now.getFullYear();
      const meses = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

      content.innerHTML = `
        <div class="filter-bar flex-wrap gap-2">
          <div>
            <label class="form-label">Mês</label>
            <select class="form-select" id="reg-filter-mes">
              <option value="">-- Período manual --</option>
              ${meses.slice(1).map((m, i) => `<option value="${i+1}" ${i+1 === mesAtual ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">Ano</label>
            <input type="number" class="form-control" id="reg-filter-ano" value="${anoAtual}" min="2024" max="2030" style="width:90px">
          </div>
          <div>
            <label class="form-label">Data Início</label>
            <input type="date" class="form-control" id="reg-filter-inicio" disabled>
          </div>
          <div>
            <label class="form-label">Data Fim</label>
            <input type="date" class="form-control" id="reg-filter-fim" disabled>
          </div>
          <div>
            <label class="form-label">Funcionário</label>
            <select class="form-select" id="reg-filter-func">
              <option value="">Todos</option>
              ${funcionarios.map(f => `<option value="${f.id}">${f.nome}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">Tipo</label>
            <select class="form-select" id="reg-filter-tipo">
              <option value="">Todos</option>
              <option value="ponto">Entrada/Saída</option>
              <option value="almoco">Almoço</option>
            </select>
          </div>
          <div class="d-flex gap-2 align-items-end">
            <button class="btn btn-primary" onclick="App.filterRegistros()">
              <i class="bi bi-search"></i> Buscar
            </button>
            <button class="btn btn-outline-secondary" onclick="App.filterRegistrosHoje()" title="Filtrar hoje">
              <i class="bi bi-calendar-day"></i> Hoje
            </button>
          </div>
          <div class="ms-auto">
            <button class="btn btn-success" onclick="App.openRegistroModal()">
              <i class="bi bi-plus-lg"></i> Novo Registro
            </button>
          </div>
        </div>
        <div id="registros-table"></div>`;

      // Toggle: mês vs período manual
      const mesSelect = document.getElementById('reg-filter-mes');
      const inicioInput = document.getElementById('reg-filter-inicio');
      const fimInput = document.getElementById('reg-filter-fim');
      mesSelect.addEventListener('change', function() {
        const useMes = this.value !== '';
        inicioInput.disabled = useMes;
        fimInput.disabled = useMes;
        if (useMes) { inicioInput.value = ''; fimInput.value = ''; }
      });
      inicioInput.addEventListener('change', function() {
        if (this.value) { mesSelect.value = ''; fimInput.disabled = false; inicioInput.disabled = false; }
      });

      filterRegistros();
    } catch (err) {
      content.innerHTML = `<div class="alert alert-danger">Erro: ${err.message}</div>`;
    }
  }

  function getBadgeForRegistro(r) {
    const obs = (r.observacao || '').toLowerCase();
    const isAlmocoSaida = obs.includes('saída almoço') || obs.includes('saida almoço') || obs.includes('saída almoco') || obs.includes('saida almoco');
    const isAlmocoRetorno = obs.includes('retorno almoço') || obs.includes('retorno almoco') || obs.includes('volta almoço') || obs.includes('volta almoco');
    let badge = '';
    if (isAlmocoSaida) {
      badge = '<span class="badge bg-warning text-dark">Saída Almoço</span>';
    } else if (isAlmocoRetorno) {
      badge = '<span class="badge bg-warning text-dark">Retorno Almoço</span>';
    } else if (r.entrada && !r.saida) {
      badge = '<span class="badge bg-success">Entrada</span>';
    } else if (r.saida && !r.entrada) {
      badge = '<span class="badge bg-danger">Saída</span>';
    } else if (r.entrada && r.saida) {
      badge = '<span class="badge bg-primary">Completo</span>';
    } else {
      badge = '<span class="badge bg-secondary">-</span>';
    }
    const fonte = r.tipo === 'whatsapp' ? '<span class="badge bg-success bg-opacity-25 text-success ms-1" style="font-size:0.65em">WA</span>' : r.tipo === 'manual' ? '<span class="badge bg-secondary bg-opacity-25 text-secondary ms-1" style="font-size:0.65em">Manual</span>' : '';
    return badge + fonte;
  }

  async function filterRegistros() {
    const container = document.getElementById('registros-table');
    const mesEl = document.getElementById('reg-filter-mes');
    const anoEl = document.getElementById('reg-filter-ano');
    const inicioEl = document.getElementById('reg-filter-inicio');
    const fimEl = document.getElementById('reg-filter-fim');
    const funcId = document.getElementById('reg-filter-func').value;

    let dataInicio, dataFim;
    if (mesEl && mesEl.value) {
      const mes = parseInt(mesEl.value);
      const ano = parseInt(anoEl.value);
      dataInicio = `${ano}-${String(mes).padStart(2,'0')}-01`;
      const lastDay = new Date(ano, mes, 0).getDate();
      dataFim = `${ano}-${String(mes).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    } else if (inicioEl && inicioEl.value) {
      dataInicio = inicioEl.value;
      dataFim = fimEl && fimEl.value ? fimEl.value : dataInicio;
    } else {
      dataInicio = today();
      dataFim = today();
    }

    container.innerHTML = '<div class="loading-spinner"><div class="spinner-border spinner-border-sm text-primary"></div></div>';

    try {
      let url = `/api/registros?dataInicio=${dataInicio}&dataFim=${dataFim}`;
      if (funcId) url += `&funcionarioId=${funcId}`;
      let registros = await api(url);
      const isAdmin = currentUser.role === 'admin';

      // Filter by tipo (ponto vs almoço)
      const tipoFilter = document.getElementById('reg-filter-tipo');
      const tipoVal = tipoFilter ? tipoFilter.value : '';
      if (tipoVal === 'almoco') {
        registros = registros.filter(r => {
          const obs = (r.observacao || '').toLowerCase();
          return obs.includes('almo');
        });
      } else if (tipoVal === 'ponto') {
        registros = registros.filter(r => {
          const obs = (r.observacao || '').toLowerCase();
          return !obs.includes('almo');
        });
      }

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
                  <td>${getBadgeForRegistro(r)}</td>
                  <td>${r.latitude != null && r.longitude != null && isFinite(r.latitude) && isFinite(r.longitude) ? `<a class="location-link" onclick="App.showLocationMap(${parseFloat(r.latitude)}, ${parseFloat(r.longitude)})" title="Ver no mapa"><i class="bi bi-geo-alt-fill"></i></a>` : '<i class="bi bi-geo-alt text-muted"></i>'}</td>
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

  function filterRegistrosHoje() {
    const todayStr = today();
    const mesEl = document.getElementById('reg-filter-mes');
    const anoEl = document.getElementById('reg-filter-ano');
    const inicioEl = document.getElementById('reg-filter-inicio');
    const fimEl = document.getElementById('reg-filter-fim');
    if (mesEl) mesEl.value = '';
    if (inicioEl) { inicioEl.disabled = false; inicioEl.value = todayStr; }
    if (fimEl) { fimEl.disabled = false; fimEl.value = todayStr; }
    filterRegistros();
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
    lat = parseFloat(lat);
    lng = parseFloat(lng);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      showToast('Localização inválida para este registro', 'warning');
      return;
    }
    const body = `<div id="location-detail-map" class="map-container" style="height:350px;"></div>
      <p class="mt-2 text-muted text-center">${lat.toFixed(6)}, ${lng.toFixed(6)}</p>`;
    openModal('Localização do Registro', body, '');
    setTimeout(() => {
      const mapEl = document.getElementById('location-detail-map');
      if (!mapEl) return;
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
        <ul class="nav nav-tabs mb-3" id="rel-tabs">
          <li class="nav-item">
            <a class="nav-link active" href="#" data-tab="mensal">Relatório Mensal</a>
          </li>
          <li class="nav-item">
            <a class="nav-link" href="#" data-tab="folha">Valor dos Pagamentos do Mês</a>
          </li>
        </ul>
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
            <button class="btn btn-primary" id="btn-gerar-rel">
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

      // Tab switching
      let activeRelTab = 'mensal';
      content.querySelectorAll('#rel-tabs .nav-link').forEach(tab => {
        tab.addEventListener('click', (e) => {
          e.preventDefault();
          content.querySelectorAll('#rel-tabs .nav-link').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          activeRelTab = tab.dataset.tab;
          if (activeRelTab === 'folha') {
            loadFolha();
          } else {
            loadRelatorio();
          }
        });
      });

      document.getElementById('btn-gerar-rel').addEventListener('click', () => {
        if (activeRelTab === 'folha') {
          loadFolha();
        } else {
          loadRelatorio();
        }
      });

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
      // Use the SAME folha endpoint so both tabs have identical calculations
      let url = `/api/relatorios/folha?mes=${mes}&ano=${ano}`;
      if (funcId) url += `&funcionarioId=${funcId}`;
      const data = await api(url);

      if (!data.folhas || data.folhas.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="bi bi-clipboard-x"></i><p>Nenhum registro encontrado para o período</p></div>';
        return;
      }

      // Filter out entries with no registros
      const folhas = data.folhas.filter(f => (f.registros || []).length > 0);
      if (folhas.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="bi bi-clipboard-x"></i><p>Nenhum registro encontrado para o período</p></div>';
        return;
      }

      const showHECol = folhas.some(f => f.funcionario && f.funcionario.permiteHE !== false);
      const totalExtrasGeral = folhas.reduce((s, f) => s + (f.resumo.totalGeral || 0), 0);
      const totalHEGeral = folhas.reduce((s, f) => s + (f.funcionario.permiteHE !== false ? (f.resumo.totalHorasExtras || 0) : 0), 0);

      let html = `
        <div class="row g-3 mb-4">
          <div class="col-md-3">
            <div class="stat-card">
              <div class="stat-icon icon-green"><i class="bi bi-people"></i></div>
              <div class="stat-value">${folhas.length}</div>
              <div class="stat-label">Funcionários</div>
            </div>
          </div>
          ${showHECol ? `<div class="col-md-3">
            <div class="stat-card">
              <div class="stat-icon icon-yellow"><i class="bi bi-clock-history"></i></div>
              <div class="stat-value">${totalHEGeral.toFixed(1)}</div>
              <div class="stat-label">Total H. Extras</div>
            </div>
          </div>` : ''}
          <div class="col-md-3">
            <div class="stat-card">
              <div class="stat-icon icon-red"><i class="bi bi-cash-stack"></i></div>
              <div class="stat-value">${formatCurrency(totalExtrasGeral)}</div>
              <div class="stat-label">Total Extras</div>
            </div>
          </div>
        </div>`;

      const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      for (const folha of folhas) {
        const f = folha.funcionario || {};
        const r = folha.resumo || {};
        const regs = folha.registros || [];
        const funcHasHE = f.permiteHE !== false;

        html += `
          <div class="summary-card mb-4">
            <h5><i class="bi bi-person me-2"></i>${f.nome || 'N/A'} - ${f.cargo || ''} (${formatCurrency(f.valor_hora_extra || 0)}/h)</h5>
            <div class="row mb-3">
              <div class="col-md-8">
                <div class="data-table">
                  <table class="table table-sm">
                    <thead>
                      <tr>
                        <th>Data</th><th>Dia</th><th>Entrada</th><th>Saída</th>
                        <th>Horas</th>${funcHasHE ? '<th>Extras</th>' : ''}<th>Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${regs.map(reg => {
                        const date = new Date(reg.data + 'T12:00:00');
                        const tipoDia = reg.tipoDia || {};
                        const isSpecial = tipoDia.tipo === 'feriado' || tipoDia.tipo === 'domingo' || tipoDia.tipo === 'sabado';
                        return `
                          <tr class="${isSpecial ? 'table-warning' : ''}">
                            <td>${formatDate(reg.data)}</td>
                            <td>${dias[date.getDay()]}</td>
                            <td>${reg.entrada || '-'}</td>
                            <td>${reg.saida || '-'}</td>
                            <td>${(reg.horasTrabalhadas || 0).toFixed(2)}</td>
                            ${funcHasHE ? `<td>${(reg.horasExtras || 0) > 0 ? '<span class="text-warning fw-bold">' + (reg.horasExtras).toFixed(2) + '</span>' : '0.00'}</td>` : ''}
                            <td>${formatCurrency((reg.pgtoHoraExtra || 0) + (reg.pgtoFDS || 0))}</td>
                          </tr>`;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
              <div class="col-md-4">
                <div class="summary-card" style="background: #F8FAFC;">
                  <h5>Resumo</h5>
                  <div class="summary-item"><span class="label">Dias Trabalhados</span><span class="value">${r.diasTrabalhados || 0}</span></div>
                  <div class="summary-item"><span class="label">Horas Trabalhadas</span><span class="value">${(r.totalHorasTrabalhadas || 0).toFixed(2)}</span></div>
                  <div class="summary-item"><span class="label">Horas Normais</span><span class="value">${(r.totalHorasNormais || 0).toFixed(2)}</span></div>
                  ${funcHasHE ? `<div class="summary-item"><span class="label">Horas Extras</span><span class="value text-warning">${(r.totalHorasExtras || 0).toFixed(2)}</span></div>` : ''}
                  ${funcHasHE ? `<div class="summary-item"><span class="label">Pgto H. Extras</span><span class="value text-warning">${formatCurrency(r.totalPgtoHE || 0)}</span></div>` : ''}
                  ${(r.totalPgtoFDS || 0) > 0 ? `<div class="summary-item"><span class="label">Pgto Dias Especiais</span><span class="value text-info">${formatCurrency(r.totalPgtoFDS)}</span></div>` : ''}
                  ${r.totalVT != null ? `<div class="summary-item"><span class="label">Vale Transporte</span><span class="value">${formatCurrency(r.totalVT)}</span></div>` : ''}
                  ${r.totalVA != null ? `<div class="summary-item"><span class="label">Vale Alimentação</span><span class="value">${formatCurrency(r.totalVA)}</span></div>` : ''}
                  ${r.totalAjudaCombustivel != null ? `<div class="summary-item"><span class="label">Ajuda Combustível</span><span class="value">${formatCurrency(r.totalAjudaCombustivel)}</span></div>` : ''}
                  <hr>
                  <div class="summary-item"><span class="label fw-bold">Total Extras</span><span class="value text-primary fs-5">${formatCurrency(r.totalGeral || 0)}</span></div>
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

  async function loadFolha() {
    const container = document.getElementById('relatorio-content');
    const mes = document.getElementById('rel-mes').value;
    const ano = document.getElementById('rel-ano').value;
    const funcId = document.getElementById('rel-func').value;

    container.innerHTML = '<div class="loading-spinner"><div class="spinner-border text-primary"></div></div>';

    try {
      let url = `/api/relatorios/folha?mes=${mes}&ano=${ano}`;
      if (funcId) url += `&funcionarioId=${funcId}`;
      const data = await api(url);

      if (!data.folhas || data.folhas.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="bi bi-clipboard-x"></i><p>Nenhum registro encontrado para o período</p></div>';
        return;
      }

      const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      let html = '';
      let grandTotal = 0;

      for (const folha of data.folhas) {
        const f = folha.funcionario || {};
        const r = folha.resumo || {};
        const regs = folha.registros || [];

        if (regs.length === 0) continue;

        grandTotal += r.totalGeral || 0;

        // PIX info string
        let pixInfo = '';
        if (f.pix_chave) {
          pixInfo = `<span class="badge bg-light text-dark border"><i class="bi bi-qr-code me-1"></i>PIX ${f.pix_tipo || ''}: ${f.pix_chave}${f.pix_banco ? ' (' + f.pix_banco + ')' : ''}</span>`;
        }

        html += `
          <div class="summary-card mb-4">
            <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
              <div>
                <h5 class="mb-1"><i class="bi bi-person-badge me-2"></i>${f.nome || 'N/A'}</h5>
                <span class="badge bg-primary me-2">${f.cargo || 'Sem cargo'}</span>
                ${pixInfo}
              </div>
              <div class="text-end">
                <div class="fs-4 fw-bold text-success">${formatCurrency(r.totalGeral || 0)}</div>
                <small class="text-muted">Total extras do mês</small>
              </div>
            </div>

            <div class="row g-2 mb-3">
              <div class="col-6 col-md-3">
                <div class="border rounded p-2 text-center h-100">
                  <small class="text-muted d-block">Dias Trabalhados</small>
                  <span class="fw-bold">${r.diasTrabalhados || 0}</span>
                  <small class="text-muted d-block">${r.diasTrabalhadosUteis || 0} úteis + ${r.diasTrabalhadosEspeciais || 0} especiais</small>
                </div>
              </div>
              <div class="col-6 col-md-3">
                <div class="border rounded p-2 text-center h-100">
                  <small class="text-muted d-block">Horas Normais</small>
                  <span class="fw-bold">${(r.totalHorasNormais || 0).toFixed(1)}h</span>
                </div>
              </div>
              <div class="col-6 col-md-3">
                <div class="border rounded p-2 text-center h-100">
                  <small class="text-muted d-block">Horas Extras</small>
                  ${f.permiteHE !== false ? `<span class="fw-bold text-warning">${(r.totalHorasExtras || 0).toFixed(1)}h</span>
                  <small class="text-muted d-block">${(r.totalHorasExtras || 0).toFixed(1)} × ${formatCurrency(f.valor_hora_extra || 0)}</small>` : '<span class="text-muted">-</span>'}
                </div>
              </div>
              <div class="col-6 col-md-3">
                <div class="border rounded p-2 text-center h-100">
                  <small class="text-muted d-block">Dias Especiais</small>
                  ${f.permiteDE !== false ? `<span class="fw-bold text-info">${r.diasTrabalhadosEspeciais || 0}</span>
                  <small class="text-muted d-block">${r.diasTrabalhadosEspeciais || 0} × ${formatCurrency(f.valor_dia_especial || 0)}</small>` : '<span class="text-muted">-</span>'}
                </div>
              </div>
            </div>

            <table class="table table-sm table-bordered mb-0">
              <tbody>
                ${f.permiteHE !== false ? `<tr>
                  <td>Horas Extras</td>
                  <td class="text-end">${(r.totalHorasExtras || 0).toFixed(1)}h × ${formatCurrency(f.valor_hora_extra || 0)}</td>
                  <td class="text-end fw-bold" style="width:130px">${formatCurrency(r.totalPgtoHE || 0)}</td>
                </tr>` : `<tr><td>Horas Extras</td><td class="text-end text-muted">não se aplica</td><td class="text-end text-muted" style="width:130px">-</td></tr>`}
                ${f.permiteDE !== false ? `<tr>
                  <td>Dias Especiais (FDS/Feriado)</td>
                  <td class="text-end">${r.diasTrabalhadosEspeciais || 0} × ${formatCurrency(f.valor_dia_especial || 0)}</td>
                  <td class="text-end fw-bold">${formatCurrency(r.totalPgtoFDS || 0)}</td>
                </tr>` : `<tr><td>Dias Especiais</td><td class="text-end text-muted">não se aplica</td><td class="text-end text-muted">-</td></tr>`}
                ${f.recebeVT !== false ? `<tr>
                  <td>Vale Transporte</td>
                  <td class="text-end"><small class="text-muted">mensal</small></td>
                  <td class="text-end fw-bold">${r.totalVT != null ? formatCurrency(r.totalVT) : '-'}</td>
                </tr>` : ''}
                ${f.recebeVA !== false ? `<tr>
                  <td>Vale Alimentação</td>
                  <td class="text-end"><small class="text-muted">mensal</small></td>
                  <td class="text-end fw-bold">${r.totalVA != null ? formatCurrency(r.totalVA) : '-'}</td>
                </tr>` : ''}
                ${f.recebeCombustivel !== false ? `<tr>
                  <td>Ajuda Combustível</td>
                  <td class="text-end"><small class="text-muted">mensal</small></td>
                  <td class="text-end fw-bold">${r.totalAjudaCombustivel != null ? formatCurrency(r.totalAjudaCombustivel) : '-'}</td>
                </tr>` : ''}
                <tr class="table-success">
                  <td colspan="2" class="fw-bold fs-6">TOTAL EXTRAS DO MÊS</td>
                  <td class="text-end fw-bold fs-6 text-success">${formatCurrency(r.totalGeral || 0)}</td>
                </tr>
              </tbody>
            </table>
            <small class="text-muted d-block mt-1"><i class="bi bi-info-circle me-1"></i>Valores adicionais ao salário base. Não inclui salário fixo.</small>

            <div class="mt-2">
              <a class="btn btn-sm btn-outline-secondary" data-bs-toggle="collapse" href="#detalhes-${folha.funcionario ? f.nome.replace(/\\s/g, '-') : 'func'}-${mes}${ano}" role="button">
                <i class="bi bi-list-ul me-1"></i>Ver detalhes diários
              </a>
              <div class="collapse mt-2" id="detalhes-${folha.funcionario ? f.nome.replace(/\\s/g, '-') : 'func'}-${mes}${ano}">
                <div class="data-table">
                  <table class="table table-sm">
                    <thead>
                      <tr>
                        <th>Data</th><th>Dia</th><th>Entrada</th><th>Saída</th>
                        <th>H. Trab.</th><th>H. Extra</th><th>Tipo</th>
                        <th>Pgto HE</th><th>Pgto FDS</th><th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${regs.map(reg => {
                        const date = new Date(reg.data + 'T12:00:00');
                        const tipoDia = reg.tipoDia || {};
                        const isEspecial = tipoDia.tipo === 'feriado' || tipoDia.tipo === 'domingo' || tipoDia.tipo === 'sabado';
                        return `
                          <tr class="${isEspecial ? 'table-warning' : ''}">
                            <td>${formatDate(reg.data)}</td>
                            <td>${dias[date.getDay()]}</td>
                            <td>${reg.entrada || '-'}</td>
                            <td>${reg.saida || '-'}</td>
                            <td>${(reg.horasTrabalhadas || 0).toFixed(2)}</td>
                            <td>${(reg.horasExtras || 0) > 0 ? '<span class="text-warning fw-bold">' + (reg.horasExtras).toFixed(2) + '</span>' : '0.00'}</td>
                            <td><span class="badge bg-${isEspecial ? 'warning text-dark' : 'secondary'}">${tipoDia.descricao || 'Útil'}</span></td>
                            <td>${(reg.pgtoHoraExtra || 0) > 0 ? formatCurrency(reg.pgtoHoraExtra) : '-'}</td>
                            <td>${(reg.pgtoFDS || 0) > 0 ? formatCurrency(reg.pgtoFDS) : '-'}</td>
                            <td class="fw-bold">${formatCurrency(reg.totalDia || 0)}</td>
                          </tr>`;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>`;
      }

      // Grand total across all employees
      if (data.folhas.filter(f => (f.registros || []).length > 0).length > 1) {
        html += `
          <div class="summary-card mb-4" style="background: #EEF2FF; border-left: 4px solid #4F46E5;">
            <div class="d-flex justify-content-between align-items-center">
              <h5 class="mb-0"><i class="bi bi-calculator me-2"></i>Total Extras Geral - ${monthName(mes)}/${ano}</h5>
              <div class="fs-3 fw-bold text-primary">${formatCurrency(grandTotal)}</div>
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
      const allFuncionarios = await api('/api/funcionarios');
      const funcionarios = allFuncionarios.filter(f => f.cargo_nome !== 'Dono(a) da Casa' && f.precisa_bater_ponto !== 0);

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
      const activeUsers = users.filter(u => u.active);
      const inactiveUsers = users.filter(u => !u.active);
      let showInactive = false;

      const renderRow = (u) => `
        <tr class="${!u.active ? 'opacity-50' : ''}" ${!u.active ? 'data-inactive="true" style="display:none"' : ''}>
          <td><strong>${u.name}</strong></td>
          <td>${u.email}</td>
          <td><span class="badge bg-${u.role === 'admin' ? 'danger' : u.role === 'gestor' ? 'warning text-dark' : 'secondary'}">${u.role}</span></td>
          <td><span class="badge-status badge-${u.active ? 'ativo' : 'inativo'}">${u.active ? 'Ativo' : 'Inativo'}</span></td>
          <td>${formatDate(u.created_at ? u.created_at.split(' ')[0] || u.created_at.split('T')[0] : '')}</td>
          <td class="text-nowrap">
            <button class="btn btn-action btn-outline-primary" onclick="App.openUsuarioModal(${u.id})" title="Editar"><i class="bi bi-pencil"></i></button>
            ${u.id !== currentUser.id ? `<button class="btn btn-action btn-outline-warning ms-1" onclick="App.resetUsuarioPassword(${u.id}, '${u.email.replace(/'/g, "\\'")}')" title="Reenviar Senha"><i class="bi bi-key"></i></button>` : ''}
            ${u.id !== currentUser.id && u.active ? `<button class="btn btn-action btn-outline-danger ms-1" onclick="App.deleteUsuario(${u.id}, '${u.name.replace(/'/g, "\\'")}')" title="Desativar"><i class="bi bi-person-x"></i></button>` : ''}
          </td>
        </tr>`;

      content.innerHTML = `
        <div class="page-header">
          <h3><i class="bi bi-person-gear me-2"></i>${activeUsers.length} usuário(s) ativo(s)</h3>
          <div class="d-flex gap-2">
            ${inactiveUsers.length > 0 ? `<button class="btn btn-outline-secondary btn-sm" id="btn-toggle-inativos-users">
              <i class="bi bi-eye"></i> Mostrar inativos (${inactiveUsers.length})
            </button>` : ''}
            <button class="btn btn-primary btn-sm" onclick="App.openUsuarioModal()">
              <i class="bi bi-plus-lg"></i> Novo Usuário
            </button>
          </div>
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
              ${users.map(renderRow).join('')}
            </tbody>
          </table>
        </div>`;

      const toggleBtn = document.getElementById('btn-toggle-inativos-users');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
          showInactive = !showInactive;
          toggleBtn.innerHTML = showInactive
            ? `<i class="bi bi-eye-slash"></i> Ocultar inativos (${inactiveUsers.length})`
            : `<i class="bi bi-eye"></i> Mostrar inativos (${inactiveUsers.length})`;
          content.querySelectorAll('tr[data-inactive]').forEach(row => {
            row.style.display = showInactive ? '' : 'none';
          });
        });
      }
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
        <hr><h6 class="text-muted">Permissões de Tarefas</h6>
        <div class="mb-3">
          <label class="form-label">Telefone (para WhatsApp)</label>
          <input type="text" class="form-control" id="user-telefone-input" placeholder="(11) 99999-0000">
        </div>
        <div class="form-check mb-2">
          <input class="form-check-input" type="checkbox" id="user-pode-tarefas">
          <label class="form-check-label" for="user-pode-tarefas">Pode criar tarefas (web)</label>
        </div>
        <div class="form-check mb-3">
          <input class="form-check-input" type="checkbox" id="user-pode-tarefas-wa">
          <label class="form-check-label" for="user-pode-tarefas-wa">Pode criar tarefas via WhatsApp</label>
        </div>
      </form>`;

    const footer = `
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary" onclick="App.saveUsuario(${id || 'null'})">Salvar</button>`;

    openModal(isEdit ? 'Editar Usuário' : 'Novo Usuário', body, footer);
    applyPhoneMask('user-telefone-input');

    if (isEdit) {
      api('/api/auth/users').then(users => {
        const u = users.find(x => x.id === id);
        if (u) {
          document.getElementById('user-name-input').value = u.name;
          document.getElementById('user-email-input').value = u.email;
          document.getElementById('user-role-input').value = u.role;
          document.getElementById('user-active-input').value = u.active ? '1' : '0';
          document.getElementById('user-telefone-input').value = maskPhone(u.telefone || '');
          document.getElementById('user-pode-tarefas').checked = !!u.pode_criar_tarefas;
          document.getElementById('user-pode-tarefas-wa').checked = !!u.pode_criar_tarefas_whatsapp;
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

    // Novos campos de permissão de tarefas
    const telefoneEl = document.getElementById('user-telefone-input');
    if (telefoneEl) data.telefone = (telefoneEl.value || '').replace(/\D/g, '') || null;
    const podeTarefasEl = document.getElementById('user-pode-tarefas');
    if (podeTarefasEl) data.pode_criar_tarefas = podeTarefasEl.checked ? 1 : 0;
    const podeTarefasWaEl = document.getElementById('user-pode-tarefas-wa');
    if (podeTarefasWaEl) data.pode_criar_tarefas_whatsapp = podeTarefasWaEl.checked ? 1 : 0;

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
  // INSIGHTS IA
  // ============================================================
  async function renderInsightsIA() {
    const content = document.getElementById('page-content');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

    content.innerHTML = `
      <div class="d-flex align-items-center gap-3 mb-4 flex-wrap">
        <input type="date" id="insights-date" class="form-control" style="max-width:200px" value="${today}">
        <button class="btn btn-primary" id="btn-generate-insights">
          <i class="bi bi-lightbulb"></i> Gerar Insights do Dia
        </button>
        <button class="btn btn-outline-secondary" id="btn-load-insights">
          <i class="bi bi-arrow-clockwise"></i> Carregar
        </button>
        <span class="text-muted">|</span>
        <button class="btn btn-success" id="btn-generate-period">
          <i class="bi bi-calendar-range"></i> Últimos 30 dias
        </button>
      </div>
      <div id="insights-container">
        <div class="text-muted">Selecione uma data e clique em "Carregar" ou "Gerar Insights".</div>
      </div>`;

    const dateInput = document.getElementById('insights-date');
    document.getElementById('btn-load-insights').addEventListener('click', () => loadInsights(dateInput.value));
    document.getElementById('btn-generate-insights').addEventListener('click', () => generateInsights(dateInput.value));
    document.getElementById('btn-generate-period').addEventListener('click', () => generatePeriodInsights());

    // Auto-load for today
    loadInsights(today);
  }

  async function loadInsights(date) {
    const container = document.getElementById('insights-container');
    container.innerHTML = '<div class="loading-spinner"><div class="spinner-border text-primary"></div></div>';
    try {
      const data = await api(`/api/insights/${date}`);
      renderInsightsCards(data.insights, date, data.mensagens_analisadas);
    } catch (err) {
      if (err.message.includes('404') || err.message.includes('Nenhum')) {
        container.innerHTML = `
          <div class="alert alert-info d-flex align-items-center gap-3">
            <i class="bi bi-info-circle fs-4"></i>
            <div>
              <strong>Nenhum insight encontrado para ${formatDate(date)}.</strong><br>
              Clique em "Gerar Insights" para analisar as mensagens deste dia.
            </div>
          </div>`;
      } else {
        container.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
      }
    }
  }

  async function generateInsights(date) {
    const container = document.getElementById('insights-container');
    const btn = document.getElementById('btn-generate-insights');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Gerando...';
    container.innerHTML = `
      <div class="text-center py-5">
        <div class="spinner-border text-primary mb-3" style="width:3rem;height:3rem"></div>
        <p class="text-muted">Analisando mensagens com IA... Isso pode levar alguns segundos.</p>
      </div>`;

    try {
      const result = await api('/api/insights/generate', {
        method: 'POST',
        body: JSON.stringify({ date }),
      });
      renderInsightsCards(result.insights, date, result.mensagens_analisadas);
      showToast('Insights gerados com sucesso!');
    } catch (err) {
      container.innerHTML = `<div class="alert alert-danger"><i class="bi bi-exclamation-triangle"></i> ${err.message}</div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-lightbulb"></i> Gerar Insights do Dia';
    }
  }

  async function generatePeriodInsights() {
    const container = document.getElementById('insights-container');
    const btn = document.getElementById('btn-generate-period');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Gerando...';
    container.innerHTML = `
      <div class="text-center py-5">
        <div class="spinner-border text-success mb-3" style="width:3rem;height:3rem"></div>
        <p class="text-muted">Analisando últimos 30 dias com IA... Isso pode levar alguns segundos.</p>
      </div>`;

    try {
      const result = await api('/api/insights/generate-period', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      renderPeriodCards(result.insights, result.periodo, result.mensagens_analisadas);
      showToast('Insights do período gerados com sucesso!');
    } catch (err) {
      container.innerHTML = `<div class="alert alert-danger"><i class="bi bi-exclamation-triangle"></i> ${err.message}</div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-calendar-range"></i> Últimos 30 dias';
    }
  }

  function renderPeriodCards(insights, periodo, msgCount) {
    const container = document.getElementById('insights-container');
    if (!insights) {
      container.innerHTML = '<div class="alert alert-warning">Dados de insights inválidos.</div>';
      return;
    }

    const gravBadge = g => {
      const cls = g === 'alta' ? 'danger' : g === 'media' ? 'warning' : 'info';
      return `<span class="badge bg-${cls}">${g}</span>`;
    };

    container.innerHTML = `
      <div class="mb-3">
        <span class="badge bg-success fs-6"><i class="bi bi-calendar-range"></i> Período: ${formatDate(periodo.inicio)} a ${formatDate(periodo.fim)}</span>
        <span class="badge bg-secondary fs-6 ms-2">${msgCount} mensagens analisadas</span>
      </div>

      <div class="card mb-3 border-success">
        <div class="card-header bg-success text-white"><i class="bi bi-journal-text"></i> Resumo do Período</div>
        <div class="card-body">${insights.resumo || 'Sem resumo.'}</div>
      </div>

      <div class="card mb-3">
        <div class="card-header"><i class="bi bi-people"></i> Presença & Frequência</div>
        <div class="card-body">
          ${(insights.presenca && insights.presenca.ranking || []).length > 0 ? `
            <div class="table-responsive">
              <table class="table table-sm table-striped">
                <thead><tr><th>Funcionário</th><th>Dias Presente</th><th>Chegada Média</th><th>Saída Média</th></tr></thead>
                <tbody>
                  ${insights.presenca.ranking.map(r => `
                    <tr>
                      <td><strong>${r.nome}</strong></td>
                      <td><span class="badge bg-primary">${r.dias_presentes}</span></td>
                      <td>${r.primeira_msg_media || '-'}</td>
                      <td>${r.ultima_msg_media || '-'}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>` : ''}
          ${(insights.presenca && insights.presenca.ausencias_frequentes || []).length > 0 ? `
            <div class="mt-2"><strong class="text-danger">Ausências frequentes:</strong> ${insights.presenca.ausencias_frequentes.join(', ')}</div>` : ''}
          ${insights.presenca && insights.presenca.observacoes ? `<div class="mt-2 text-muted"><em>${insights.presenca.observacoes}</em></div>` : ''}
        </div>
      </div>

      <div class="row g-3">
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header"><i class="bi bi-exclamation-triangle text-danger"></i> Problemas Recorrentes</div>
            <div class="card-body">
              ${(insights.problemas_recorrentes || []).length > 0
                ? insights.problemas_recorrentes.map(p => `
                  <div class="border-bottom pb-2 mb-2">
                    <div>${gravBadge(p.gravidade)} ${p.descricao} <small class="text-muted">(${p.frequencia})</small></div>
                    ${p.sugestao ? `<small class="text-success"><i class="bi bi-lightbulb"></i> ${p.sugestao}</small>` : ''}
                  </div>`).join('')
                : '<span class="text-muted">Nenhum problema recorrente.</span>'}
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header"><i class="bi bi-star text-warning"></i> Destaques</div>
            <div class="card-body">
              ${(insights.destaques || []).length > 0
                ? insights.destaques.map(d => `
                  <div class="border-bottom pb-2 mb-2">
                    <div>${d.descricao}</div>
                    ${d.responsavel ? `<small class="text-muted">Responsável: ${d.responsavel}</small>` : ''}
                  </div>`).join('')
                : '<span class="text-muted">Nenhum destaque.</span>'}
            </div>
          </div>
        </div>
      </div>

      <div class="row g-3 mt-1">
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header"><i class="bi bi-arrow-repeat text-info"></i> Padrões Observados</div>
            <div class="card-body">
              ${(insights.padroes || []).length > 0
                ? insights.padroes.map(p => {
                    const cls = p.tipo === 'positivo' ? 'success' : p.tipo === 'negativo' ? 'danger' : 'secondary';
                    return `<div class="border-bottom pb-2 mb-2"><span class="badge bg-${cls}">${p.tipo}</span> ${p.descricao}</div>`;
                  }).join('')
                : '<span class="text-muted">Nenhum padrão identificado.</span>'}
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header"><i class="bi bi-lightbulb text-success"></i> Sugestões</div>
            <div class="card-body">
              ${(insights.sugestoes || []).length > 0
                ? insights.sugestoes.map(s => `
                  <div class="border-bottom pb-2 mb-2">
                    <div>${gravBadge(s.prioridade)} <strong>${s.titulo}</strong></div>
                    <small>${s.descricao}</small>
                  </div>`).join('')
                : '<span class="text-muted">Nenhuma sugestão.</span>'}
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderInsightsCards(insights, date, msgCount) {
    const container = document.getElementById('insights-container');
    if (!insights) {
      container.innerHTML = '<div class="alert alert-warning">Dados de insights inválidos.</div>';
      return;
    }

    const gravityBadge = (g) => {
      const colors = { alta: 'danger', media: 'warning', baixa: 'info' };
      return `<span class="badge bg-${colors[g] || 'secondary'}">${g}</span>`;
    };

    const statusBadge = (s) => {
      const colors = { concluida: 'success', em_andamento: 'primary', pendente: 'warning' };
      return `<span class="badge bg-${colors[s] || 'secondary'}">${s}</span>`;
    };

    const prioBadge = (p) => {
      const colors = { alta: 'danger', media: 'warning', baixa: 'info' };
      return `<span class="badge bg-${colors[p] || 'secondary'}">${p}</span>`;
    };

    container.innerHTML = `
      <div class="mb-3 text-muted small">
        <i class="bi bi-calendar3"></i> ${formatDate(date)} &middot;
        <i class="bi bi-chat-dots"></i> ${msgCount || 0} mensagens analisadas
      </div>

      <!-- Resumo -->
      <div class="card border-primary mb-3">
        <div class="card-header bg-primary text-white">
          <i class="bi bi-file-text"></i> Resumo do Dia
        </div>
        <div class="card-body">${insights.resumo || 'Sem resumo disponível.'}</div>
      </div>

      <!-- Presença -->
      <div class="card border-success mb-3">
        <div class="card-header bg-success text-white">
          <i class="bi bi-people"></i> Presença
        </div>
        <div class="card-body">
          ${insights.presenca ? `
            <div class="row">
              <div class="col-md-6">
                <h6 class="text-success"><i class="bi bi-check-circle"></i> Presentes (${(insights.presenca.presentes || []).length})</h6>
                ${(insights.presenca.presentes || []).length > 0
                  ? `<ul class="list-unstyled">${insights.presenca.presentes.map(n => `<li><i class="bi bi-person-check text-success"></i> ${n}</li>`).join('')}</ul>`
                  : '<p class="text-muted">Nenhum</p>'}
              </div>
              <div class="col-md-6">
                <h6 class="text-danger"><i class="bi bi-x-circle"></i> Ausentes (${(insights.presenca.ausentes || []).length})</h6>
                ${(insights.presenca.ausentes || []).length > 0
                  ? `<ul class="list-unstyled">${insights.presenca.ausentes.map(n => `<li><i class="bi bi-person-x text-danger"></i> ${n}</li>`).join('')}</ul>`
                  : '<p class="text-muted">Nenhum</p>'}
              </div>
            </div>
            ${insights.presenca.observacoes ? `<div class="mt-2 text-muted"><em>${insights.presenca.observacoes}</em></div>` : ''}
          ` : '<p class="text-muted">Sem dados de presença.</p>'}
        </div>
      </div>

      <!-- Problemas -->
      <div class="card border-danger mb-3">
        <div class="card-header bg-danger text-white">
          <i class="bi bi-exclamation-triangle"></i> Problemas Relatados
        </div>
        <div class="card-body">
          ${(insights.problemas || []).length > 0
            ? insights.problemas.map(p => `
              <div class="d-flex justify-content-between align-items-start mb-2 p-2 bg-light rounded">
                <div>
                  <strong>${p.descricao}</strong>
                  ${p.sugestao ? `<br><small class="text-muted"><i class="bi bi-lightbulb"></i> ${p.sugestao}</small>` : ''}
                </div>
                ${gravityBadge(p.gravidade)}
              </div>`).join('')
            : '<p class="text-muted">Nenhum problema relatado.</p>'}
        </div>
      </div>

      <!-- Entregas -->
      <div class="card border-warning mb-3">
        <div class="card-header bg-warning text-dark">
          <i class="bi bi-box-seam"></i> Entregas
        </div>
        <div class="card-body">
          ${(insights.entregas || []).length > 0
            ? insights.entregas.map(e => `
              <div class="mb-2 p-2 bg-light rounded">
                <strong>${e.descricao}</strong>
                <br><small class="text-muted">Responsável: ${e.responsavel || 'N/A'}
                ${e.tem_foto ? ' <i class="bi bi-camera text-primary"></i> Com foto' : ''}</small>
              </div>`).join('')
            : '<p class="text-muted">Nenhuma entrega registrada.</p>'}
        </div>
      </div>

      <!-- Tarefas -->
      <div class="card mb-3" style="border-color:#6f42c1">
        <div class="card-header text-white" style="background:#6f42c1">
          <i class="bi bi-list-task"></i> Tarefas
        </div>
        <div class="card-body">
          ${(insights.tarefas || []).length > 0
            ? `<table class="table table-sm mb-0">
                <thead><tr><th>Tarefa</th><th>Responsável</th><th>Status</th></tr></thead>
                <tbody>
                  ${insights.tarefas.map(t => `
                    <tr>
                      <td>${t.descricao}</td>
                      <td>${t.responsavel || 'N/A'}</td>
                      <td>${statusBadge(t.status)}</td>
                    </tr>`).join('')}
                </tbody>
              </table>`
            : '<p class="text-muted">Nenhuma tarefa identificada.</p>'}
        </div>
      </div>

      <!-- Sugestões -->
      <div class="card mb-3" style="border-color:#0dcaf0">
        <div class="card-header text-white" style="background:#0dcaf0">
          <i class="bi bi-magic"></i> Sugestões de Melhoria
        </div>
        <div class="card-body">
          ${(insights.sugestoes || []).length > 0
            ? insights.sugestoes.map(s => `
              <div class="d-flex justify-content-between align-items-start mb-2 p-2 bg-light rounded">
                <div>
                  <strong>${s.titulo}</strong>
                  <br><small class="text-muted">${s.descricao}</small>
                </div>
                ${prioBadge(s.prioridade)}
              </div>`).join('')
            : '<p class="text-muted">Nenhuma sugestão.</p>'}
        </div>
      </div>`;
  }

  // ============================================================
  // Cargos
  // ============================================================
  let _cargosShowInactive = false;
  async function renderCargos() {
    const content = document.getElementById('page-content');
    try {
      const allCargos = await api('/api/cargos?includeInactive=true');
      const inactiveCount = allCargos.filter(c => c.ativo === 0).length;
      const cargos = _cargosShowInactive ? allCargos : allCargos.filter(c => c.ativo !== 0);
      const canManage = currentUser.role === 'admin' || currentUser.role === 'gestor';
      content.innerHTML = `
        <div class="page-header">
          <h3><i class="bi bi-briefcase me-2"></i>Cargos</h3>
          <div class="d-flex gap-2">
            ${inactiveCount > 0 ? `<button class="btn btn-sm ${_cargosShowInactive ? 'btn-secondary' : 'btn-outline-secondary'}" id="btn-toggle-inativos-cargo">
              <i class="bi bi-eye${_cargosShowInactive ? '-slash' : ''}"></i> ${_cargosShowInactive ? 'Ocultar' : 'Mostrar'} inativos (${inactiveCount})
            </button>` : ''}
            ${canManage ? '<button class="btn btn-primary btn-sm" onclick="App.openCargoModal()"><i class="bi bi-plus-lg"></i> Novo Cargo</button>' : ''}
          </div>
        </div>
        <div class="data-table">
          <table class="table">
            <thead><tr><th>Nome</th><th>Descrição</th><th>Status</th>${canManage ? '<th>Ações</th>' : ''}</tr></thead>
            <tbody>
              ${cargos.length === 0 ? '<tr><td colspan="4" class="text-center text-muted py-4">Nenhum cargo cadastrado</td></tr>' : ''}
              ${cargos.map(c => `
                <tr${c.ativo === 0 ? ' class="text-muted" style="opacity:0.6"' : ''}>
                  <td><strong>${c.nome}</strong></td>
                  <td>${c.descricao || '-'}</td>
                  <td><span class="badge-status badge-${c.ativo !== 0 ? 'ativo' : 'inativo'}">${c.ativo !== 0 ? 'Ativo' : 'Inativo'}</span></td>
                  ${canManage ? `<td>
                    <button class="btn btn-action btn-outline-primary btn-edit-cargo" data-id="${c.id}" title="Editar"><i class="bi bi-pencil"></i></button>
                    <button class="btn btn-action btn-outline-danger ms-1 btn-del-cargo" data-id="${c.id}" data-nome="${(c.nome||'').replace(/"/g,'&quot;')}" title="Excluir"><i class="bi bi-trash"></i></button>
                  </td>` : ''}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      const toggleBtn = document.getElementById('btn-toggle-inativos-cargo');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => { _cargosShowInactive = !_cargosShowInactive; renderCargos(); });
      }
      content.querySelectorAll('.btn-edit-cargo').forEach(btn => {
        btn.addEventListener('click', () => openCargoModal(parseInt(btn.dataset.id)));
      });
      content.querySelectorAll('.btn-del-cargo').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Excluir cargo "' + btn.dataset.nome + '"?')) {
            await api('/api/cargos/' + btn.dataset.id, { method: 'DELETE' });
            renderCargos();
          }
        });
      });
    } catch (err) {
      content.innerHTML = `<div class="alert alert-danger">Erro: ${err.message}</div>`;
    }
  }

  function openCargoModal(id) {
    const isEdit = !!id;
    const body = `
      <form id="cargo-form">
        <div class="mb-3"><label class="form-label">Nome</label><input type="text" class="form-control" id="cargo-nome" required></div>
        <hr><h6 class="text-muted">Configurações</h6>
        <div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="cargo-ponto" checked><label class="form-check-label" for="cargo-ponto">Precisa bater ponto</label></div>
        <div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="cargo-hora-extra" checked onchange="document.getElementById('cargo-he-fields').style.display=this.checked?'':'none'"><label class="form-check-label" for="cargo-hora-extra">Permite hora extra</label></div>
        <div id="cargo-he-fields">
          <div class="mb-3"><label class="form-label">Valor Hora Extra (R$)</label><input type="number" class="form-control" id="cargo-val-hora-extra" step="0.01" min="0" value="0"></div>
        </div>
        <div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="cargo-dia-extra" onchange="document.getElementById('cargo-de-fields').style.display=this.checked?'':'none'"><label class="form-check-label" for="cargo-dia-extra">Permite dia extra</label></div>
        <div id="cargo-de-fields" style="display:none">
          <div class="mb-3"><label class="form-label">Valor Dia Extra (R$)</label><input type="number" class="form-control" id="cargo-val-dia-extra" step="0.01" min="0" value="0"></div>
        </div>
        <hr><h6 class="text-muted">Benefícios</h6>
        <div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="cargo-vt" onchange="document.getElementById('cargo-vt-fields').style.display=this.checked?'':'none'"><label class="form-check-label" for="cargo-vt">Recebe Vale Transporte</label></div>
        <div id="cargo-vt-fields" style="display:none">
          <div class="mb-3"><label class="form-label">Valor VT por dia - ida + volta somados (R$)</label><input type="number" class="form-control" id="cargo-val-vt" step="0.01" min="0" value="0"></div>
        </div>
        <div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="cargo-vr" onchange="document.getElementById('cargo-vr-fields').style.display=this.checked?'':'none'"><label class="form-check-label" for="cargo-vr">Recebe Vale Refeição</label></div>
        <div id="cargo-vr-fields" style="display:none">
          <div class="mb-3"><label class="form-label">Valor VR por dia (R$)</label><input type="number" class="form-control" id="cargo-val-vr" step="0.01" min="0" value="0"></div>
        </div>
        <div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="cargo-combustivel" onchange="document.getElementById('cargo-combustivel-fields').style.display=this.checked?'':'none'"><label class="form-check-label" for="cargo-combustivel">Recebe Ajuda Combustível</label></div>
        <div id="cargo-combustivel-fields" style="display:none">
          <div class="mb-3"><label class="form-label">Valor Ajuda Combustível mensal (R$)</label><input type="number" class="form-control" id="cargo-val-combustivel" step="0.01" min="0" value="0"></div>
        </div>
        <hr><h6 class="text-muted">Dormida</h6>
        <div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="cargo-dorme" onchange="document.getElementById('cargo-dormida-fields').style.display=this.checked?'':'none'"><label class="form-check-label" for="cargo-dorme">Dorme no local</label></div>
        <div id="cargo-dormida-fields" style="display:none">
          <div class="row">
            <div class="col-6 mb-3"><label class="form-label">Dias de dormida</label><input type="number" class="form-control" id="cargo-dias-dormida" min="0" value="0"></div>
            <div class="col-6 mb-3"><label class="form-label">Tipo</label><select class="form-select" id="cargo-tipo-dormida"><option value="uteis">Segunda a Sexta</option><option value="fds">Sexta a Segunda</option><option value="todos">Todos os dias</option><option value="customizado">Personalizado</option></select></div>
          </div>
        </div>
      </form>`;
    const footer = `
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary" onclick="App.saveCargo(${id || 'null'})">Salvar</button>`;
    openModal(isEdit ? 'Editar Cargo' : 'Novo Cargo', body, footer);
    if (isEdit) {
      api('/api/cargos/' + id).then(c => {
        document.getElementById('cargo-nome').value = c.nome || '';
        document.getElementById('cargo-ponto').checked = !!c.precisa_bater_ponto;
        document.getElementById('cargo-hora-extra').checked = !!c.permite_hora_extra;
        document.getElementById('cargo-dia-extra').checked = !!c.permite_dia_extra;
        document.getElementById('cargo-val-hora-extra').value = c.valor_hora_extra || 0;
        document.getElementById('cargo-val-dia-extra').value = c.valor_dia_extra || 0;
        document.getElementById('cargo-vt').checked = !!c.recebe_vale_transporte;
        document.getElementById('cargo-vr').checked = !!c.recebe_vale_refeicao;
        document.getElementById('cargo-val-vt').value = c.valor_vale_transporte || 0;
        document.getElementById('cargo-val-vr').value = c.valor_vale_refeicao || 0;
        document.getElementById('cargo-combustivel').checked = !!c.recebe_ajuda_combustivel;
        document.getElementById('cargo-val-combustivel').value = c.valor_ajuda_combustivel || 0;
        document.getElementById('cargo-dorme').checked = !!c.dorme_no_local;
        document.getElementById('cargo-dias-dormida').value = c.dias_dormida || 0;
        // Map old values to new dropdown options
        document.getElementById('cargo-tipo-dormida').value = c.tipo_dias_dormida || 'uteis';
        // Show/hide conditional fields based on checkbox state
        document.getElementById('cargo-he-fields').style.display = c.permite_hora_extra ? '' : 'none';
        document.getElementById('cargo-de-fields').style.display = c.permite_dia_extra ? '' : 'none';
        document.getElementById('cargo-vt-fields').style.display = c.recebe_vale_transporte ? '' : 'none';
        document.getElementById('cargo-vr-fields').style.display = c.recebe_vale_refeicao ? '' : 'none';
        document.getElementById('cargo-combustivel-fields').style.display = c.recebe_ajuda_combustivel ? '' : 'none';
        document.getElementById('cargo-dormida-fields').style.display = c.dorme_no_local ? '' : 'none';
      });
    }
  }

  async function saveCargo(id) {
    const data = {
      nome: document.getElementById('cargo-nome').value,
      precisa_bater_ponto: document.getElementById('cargo-ponto').checked ? 1 : 0,
      permite_hora_extra: document.getElementById('cargo-hora-extra').checked ? 1 : 0,
      permite_dia_extra: document.getElementById('cargo-dia-extra').checked ? 1 : 0,
      valor_hora_extra: parseFloat(document.getElementById('cargo-val-hora-extra').value) || 0,
      valor_dia_extra: parseFloat(document.getElementById('cargo-val-dia-extra').value) || 0,
      recebe_vale_transporte: document.getElementById('cargo-vt').checked ? 1 : 0,
      recebe_vale_refeicao: document.getElementById('cargo-vr').checked ? 1 : 0,
      valor_vale_transporte: parseFloat(document.getElementById('cargo-val-vt').value) || 0,
      valor_vale_refeicao: parseFloat(document.getElementById('cargo-val-vr').value) || 0,
      recebe_ajuda_combustivel: document.getElementById('cargo-combustivel').checked ? 1 : 0,
      valor_ajuda_combustivel: parseFloat(document.getElementById('cargo-val-combustivel').value) || 0,
      dorme_no_local: document.getElementById('cargo-dorme').checked ? 1 : 0,
      dias_dormida: parseInt(document.getElementById('cargo-dias-dormida').value) || 0,
      tipo_dias_dormida: document.getElementById('cargo-tipo-dormida').value || 'uteis'
    };
    if (!data.nome) return showToast('Nome obrigatório', 'danger');
    try {
      if (id) {
        await api('/api/cargos/' + id, { method: 'PUT', body: JSON.stringify(data) });
      } else {
        await api('/api/cargos', { method: 'POST', body: JSON.stringify(data) });
      }
      closeModal();
      showToast(id ? 'Cargo atualizado' : 'Cargo criado');
      renderCargos();
    } catch (err) {
      showToast('Erro: ' + err.message, 'danger');
    }
  }

  // ============================================================
  // Veículos
  // ============================================================
  let _veiculosShowInactive = false;
  async function renderVeiculos() {
    const content = document.getElementById('page-content');
    try {
      const [veiculos, alerts, funcionarios] = await Promise.all([
        api('/api/veiculos?includeInactive=true'),
        api('/api/veiculos/alerts'),
        api('/api/funcionarios')
      ]);
      const inactiveCount = veiculos.filter(v => v.status !== 'ativo').length;
      const list = _veiculosShowInactive ? veiculos : veiculos.filter(v => v.status === 'ativo');
      const canManage = currentUser.role === 'admin' || currentUser.role === 'gestor';

      let alertsHtml = '';
      if (alerts.length > 0) {
        alertsHtml = `<div class="alert alert-warning py-2 mb-3"><i class="bi bi-exclamation-triangle me-2"></i><strong>${alerts.length} alerta(s):</strong> ` +
          alerts.map(a => {
            if (a.tipo === 'ipva') return `IPVA ${a.placa} ${a.vencido ? 'VENCIDO' : 'vence ' + formatDate(a.data)}`;
            if (a.tipo === 'revisao') return `Revisão ${a.placa} ${a.vencido ? 'ATRASADA' : 'em ' + formatDate(a.data)}`;
            if (a.tipo === 'revisao_km') return `Revisão ${a.placa} km ${a.km_atual}/${a.proxima_km}`;
            return a.tipo;
          }).join(' | ') + '</div>';
      }

      content.innerHTML = `
        <div class="page-header">
          <h3><i class="bi bi-car-front me-2"></i>Veículos</h3>
          <div class="d-flex gap-2">
            ${inactiveCount > 0 ? `<button class="btn btn-sm ${_veiculosShowInactive ? 'btn-secondary' : 'btn-outline-secondary'}" id="btn-toggle-inativos-veic">
              <i class="bi bi-eye${_veiculosShowInactive ? '-slash' : ''}"></i> ${_veiculosShowInactive ? 'Ocultar' : 'Mostrar'} inativos (${inactiveCount})
            </button>` : ''}
            ${canManage ? '<button class="btn btn-primary btn-sm" id="btn-novo-veiculo"><i class="bi bi-plus-lg"></i> Novo Veículo</button>' : ''}
          </div>
        </div>
        ${alertsHtml}
        <div class="row g-3">
          ${list.length === 0 ? '<div class="col-12"><div class="empty-state"><i class="bi bi-car-front"></i><p>Nenhum veículo cadastrado</p></div></div>' : ''}
          ${list.map(v => `
            <div class="col-md-6 col-lg-4">
              <div class="summary-card h-100${v.status !== 'ativo' ? ' opacity-50' : ''}">
                <div class="d-flex justify-content-between align-items-start mb-2">
                  <div>
                    <h5 class="mb-1"><i class="bi bi-car-front me-2"></i>${v.marca || ''} ${v.modelo || 'Sem modelo'}</h5>
                    <span class="badge bg-dark me-1">${v.placa || 'Sem placa'}</span>
                    <span class="badge bg-secondary">${v.cor || ''}</span>
                    ${v.ano_fabricacao ? `<span class="badge bg-light text-dark border">${v.ano_fabricacao}/${v.ano_modelo || v.ano_fabricacao}</span>` : ''}
                  </div>
                  <span class="badge-status badge-${v.status === 'ativo' ? 'ativo' : 'inativo'}">${v.status || 'ativo'}</span>
                </div>
                <div class="small text-muted mb-2">
                  ${v.combustivel ? `<span class="me-2"><i class="bi bi-fuel-pump"></i> ${v.combustivel}</span>` : ''}
                  ${v.km_atual ? `<span class="me-2"><i class="bi bi-speedometer2"></i> ${v.km_atual.toLocaleString()} km</span>` : ''}
                  ${v.responsavel_nome ? `<span><i class="bi bi-person"></i> ${v.responsavel_nome}</span>` : ''}
                </div>
                ${canManage ? `<div class="mt-auto pt-2 border-top">
                  <button class="btn btn-sm btn-outline-primary btn-edit-veic" data-id="${v.id}"><i class="bi bi-pencil"></i> Editar</button>
                  <button class="btn btn-sm btn-outline-danger ms-1 btn-del-veic" data-id="${v.id}" data-nome="${(v.marca||'') + ' ' + (v.modelo||'')}"><i class="bi bi-trash"></i></button>
                </div>` : ''}
              </div>
            </div>`).join('')}
        </div>`;

      const toggleBtn = document.getElementById('btn-toggle-inativos-veic');
      if (toggleBtn) toggleBtn.addEventListener('click', () => { _veiculosShowInactive = !_veiculosShowInactive; renderVeiculos(); });
      const novoBtn = document.getElementById('btn-novo-veiculo');
      if (novoBtn) novoBtn.addEventListener('click', () => openVeiculoModal(null, funcionarios));
      content.querySelectorAll('.btn-edit-veic').forEach(btn => {
        btn.addEventListener('click', () => openVeiculoModal(parseInt(btn.dataset.id), funcionarios));
      });
      content.querySelectorAll('.btn-del-veic').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Desativar veículo "' + btn.dataset.nome + '"?')) {
            await api('/api/veiculos/' + btn.dataset.id, { method: 'DELETE' });
            renderVeiculos();
          }
        });
      });
    } catch (err) {
      content.innerHTML = `<div class="alert alert-danger">Erro: ${err.message}</div>`;
    }
  }

  function openVeiculoModal(id, funcionarios) {
    const isEdit = !!id;
    const ufs = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
    const body = `
      <form id="veiculo-form">
        <div class="row mb-2">
          <div class="col-12 d-flex gap-2 mb-3">
            <button type="button" class="btn btn-sm btn-outline-success" id="btn-crlv-ai"><i class="bi bi-camera"></i> Preencher via CRLV</button>
            <button type="button" class="btn btn-sm btn-outline-info" id="btn-buscar-placa" disabled><i class="bi bi-search"></i> Buscar por placa</button>
            <input type="file" id="crlv-file-input" accept="image/*" class="d-none">
          </div>
        </div>
        <h6 class="text-muted">Dados do Veículo</h6>
        <div class="row g-2">
          <div class="col-md-4"><label class="form-label">Marca</label><input type="text" class="form-control" id="veic-marca"></div>
          <div class="col-md-4"><label class="form-label">Modelo</label><input type="text" class="form-control" id="veic-modelo"></div>
          <div class="col-md-2"><label class="form-label">Ano Fab.</label><input type="number" class="form-control" id="veic-ano-fab" min="1900" max="2099"></div>
          <div class="col-md-2"><label class="form-label">Ano Mod.</label><input type="number" class="form-control" id="veic-ano-mod" min="1900" max="2099"></div>
        </div>
        <div class="row g-2 mt-1">
          <div class="col-md-3"><label class="form-label">Placa</label><input type="text" class="form-control" id="veic-placa" maxlength="8" placeholder="ABC1D23"></div>
          <div class="col-md-3"><label class="form-label">Cor</label><input type="text" class="form-control" id="veic-cor"></div>
          <div class="col-md-3"><label class="form-label">Combustível</label><select class="form-select" id="veic-combustivel"><option value="flex">Flex</option><option value="gasolina">Gasolina</option><option value="etanol">Etanol</option><option value="diesel">Diesel</option><option value="eletrico">Elétrico</option><option value="hibrido">Híbrido</option></select></div>
          <div class="col-md-3"><label class="form-label">KM Atual</label><input type="number" class="form-control" id="veic-km" min="0"></div>
        </div>
        <div class="row g-2 mt-1">
          <div class="col-md-6"><label class="form-label">Renavam</label><input type="text" class="form-control" id="veic-renavam"></div>
          <div class="col-md-6"><label class="form-label">Chassi</label><input type="text" class="form-control" id="veic-chassi"></div>
        </div>
        <hr><h6 class="text-muted">Seguro</h6>
        <div class="row g-2">
          <div class="col-md-4"><label class="form-label">Seguradora</label><input type="text" class="form-control" id="veic-seguradora"></div>
          <div class="col-md-3"><label class="form-label">Apólice</label><input type="text" class="form-control" id="veic-seguro-apolice"></div>
          <div class="col-md-2"><label class="form-label">Início</label><input type="date" class="form-control" id="veic-seguro-inicio"></div>
          <div class="col-md-2"><label class="form-label">Fim</label><input type="date" class="form-control" id="veic-seguro-fim"></div>
          <div class="col-md-1"><label class="form-label">Valor</label><input type="number" class="form-control" id="veic-seguro-valor" step="0.01" min="0"></div>
        </div>
        <hr><h6 class="text-muted">IPVA / Licenciamento / Revisão</h6>
        <div class="row g-2">
          <div class="col-md-3"><label class="form-label">IPVA Valor</label><input type="number" class="form-control" id="veic-ipva-valor" step="0.01" min="0"></div>
          <div class="col-md-3"><label class="form-label">IPVA Vencimento</label><input type="date" class="form-control" id="veic-ipva-venc"></div>
          <div class="col-md-3"><label class="form-label">IPVA Status</label><select class="form-select" id="veic-ipva-status"><option value="pendente">Pendente</option><option value="pago">Pago</option><option value="atrasado">Atrasado</option></select></div>
          <div class="col-md-3"><label class="form-label">Licenciamento Status</label><select class="form-select" id="veic-lic-status"><option value="pendente">Pendente</option><option value="pago">Pago</option></select></div>
        </div>
        <div class="row g-2 mt-1">
          <div class="col-md-3"><label class="form-label">Última Revisão</label><input type="date" class="form-control" id="veic-ult-rev-data"></div>
          <div class="col-md-3"><label class="form-label">KM Última Rev.</label><input type="number" class="form-control" id="veic-ult-rev-km" min="0"></div>
          <div class="col-md-3"><label class="form-label">Próxima Revisão</label><input type="date" class="form-control" id="veic-prox-rev-data"></div>
          <div class="col-md-3"><label class="form-label">KM Próxima Rev.</label><input type="number" class="form-control" id="veic-prox-rev-km" min="0"></div>
        </div>
        <hr><h6 class="text-muted">Outros</h6>
        <div class="row g-2">
          <div class="col-md-4"><label class="form-label">Responsável</label><select class="form-select" id="veic-responsavel"><option value="">Nenhum</option>${funcionarios.map(f => `<option value="${f.id}">${f.nome}</option>`).join('')}</select></div>
          <div class="col-md-4"><label class="form-label">Status</label><select class="form-select" id="veic-status"><option value="ativo">Ativo</option><option value="vendido">Vendido</option><option value="manutencao">Manutenção</option><option value="inativo">Inativo</option></select></div>
          <div class="col-md-4"><label class="form-label">Licenciamento Ano</label><input type="number" class="form-control" id="veic-lic-ano" min="2020" max="2099"></div>
        </div>
        <div class="mt-2"><label class="form-label">Observações</label><textarea class="form-control" id="veic-obs" rows="2"></textarea></div>
      </form>`;
    const footer = `
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary" id="btn-save-veiculo">Salvar</button>`;
    openModal(isEdit ? 'Editar Veículo' : 'Novo Veículo', body, footer, 'modal-lg');

    // Wire up save button
    document.getElementById('btn-save-veiculo').addEventListener('click', () => saveVeiculo(id));

    // CRLV AI button
    document.getElementById('btn-crlv-ai').addEventListener('click', () => document.getElementById('crlv-file-input').click());
    document.getElementById('crlv-file-input').addEventListener('change', async function() {
      if (!this.files[0]) return;
      const formData = new FormData();
      formData.append('foto', this.files[0]);
      showToast('Analisando documento com IA...', 'info');
      try {
        const resp = await fetch('/api/veiculos/analyze-crlv', {
          method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: formData
        });
        const result = await resp.json();
        if (result.success && result.data) {
          const d = result.data;
          const fill = (elId, val) => { const el = document.getElementById(elId); if (el && !el.value && val) el.value = val; };
          fill('veic-marca', d.marca);
          fill('veic-modelo', d.modelo);
          fill('veic-ano-fab', d.ano_fabricacao);
          fill('veic-ano-mod', d.ano_modelo);
          fill('veic-cor', d.cor);
          fill('veic-placa', d.placa);
          fill('veic-renavam', d.renavam);
          fill('veic-chassi', d.chassi);
          if (d.combustivel) { const el = document.getElementById('veic-combustivel'); if (el) el.value = d.combustivel.toLowerCase(); }
          fill('veic-seguradora', d.seguradora);
          fill('veic-seguro-apolice', d.seguro_apolice);
          fill('veic-seguro-inicio', d.seguro_vigencia_inicio);
          fill('veic-seguro-fim', d.seguro_vigencia_fim);
          fill('veic-seguro-valor', d.seguro_valor);
          fill('veic-ipva-valor', d.ipva_valor);
          fill('veic-ipva-venc', d.ipva_vencimento);
          showToast('Dados extraídos do documento com sucesso!');
        } else {
          showToast('Não foi possível extrair dados: ' + (result.error || ''), 'danger');
        }
      } catch (err) { showToast('Erro ao analisar: ' + err.message, 'danger'); }
    });

    // Placa mask and search button
    const placaInput = document.getElementById('veic-placa');
    const searchBtn = document.getElementById('btn-buscar-placa');
    placaInput.addEventListener('input', function() {
      const v = this.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      this.value = v;
      searchBtn.disabled = v.length !== 7;
    });
    searchBtn.addEventListener('click', async () => {
      const placa = placaInput.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      if (placa.length !== 7) return showToast('Placa deve ter 7 caracteres', 'danger');
      showToast('Buscando dados da placa...', 'info');
      try {
        const resp = await fetch('/api/veiculos/buscar-placa', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ placa })
        });
        const result = await resp.json();
        if (result.success && result.data) {
          const d = result.data;
          const fill = (elId, val) => { const el = document.getElementById(elId); if (el && !el.value && val) el.value = val; };
          fill('veic-marca', d.marca);
          fill('veic-modelo', d.modelo);
          fill('veic-ano-fab', d.ano_fabricacao);
          fill('veic-ano-mod', d.ano_modelo);
          fill('veic-cor', d.cor);
          fill('veic-renavam', d.renavam);
          fill('veic-chassi', d.chassi);
          if (d.combustivel) { const el = document.getElementById('veic-combustivel'); if (el && el.value === 'flex') el.value = d.combustivel.toLowerCase(); }
          showToast('Dados encontrados e preenchidos!');
        } else if (resp.status === 403) {
          showToast('Consulta por placa não disponível no seu plano BigDataCorp. Use a opção Preencher via CRLV.', 'warning');
        } else {
          showToast(result.message || 'Veículo não encontrado. Tente preencher via foto do CRLV.', 'warning');
        }
      } catch (err) { showToast('Erro: ' + err.message, 'danger'); }
    });

    // Load existing data if editing
    if (isEdit) {
      api('/api/veiculos/' + id).then(v => {
        document.getElementById('veic-marca').value = v.marca || '';
        document.getElementById('veic-modelo').value = v.modelo || '';
        document.getElementById('veic-ano-fab').value = v.ano_fabricacao || '';
        document.getElementById('veic-ano-mod').value = v.ano_modelo || '';
        document.getElementById('veic-placa').value = v.placa || '';
        document.getElementById('veic-cor').value = v.cor || '';
        document.getElementById('veic-combustivel').value = v.combustivel || 'flex';
        document.getElementById('veic-km').value = v.km_atual || '';
        document.getElementById('veic-renavam').value = v.renavam || '';
        document.getElementById('veic-chassi').value = v.chassi || '';
        document.getElementById('veic-seguradora').value = v.seguradora || '';
        document.getElementById('veic-seguro-apolice').value = v.seguro_apolice || '';
        document.getElementById('veic-seguro-inicio').value = v.seguro_vigencia_inicio || '';
        document.getElementById('veic-seguro-fim').value = v.seguro_vigencia_fim || '';
        document.getElementById('veic-seguro-valor').value = v.seguro_valor || '';
        document.getElementById('veic-ipva-valor').value = v.ipva_valor || '';
        document.getElementById('veic-ipva-venc').value = v.ipva_vencimento || '';
        document.getElementById('veic-ipva-status').value = v.ipva_status || 'pendente';
        document.getElementById('veic-lic-status').value = v.licenciamento_status || 'pendente';
        document.getElementById('veic-lic-ano').value = v.licenciamento_ano || '';
        document.getElementById('veic-ult-rev-data').value = v.ultima_revisao_data || '';
        document.getElementById('veic-ult-rev-km').value = v.ultima_revisao_km || '';
        document.getElementById('veic-prox-rev-data').value = v.proxima_revisao_data || '';
        document.getElementById('veic-prox-rev-km').value = v.proxima_revisao_km || '';
        document.getElementById('veic-responsavel').value = v.responsavel_id || '';
        document.getElementById('veic-status').value = v.status || 'ativo';
        document.getElementById('veic-obs').value = v.observacoes || '';
        // Enable search button if placa filled
        if (v.placa && v.placa.length === 7) searchBtn.disabled = false;
      });
    }
  }

  async function saveVeiculo(id) {
    const data = {
      marca: document.getElementById('veic-marca').value,
      modelo: document.getElementById('veic-modelo').value,
      ano_fabricacao: parseInt(document.getElementById('veic-ano-fab').value) || null,
      ano_modelo: parseInt(document.getElementById('veic-ano-mod').value) || null,
      placa: document.getElementById('veic-placa').value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase(),
      cor: document.getElementById('veic-cor').value,
      combustivel: document.getElementById('veic-combustivel').value,
      km_atual: parseInt(document.getElementById('veic-km').value) || 0,
      renavam: document.getElementById('veic-renavam').value,
      chassi: document.getElementById('veic-chassi').value,
      seguradora: document.getElementById('veic-seguradora').value,
      seguro_apolice: document.getElementById('veic-seguro-apolice').value,
      seguro_vigencia_inicio: document.getElementById('veic-seguro-inicio').value,
      seguro_vigencia_fim: document.getElementById('veic-seguro-fim').value,
      seguro_valor: parseFloat(document.getElementById('veic-seguro-valor').value) || null,
      ipva_valor: parseFloat(document.getElementById('veic-ipva-valor').value) || null,
      ipva_vencimento: document.getElementById('veic-ipva-venc').value,
      ipva_status: document.getElementById('veic-ipva-status').value,
      licenciamento_status: document.getElementById('veic-lic-status').value,
      licenciamento_ano: parseInt(document.getElementById('veic-lic-ano').value) || null,
      ultima_revisao_data: document.getElementById('veic-ult-rev-data').value,
      ultima_revisao_km: parseInt(document.getElementById('veic-ult-rev-km').value) || null,
      proxima_revisao_data: document.getElementById('veic-prox-rev-data').value,
      proxima_revisao_km: parseInt(document.getElementById('veic-prox-rev-km').value) || null,
      responsavel_id: parseInt(document.getElementById('veic-responsavel').value) || null,
      status: document.getElementById('veic-status').value,
      observacoes: document.getElementById('veic-obs').value
    };
    if (!data.placa && !data.modelo) return showToast('Placa ou modelo obrigatório', 'danger');
    try {
      if (id) {
        await api('/api/veiculos/' + id, { method: 'PUT', body: JSON.stringify(data) });
      } else {
        await api('/api/veiculos', { method: 'POST', body: JSON.stringify(data) });
      }
      closeModal();
      showToast(id ? 'Veículo atualizado' : 'Veículo cadastrado');
      renderVeiculos();
    } catch (err) {
      showToast('Erro: ' + err.message, 'danger');
    }
  }

  // ============================================================
  // Log de Acessos
  // ============================================================
  async function renderAccessLog() {
    const content = document.getElementById('page-content');
    if (currentUser.role !== 'admin') {
      content.innerHTML = '<div class="alert alert-warning">Acesso restrito a administradores</div>';
      return;
    }
    const hoje = new Date().toISOString().split('T')[0];
    const mesPassado = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    content.innerHTML = `
      <div class="page-header"><h3><i class="bi bi-door-open me-2"></i>Log de Acessos</h3></div>
      <div class="card mb-3">
        <div class="card-body py-2">
          <div class="row g-2 align-items-end">
            <div class="col-auto">
              <label class="form-label mb-0 small">De</label>
              <input type="date" id="access-start" class="form-control form-control-sm" value="${mesPassado}">
            </div>
            <div class="col-auto">
              <label class="form-label mb-0 small">Até</label>
              <input type="date" id="access-end" class="form-control form-control-sm" value="${hoje}">
            </div>
            <div class="col-auto">
              <label class="form-label mb-0 small">Ação</label>
              <select id="access-acao" class="form-select form-select-sm">
                <option value="">Todas</option>
                <option value="login">Login</option>
                <option value="logout">Logout</option>
                <option value="login_failed">Falhou</option>
              </select>
            </div>
            <div class="col-auto">
              <button class="btn btn-sm btn-primary" onclick="App.loadAccessLog()"><i class="bi bi-funnel me-1"></i>Filtrar</button>
            </div>
          </div>
        </div>
      </div>
      <div id="access-log-content"></div>`;
    loadAccessLog();
  }

  // ===================== DOCUMENTOS =====================
  async function renderDocumentos() {
    const content = document.getElementById('page-content');
    const canManage = currentUser && (currentUser.role === 'admin' || currentUser.role === 'gestor');
    content.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div class="d-flex gap-2 align-items-center flex-wrap">
          <select class="form-select form-select-sm" id="doc-filter-tipo" style="width:auto">
            <option value="">Todos os tipos</option>
            <option value="crlv">CRLV</option><option value="rg">RG</option><option value="cpf">CPF</option>
            <option value="cnh">CNH</option><option value="comprovante_endereco">Comprovante Endereço</option>
            <option value="apolice_seguro">Apólice Seguro</option><option value="contrato">Contrato</option>
            <option value="holerite">Holerite</option><option value="outro">Outro</option>
          </select>
          <select class="form-select form-select-sm" id="doc-filter-entidade" style="width:auto">
            <option value="">Todas entidades</option>
            <option value="funcionario">Funcionários</option>
            <option value="veiculo">Veículos</option>
          </select>
          <button class="btn btn-outline-primary btn-sm" onclick="App.filterDocumentos()"><i class="bi bi-funnel"></i> Filtrar</button>
        </div>
        ${canManage ? '<button class="btn btn-success btn-sm" id="btn-upload-doc"><i class="bi bi-upload"></i> Enviar Documento</button>' : ''}
      </div>
      <div id="documentos-list"></div>`;
    loadDocumentos();
    const uploadBtn = document.getElementById('btn-upload-doc');
    if (uploadBtn) uploadBtn.addEventListener('click', () => openUploadDocModal());
  }

  async function loadDocumentos() {
    const container = document.getElementById('documentos-list');
    if (!container) return;
    container.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
    try {
      const tipo = document.getElementById('doc-filter-tipo')?.value || '';
      const entidade = document.getElementById('doc-filter-entidade')?.value || '';
      let url = '/api/documentos?';
      if (tipo) url += 'tipo=' + tipo + '&';
      if (entidade) url += 'entidade_tipo=' + entidade + '&';
      const docs = await api(url);
      if (!docs || docs.length === 0) {
        container.innerHTML = '<div class="text-muted text-center py-4">Nenhum documento encontrado</div>';
        return;
      }
      const typeLabels = { crlv:'CRLV', rg:'RG', cpf:'CPF', cnh:'CNH', comprovante_endereco:'Comp. Endereço', apolice_seguro:'Apólice Seguro', contrato:'Contrato', holerite:'Holerite', outro:'Outro' };
      const typeBadges = { crlv:'primary', rg:'info', cpf:'warning', cnh:'success', comprovante_endereco:'secondary', apolice_seguro:'danger', contrato:'dark', holerite:'primary', outro:'secondary' };
      let html = '<div class="row g-3">';
      for (const doc of docs) {
        const badge = typeBadges[doc.tipo] || 'secondary';
        const label = typeLabels[doc.tipo] || doc.tipo;
        const entLabel = doc.entidade_nome || (doc.entidade_tipo === 'funcionario' ? 'Funcionário #' + doc.entidade_id : 'Veículo #' + doc.entidade_id);
        const isImage = doc.arquivo_path && /\.(jpg|jpeg|png|gif|webp)$/i.test(doc.arquivo_path);
        const thumb = isImage ? `<img src="${doc.arquivo_path}" class="rounded" style="width:60px;height:60px;object-fit:cover;cursor:pointer" onclick="window.open('${doc.arquivo_path}')">` : '<div class="bg-light rounded d-flex align-items-center justify-content-center" style="width:60px;height:60px"><i class="bi bi-file-earmark-text fs-4 text-muted"></i></div>';
        const date = doc.created_at ? new Date(doc.created_at.replace(' ', 'T')).toLocaleDateString('pt-BR') : '';
        const via = doc.enviado_por_whatsapp ? '<span class="badge bg-success ms-1" style="font-size:0.65rem">WA</span>' : '';
        html += `
          <div class="col-md-6 col-lg-4">
            <div class="card h-100">
              <div class="card-body d-flex gap-3 p-2">
                ${thumb}
                <div class="flex-grow-1 overflow-hidden">
                  <div><span class="badge bg-${badge}">${label}</span>${via} <small class="text-muted">${date}</small></div>
                  <div class="small text-truncate mt-1">${doc.entidade_tipo === 'funcionario' ? '<i class="bi bi-person"></i>' : '<i class="bi bi-car-front"></i>'} ${entLabel}</div>
                  ${doc.descricao ? '<div class="small text-muted text-truncate">' + doc.descricao + '</div>' : ''}
                </div>
                <div class="d-flex flex-column gap-1">
                  <button class="btn btn-outline-danger btn-sm btn-del-doc" data-id="${doc.id}" title="Excluir"><i class="bi bi-trash"></i></button>
                </div>
              </div>
            </div>
          </div>`;
      }
      html += '</div>';
      container.innerHTML = html;
      container.querySelectorAll('.btn-del-doc').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Excluir este documento?')) {
            await api('/api/documentos/' + btn.dataset.id, { method: 'DELETE' });
            loadDocumentos();
          }
        });
      });
    } catch (err) {
      container.innerHTML = '<div class="alert alert-danger">Erro: ' + err.message + '</div>';
    }
  }

  function openUploadDocModal() {
    const title = 'Enviar Documento';
    const body = `
      <div class="mb-3">
        <label class="form-label">Tipo de Documento</label>
        <select class="form-select" id="upload-doc-tipo">
          <option value="crlv">CRLV</option><option value="rg">RG</option><option value="cpf">CPF</option>
          <option value="cnh">CNH</option><option value="comprovante_endereco">Comprovante de Endereço</option>
          <option value="apolice_seguro">Apólice de Seguro</option><option value="contrato">Contrato</option>
          <option value="holerite">Holerite</option><option value="outro">Outro</option>
        </select>
      </div>
      <div class="mb-3">
        <label class="form-label">Vincular a</label>
        <select class="form-select" id="upload-doc-entidade-tipo">
          <option value="funcionario">Funcionário</option>
          <option value="veiculo">Veículo</option>
        </select>
      </div>
      <div class="mb-3">
        <label class="form-label">Entidade</label>
        <select class="form-select" id="upload-doc-entidade-id"></select>
      </div>
      <div class="mb-3">
        <label class="form-label">Descrição (opcional)</label>
        <input type="text" class="form-control" id="upload-doc-descricao" placeholder="Descrição do documento">
      </div>
      <div class="mb-3">
        <label class="form-label">Arquivo (imagem ou PDF)</label>
        <input type="file" class="form-control" id="upload-doc-arquivo" accept="image/*,application/pdf">
      </div>
      <div id="upload-doc-preview" class="text-center mb-2"></div>
      <div class="mb-3">
        <button type="button" class="btn btn-outline-info btn-sm w-100" id="btn-analyze-doc"><i class="bi bi-magic"></i> Analisar com IA</button>
        <small class="text-muted">Analisa o documento e identifica tipo/dados automaticamente</small>
      </div>`;
    const footer = '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button><button type="button" class="btn btn-primary" id="btn-save-doc">Enviar</button>';
    openModal(title, body, footer);

    // Load entities
    async function loadEntities() {
      const tipo = document.getElementById('upload-doc-entidade-tipo').value;
      const sel = document.getElementById('upload-doc-entidade-id');
      sel.innerHTML = '<option value="">Carregando...</option>';
      try {
        if (tipo === 'funcionario') {
          const funcs = await api('/api/funcionarios');
          sel.innerHTML = funcs.filter(f => f.status === 'ativo').map(f => '<option value="' + f.id + '">' + f.nome + '</option>').join('');
        } else {
          const veics = await api('/api/veiculos');
          sel.innerHTML = veics.map(v => '<option value="' + v.id + '">' + (v.marca||'') + ' ' + (v.modelo||'') + ' - ' + (v.placa||'') + '</option>').join('');
        }
      } catch (e) { sel.innerHTML = '<option value="">Erro ao carregar</option>'; }
    }
    loadEntities();
    document.getElementById('upload-doc-entidade-tipo').addEventListener('change', loadEntities);

    // File preview
    document.getElementById('upload-doc-arquivo').addEventListener('change', function() {
      const file = this.files[0];
      const preview = document.getElementById('upload-doc-preview');
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = e => { preview.innerHTML = '<img src="' + e.target.result + '" style="max-height:150px;border-radius:8px">'; };
        reader.readAsDataURL(file);
      } else { preview.innerHTML = ''; }
    });

    // AI Analyze button
    document.getElementById('btn-analyze-doc').addEventListener('click', async function() {
      const fileInput = document.getElementById('upload-doc-arquivo');
      if (!fileInput.files[0]) { showToast('Selecione um arquivo primeiro', 'warning'); return; }
      this.disabled = true;
      this.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Analisando...';
      try {
        const formData = new FormData();
        formData.append('arquivo', fileInput.files[0]);
        const resp = await fetch('/api/documentos/analyze', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('ponto_token') || localStorage.getItem('token')) },
          body: formData
        });
        const result = await resp.json();
        if (result.success && result.data) {
          const d = result.data;
          if (d.type) document.getElementById('upload-doc-tipo').value = d.type;
          if (d.description) document.getElementById('upload-doc-descricao').value = d.description;
          if (d._matches && d._matches.length > 0) {
            const m = d._matches[0];
            document.getElementById('upload-doc-entidade-tipo').value = m.entidade_tipo;
            await loadEntities();
            document.getElementById('upload-doc-entidade-id').value = m.entidade_id;
            showToast('IA identificou: ' + (d.type || 'documento') + ' → ' + m.nome, 'success');
          } else {
            showToast('IA identificou: ' + (d.type || 'documento'), 'info');
          }
        } else {
          showToast('Não foi possível analisar o documento', 'warning');
        }
      } catch (err) {
        showToast('Erro na análise: ' + err.message, 'danger');
      } finally {
        this.disabled = false;
        this.innerHTML = '<i class="bi bi-magic"></i> Analisar com IA';
      }
    });

    // Save button
    document.getElementById('btn-save-doc').addEventListener('click', async function() {
      const fileInput = document.getElementById('upload-doc-arquivo');
      if (!fileInput.files[0]) { showToast('Selecione um arquivo', 'warning'); return; }
      const entidadeId = document.getElementById('upload-doc-entidade-id').value;
      if (!entidadeId) { showToast('Selecione a entidade', 'warning'); return; }
      this.disabled = true;
      try {
        const formData = new FormData();
        formData.append('arquivo', fileInput.files[0]);
        formData.append('tipo', document.getElementById('upload-doc-tipo').value);
        formData.append('entidade_tipo', document.getElementById('upload-doc-entidade-tipo').value);
        formData.append('entidade_id', entidadeId);
        formData.append('descricao', document.getElementById('upload-doc-descricao').value);
        const resp = await fetch('/api/documentos/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('ponto_token') || localStorage.getItem('token')) },
          body: formData
        });
        const result = await resp.json();
        if (result.id) {
          showToast('Documento enviado com sucesso', 'success');
          bootstrap.Modal.getInstance(document.getElementById('app-modal'))?.hide();
          loadDocumentos();
        } else {
          showToast(result.error || 'Erro ao enviar', 'danger');
        }
      } catch (err) {
        showToast('Erro: ' + err.message, 'danger');
      } finally {
        this.disabled = false;
      }
    });
  }

  // ===================== LOG DE ACESSOS =====================
  async function loadAccessLog(page) {
    const container = document.getElementById('access-log-content');
    container.innerHTML = '<div class="loading-spinner"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
    try {
      const startDate = document.getElementById('access-start')?.value || '';
      const endDate = document.getElementById('access-end')?.value || '';
      const acao = document.getElementById('access-acao')?.value || '';
      let url = '/api/auth/access-log?page=' + (page || 1);
      if (startDate) url += '&startDate=' + startDate;
      if (endDate) url += '&endDate=' + endDate;
      if (acao) url += '&acao=' + acao;
      const data = await api(url);
      const logs = data.logs || [];
      const badgeMap = { login: 'bg-success', logout: 'bg-primary', login_failed: 'bg-danger' };
      const labelMap = { login: 'Login', logout: 'Logout', login_failed: 'Falhou' };

      container.innerHTML = `
        <div class="data-table">
          <table class="table table-sm">
            <thead>
              <tr><th>Data/Hora</th><th>Usuário</th><th>Email</th><th>Ação</th><th>IP</th><th>Navegador</th></tr>
            </thead>
            <tbody>
              ${logs.length === 0 ? '<tr><td colspan="6" class="text-center text-muted py-3">Nenhum registro</td></tr>' : logs.map(l => {
                const dt = new Date(l.created_at).toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'});
                const badge = badgeMap[l.acao] || 'bg-secondary';
                const label = labelMap[l.acao] || l.acao;
                const ua = (l.user_agent || '').substring(0, 50);
                return `<tr>
                  <td><small>${dt}</small></td>
                  <td>${l.user_nome || '-'}</td>
                  <td><small>${l.user_email || '-'}</small></td>
                  <td><span class="badge ${badge}">${label}</span></td>
                  <td><small class="text-muted">${l.ip || '-'}</small></td>
                  <td><small class="text-muted" title="${(l.user_agent || '').replace(/"/g, '&quot;')}">${ua}${ua.length < (l.user_agent||'').length ? '...' : ''}</small></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        ${data.pages > 1 ? '<nav><ul class="pagination pagination-sm justify-content-center">' +
          Array.from({length: data.pages}, (_, i) => `<li class="page-item ${i+1 === data.page ? 'active' : ''}"><a class="page-link" href="#" onclick="App.loadAccessLog(${i+1});return false">${i+1}</a></li>`).join('') +
          '</ul></nav>' : ''}
        <small class="text-muted">${data.total || 0} registros</small>`;
    } catch (err) {
      container.innerHTML = '<div class="alert alert-danger">Erro: ' + err.message + '</div>';
    }
  }

  // ============================================================
  // Entregas
  // ============================================================
  async function renderEntregas(dataInicio, dataFim) {
    const content = document.getElementById('page-content');
    try {
      let url = '/api/entregas?limit=100';
      if (dataInicio) url += '&data_inicio=' + dataInicio;
      if (dataFim) url += '&data_fim=' + dataFim;
      const result = await api(url);
      const entregas = result.entregas || result.data || result;
      const funcs = await api('/api/funcionarios?includeInactive=true');
      const funcMap = {};
      funcs.forEach(f => funcMap[f.id] = f.nome);

      const hoje = new Date().toISOString().split('T')[0];
      const mesPassado = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const filtroInicio = dataInicio || mesPassado;
      const filtroFim = dataFim || hoje;

      const escapeAttr = (s) => (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;');

      content.innerHTML = `
        <div class="page-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h3><i class="bi bi-box-seam me-2"></i>Entregas</h3>
          <div class="d-flex align-items-center gap-2">
            <span class="badge bg-primary">${entregas.length} registro${entregas.length !== 1 ? 's' : ''}</span>
            <button class="btn btn-sm btn-success" onclick="App.openNovaEntrega()"><i class="bi bi-plus-lg me-1"></i>Nova Entrega</button>
          </div>
        </div>
        <div class="card mb-3">
          <div class="card-body py-2">
            <div class="row g-2 align-items-end">
              <div class="col-auto">
                <label class="form-label mb-0 small">De</label>
                <input type="date" id="entrega-data-inicio" class="form-control form-control-sm" value="${filtroInicio}">
              </div>
              <div class="col-auto">
                <label class="form-label mb-0 small">Até</label>
                <input type="date" id="entrega-data-fim" class="form-control form-control-sm" value="${filtroFim}">
              </div>
              <div class="col-auto">
                <button class="btn btn-sm btn-primary" onclick="App.filterEntregas()"><i class="bi bi-funnel me-1"></i>Filtrar</button>
              </div>
              <div class="col-auto">
                <button class="btn btn-sm btn-outline-secondary" onclick="App.filterEntregas('clear')"><i class="bi bi-x-circle me-1"></i>Limpar</button>
              </div>
            </div>
          </div>
        </div>
        ${(!entregas || entregas.length === 0)
          ? '<div class="text-center text-muted py-5"><i class="bi bi-box-seam" style="font-size:3rem"></i><p class="mt-2">Nenhuma entrega registrada no período</p></div>'
          : '<div class="row g-3">' + entregas.map(e => {
              const df = new Date(e.data_hora).toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'});
              const desc = e.descricao || '';
              const descT = desc.length > 100 ? desc.substring(0, 100) + '...' : desc;
              return '<div class="col-12 col-md-6 col-lg-4">' +
                '<div class="card h-100 shadow-sm"><div class="card-body p-3"><div class="d-flex gap-3">' +
                (e.imagem_path
                  ? '<img src="' + escapeAttr(e.imagem_path) + '" alt="Entrega" class="rounded" style="width:80px;height:80px;object-fit:cover;cursor:pointer;flex-shrink:0" onclick="App.openEntregaImage(\'' + escapeAttr(e.imagem_path) + '\',' + e.id + ',\'' + escapeAttr(df) + '\')">'
                  : '<div class="rounded bg-light d-flex align-items-center justify-content-center" style="width:80px;height:80px;flex-shrink:0"><i class="bi bi-box-seam text-muted" style="font-size:2rem"></i></div>') +
                '<div class="flex-grow-1" style="min-width:0">' +
                  '<div class="d-flex justify-content-between align-items-start">' +
                    '<small class="text-muted"><i class="bi bi-clock me-1"></i>' + df + '</small>' +
                    '<button class="btn btn-sm btn-link p-0 text-muted" onclick="App.editEntrega(' + e.id + ')" title="Editar"><i class="bi bi-pencil"></i></button>' +
                  '</div>' +
                  (e.destinatario ? '<div class="mt-1"><small class="fw-bold"><i class="bi bi-person me-1"></i>' + escapeAttr(e.destinatario) + '</small></div>' : '') +
                  (e.remetente ? '<div><small><i class="bi bi-shop me-1"></i>' + escapeAttr(e.remetente) + '</small></div>' : '') +
                  (e.transportadora ? '<div><small><i class="bi bi-truck me-1"></i>' + escapeAttr(e.transportadora) + '</small></div>' : '') +
                  '<div><small class="text-muted"><i class="bi bi-person-check me-1"></i>' + escapeAttr(funcMap[e.funcionario_id] || 'Não identificado') + '</small></div>' +
                  (descT ? '<div class="mt-1"><small class="text-muted fst-italic" title="' + escapeAttr(desc) + '">' + escapeAttr(descT) + '</small></div>' : '') +
                '</div>' +
                '</div></div></div></div>';
            }).join('') + '</div>'}

        <!-- Modal Imagem -->
        <div class="modal fade" id="entregaImageModal" tabindex="-1">
          <div class="modal-dialog modal-lg modal-dialog-centered">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title" id="entregaImageModalTitle">Foto da Entrega</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body text-center p-2">
                <img id="entregaImageFull" src="" alt="Entrega" class="img-fluid rounded" style="max-height:70vh">
              </div>
            </div>
          </div>
        </div>

        <!-- Modal Edição -->
        <div class="modal fade" id="entregaEditModal" tabindex="-1">
          <div class="modal-dialog">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">Editar Entrega</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">
                <input type="hidden" id="editEntregaId">
                <div class="mb-3">
                  <label class="form-label">Destinatário</label>
                  <input type="text" id="editEntregaDestinatario" class="form-control">
                </div>
                <div class="mb-3">
                  <label class="form-label">Remetente</label>
                  <input type="text" id="editEntregaRemetente" class="form-control">
                </div>
                <div class="mb-3">
                  <label class="form-label">Transportadora</label>
                  <input type="text" id="editEntregaTransportadora" class="form-control">
                </div>
                <div class="mb-3">
                  <label class="form-label">Descrição</label>
                  <textarea id="editEntregaDescricao" class="form-control" rows="3"></textarea>
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                <button type="button" class="btn btn-primary" onclick="App.saveEntrega()"><i class="bi bi-check-lg me-1"></i>Salvar</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Modal Nova Entrega -->
        <div class="modal fade" id="novaEntregaModal" tabindex="-1">
          <div class="modal-dialog">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title"><i class="bi bi-plus-circle me-2"></i>Nova Entrega</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">
                <form id="novaEntregaForm" enctype="multipart/form-data">
                  <div class="mb-3">
                    <label class="form-label">Foto da entrega</label>
                    <input type="file" id="novaEntregaFoto" class="form-control" accept="image/*">
                    <div id="novaEntregaPreview" class="mt-2" style="display:none">
                      <img id="novaEntregaPreviewImg" class="rounded" style="max-height:150px;max-width:100%">
                    </div>
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Destinatário</label>
                    <input type="text" id="novaEntregaDestinatario" class="form-control" placeholder="Ex: Edmar, Roberto...">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Remetente</label>
                    <input type="text" id="novaEntregaRemetente" class="form-control" placeholder="Ex: Amazon, Mercado Livre...">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Transportadora</label>
                    <input type="text" id="novaEntregaTransportadora" class="form-control" placeholder="Ex: Correios, Loggi...">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Data/hora</label>
                    <input type="datetime-local" id="novaEntregaDataHora" class="form-control">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Recebido por</label>
                    <select id="novaEntregaFuncionario" class="form-select">
                      <option value="">-- Selecione --</option>
                      ${funcs.map(f => '<option value="' + f.id + '">' + escapeAttr(f.nome) + '</option>').join('')}
                    </select>
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Observação</label>
                    <textarea id="novaEntregaDescricao" class="form-control" rows="2" placeholder="Detalhes sobre a entrega..."></textarea>
                  </div>
                </form>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                <button type="button" class="btn btn-success" onclick="App.saveNovaEntrega()" id="btnSaveNovaEntrega"><i class="bi bi-check-lg me-1"></i>Salvar</button>
              </div>
            </div>
          </div>
        </div>`;
    } catch (err) {
      content.innerHTML = '<div class="alert alert-danger">Erro: ' + err.message + '</div>';
    }
  }

  // ============================================================
  // TAREFAS
  // ============================================================
  async function renderTarefas() {
    const content = document.getElementById('page-content');
    try {
      const funcionarios = await api('/api/funcionarios');
      content.innerHTML = `
        <div class="filter-bar flex-wrap gap-2">
          <div>
            <label class="form-label">Status</label>
            <select class="form-select" id="tarefa-filter-status">
              <option value="">Todos</option>
              <option value="pendente" selected>Pendente</option>
              <option value="em_andamento">Em Andamento</option>
              <option value="concluida">Concluída</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </div>
          <div>
            <label class="form-label">Prioridade</label>
            <select class="form-select" id="tarefa-filter-prioridade">
              <option value="">Todas</option>
              <option value="alta">Alta</option>
              <option value="media">Média</option>
              <option value="baixa">Baixa</option>
            </select>
          </div>
          <div>
            <label class="form-label">Funcionário</label>
            <select class="form-select" id="tarefa-filter-func">
              <option value="">Todos</option>
              ${funcionarios.map(f => '<option value="' + f.id + '">' + f.nome + '</option>').join('')}
            </select>
          </div>
          <div>
            <button class="btn btn-primary" onclick="App.filterTarefas()">
              <i class="bi bi-search"></i> Buscar
            </button>
          </div>
          <div class="ms-auto">
            <button class="btn btn-success" onclick="App.openTarefaModal()">
              <i class="bi bi-plus-lg"></i> Nova Tarefa
            </button>
          </div>
        </div>
        <div id="tarefas-list"></div>`;
      filterTarefas();
    } catch (err) {
      content.innerHTML = '<div class="alert alert-danger">Erro: ' + err.message + '</div>';
    }
  }

  async function filterTarefas() {
    const container = document.getElementById('tarefas-list');
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner"><div class="spinner-border spinner-border-sm text-primary"></div></div>';

    try {
      let url = '/api/tarefas?';
      const status = document.getElementById('tarefa-filter-status')?.value;
      const prioridade = document.getElementById('tarefa-filter-prioridade')?.value;
      const funcId = document.getElementById('tarefa-filter-func')?.value;
      if (status) url += 'status=' + status + '&';
      if (prioridade) url += 'prioridade=' + prioridade + '&';
      if (funcId) url += 'funcionarioId=' + funcId + '&';

      const tarefas = await api(url);

      if (tarefas.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="bi bi-list-task"></i><p>Nenhuma tarefa encontrada</p></div>';
        return;
      }

      const prioridadeBadge = { alta: 'danger', media: 'warning', baixa: 'info' };
      const statusBadge = { pendente: 'secondary', em_andamento: 'primary', concluida: 'success', cancelada: 'dark' };
      const statusLabel = { pendente: 'Pendente', em_andamento: 'Em Andamento', concluida: 'Concluída', cancelada: 'Cancelada' };
      const isAdmin = currentUser.role === 'admin' || currentUser.role === 'gestor';

      container.innerHTML = `<div class="row g-3">${tarefas.map(t => {
        const prazoDate = t.prazo ? new Date(t.prazo + 'T12:00:00') : null;
        const isOverdue = prazoDate && prazoDate < new Date() && t.status !== 'concluida';
        const funcNames = (t.funcionarios || []).map(f => f.funcionario_nome).join(', ') || 'Ninguém atribuído';

        return '<div class="col-md-6 col-lg-4"><div class="summary-card h-100' + (isOverdue ? ' border-danger' : '') + '">' +
          '<div class="d-flex justify-content-between align-items-start mb-2">' +
            '<h6 class="mb-0">' + t.titulo + '</h6>' +
            '<span class="badge bg-' + (prioridadeBadge[t.prioridade] || 'secondary') + '">' + (t.prioridade || 'media') + '</span>' +
          '</div>' +
          (t.descricao ? '<p class="small text-muted mb-2">' + t.descricao + '</p>' : '') +
          '<div class="mb-2">' +
            '<i class="bi bi-person me-1"></i><small>' + funcNames + '</small>' +
          '</div>' +
          '<div class="d-flex justify-content-between align-items-center">' +
            '<div>' +
              '<span class="badge bg-' + (statusBadge[t.status] || 'secondary') + ' me-1">' + (statusLabel[t.status] || t.status) + '</span>' +
              (t.prazo ? '<small class="' + (isOverdue ? 'text-danger fw-bold' : 'text-muted') + '"><i class="bi bi-calendar3 me-1"></i>' + formatDate(t.prazo) + '</small>' : '') +
            '</div>' +
            '<div>' +
              (t.fonte !== 'web' ? '<span class="badge bg-success bg-opacity-25 text-success me-1" style="font-size:0.65em">WA</span>' : '') +
              (isAdmin ? '<button class="btn btn-action btn-outline-primary btn-sm" onclick="App.openTarefaModal(' + t.id + ')" title="Editar"><i class="bi bi-pencil"></i></button>' +
              '<button class="btn btn-action btn-outline-danger btn-sm ms-1" onclick="App.deleteTarefa(' + t.id + ')" title="Excluir"><i class="bi bi-trash"></i></button>' : '') +
            '</div>' +
          '</div>' +
        '</div></div>';
      }).join('')}</div>`;
    } catch (err) {
      container.innerHTML = '<div class="alert alert-danger">Erro: ' + err.message + '</div>';
    }
  }

  async function openTarefaModal(id) {
    const isEdit = !!id;
    const funcionarios = await api('/api/funcionarios');

    const body = `
      <form id="tarefa-form">
        <div class="mb-3">
          <label class="form-label">Título <span class="text-danger">*</span></label>
          <input type="text" class="form-control" id="tarefa-titulo" required>
        </div>
        <div class="mb-3">
          <label class="form-label">Descrição</label>
          <textarea class="form-control" id="tarefa-descricao" rows="2"></textarea>
        </div>
        <div class="row">
          <div class="col-md-4 mb-3">
            <label class="form-label">Prioridade</label>
            <select class="form-select" id="tarefa-prioridade">
              <option value="baixa">Baixa</option>
              <option value="media" selected>Média</option>
              <option value="alta">Alta</option>
            </select>
          </div>
          <div class="col-md-4 mb-3">
            <label class="form-label">Prazo</label>
            <input type="date" class="form-control" id="tarefa-prazo">
          </div>
          <div class="col-md-4 mb-3">
            <label class="form-label">Status</label>
            <select class="form-select" id="tarefa-status">
              <option value="pendente">Pendente</option>
              <option value="em_andamento">Em Andamento</option>
              <option value="concluida">Concluída</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </div>
        </div>
        <div class="mb-3">
          <label class="form-label">Atribuir Funcionário(s)</label>
          <div id="tarefa-func-checks" class="border rounded p-2" style="max-height:150px;overflow-y:auto">
            ${funcionarios.map(f => '<div class="form-check"><input class="form-check-input tarefa-func-check" type="checkbox" value="' + f.id + '" id="tf-' + f.id + '"><label class="form-check-label" for="tf-' + f.id + '">' + f.nome + '</label></div>').join('')}
          </div>
        </div>
      </form>`;

    const footer = '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>' +
      '<button type="button" class="btn btn-primary" onclick="App.saveTarefa(' + (id || 'null') + ')">Salvar</button>';

    openModal(isEdit ? 'Editar Tarefa' : 'Nova Tarefa', body, footer);

    if (isEdit) {
      const t = await api('/api/tarefas/' + id);
      document.getElementById('tarefa-titulo').value = t.titulo;
      document.getElementById('tarefa-descricao').value = t.descricao || '';
      document.getElementById('tarefa-prioridade').value = t.prioridade;
      document.getElementById('tarefa-prazo').value = t.prazo || '';
      document.getElementById('tarefa-status').value = t.status;
      (t.funcionarios || []).forEach(f => {
        const cb = document.getElementById('tf-' + f.funcionario_id);
        if (cb) cb.checked = true;
      });
    }
  }

  async function saveTarefa(id) {
    const funcChecks = document.querySelectorAll('.tarefa-func-check:checked');
    const funcIds = Array.from(funcChecks).map(cb => parseInt(cb.value));

    const data = {
      titulo: document.getElementById('tarefa-titulo').value,
      descricao: document.getElementById('tarefa-descricao').value || null,
      prioridade: document.getElementById('tarefa-prioridade').value,
      prazo: document.getElementById('tarefa-prazo').value || null,
      status: document.getElementById('tarefa-status').value,
      funcionario_ids: funcIds
    };

    if (!data.titulo) { showToast('Título obrigatório', 'danger'); return; }

    try {
      if (id) {
        await api('/api/tarefas/' + id, { method: 'PUT', body: JSON.stringify(data) });
        showToast('Tarefa atualizada com sucesso');
      } else {
        await api('/api/tarefas', { method: 'POST', body: JSON.stringify(data) });
        showToast('Tarefa criada com sucesso');
      }
      closeModal();
      filterTarefas();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  function deleteTarefa(id) {
    confirmAction('Deseja excluir esta tarefa?', async () => {
      try {
        await api('/api/tarefas/' + id, { method: 'DELETE' });
        showToast('Tarefa excluída');
        filterTarefas();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });
  }

  // ============================================================
  // CHAT WHATSAPP (modal on funcionários)
  // ============================================================
  async function openChatModal(funcionarioId, funcionarioNome) {
    const body = `
      <div id="chat-container" style="height:350px;overflow-y:auto;border:1px solid #dee2e6;border-radius:8px;padding:10px;background:#f8f9fa;margin-bottom:10px">
        <div class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm"></div> Carregando...</div>
      </div>
      <div class="input-group">
        <input type="text" class="form-control" id="chat-input" placeholder="Digite sua mensagem..." onkeydown="if(event.key==='Enter')App.sendChatMessage(${funcionarioId})">
        <button class="btn btn-primary" onclick="App.sendChatMessage(${funcionarioId})"><i class="bi bi-send"></i></button>
      </div>
      <div class="mt-2">
        <input type="file" class="form-control form-control-sm" id="chat-file-input" accept="image/*,.pdf,.doc,.docx">
        <button class="btn btn-sm btn-outline-secondary mt-1" onclick="App.sendChatMedia(${funcionarioId})"><i class="bi bi-paperclip"></i> Enviar arquivo</button>
      </div>`;

    const modalEl = document.getElementById('app-modal');
    modalEl.querySelector('.modal-dialog').classList.add('modal-lg');
    modalEl.addEventListener('hidden.bs.modal', function handler() {
      modalEl.querySelector('.modal-dialog').classList.remove('modal-lg');
      modalEl.removeEventListener('hidden.bs.modal', handler);
    });

    openModal('Chat com ' + funcionarioNome, body, '');

    // Load messages
    try {
      const data = await api('/api/whatsapp/chat/' + funcionarioId + '?limit=100');
      const container = document.getElementById('chat-container');
      if (!data.messages || data.messages.length === 0) {
        container.innerHTML = '<div class="text-center text-muted py-4"><i class="bi bi-chat-dots" style="font-size:2rem"></i><p>Nenhuma mensagem ainda</p></div>';
        return;
      }
      container.innerHTML = data.messages.map(m => {
        const isSent = m.direcao === 'enviada';
        const time = m.created_at ? m.created_at.slice(11, 16) : '';
        const date = m.created_at ? m.created_at.slice(0, 10).split('-').reverse().join('/') : '';
        let content = m.conteudo || '';
        if (m.media_path) {
          if (m.tipo === 'foto') {
            content += '<br><img src="' + m.media_path + '" style="max-width:200px;border-radius:8px;margin-top:4px" onclick="window.open(\'' + m.media_path + '\')" class="cursor-pointer">';
          } else {
            content += '<br><a href="' + m.media_path + '" target="_blank" class="btn btn-sm btn-outline-primary mt-1"><i class="bi bi-download"></i> Arquivo</a>';
          }
        }
        return '<div class="mb-2 d-flex ' + (isSent ? 'justify-content-end' : 'justify-content-start') + '">' +
          '<div style="max-width:75%;padding:8px 12px;border-radius:12px;' + (isSent ? 'background:#0d6efd;color:#fff' : 'background:#fff;border:1px solid #dee2e6') + '">' +
            '<div class="small">' + content + '</div>' +
            '<div style="font-size:0.65rem;opacity:0.7;text-align:right">' + date + ' ' + time + '</div>' +
          '</div></div>';
      }).join('');
      container.scrollTop = container.scrollHeight;
    } catch (err) {
      document.getElementById('chat-container').innerHTML = '<div class="alert alert-danger">Erro: ' + err.message + '</div>';
    }
  }

  async function sendChatMessage(funcionarioId) {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';

    try {
      await api('/api/whatsapp/chat/' + funcionarioId + '/send', {
        method: 'POST', body: JSON.stringify({ message })
      });
      // Reload chat
      const data = await api('/api/whatsapp/chat/' + funcionarioId + '?limit=100');
      const container = document.getElementById('chat-container');
      container.innerHTML = data.messages.map(m => {
        const isSent = m.direcao === 'enviada';
        const time = m.created_at ? m.created_at.slice(11, 16) : '';
        let content = m.conteudo || '';
        if (m.media_path && m.tipo === 'foto') {
          content += '<br><img src="' + m.media_path + '" style="max-width:200px;border-radius:8px">';
        }
        return '<div class="mb-2 d-flex ' + (isSent ? 'justify-content-end' : 'justify-content-start') + '">' +
          '<div style="max-width:75%;padding:8px 12px;border-radius:12px;' + (isSent ? 'background:#0d6efd;color:#fff' : 'background:#fff;border:1px solid #dee2e6') + '">' +
            '<div class="small">' + content + '</div>' +
            '<div style="font-size:0.65rem;opacity:0.7;text-align:right">' + time + '</div>' +
          '</div></div>';
      }).join('');
      container.scrollTop = container.scrollHeight;
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  async function sendChatMedia(funcionarioId) {
    const fileInput = document.getElementById('chat-file-input');
    if (!fileInput.files.length) { showToast('Selecione um arquivo', 'warning'); return; }
    const formData = new FormData();
    formData.append('media', fileInput.files[0]);
    try {
      const token = localStorage.getItem('ponto_token');
      await fetch('/api/whatsapp/chat/' + funcionarioId + '/send-media', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: formData
      });
      fileInput.value = '';
      showToast('Arquivo enviado');
      // Reload chat
      openChatModal(funcionarioId, '');
    } catch (err) {
      showToast('Erro ao enviar: ' + err.message, 'danger');
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
    filterRegistrosHoje: filterRegistrosHoje,
    loadRelatorio: loadRelatorio,
    loadFolha: loadFolha,
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
    resetUsuarioPassword: async function(id, email) {
      if (!confirm('Reenviar senha temporária para ' + email + '?')) return;
      try {
        await api('/api/auth/users/' + id + '/reset-password', { method: 'POST' });
        showToast('Senha reenviada para ' + email);
      } catch (err) {
        showToast('Erro: ' + err.message, 'danger');
      }
    },
    loadAuditLog: loadAuditLog,
    showLocationMap: showLocationMap,
    syncFeriados: syncFeriados,
    loadGraficos: loadGraficos,
    loadPresencaMensal: loadPresencaMensal,
    loadInsights: loadInsights,
    generateInsights: generateInsights,
    openCargoModal: openCargoModal,
    loadAccessLog: loadAccessLog,
    filterDocumentos: loadDocumentos,
    saveCargo: saveCargo,
    filterTarefas: filterTarefas,
    openTarefaModal: openTarefaModal,
    saveTarefa: saveTarefa,
    deleteTarefa: deleteTarefa,
    openChatModal: openChatModal,
    sendChatMessage: sendChatMessage,
    sendChatMedia: sendChatMedia,
    openNovaEntrega: function() {
      document.getElementById('novaEntregaForm').reset();
      document.getElementById('novaEntregaPreview').style.display = 'none';
      // Default data/hora = agora
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      document.getElementById('novaEntregaDataHora').value =
        now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate()) +
        'T' + pad(now.getHours()) + ':' + pad(now.getMinutes());
      // Preview da foto
      document.getElementById('novaEntregaFoto').onchange = function() {
        const file = this.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = function(e) {
            document.getElementById('novaEntregaPreviewImg').src = e.target.result;
            document.getElementById('novaEntregaPreview').style.display = 'block';
          };
          reader.readAsDataURL(file);
        } else {
          document.getElementById('novaEntregaPreview').style.display = 'none';
        }
      };
      new bootstrap.Modal(document.getElementById('novaEntregaModal')).show();
    },
    saveNovaEntrega: async function() {
      const btn = document.getElementById('btnSaveNovaEntrega');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Salvando...';
      try {
        const fotoFile = document.getElementById('novaEntregaFoto').files[0];
        const formData = new FormData();
        if (fotoFile) formData.append('foto', fotoFile);
        formData.append('destinatario', document.getElementById('novaEntregaDestinatario').value);
        formData.append('remetente', document.getElementById('novaEntregaRemetente').value);
        formData.append('transportadora', document.getElementById('novaEntregaTransportadora').value);
        formData.append('descricao', document.getElementById('novaEntregaDescricao').value);
        formData.append('data_hora', document.getElementById('novaEntregaDataHora').value.replace('T', ' '));
        formData.append('funcionario_id', document.getElementById('novaEntregaFuncionario').value);

        const token = localStorage.getItem('ponto_token') || localStorage.getItem('token');
        const resp = await fetch('/api/entregas/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token },
          body: formData
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error || 'Erro ao salvar');
        bootstrap.Modal.getInstance(document.getElementById('novaEntregaModal'))?.hide();
        showToast('Entrega registrada com sucesso!');
        const di = document.getElementById('entrega-data-inicio')?.value;
        const df = document.getElementById('entrega-data-fim')?.value;
        renderEntregas(di || undefined, df || undefined);
      } catch (err) {
        showToast('Erro: ' + err.message, 'danger');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Salvar';
      }
    },
    filterEntregas: function(action) {
      if (action === 'clear') {
        renderEntregas();
      } else {
        const di = document.getElementById('entrega-data-inicio')?.value;
        const df = document.getElementById('entrega-data-fim')?.value;
        renderEntregas(di || undefined, df || undefined);
      }
    },
    openEntregaImage: function(imgPath, id, dataStr) {
      document.getElementById('entregaImageFull').src = imgPath;
      document.getElementById('entregaImageModalTitle').textContent = 'Entrega #' + id + ' - ' + dataStr;
      new bootstrap.Modal(document.getElementById('entregaImageModal')).show();
    },
    editEntrega: async function(id) {
      try {
        const e = await api('/api/entregas/' + id);
        document.getElementById('editEntregaId').value = e.id;
        document.getElementById('editEntregaDestinatario').value = e.destinatario || '';
        document.getElementById('editEntregaRemetente').value = e.remetente || '';
        document.getElementById('editEntregaTransportadora').value = e.transportadora || '';
        document.getElementById('editEntregaDescricao').value = e.descricao || '';
        new bootstrap.Modal(document.getElementById('entregaEditModal')).show();
      } catch (err) {
        showToast('Erro ao carregar entrega: ' + err.message, 'danger');
      }
    },
    saveEntrega: async function() {
      const id = document.getElementById('editEntregaId').value;
      try {
        await api('/api/entregas/' + id, {
          method: 'PUT',
          body: JSON.stringify({
            destinatario: document.getElementById('editEntregaDestinatario').value || null,
            remetente: document.getElementById('editEntregaRemetente').value || null,
            transportadora: document.getElementById('editEntregaTransportadora').value || null,
            descricao: document.getElementById('editEntregaDescricao').value || null
          })
        });
        bootstrap.Modal.getInstance(document.getElementById('entregaEditModal'))?.hide();
        showToast('Entrega atualizada com sucesso');
        const di = document.getElementById('entrega-data-inicio')?.value;
        const df = document.getElementById('entrega-data-fim')?.value;
        renderEntregas(di || undefined, df || undefined);
      } catch (err) {
        showToast('Erro ao salvar: ' + err.message, 'danger');
      }
    }
  };

  // --- Init ---
  checkAuth();

})();
