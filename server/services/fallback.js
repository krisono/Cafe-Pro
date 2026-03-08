const DEFAULT_SHELF_LIFE = {
  produce:   5,
  dairy:     10,
  protein:   3,
  dry_goods: 180,
  beverages: 30,
};

function generateDailyBrief(snapshot) {
  // for when it breaks
  const items         = Array.isArray(snapshot?.items)         ? snapshot.items         : [];
  const urgentBatches = Array.isArray(snapshot?.urgentBatches) ? snapshot.urgentBatches : [];

  const today = todayISO();
  const urgent    = [];
  const this_week = [];
  const reorder   = [];

  // make sure the same item doesn't appear twice
  const seenUrgent   = new Set();
  const seenThisWeek = new Set();

  for (const batch of urgentBatches) {
    // if theres nothing skip
    if (!batch.quantity_remaining || batch.quantity_remaining <= 0) continue;

    const diff = daysBetween(today, batch.expiration_date);
    // expired is urgent
    const isUrgent   = diff <= 2;
    const isThisWeek = diff > 2 && diff <= 7;

    const qty  = formatQty(batch.quantity_remaining, batch.unit);
    const name = batch.item_name || 'Unknown item';

    if (isUrgent && !seenUrgent.has(name)) {
      seenUrgent.add(name);
      urgent.push({
        item:       name,
        batch_qty:  qty,
        expires:    batch.expiration_date,
        suggestion: diff <= 0
          ? `${name} has already expired — remove from stock immediately.`
          : `Use remaining ${name} today or tomorrow before it expires.`,
      });
    } else if (isThisWeek && !seenThisWeek.has(name) && !seenUrgent.has(name)) {
      seenThisWeek.add(name);
      this_week.push({
        item:       name,
        batch_qty:  qty,
        expires:    batch.expiration_date,
        suggestion: `Feature ${name} on the menu this week — expires in ${diff} days.`,
      });
    }
  }

  for (const item of items) {
    const stock        = Number(item.total_stock) || 0;
    const reorderPoint = Number(item.reorder_point) || 0;
    if (reorderPoint > 0 && stock < reorderPoint) {
      reorder.push({
        item:          item.name,
        current_qty:   formatQty(stock, item.unit),
        reorder_point: formatQty(reorderPoint, item.unit),
        suggestion:    `Reorder ${item.name} — only ${formatQty(stock, item.unit)} left (min ${formatQty(reorderPoint, item.unit)}).`,
      });
    }
  }

  return { urgent, this_week, reorder, waste_insight: null };
}

function estimateShelfLife({ name, category, date }) {
  const baseDate = isValidDateStr(date) ? date : todayISO();
  const days     = DEFAULT_SHELF_LIFE[category] ?? DEFAULT_SHELF_LIFE['dry_goods'];

  return {
    estimated_days:  days,
    expiration_date: addDays(baseDate, days),
    confidence:      'low',
    reasoning:       `Default shelf life for ${category || 'unknown'} is approximately ${days} days.`,
  };
}

function daysBetween(from, to) {
  if (!isValidDateStr(from) || !isValidDateStr(to)) return 9999;
  const a = new Date(from);
  const b = new Date(to);
  return Math.ceil((b - a) / (1000 * 60 * 60 * 24));
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return todayISO();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function isValidDateStr(str) {
  if (!str || typeof str !== 'string') return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}

function formatQty(qty, unit) {
  const q = qty !== null && qty !== undefined ? qty : '?';
  return unit ? `${q} ${unit}` : String(q);
}

module.exports = { generateDailyBrief, estimateShelfLife, DEFAULT_SHELF_LIFE };
