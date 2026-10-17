'use strict';
// Bill = subtotal of (price x qty) + each tax % + each service charge %, all on the base subtotal.
// Rounded to paise at each line, exactly like the guest page, so the guest sees the same total.
const r2 = n => Math.round(n * 100) / 100;

function computeBill(lines, billing) {
  const subtotal = r2(lines.reduce((s, l) => s + Number(l.price) * l.qty, 0));
  const mk = arr => (arr || []).map(t => ({ name: t.name, rate: Number(t.rate) || 0, amount: r2(subtotal * (Number(t.rate) || 0) / 100) }));
  const taxes = mk(billing.taxes);
  const charges = mk(billing.charges);
  const total = r2(subtotal + taxes.reduce((s, t) => s + t.amount, 0) + charges.reduce((s, t) => s + t.amount, 0));
  return { subtotal, taxes, charges, total };
}
module.exports = { computeBill, r2 };
