import { q, one, pool } from './db.js';
import { randomId } from './auth.js';

export const STATUSES = ['draft', 'sent', 'viewed', 'changes_requested', 'accepted', 'paid', 'declined'];
export const OPEN_STATUSES = ['draft', 'sent', 'viewed', 'changes_requested'];

export const STATUS_LABEL = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  changes_requested: 'Changes requested',
  accepted: 'Accepted, awaiting payment',
  client_paid: 'Client marked paid',
  paid: 'Paid',
  declined: 'Declined',
};

/** Status shown in the UI: an accepted invoice the client says is paid gets its own label. */
export const displayStatus = (quote) => (quote.status === 'accepted' && quote.client_paid_at ? 'client_paid' : quote.status);

export function baseUrl() {
  return (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`)
    .replace(/\/$/, '');
}

export const publicUrl = (quote) => `${baseUrl()}/q/${quote.public_id}`;
export const editUrl = (quote) => `${baseUrl()}/app/quotes/${quote.id}`;
export const quoteNumber = (quote) => `Q-${String(quote.seq).padStart(4, '0')}`;
export const invoiceNumber = (quote) => (quote.invoice_seq ? `INV-${String(quote.invoice_seq).padStart(4, '0')}` : null);
export const isInvoice = (quote) => quote.status === 'accepted' || quote.status === 'paid';
export const docNumber = (quote) => (isInvoice(quote) ? invoiceNumber(quote) : quoteNumber(quote));

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => ({
      description: String(it.description ?? '').trim(),
      quantity: round2(it.quantity ?? 1) || 0,
      unit_price: round2(it.unit_price ?? 0),
    }))
    .filter((it) => it.description);
}

export function totals(quote) {
  const items = quote.items || [];
  const subtotal = round2(items.reduce((s, it) => s + Number(it.quantity) * Number(it.unit_price), 0));
  const discount = Math.min(round2(quote.discount), subtotal);
  const taxable = round2(subtotal - discount);
  const taxPercent = Number(quote.tax_percent) || 0;
  const tax = round2((taxable * taxPercent) / 100);
  return { subtotal, discount, taxable, taxPercent, tax, total: round2(taxable + tax) };
}

export function money(amount, currency = 'INR') {
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency', currency, maximumFractionDigits: 2,
      minimumFractionDigits: Number.isInteger(Number(amount)) ? 0 : 2,
    }).format(Number(amount) || 0);
  } catch {
    return `${currency} ${(Number(amount) || 0).toFixed(2)}`;
  }
}

export function fmtDate(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function fmtDateTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: process.env.DISPLAY_TZ || 'Asia/Kolkata',
  });
}

export function isoDate(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().slice(0, 10);
}

export function addDays(days, from = new Date()) {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d;
}

export async function logEvent(quoteId, actor, message) {
  await q('INSERT INTO events (quote_id, actor, message) VALUES ($1, $2, $3)', [quoteId, actor, message]);
}

/** Accepts an internal id, "Q-0003", "INV-0002" or a public link id. */
export async function findQuote(userId, ref) {
  const s = String(ref ?? '').trim();
  let m;
  if (/^\d+$/.test(s)) return one('SELECT * FROM quotes WHERE user_id = $1 AND id = $2', [userId, Number(s)]);
  if ((m = s.match(/^Q-?0*(\d+)$/i))) return one('SELECT * FROM quotes WHERE user_id = $1 AND seq = $2', [userId, Number(m[1])]);
  if ((m = s.match(/^INV-?0*(\d+)$/i))) return one('SELECT * FROM quotes WHERE user_id = $1 AND invoice_seq = $2', [userId, Number(m[1])]);
  const pub = s.split('/q/').pop();
  return one('SELECT * FROM quotes WHERE user_id = $1 AND public_id = $2', [userId, pub]);
}

const LIST_COLS = `id, user_id, public_id, seq, title, client_name, client_email, client_company, currency, items,
  tax_percent, discount, status, sent_at, viewed_at, view_count, accepted_at, accepted_by, invoice_seq, due_date,
  client_paid_at, client_paid_note, paid_at, archived_at, change_requested_at, created_at, updated_at`;

/** status: all | unpaid | client_paid | archived | any real status. Archived quotes only show under "archived". */
export async function listQuotes(userId, status = 'all') {
  const base = `SELECT ${LIST_COLS} FROM quotes WHERE user_id = $1`;
  const order = ' ORDER BY created_at DESC';
  if (status === 'archived') return q(`${base} AND archived_at IS NOT NULL${order}`, [userId]);
  const live = `${base} AND archived_at IS NULL`;
  if (!status || status === 'all') return q(live + order, [userId]);
  if (status === 'unpaid') return q(`${live} AND status NOT IN ('paid','declined')${order}`, [userId]);
  if (status === 'client_paid') return q(`${live} AND status = 'accepted' AND client_paid_at IS NOT NULL${order}`, [userId]);
  return q(`${live} AND status = $2${order}`, [userId, status]);
}

export async function setArchived(quote, archived, actor) {
  const updated = await one(`UPDATE quotes SET archived_at = ${archived ? 'now()' : 'NULL'} WHERE id = $1 RETURNING *`, [quote.id]);
  await logEvent(quote.id, actor, archived ? 'Archived' : 'Restored from archive');
  return updated;
}

export async function getReminders(quoteId) {
  return q('SELECT * FROM reminders WHERE quote_id = $1 ORDER BY send_at, id', [quoteId]);
}

export async function getEvents(quoteId) {
  return q('SELECT * FROM events WHERE quote_id = $1 ORDER BY created_at DESC, id DESC', [quoteId]);
}

export async function createQuote(user, input, actor = 'Claude') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize numbering per user.
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
    const { rows: [{ next }] } = await client.query(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM quotes WHERE user_id = $1', [user.id]);
    const validUntil = input.valid_until || (input.valid_days ? isoDate(addDays(input.valid_days)) : isoDate(addDays(14)));
    const dueDate = input.due_date || (input.due_days != null ? isoDate(addDays(input.due_days)) : null);
    const { rows: [quote] } = await client.query(
      `INSERT INTO quotes (user_id, public_id, seq, title, client_name, client_email, client_company, currency,
         items, tax_percent, discount, summary, terms, payment_terms, valid_until, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [user.id, randomId(9), next, input.title, input.client_name || '', input.client_email || '',
        input.client_company || '', (input.currency || user.currency || 'INR').toUpperCase(),
        JSON.stringify(normalizeItems(input.items)), input.tax_percent || 0, input.discount || 0,
        input.summary || '', input.terms || '', input.payment_terms || '', validUntil, dueDate],
    );
    await client.query('INSERT INTO events (quote_id, actor, message) VALUES ($1,$2,$3)',
      [quote.id, actor, `Quote ${quoteNumber(quote)} created`]);
    await client.query('COMMIT');
    return quote;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const EDITABLE = ['title', 'client_name', 'client_email', 'client_company', 'currency', 'items', 'tax_percent',
  'discount', 'summary', 'terms', 'payment_terms', 'valid_until', 'due_date'];

export async function updateQuote(quote, patch, actor) {
  const sets = [];
  const vals = [];
  const changed = [];
  for (const key of EDITABLE) {
    if (patch[key] === undefined) continue;
    let v = patch[key];
    let same;
    if (key === 'items') {
      v = JSON.stringify(normalizeItems(v));
      same = v === JSON.stringify(quote.items);
    } else if (key === 'valid_until' || key === 'due_date') {
      v = v ? isoDate(v) : null;
      same = (v || '') === (quote[key] ? isoDate(quote[key]) : '');
    } else if (key === 'tax_percent' || key === 'discount') {
      v = Number(v) || 0;
      same = v === Number(quote[key]);
    } else {
      v = String(v ?? '');
      if (key === 'currency') v = v.toUpperCase();
      same = v === String(quote[key] ?? '');
    }
    if (same) continue;
    vals.push(v);
    sets.push(`${key} = $${vals.length}`);
    changed.push(key.replace(/_/g, ' '));
  }
  if (!sets.length) return quote;
  vals.push(quote.id);
  const updated = await one(
    `UPDATE quotes SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length} RETURNING *`, vals);
  await logEvent(quote.id, actor, `Edited: ${changed.join(', ')}`);
  return updated;
}

export async function markSent(quote, actor) {
  if (!['draft', 'changes_requested'].includes(quote.status)) return quote;
  const updated = await one(
    `UPDATE quotes SET status = 'sent', sent_at = now(), updated_at = now() WHERE id = $1 RETURNING *`, [quote.id]);
  await logEvent(quote.id, actor, 'Marked as sent to client');
  return updated;
}

export async function recordView(quote) {
  const firstView = !quote.viewed_at;
  const nextStatus = ['draft', 'sent'].includes(quote.status) ? 'viewed' : quote.status;
  const updated = await one(
    `UPDATE quotes SET view_count = view_count + 1, viewed_at = COALESCE(viewed_at, now()), status = $2
     WHERE id = $1 RETURNING *`, [quote.id, nextStatus]);
  if (firstView) await logEvent(quote.id, 'Client', 'Opened the link for the first time');
  return updated;
}

export async function acceptQuote(quote, name) {
  if (!OPEN_STATUSES.includes(quote.status)) return quote;
  const { rows: [{ next }] } = await pool.query(
    'SELECT COALESCE(MAX(invoice_seq), 0) + 1 AS next FROM quotes WHERE user_id = $1', [quote.user_id]);
  const updated = await one(
    `UPDATE quotes SET status = 'accepted', accepted_at = now(), accepted_by = $2, invoice_seq = $3,
       due_date = COALESCE(due_date, (now() + interval '7 days')::date), updated_at = now()
     WHERE id = $1 RETURNING *`, [quote.id, name, next]);
  await logEvent(quote.id, 'Client', `Accepted by ${name}. Invoice ${invoiceNumber(updated)} issued`);
  return updated;
}

export async function requestChanges(quote, text) {
  if (!OPEN_STATUSES.includes(quote.status)) return quote;
  const updated = await one(
    `UPDATE quotes SET status = 'changes_requested', change_request = $2, change_requested_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`, [quote.id, text]);
  // Pause follow-ups while the owner revises; re-sending the quote schedules them again.
  await q(`UPDATE reminders SET status = 'cancelled' WHERE quote_id = $1 AND status = 'scheduled'`, [quote.id]);
  await logEvent(quote.id, 'Client', `Requested changes: "${text}"`);
  return updated;
}

export async function declineQuote(quote, reason) {
  if (!OPEN_STATUSES.includes(quote.status)) return quote;
  const updated = await one(
    `UPDATE quotes SET status = 'declined', declined_at = now(), decline_reason = $2, updated_at = now()
     WHERE id = $1 RETURNING *`, [quote.id, reason || null]);
  await q(`UPDATE reminders SET status = 'cancelled' WHERE quote_id = $1 AND status = 'scheduled'`, [quote.id]);
  await logEvent(quote.id, 'Client', `Declined${reason ? `: "${reason}"` : ''}`);
  return updated;
}

export async function clientSaysPaid(quote, note, proof) {
  if (quote.status !== 'accepted') return quote;
  const updated = await one(
    `UPDATE quotes SET client_paid_at = now(), client_paid_note = $2, paid_proof = $3, paid_proof_mime = $4,
       updated_at = now() WHERE id = $1 RETURNING *`,
    [quote.id, note || null, proof ? proof.data : null, proof ? proof.mime : null]);
  await logEvent(quote.id, 'Client',
    `Marked as paid${note ? ` (ref: "${note}")` : ''}${proof ? ' with a payment screenshot' : ''}. Please confirm`);
  return updated;
}

export async function markPaid(quote, actor) {
  if (quote.status === 'paid') return quote;
  let inv = quote.invoice_seq;
  if (!inv) {
    const { rows: [{ next }] } = await pool.query(
      'SELECT COALESCE(MAX(invoice_seq), 0) + 1 AS next FROM quotes WHERE user_id = $1', [quote.user_id]);
    inv = next;
  }
  const updated = await one(
    `UPDATE quotes SET status = 'paid', paid_at = now(), invoice_seq = $2,
       accepted_at = COALESCE(accepted_at, now()), updated_at = now() WHERE id = $1 RETURNING *`, [quote.id, inv]);
  const cancelled = await q(
    `UPDATE reminders SET status = 'cancelled' WHERE quote_id = $1 AND status = 'scheduled' RETURNING id`, [quote.id]);
  await logEvent(quote.id, actor,
    `Marked as paid${cancelled.length ? `. ${cancelled.length} pending reminder(s) cancelled` : ''}`);
  return updated;
}

export async function addReminders(quote, reminders, { replace = false, auto = false } = {}, actor = 'Claude') {
  if (replace) {
    await q(`DELETE FROM reminders WHERE quote_id = $1 AND status = 'scheduled'`, [quote.id]);
  } else if (!auto) {
    // Custom reminders replace the default automatic ones that haven't gone out yet.
    await q(`DELETE FROM reminders WHERE quote_id = $1 AND status = 'scheduled' AND auto`, [quote.id]);
  }
  const created = [];
  for (const r of reminders) {
    let sendAt;
    if (r.send_at) sendAt = new Date(r.send_at);
    else sendAt = new Date(Date.now() + Number(r.send_in_days || 0) * 86400000);
    if (Number.isNaN(sendAt.getTime())) throw new Error(`Invalid send time for reminder "${r.subject}"`);
    created.push(await one(
      'INSERT INTO reminders (quote_id, send_at, subject, body, auto) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [quote.id, sendAt, r.subject, r.body, auto]));
  }
  await logEvent(quote.id, actor, `${created.length} ${auto ? 'automatic follow-up' : 'payment reminder'}(s) scheduled`);
  return created;
}

/** Standard follow-ups used when the owner has automatic reminders on and nobody wrote custom ones. */
export function defaultReminders(daysSetting = '3,7,14') {
  const days = String(daysSetting).split(',').map((d) => Number(d.trim())).filter((d) => d > 0).slice(0, 5);
  const templates = [
    ['Following up: {{title}} ({{number}})',
      'Hi {{client_name}},\n\nJust checking you received {{number}} for {{title}} ({{amount}}). You can review it and respond online using the button below.\n\nHappy to answer any questions.\n\nThanks,\n{{sender_name}}'],
    ['Reminder: {{number}} for {{amount}}',
      'Hi {{client_name}},\n\nA quick reminder about {{number}} for {{title}} ({{amount}}). It only takes a minute to review using the button below.\n\nThanks,\n{{sender_name}}'],
    ['Final reminder: {{number}} for {{amount}}',
      'Hi {{client_name}},\n\nThis is a final reminder about {{number}} for {{title}} ({{amount}}). Please review it using the button below, or reply to this email if anything needs to change.\n\nThanks,\n{{sender_name}}'],
  ];
  return days.map((d, i) => {
    const [subject, body] = templates[Math.min(i, templates.length - 1)];
    return { send_in_days: d, subject, body };
  });
}

/** Fill {{placeholders}} that Claude (or the owner) wrote into reminder text. */
export function fillTemplate(text, quote, user) {
  const t = totals(quote);
  const vars = {
    client_name: quote.client_name || 'there',
    client_company: quote.client_company || '',
    amount: money(t.total, quote.currency),
    total: money(t.total, quote.currency),
    link: publicUrl(quote),
    number: docNumber(quote),
    invoice_number: invoiceNumber(quote) || quoteNumber(quote),
    quote_number: quoteNumber(quote),
    due_date: quote.due_date ? fmtDate(quote.due_date) : 'on receipt',
    title: quote.title,
    business_name: user.business_name || user.name || '',
    sender_name: user.name || user.business_name || '',
  };
  return String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (all, key) => (key in vars ? vars[key] : all));
}

/** Plain object Claude gets back from MCP tools. */
export function quoteForClaude(quote, extra = {}) {
  const t = totals(quote);
  return {
    id: quote.id,
    number: docNumber(quote),
    quote_number: quoteNumber(quote),
    invoice_number: invoiceNumber(quote),
    title: quote.title,
    status: displayStatus(quote),
    status_label: STATUS_LABEL[displayStatus(quote)],
    client: { name: quote.client_name, email: quote.client_email, company: quote.client_company },
    currency: quote.currency,
    items: quote.items,
    subtotal: t.subtotal,
    discount: t.discount,
    tax_percent: t.taxPercent,
    tax: t.tax,
    total: t.total,
    total_formatted: money(t.total, quote.currency),
    summary: quote.summary,
    payment_terms: quote.payment_terms,
    terms: quote.terms,
    valid_until: isoDate(quote.valid_until) || null,
    due_date: isoDate(quote.due_date) || null,
    viewed: quote.view_count > 0,
    view_count: quote.view_count,
    accepted_by: quote.accepted_by,
    accepted_at: quote.accepted_at,
    client_says_paid: !!quote.client_paid_at,
    client_payment_ref: quote.client_paid_note || null,
    client_sent_payment_screenshot: !!quote.paid_proof_mime,
    change_request: quote.change_request || null,
    archived: !!quote.archived_at,
    paid_at: quote.paid_at,
    client_link: publicUrl(quote),
    edit_link: editUrl(quote),
    ...extra,
  };
}
