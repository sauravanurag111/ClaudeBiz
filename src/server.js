import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, one, q } from './db.js';
import {
  loadUser, requireUser, setSession, clearSession, verifyPassword, createUser, ensureDemoUser, randomId, isDemoUser,
} from './auth.js';
import {
  findQuote, listQuotes, getReminders, getEvents, createQuote, updateQuote, markSent, markPaid, recordView,
  acceptQuote, declineQuote, clientSaysPaid, addReminders, logEvent, baseUrl,
} from './quotes.js';
import { handleMcp } from './mcp.js';
import { startScheduler, runDueReminders, sendReminderNow, sendQuoteEmail, emailMode } from './reminders.js';
import {
  landingPage, authPage, dashboardPage, quoteEditPage, connectPage, settingsPage, publicQuotePage, messagePage,
} from './views.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

const FLASH = {
  saved: ['ok', 'Saved.'],
  created: ['ok', 'Blank quote created. Fill it in and save.'],
  sent: ['ok', 'Marked as sent.'],
  emailed: ['ok', 'Emailed the link to your client.'],
  logged: ['info', 'Email sending is not configured on this server, so nothing was emailed. Copy the client link and share it directly.'],
  paid: ['ok', 'Marked as paid. Pending reminders were cancelled.'],
  rsaved: ['ok', 'Reminder updated.'],
  radded: ['ok', 'Reminder scheduled.'],
  rsent: ['ok', 'Reminder processed. See its status below.'],
  rdeleted: ['ok', 'Reminder deleted.'],
  deleted: ['ok', 'Quote deleted.'],
  reset: ['ok', 'New connector URL created. Update it in Claude.'],
  accepted: ['ok', 'Thank you! The quote is accepted and your invoice is below.'],
  declined: ['ok', 'Thanks for letting us know. The sender has been notified.'],
  clientpaid: ['ok', 'Thanks! We\'ve let the sender know you paid.'],
  err: ['err', 'Something went wrong. Please try again.'],
  demoreset: ['info', 'The shared test account keeps a fixed connector URL so reviewers can use it. Create your own account to get a private one.'],
};
const flashFrom = (req) => {
  const f = FLASH[req.query.m];
  if (req.query.m === 'err' && req.query.e) return { type: 'err', text: String(req.query.e).slice(0, 200) };
  return f ? { type: f[0], text: f[1] } : null;
};

app.use(express.static(path.join(here, '..', 'public'), { maxAge: '1h' }));

// ---- MCP endpoint (Claude connects here) ----
app.all('/mcp/:key', express.json({ limit: '1mb' }), handleMcp);

app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(loadUser);

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Called by an external free cron (e.g. cron-job.org) so reminders go out even if the host sleeps.
app.all('/cron/tick', async (req, res) => {
  const expected = String(process.env.CRON_SECRET || '').trim();
  // Generated secrets can contain '+', which arrives as a space when not URL-encoded.
  const given = String(req.query.secret || req.get('x-cron-secret') || '').trim().replace(/ /g, '+');
  if (expected && given !== expected && encodeURIComponent(given) !== expected) {
    return res.status(403).send('forbidden: secret does not match CRON_SECRET');
  }
  const sent = await runDueReminders();
  res.json({ ok: true, processed: sent });
});

// ---- Marketing & auth ----
app.get('/', (req, res) => res.send(landingPage({ user: req.user })));

const demo = () => (process.env.DEMO_EMAIL && process.env.DEMO_PASSWORD && process.env.SHOW_DEMO_LOGIN !== 'false'
  ? { email: process.env.DEMO_EMAIL, password: process.env.DEMO_PASSWORD } : null);
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/app');

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/app');
  res.send(authPage({ mode: 'login', next: req.query.next || '', demo: demo() }));
});
app.post('/login', async (req, res) => {
  const { email = '', password = '', next } = req.body;
  const user = await one('SELECT * FROM users WHERE email = lower($1)', [email.trim()]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).send(authPage({ mode: 'login', error: 'Wrong email or password.', values: { email }, next, demo: demo() }));
  }
  setSession(res, user.id);
  res.redirect(safeNext(next));
});
app.get('/signup', (req, res) => (req.user ? res.redirect('/app') : res.send(authPage({ mode: 'signup' }))));
app.post('/signup', async (req, res) => {
  const { email = '', password = '', name = '', business_name: businessName = '' } = req.body;
  const values = { email, name, business_name: businessName };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).send(authPage({ mode: 'signup', error: 'Enter a valid email.', values }));
  }
  if (password.length < 8) return res.status(400).send(authPage({ mode: 'signup', error: 'Password must be at least 8 characters.', values }));
  if (await one('SELECT id FROM users WHERE email = lower($1)', [email.trim()])) {
    return res.status(400).send(authPage({ mode: 'signup', error: 'An account with this email already exists. Log in instead.', values }));
  }
  const user = await createUser({ email, password, name, businessName });
  setSession(res, user.id);
  res.redirect('/app/connect');
});
app.post('/logout', (_req, res) => {
  clearSession(res);
  res.redirect('/');
});

