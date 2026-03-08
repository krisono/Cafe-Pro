let catalogItems = [];
let rowCounter = 0;

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('received-date').value = todayISO();

  // pull all items so the dropdowns are populated
  try {
    const data = await api.get('/inventory');
    catalogItems = data.items;
  } catch (err) {
    toast.error('Could not load item catalog.');
  }

  addItemRow();

  document.getElementById('add-row-btn').addEventListener('click', addItemRow);
  document.getElementById('delivery-form').addEventListener('submit', submitDelivery);
});

function addItemRow() {
  const id = ++rowCounter;
  const container = document.getElementById('delivery-rows');
  const row = document.createElement('div');
  row.className = 'delivery-item-row';
  row.dataset.rowId = id;

  const options = catalogItems.map(i =>
    `<option value="${i.id}" data-category="${i.category}" data-name="${escHtml(i.name)}">${escHtml(i.name)}</option>`
  ).join('');

  row.innerHTML = `
    <div class="form-group" style="margin:0">
      <select class="form-control item-select" data-row="${id}">
        <option value="">Select item…</option>
        ${options}
        <option value="__new__">+ Add New Item</option>
      </select>
      <div class="new-item-fields hidden" id="new-item-${id}" style="margin-top:.5rem">
        <input type="text"   class="form-control mb-1" placeholder="Item name"  id="new-name-${id}" />
        <div style="display:flex;gap:.4rem">
          <select class="form-control" id="new-category-${id}">
            <option value="">Category…</option>
            <option value="produce">Produce</option>
            <option value="dairy">Dairy</option>
            <option value="protein">Protein</option>
            <option value="dry_goods">Dry Goods</option>
            <option value="beverages">Beverages</option>
          </select>
          <input type="text" class="form-control" placeholder="Unit (lbs, oz…)" id="new-unit-${id}" />
        </div>
      </div>
    </div>

    <div class="form-group" style="margin:0">
      <input type="number" class="form-control qty-input" placeholder="0" min="0.01" step="0.01" data-row="${id}" />
    </div>

    <div class="form-group" style="margin:0">
      <div class="exp-row">
        <input type="date" class="form-control exp-date-input" data-row="${id}" />
        <button type="button" class="btn btn-secondary btn-sm ai-shelf-btn" data-row="${id}" title="Get AI estimate">🤖</button>
      </div>
      <div class="exp-hint" id="exp-hint-${id}"></div>
    </div>

    <div class="form-group" style="margin:0">
      <span class="source-badge" id="source-badge-${id}">${sourceBadge('manual')}</span>
      <input type="hidden" class="exp-source-input" data-row="${id}" value="manual" />
    </div>

    <div style="padding-top:.3rem">
      <button type="button" class="btn btn-danger btn-sm remove-row-btn" data-row="${id}">×</button>
    </div>
  `;

  container.appendChild(row);

  row.querySelector('.item-select').addEventListener('change', (e) => {
    const newFields = document.getElementById(`new-item-${id}`);
    if (e.target.value === '__new__') {
      newFields.classList.remove('hidden');
    } else {
      newFields.classList.add('hidden');
    }
  });

  // if the user edits the date after the AI filled it, flip the source back to manual
  row.querySelector('.exp-date-input').addEventListener('change', (e) => {
    if (e.target.dataset.aiSet !== 'true') {
      setRowSource(id, 'manual');
    }
    e.target.dataset.aiSet = 'false';
  });

  row.querySelector('.ai-shelf-btn').addEventListener('click', () => getAIShelfLife(id));
  row.querySelector('.remove-row-btn').addEventListener('click', () => {
    row.remove();
    rowCounter = Math.max(0, rowCounter);
  });
}

function setRowSource(rowId, source) {
  const input = document.querySelector(`.exp-source-input[data-row="${rowId}"]`);
  const badge = document.getElementById(`source-badge-${rowId}`);
  if (input) input.value = source;
  if (badge) badge.innerHTML = sourceBadge(source);
}

