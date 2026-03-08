let allItems = [];
let expandedItemId = null;
let currentEditItemId = null;

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('urgency')) document.getElementById('urgency-filter').value = params.get('urgency');
  if (params.get('category')) document.getElementById('category-filter').value = params.get('category');

  await loadInventory();
  bindFilters();
  bindModal();
  bindUseModal();
  bindExpiryModal();
  bindQtyModal();

  document.getElementById('use-date').value = todayISO();
});

async function loadInventory() {
  try {
    const search   = document.getElementById('search-input').value.trim();
    const category = document.getElementById('category-filter').value;
    const urgency  = document.getElementById('urgency-filter').value;
    const params   = new URLSearchParams();
    if (search)   params.set('search', search);
    if (category) params.set('category', category);
    if (urgency)  params.set('urgency', urgency);

    const data = await api.get('/inventory?' + params.toString());
    allItems = data.items;
    renderTable(allItems);
  } catch (err) {
    toast.error('Failed to load inventory: ' + err.message);
    document.getElementById('inventory-tbody').innerHTML =
      `<tr><td colspan="6" class="brief-empty">Error: ${err.message}</td></tr>`;
  }
}

function renderTable(items) {
  const tbody = document.getElementById('inventory-tbody');
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">
      <div style="font-size:2.5rem">📦</div>
      <p>No items found. Try adjusting your filters.</p>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(item => `
    <tr class="expandable-row" data-id="${item.id}">
      <td><strong>${escHtml(item.name)}</strong></td>
      <td><span style="text-transform:capitalize">${item.category.replace('_',' ')}</span></td>
      <td>${item.total_stock} <span class="text-muted">${item.unit}</span></td>
      <td>${expiryLabel(item.oldest_expiration)}</td>
      <td>${statusBadge(item.status)}</td>
      <td>
        <div style="display:flex;gap:.4rem">
          <button class="btn btn-secondary btn-sm use-btn" data-id="${item.id}" data-name="${escHtml(item.name)}" data-unit="${item.unit}" data-stock="${item.total_stock}">Use</button>
          <button class="btn btn-secondary btn-sm edit-btn" data-id="${item.id}">Edit</button>
          <button class="btn btn-danger btn-sm delete-btn" data-id="${item.id}">×</button>
        </div>
      </td>
    </tr>
    <tr class="expand-detail hidden" id="expand-${item.id}">
      <td colspan="6">
        <div class="batch-table-wrapper" id="batches-${item.id}">
          <div class="spinner"></div>
        </div>
      </td>
    </tr>
  `).join('');

  // click the row to see which batches are in stock and when they expire
  tbody.querySelectorAll('.expandable-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const id = Number(row.dataset.id);
      toggleExpand(id);
    });
  });

  tbody.querySelectorAll('.use-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openUseModal(btn.dataset.id, btn.dataset.name, btn.dataset.unit, btn.dataset.stock);
    });
  });

  tbody.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = allItems.find(i => i.id === Number(btn.dataset.id));
      if (item) openItemModal(item);
    });
  });

  tbody.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this item and all its batches?')) return;
      try {
        await api.delete('/inventory/' + btn.dataset.id);
        toast.success('Item deleted.');
        loadInventory();
      } catch (err) {
        toast.error(err.message);
      }
    });
  });
}