// ---- Owner app ----
const owner = express.Router();
owner.use(requireUser);

owner.get('/', async (req, res) => {
  const quotes = await listQuotes(req.user.id);
  const { n } = await one(
    `SELECT count(*)::int AS n FROM reminders r JOIN quotes x ON x.id = r.quote_id
     WHERE x.user_id = $1 AND r.status = 'scheduled'`, [req.user.id]);
  const filter = ['all', 'unpaid', 'accepted', 'paid', 'draft'].includes(req.query.status) ? req.query.status : 'all';
  res.send(dashboardPage({ user: req.user, quotes, filter, scheduledCount: n, flash: flashFrom(req) }));
});

owner.post('/quotes/new', async (req, res) => {
  const quote = await createQuote(req.user, {
    title: 'New project', client_name: '', items: [{ description: 'Work item', quantity: 1, unit_price: 0 }],
  }, req.user.name || 'You');
  res.redirect(`/app/quotes/${quote.id}?m=created`);
});

async function ownQuote(req, res, next) {
  const quote = await one('SELECT * FROM quotes WHERE id = $1 AND user_id = $2', [Number(req.params.id) || 0, req.user.id]);
  if (!quote) return res.status(404).send(messagePage({ title: 'Not found', text: 'That quote does not exist.', user: req.user }));
  req.quote = quote;
  next();
}
const me = (req) => req.user.name || 'You';
const back = (req, m) => `/app/quotes/${req.quote.id}?m=${m}`;

owner.get('/quotes/:id', ownQuote, async (req, res) => {
  const [reminders, events] = await Promise.all([getReminders(req.quote.id), getEvents(req.quote.id)]);
  res.send(quoteEditPage({
    user: req.user, quote: req.quote, reminders, events, flash: flashFrom(req), emailOn: emailMode() === 'email',
  }));
});

owner.post('/quotes/:id', ownQuote, async (req, res) => {
  const b = req.body;
  const patch = {
    title: (b.title || '').trim() || req.quote.title,
    client_name: b.client_name, client_email: b.client_email, client_company: b.client_company,
    currency: (b.currency || req.quote.currency).trim().slice(0, 3) || 'INR',
    summary: b.summary, terms: b.terms, payment_terms: b.payment_terms,
    discount: Number(b.discount) || 0, tax_percent: Number(b.tax_percent) || 0,
    valid_until: b.valid_until || null, due_date: b.due_date || null,
  };
  if (b.items_json) {
    try { patch.items = JSON.parse(b.items_json); } catch { /* keep existing items */ }
  }
  await updateQuote(req.quote, patch, me(req));
  res.redirect(back(req, 'saved'));
});

owner.post('/quotes/:id/delete', ownQuote, async (req, res) => {
  await q('DELETE FROM quotes WHERE id = $1', [req.quote.id]);
  res.redirect('/app?m=deleted');
});
owner.post('/quotes/:id/mark-sent', ownQuote, async (req, res) => {
  await markSent(req.quote, me(req));
  res.redirect(back(req, 'sent'));
});
owner.post('/quotes/:id/mark-paid', ownQuote, async (req, res) => {
  await markPaid(req.quote, me(req));
  res.redirect(back(req, 'paid'));
});
owner.post('/quotes/:id/send', ownQuote, async (req, res) => {
  try {
    const { delivery } = await sendQuoteEmail(req.quote, req.user);
    await markSent(req.quote, me(req));
    await logEvent(req.quote.id, me(req), delivery === 'email' ? `Emailed link to ${req.quote.client_email}` : 'Tried to email link (email not configured)');
    res.redirect(back(req, delivery === 'email' ? 'emailed' : 'logged'));
  } catch (err) {
    res.redirect(`/app/quotes/${req.quote.id}?m=err&e=${encodeURIComponent(err.message)}`);
  }
});

const validDate = (v) => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v) : null);

owner.post('/quotes/:id/reminders', ownQuote, async (req, res) => {
  const sendAt = validDate(req.body.send_at) || new Date(Date.now() + 86400000);
  await addReminders(req.quote, [{ send_at: sendAt.toISOString(), subject: req.body.subject || 'Reminder', body: req.body.body || '' }], {}, me(req));
  res.redirect(back(req, 'radded'));
});

