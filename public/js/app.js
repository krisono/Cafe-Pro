const API_BASE = '/api';

async function apiFetch(path, options = {}) {
  const { timeoutMs, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = timeoutMs
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const res = await fetch(API_BASE + path, {
      headers: { 'Content-Type': 'application/json', ...fetchOptions.headers },
      signal: controller.signal,
      ...fetchOptions,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out. Please try again.');
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

window.api = {
  get:    (path)         => apiFetch(path),
  post:   (path, body)   => apiFetch(path, { method: 'POST',   body: JSON.stringify(body) }),
  put:    (path, body)   => apiFetch(path, { method: 'PUT',    body: JSON.stringify(body) }),
  patch:  (path, body)   => apiFetch(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  delete: (path)         => apiFetch(path, { method: 'DELETE' }),
};

window.toast = {
  show(message, type = 'default', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity .3s';
      setTimeout(() => el.remove(), 300);
    }, duration);
  },
  success: (msg) => window.toast.show(msg, 'success'),
  error:   (msg) => window.toast.show(msg, 'error'),
  warn:    (msg) => window.toast.show(msg, 'warning'),
};

window.statusBadge = function(status) {
  const map = {
    URGENT:  ['badge-urgent',  '🔴 Urgent'],
    WARNING: ['badge-warning', '🟡 Warning'],
    HEALTHY: ['badge-healthy', '🟢 Healthy'],
    LOW:     ['badge-low',     '🟠 Low Stock'],
  };
  const [cls, label] = map[status] || ['badge-healthy', status];
  return `<span class="badge ${cls}">${label}</span>`;
};

window.sourceBadge = function(source) {
  const map = {
    supplier:     ['badge-supplier',     '🟢 Supplier'],
    ai_suggested: ['badge-ai_suggested', '🤖 AI Suggested'],
    manual:       ['badge-manual',       '✏️ Manual'],
  };
  const [cls, label] = map[source] || ['badge-manual', source];
  return `<span class="badge ${cls}">${label}</span>`;
};

window.todayISO = function() {
  return new Date().toISOString().split('T')[0];
};

window.formatDate = function(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

window.daysUntil = function(dateStr) {
  if (!dateStr) return null;
  const today = new Date(window.todayISO());
  const target = new Date(dateStr);
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
};

window.expiryLabel = function(dateStr) {
  const days = window.daysUntil(dateStr);
  if (days === null) return '—';
  if (days < 0)  return `<span style="color:var(--color-urgent)">Expired ${Math.abs(days)}d ago</span>`;
  if (days === 0) return `<span style="color:var(--color-urgent)">Expires today</span>`;
  if (days === 1) return `<span style="color:var(--color-urgent)">Tomorrow</span>`;
  if (days <= 7)  return `<span style="color:var(--color-warning)">${window.formatDate(dateStr)} (${days}d)</span>`;
  return `<span style="color:var(--color-healthy)">${window.formatDate(dateStr)}</span>`;
};

(function setActiveNav() {
  const path = window.location.pathname;
  document.querySelectorAll('.nav-links a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === path ||
      (path === '/' && a.getAttribute('href') === '/') ||
      (path.includes(a.getAttribute('href').replace('/', '')) && a.getAttribute('href') !== '/'));
  });
})();
