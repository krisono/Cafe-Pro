document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('today-date').textContent =
    new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  await Promise.all([loadStats(), loadBrief()]);

  document.getElementById('refresh-brief-btn').addEventListener('click', async () => {
    await loadBrief(true);
  });
});

async function loadStats() {
  try {
    const [allData, urgentData, weekData, lowData] = await Promise.all([
      api.get('/inventory'),
      api.get('/inventory?urgency=urgent'),
      api.get('/inventory?urgency=warning'),
      api.get('/inventory?urgency=low'),
    ]);
    document.getElementById('stat-total').textContent  = allData.items.length;
    document.getElementById('stat-urgent').textContent = urgentData.items.length;
    document.getElementById('stat-week').textContent   = weekData.items.length;
    document.getElementById('stat-low').textContent    = lowData.items.length;

    renderUrgencyList(urgentData.items.slice(0, 5));
    renderReorderList(lowData.items.slice(0, 5));
  } catch (err) {
    toast.error('Failed to load stats: ' + err.message);
  }
}

async function loadBrief(forced = false) {
  const container  = document.getElementById('brief-content');
  const sourceEl   = document.getElementById('brief-source');
  const spinner    = document.getElementById('brief-spinner');
  const btn        = document.getElementById('refresh-brief-btn');

  container.innerHTML = `<div class="brief-loading"><div class="spinner"></div><p class="mt-1">Generating your daily brief…</p></div>`;
  if (spinner) spinner.classList.remove('hidden');
  btn.disabled = true;

  try {
    const data = await apiFetch('/ai/daily-brief', { timeoutMs: 30000 });
    sourceEl.textContent = data.source === 'ai' ? '✨ AI-powered' : '📏 Rule-based';
    renderBrief(data.brief);
  } catch (err) {
    container.innerHTML = `<div class="brief-empty">Failed to load brief: ${err.message}</div>`;
    toast.error('Brief failed: ' + err.message);
  } finally {
    if (spinner) spinner.classList.add('hidden');
    btn.disabled = false;
  }
}

function renderBrief(brief) {
  const container = document.getElementById('brief-content');
  let html = '';

  // 🔴 items expiring in the next 2 days
  if (brief.urgent && brief.urgent.length > 0) {
    html += `<div class="brief-section">
      <div class="brief-section-title urgent">🔴 Use Now — Expiring Very Soon</div>`;
    for (const item of brief.urgent) {
      html += `<div class="brief-item urgent">
        <span><strong>${escHtml(item.item)}</strong><span class="brief-meta">${escHtml(item.batch_qty)} · Expires ${escHtml(item.expires)}</span></span>
      </div>`;
    }
    html += `</div>`;
  }

  // 🟡 still got a few days but use it this week
  if (brief.this_week && brief.this_week.length > 0) {
    html += `<div class="brief-section">
      <div class="brief-section-title warning">🟡 Use This Week</div>`;
    for (const item of brief.this_week) {
      html += `<div class="brief-item warning">
        <span><strong>${escHtml(item.item)}</strong><span class="brief-meta">${escHtml(item.batch_qty)} · Expires ${escHtml(item.expires)}</span></span>
      </div>`;
    }
    html += `</div>`;
  }

  // 🟠 running low, place an order before you're out
  if (brief.reorder && brief.reorder.length > 0) {
    html += `<div class="brief-section">
      <div class="brief-section-title low">🟠 Reorder Soon</div>`;
    for (const item of brief.reorder) {
      html += `<div class="brief-item reorder">
        <span><strong>${escHtml(item.item)}</strong><span class="brief-meta">Stock: ${escHtml(item.current_qty)} · Min: ${escHtml(item.reorder_point)}</span></span>
      </div>`;
    }
    html += `</div>`;
  }

  // patterns the AI spotted across the whole inventory
  if (brief.waste_insight) {
    html += `<div class="brief-section">
      <div class="brief-section-title insight">💡 Waste Insight</div>
      <div class="brief-item" style="background:var(--color-bg)">${escHtml(brief.waste_insight)}</div>
    </div>`;
  }

  if (!html) {
    html = `<div class="brief-empty">✅ No urgent items! Your inventory looks great today.</div>`;
  }

  document.getElementById('brief-content').innerHTML = html;
}

function renderUrgencyList(items) {
  const el = document.getElementById('urgency-list');
  if (!items.length) {
    el.innerHTML = `<li class="text-muted" style="padding:.5rem 0">No urgent items today 🎉</li>`;
    return;
  }
  el.innerHTML = items.map(item => `
    <li class="urgency-item">
      <div>
        <div class="urgency-item-name">${escHtml(item.name)}</div>
        <div class="urgency-item-exp">${expiryLabel(item.oldest_expiration)}</div>
      </div>
      ${statusBadge(item.status)}
    </li>
  `).join('');
}

function renderReorderList(items) {
  const el = document.getElementById('reorder-list');
  if (!items.length) {
    el.innerHTML = `<li class="text-muted" style="padding:.5rem 0">All stock levels are healthy ✅</li>`;
    return;
  }
  el.innerHTML = items.map(item => `
    <li class="urgency-item">
      <div>
        <div class="urgency-item-name">${escHtml(item.name)}</div>
        <div class="urgency-item-exp">${item.total_stock} ${item.unit} remaining</div>
      </div>
      <span class="badge badge-low">🟠 Low</span>
    </li>
  `).join('');
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