async function getAIShelfLife(rowId) {
  const selectEl = document.querySelector(`.item-select[data-row="${rowId}"]`);
  const hintEl   = document.getElementById(`exp-hint-${rowId}`);
  const dateEl   = document.querySelector(`.exp-date-input[data-row="${rowId}"]`);
  const btn      = document.querySelector(`.ai-shelf-btn[data-row="${rowId}"]`);

  let name, category;

  if (selectEl.value === '__new__') {
    name     = document.getElementById(`new-name-${rowId}`)?.value.trim();
    category = document.getElementById(`new-category-${rowId}`)?.value;
  } else if (selectEl.value) {
    const opt = selectEl.querySelector(`option[value="${selectEl.value}"]`);
    name     = opt?.dataset.name;
    category = opt?.dataset.category;
  }

  if (!name || !category) {
    toast.warn('Select an item first before requesting an AI estimate.');
    return;
  }

  btn.textContent = '⟳';
  btn.disabled = true;
  hintEl.textContent = 'Estimating…';

  try {
    const result = await api.post('/ai/shelf-life', {
      name,
      category,
      date: document.getElementById('received-date').value || todayISO(),
    });

    dateEl.value = result.expiration_date;
    dateEl.dataset.aiSet = 'true';
    setRowSource(rowId, 'ai_suggested');

    const conf = result.confidence === 'high' ? '✅' : result.confidence === 'medium' ? '⚠️' : '❓';
    hintEl.innerHTML = `${conf} ${result.estimated_days}d · <em>${escHtml(result.reasoning)}</em>`;
    hintEl.style.color = 'var(--color-primary)';

    if (result.source === 'fallback') {
      toast.warn('AI unavailable — used default shelf-life estimate.');
    }

  } catch (err) {
    hintEl.textContent = 'Failed: ' + err.message;
    toast.error('Shelf-life estimate failed.');
  } finally {
    btn.textContent = '🤖';
    btn.disabled = false;
  }
}

async function submitDelivery(e) {
  e.preventDefault();
  const btn = document.getElementById('submit-btn');

  const supplierName = document.getElementById('supplier-name').value.trim();
  const receivedDate = document.getElementById('received-date').value;
  const notes        = document.getElementById('delivery-notes').value.trim();

  if (!supplierName || !receivedDate) {
    toast.warn('Supplier name and date are required.');
    return;
  }

  const rows = document.querySelectorAll('.delivery-item-row');
  const items = [];
  let valid = true;

  for (const row of rows) {
    const rowId      = row.dataset.rowId;
    const selectEl   = row.querySelector('.item-select');
    const qtyEl      = row.querySelector('.qty-input');
    const dateEl     = row.querySelector('.exp-date-input');
    const sourceEl   = row.querySelector('.exp-source-input');

    if (!selectEl.value) { toast.warn('Select an item for each row.'); valid = false; break; }
    if (!qtyEl.value || Number(qtyEl.value) <= 0) { toast.warn('Enter a valid quantity for each row.'); valid = false; break; }
    if (!dateEl.value) { toast.warn('Enter an expiration date for each row.'); valid = false; break; }

    if (selectEl.value === '__new__') {
      // new item — create it first, then treat it like any other
      const newName     = document.getElementById(`new-name-${rowId}`)?.value.trim();
      const newCategory = document.getElementById(`new-category-${rowId}`)?.value;
      const newUnit     = document.getElementById(`new-unit-${rowId}`)?.value.trim() || 'count';
      if (!newName || !newCategory) {
        toast.warn('Fill in name and category for new items.'); valid = false; break;
      }
      try {
        const created = await api.post('/inventory', { name: newName, category: newCategory, unit: newUnit, reorder_point: 0 });
        items.push({
          item_id:         created.item.id,
          quantity:        Number(qtyEl.value),
          expiration_date: dateEl.value,
          expiration_source: sourceEl.value || 'manual',
        });
      } catch (err) {
        toast.error('Failed to create new item: ' + err.message); valid = false; break;
      }
    } else {
      items.push({
        item_id:         Number(selectEl.value),
        quantity:        Number(qtyEl.value),
        expiration_date: dateEl.value,
        expiration_source: sourceEl.value || 'manual',
      });
    }
  }

  if (!valid) return;
  if (!items.length) { toast.warn('Add at least one item row.'); return; }

  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    await api.post('/deliveries', { supplier_name: supplierName, received_date: receivedDate, notes, items });
    toast.success(`Delivery logged — ${items.length} item(s) added to inventory.`);
    setTimeout(() => { window.location.href = '/inventory.html'; }, 1200);
  } catch (err) {
    toast.error('Delivery failed: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Submit Delivery';
  }
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