async function toggleExpand(itemId) {
  const detailRow = document.getElementById(`expand-${itemId}`);
  const batchesDiv = document.getElementById(`batches-${itemId}`);
  if (!detailRow) return;

  const isOpen = !detailRow.classList.contains('hidden');
  // Close 
  if (expandedItemId && expandedItemId !== itemId) {
    document.getElementById(`expand-${expandedItemId}`)?.classList.add('hidden');
  }

  if (isOpen) {
    detailRow.classList.add('hidden');
    expandedItemId = null;
    return;
  }

  detailRow.classList.remove('hidden');
  expandedItemId = itemId;

  try {
    const data = await api.get('/inventory/' + itemId);
    const batches = data.item.batches;
    if (!batches.length) {
      batchesDiv.innerHTML = '<p class="text-muted">No batches recorded yet.</p>';
      return;
    }
    batchesDiv.innerHTML = `
      <table class="batch-table">
        <thead>
          <tr>
            <th>Received</th>
            <th>Expiration</th>
            <th>Source</th>
            <th>Supplier</th>
            <th>Qty Received</th>
            <th>Qty Remaining</th>
          </tr>
        </thead>
        <tbody>
          ${batches.map((b, i) => `
            <tr style="${i === 0 ? 'font-weight:600' : ''}">
              <td>${formatDate(b.received_date)}</td>
              <td>
                ${expiryLabel(b.expiration_date)}
                <button class="btn btn-secondary btn-sm edit-expiry-btn"
                  data-batch-id="${b.id}" data-exp="${b.expiration_date}"
                  style="margin-left:.4rem;padding:2px 7px;font-size:.72rem" title="Edit expiry date">✏️</button>
              </td>
              <td>${sourceBadge(b.expiration_source)}</td>
              <td>${escHtml(b.supplier_name) || '—'}</td>
              <td>${b.quantity_received}</td>
              <td>
                ${b.quantity_remaining}
                <button class="btn btn-secondary btn-sm edit-qty-btn"
                  data-batch-id="${b.id}" data-qty="${b.quantity_remaining}"
                  style="margin-left:.4rem;padding:2px 7px;font-size:.72rem" title="Adjust quantity">✏️</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <p class="text-muted mt-1" style="font-size:.78rem">Batches ordered by expiration (oldest first — FIFO)</p>`;

    batchesDiv.querySelectorAll('.edit-expiry-btn').forEach(btn => {
      btn.addEventListener('click', () => openEditExpiry(btn.dataset.batchId, btn.dataset.exp, itemId));
    });
    batchesDiv.querySelectorAll('.edit-qty-btn').forEach(btn => {
      btn.addEventListener('click', () => openEditQty(btn.dataset.batchId, btn.dataset.qty, itemId));
    });
  } catch (err) {
    batchesDiv.innerHTML = `<p class="text-muted">Failed to load batches: ${err.message}</p>`;
  }
}

function bindFilters() {
  let debounce;
  document.getElementById('search-input').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(loadInventory, 300);
  });
  document.getElementById('category-filter').addEventListener('change', loadInventory);
  document.getElementById('urgency-filter').addEventListener('change', loadInventory);
  document.getElementById('clear-filters-btn').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    document.getElementById('category-filter').value = '';
    document.getElementById('urgency-filter').value = '';
    loadInventory();
  });
}

function bindModal() {
  document.getElementById('add-item-btn').addEventListener('click', () => openItemModal());
  document.getElementById('item-modal-cancel').addEventListener('click', closeItemModal);
  document.getElementById('item-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeItemModal();
  });
  document.getElementById('item-modal-save').addEventListener('click', saveItem);
}

function openItemModal(item = null) {
  document.getElementById('item-modal-title').textContent = item ? 'Edit Item' : 'Add Item';
  document.getElementById('item-modal-id').value     = item?.id || '';
  document.getElementById('item-name').value         = item?.name || '';
  document.getElementById('item-category').value     = item?.category || '';
  document.getElementById('item-unit').value         = item?.unit || '';
  document.getElementById('item-reorder').value      = item?.reorder_point ?? '';
  document.getElementById('item-init-qty').value     = '';
  document.getElementById('item-init-exp').value     = '';
  document.getElementById('initial-stock-fields').style.display = item ? 'none' : '';
  document.getElementById('item-modal').classList.remove('hidden');
}

function closeItemModal() {
  document.getElementById('item-modal').classList.add('hidden');
}

async function saveItem() {
  const id       = document.getElementById('item-modal-id').value;
  const payload  = {
    name:          document.getElementById('item-name').value.trim(),
    category:      document.getElementById('item-category').value,
    unit:          document.getElementById('item-unit').value.trim() || 'count',
    reorder_point: Number(document.getElementById('item-reorder').value) || 0,
  };
  if (!payload.name || !payload.category) {
    toast.warn('Name and category are required.');
    return;
  }

  const initQty = Number(document.getElementById('item-init-qty').value);
  const initExp = document.getElementById('item-init-exp').value;

  if (!id && initQty > 0 && !initExp) {
    toast.warn('Expiration date is required when adding an initial quantity.');
    return;
  }

  try {
    if (id) {
      await api.put('/inventory/' + id, payload);
      toast.success('Item updated.');
    } else {
      const result = await api.post('/inventory', payload);
      const newId = result.item.id;
      if (initQty > 0 && initExp) {
        await api.post(`/inventory/${newId}/batches`, {
          quantity: initQty,
          expiration_date: initExp,
        });
        toast.success('Item added with initial stock.');
      } else {
        toast.success('Item added.');
      }
    }
    closeItemModal();
    loadInventory();
  } catch (err) {
    toast.error(err.message);
  }
}

function bindUseModal() {
  document.getElementById('use-modal-cancel').addEventListener('click', closeUseModal);
  document.getElementById('use-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeUseModal();
  });
  document.getElementById('use-modal-save').addEventListener('click', submitUsage);
}

function openUseModal(itemId, itemName, unit, stock) {
  document.getElementById('use-item-id').value    = itemId;
  document.getElementById('use-item-name').textContent = itemName;
  document.getElementById('use-qty').value        = '';
  document.getElementById('use-date').value       = todayISO();
  document.getElementById('use-hint').textContent = `Available: ${stock} ${unit}`;
  document.getElementById('use-modal').classList.remove('hidden');
}

function closeUseModal() {
  document.getElementById('use-modal').classList.add('hidden');
}

async function submitUsage() {
  const itemId = document.getElementById('use-item-id').value;
  const qty    = Number(document.getElementById('use-qty').value);
  const date   = document.getElementById('use-date').value;
  if (!qty || qty <= 0) { toast.warn('Enter a valid quantity.'); return; }
  try {
    await api.post('/usage', { item_id: Number(itemId), quantity_used: qty, used_date: date });
    toast.success(`Usage logged (FIFO).`);
    closeUseModal();
    loadInventory();
  } catch (err) {
    toast.error(err.message);
  }
}

function bindExpiryModal() {
  document.getElementById('expiry-modal-cancel').addEventListener('click', closeEditExpiry);
  document.getElementById('expiry-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEditExpiry();
  });
  document.getElementById('expiry-modal-save').addEventListener('click', saveEditExpiry);
}

function openEditExpiry(batchId, currentDate, itemId) {
  document.getElementById('expiry-batch-id').value = batchId;
  document.getElementById('expiry-batch-id-label').textContent = batchId;
  document.getElementById('expiry-date-input').value = currentDate;
  currentEditItemId = itemId;
  document.getElementById('expiry-modal').classList.remove('hidden');
}

function closeEditExpiry() {
  document.getElementById('expiry-modal').classList.add('hidden');
}

async function saveEditExpiry() {
  const batchId = document.getElementById('expiry-batch-id').value;
  const date    = document.getElementById('expiry-date-input').value;
  if (!date) { toast.warn('Please select a date.'); return; }
  try {
    await api.patch('/inventory/batches/' + batchId, { expiration_date: date });
    toast.success('Expiry date updated.');
    closeEditExpiry();
    if (currentEditItemId) {
      expandedItemId = null;
      await toggleExpand(currentEditItemId);
      loadInventory();
    }
  } catch (err) {
    toast.error(err.message);
  }
}

function bindQtyModal() {
  document.getElementById('qty-modal-cancel').addEventListener('click', closeEditQty);
  document.getElementById('qty-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEditQty();
  });
  document.getElementById('qty-modal-save').addEventListener('click', saveEditQty);
}

function openEditQty(batchId, currentQty, itemId) {
  document.getElementById('qty-batch-id').value = batchId;
  document.getElementById('qty-input').value = currentQty;
  currentEditItemId = itemId;
  document.getElementById('qty-modal').classList.remove('hidden');
  document.getElementById('qty-input').focus();
  document.getElementById('qty-input').select();
}

function closeEditQty() {
  document.getElementById('qty-modal').classList.add('hidden');
}

async function saveEditQty() {
  const batchId = document.getElementById('qty-batch-id').value;
  const qty = Number(document.getElementById('qty-input').value);
  if (isNaN(qty) || qty < 0) { toast.warn('Enter a valid quantity (0 or more).'); return; }
  try {
    await api.patch('/inventory/batches/' + batchId, { quantity_remaining: qty });
    toast.success('Quantity updated.');
    closeEditQty();
    if (currentEditItemId) {
      expandedItemId = null;
      await toggleExpand(currentEditItemId);
      loadInventory();
    }
  } catch (err) {
    toast.error(err.message);
  }
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