async function ownReminder(req, res, next) {
  const r = await one('SELECT * FROM reminders WHERE id = $1 AND quote_id = $2', [Number(req.params.rid) || 0, req.quote.id]);
  if (!r) return res.redirect(back(req, 'err'));
  req.reminder = r;
  next();
}
owner.post('/quotes/:id/reminders/:rid', ownQuote, ownReminder, async (req, res) => {
  const sendAt = validDate(req.body.send_at) || req.reminder.send_at;
  await q(`UPDATE reminders SET subject = $2, body = $3, send_at = $4,
           status = CASE WHEN status = 'failed' THEN 'scheduled' ELSE status END WHERE id = $1`,
  [req.reminder.id, req.body.subject || req.reminder.subject, req.body.body || req.reminder.body, sendAt]);
  await logEvent(req.quote.id, me(req), `Edited reminder "${req.body.subject || req.reminder.subject}"`);
  res.redirect(back(req, 'rsaved'));
});
owner.post('/quotes/:id/reminders/:rid/send', ownQuote, ownReminder, async (req, res) => {
  if (req.body.subject || req.body.body) {
    await q('UPDATE reminders SET subject = $2, body = $3 WHERE id = $1',
      [req.reminder.id, req.body.subject || req.reminder.subject, req.body.body || req.reminder.body]);
  }
  await sendReminderNow(req.reminder.id);
  res.redirect(back(req, 'rsent'));
});
owner.post('/quotes/:id/reminders/:rid/delete', ownQuote, ownReminder, async (req, res) => {
  await q('DELETE FROM reminders WHERE id = $1', [req.reminder.id]);
  res.redirect(back(req, 'rdeleted'));
});

owner.get('/connect', (req, res) => {
  res.send(connectPage({ user: req.user, demo: isDemoUser(req.user), mcpUrl: `${baseUrl()}/mcp/${req.user.mcp_key}`, flash: flashFrom(req) }));
});
owner.post('/connect/reset', async (req, res) => {
  if (isDemoUser(req.user)) return res.redirect('/app/connect?m=demoreset');
  await one('UPDATE users SET mcp_key = $2 WHERE id = $1 RETURNING id', [req.user.id, randomId(18)]);
  res.redirect('/app/connect?m=reset');
});
owner.get('/settings', (req, res) => res.send(settingsPage({ user: req.user, flash: flashFrom(req) })));
owner.post('/settings', async (req, res) => {
  const b = req.body;
  await one(
    `UPDATE users SET name = $2, business_name = $3, business_address = $4, tax_id = $5,
       currency = $6, payment_instructions = $7 WHERE id = $1 RETURNING id`,
    [req.user.id, b.name || '', b.business_name || '', b.business_address || '', b.tax_id || '',
      (b.currency || 'INR').trim().toUpperCase().slice(0, 3), b.payment_instructions || '']);
  res.redirect('/app/settings?m=saved');
});

app.use('/app', owner);

// ---- Public client pages (no login) ----
async function publicQuote(req, res, next) {
  const quote = await one('SELECT * FROM quotes WHERE public_id = $1', [req.params.pid]);
  if (!quote) return res.status(404).send(messagePage({ title: 'Link not found', text: 'This quote link is invalid or was deleted by the sender.' }));
  req.quote = quote;
  req.owner = await one('SELECT * FROM users WHERE id = $1', [quote.user_id]);
  next();
}

app.get('/q/:pid', publicQuote, async (req, res) => {
  let quote = req.quote;
  const isOwner = req.user && req.user.id === quote.user_id;
  // Count real client visits only (not the owner, not link-preview bots).
  const ua = String(req.headers['user-agent'] || '');
  if (!isOwner && !/bot|crawler|spider|preview|slack|whatsapp|facebookexternalhit|telegram|discord|curl/i.test(ua)) {
    quote = await recordView(quote);
  }
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex');
  res.send(publicQuotePage({ quote, owner: req.owner, viewer: req.user, flash: flashFrom(req) }));
});
app.post('/q/:pid/accept', publicQuote, async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 120);
  if (!name) return res.redirect(`/q/${req.params.pid}`);
  await acceptQuote(req.quote, name);
  res.redirect(`/q/${req.params.pid}?m=accepted`);
});
app.post('/q/:pid/decline', publicQuote, async (req, res) => {
  await declineQuote(req.quote, String(req.body.reason || '').trim().slice(0, 1000));
  res.redirect(`/q/${req.params.pid}?m=declined`);
});
app.post('/q/:pid/paid', publicQuote, async (req, res) => {
  await clientSaysPaid(req.quote, String(req.body.note || '').trim().slice(0, 300));
  res.redirect(`/q/${req.params.pid}?m=clientpaid`);
});

app.use((req, res) => res.status(404).send(messagePage({ title: 'Page not found', text: 'Nothing here.', user: req.user })));
app.use((err, req, res, _next) => {
  console.error(err);
  if (req.path.startsWith('/mcp/')) {
    return res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
  res.status(500).send(messagePage({ title: 'Something went wrong', text: 'Please try again in a moment.', user: req.user }));
});

const port = Number(process.env.PORT) || 3000;
await migrate();
await ensureDemoUser();
startScheduler();
app.listen(port, () => console.log(`Dealflow running on ${baseUrl()} (port ${port}), email: ${emailMode()}`));
