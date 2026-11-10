import {
  STATUS_LABEL, totals, money, fmtDate, fmtDateTime, isoDate, quoteNumber, invoiceNumber, docNumber,
  isInvoice, publicUrl, baseUrl, fillTemplate, displayStatus, OPEN_STATUSES,
} from './quotes.js';
import { contactEmail } from './auth.js';

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const badge = (status) => `<span class="badge b-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
const rbadge = (status) => `<span class="badge b-${esc(status)}">${esc(status)}</span>`;

export function layout({ title, user, body, active = '', flash, bare = false }) {
  const nav = user
    ? `<a href="/app" class="${active === 'dash' ? 'on' : ''}">Quotes</a>
       <a href="/app/connect" class="${active === 'connect' ? 'on' : ''}">Connect Claude</a>
       <a href="/app/settings" class="${active === 'settings' ? 'on' : ''}">Settings</a>
       <form class="inline" method="post" action="/logout"><button class="btn sm" type="submit">Log out</button></form>`
    : `<a href="/#how">How it works</a><a href="/login">Log in</a><a class="btn sm primary" href="/signup">Start free</a>`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="Quotes that turn into invoices and chase payment. Runs on your own Claude, with no AI inside.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@500;600&display=swap">
<link rel="stylesheet" href="/style.css?v=7">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%235b47f5'/><text x='16' y='22' font-size='17' text-anchor='middle' fill='white' font-family='Arial' font-weight='bold'>D</text></svg>">
</head><body>
${bare ? '' : `<header class="topbar"><div class="wrap">
<a class="brand" href="${user ? '/app' : '/'}"><span class="logo">D</span>Dealflow</a>
<nav class="nav">${nav}</nav></div></header>`}
<main><div class="wrap">
${flash ? `<div class="flash ${esc(flash.type)}" role="status"${flash.type === 'ok' ? ' data-autohide' : ''}${flash.celebrate ? ' data-celebrate' : ''}><div>${esc(flash.text)}</div><button class="x" type="button" aria-label="Dismiss" data-dismiss>×</button></div>` : ''}
${body}
</div></main>
<footer class="site"><b>Dealflow</b> · Your Claude does the writing. Dealflow keeps it live. No AI inside.${process.env.CONTACT_EMAIL ? `<br>Questions? <a href="mailto:${esc(process.env.CONTACT_EMAIL)}">${esc(process.env.CONTACT_EMAIL)}</a>` : ''}</footer>
<script src="/app.js?v=7"></script>
</body></html>`;
}

const ICON = {
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8L4 10.7l5 3.6L7.2 20 12 16.5 16.8 20 15 14.3l5-3.6-6.1-1.9z"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  zero: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>',
};

/** Draft → Sent → Viewed → Accepted → Paid, with the current step highlighted. */
export function tracker(quote) {
  const steps = [['sent', 'Sent'], ['viewed', 'Opened'], ['accepted', 'Accepted'], ['paid', 'Paid']];
  const reached = {
    sent: !!quote.sent_at || quote.view_count > 0 || ['sent', 'viewed', 'changes_requested', 'accepted', 'paid'].includes(quote.status),
    viewed: quote.view_count > 0 || ['accepted', 'paid'].includes(quote.status),
    accepted: ['accepted', 'paid'].includes(quote.status),
    paid: quote.status === 'paid',
  };
  const declined = quote.status === 'declined';
  let nowMarked = false;
  const html = steps.map(([k, label], i) => {
    const done = reached[k];
    let cls = done ? 'done' : '';
    if (!done && !nowMarked && !declined) { cls = 'now'; nowMarked = true; }
    if (!done && declined && !nowMarked) { cls = 'bad'; nowMarked = true; label = 'Declined'; }
    if (k === 'paid' && !done && quote.client_paid_at) label = 'Client says paid';
    if (k === 'accepted' && !done && quote.status === 'changes_requested') label = 'Changes requested';
    const bar = i ? `<span class="bar ${done ? 'done' : ''}"></span>` : '';
    return `${bar}<span class="st ${cls}"><span class="dot">${done ? '✓' : cls === 'bad' ? '×' : ''}</span>${esc(label)}</span>`;
  }).join('');
  return `<div class="card tracker" aria-label="Progress">${html}</div>`;
}

function copyField(value, id) {
  return `<div class="copy"><input type="text" readonly value="${esc(value)}" id="${id}">
<button class="btn" type="button" data-copy="#${id}">Copy</button></div>`;
}

// ---------- Marketing & auth ----------

export function landingPage({ user }) {
  const cta = user
    ? '<a class="btn primary lg" href="/app">Open your quotes →</a>'
    : '<a class="btn primary lg" href="/signup">Start free →</a><a class="btn lg" href="/login">Try the demo</a>';
  return layout({
    title: 'Dealflow: quotes that get accepted and paid, written by your Claude',
    user,
    body: `
<section class="hero">
  <div>
    <span class="eyebrow"><b>For freelancers</b> Runs on your own Claude · no AI inside</span>
    <h1>Tell Claude what you're charging. <span class="serif grad-text"><i>We'll get you paid.</i></span></h1>
    <p class="lead">You do the work. Dealflow handles the awkward part after it. Describe the job to Claude in a sentence:
    Claude writes the quote, Dealflow sends it, your client accepts in one click, and polite follow-ups keep going until the money lands.</p>
    <div class="row">${cta}</div>
    <div class="trust"><span>Client needs no login</span><span>Reminders stop when paid</span><span>₹0 AI cost</span></div>
  </div>
  <div class="demo" aria-hidden="true">
    <div class="win">
      <div class="win-bar"><i></i><i></i><i></i><span>Claude</span></div>
      <div class="chat">
        <div class="msg me">Quote Anurag at Meesho for a logo redesign, ₹40k + brand guidelines ₹15k, 18% GST, half upfront.</div>
        <div class="msg ai">Done. I wrote the scope and terms and sent it with <code>create_quote</code>. Q-0001 is in Anurag's inbox, and follow-ups are set for days 3, 7 and 14.</div>
      </div>
    </div>
    <div class="quote-card">
      <div class="top"><span class="num">Q-0001 · Meesho</span>
        <span class="chips"><span class="badge b-sent">Sent</span><span class="badge b-viewed">Opened</span><span class="badge b-accepted">Accepted</span><span class="badge b-paid">Paid</span></span></div>
      <div class="muted small">Logo redesign & brand guidelines</div>
      <div class="amt">₹64,900</div>
      <div class="ln"><span>Logo redesign · 3 concepts</span><span>₹40,000</span></div>
      <div class="ln"><span>Brand guidelines</span><span>₹15,000</span></div>
      <div class="ln"><span>GST 18%</span><span>₹9,900</span></div>
    </div>
    <div class="ping">Anurag accepted your quote<small>Invoice INV-0001 issued · just now</small></div>
  </div>
</section>

<section class="stats reveal">
  <div><b>61%</b><span>of Indian freelancers have gone unpaid at least once</span><a href="https://yourstory.com/2018/01/41pc-freelancers-witnessing-growth-2017-india-now-largest-freelancers-market-paypal-report" target="_blank" rel="noopener">PayPal India survey</a></div>
  <div><b>2–4 wks</b><span>is how long many wait after invoicing to get paid</span><a href="https://yourstory.com/2018/01/41pc-freelancers-witnessing-growth-2017-india-now-largest-freelancers-market-paypal-report" target="_blank" rel="noopener">PayPal India survey</a></div>
  <div><b>204 hrs</b><span>a year lost to admin and paperwork</span><a href="https://contentgrip.com/freelancer-admin-ai-gap" target="_blank" rel="noopener">Smallpdf survey</a></div>
  <div><b>15M+</b><span>freelancers in India, second only to the US</span><a href="https://mediaindia.eu/?p=137926" target="_blank" rel="noopener">2024 estimate</a></div>
</section>

<h2 class="section-title reveal" id="how">From one sentence to <span class="serif grad-text"><i>paid</i></span></h2>
<p class="section-sub reveal">Claude does the thinking and writing. Dealflow does everything that has to keep happening after the chat closes.</p>
<section class="flow">
  <div class="card reveal"><div class="n grad-text">01 · In Claude</div><h3>"Quote Meesho for a logo redesign, 40k, half upfront"</h3><p class="muted small">Claude writes the scope, line items, terms and the cover email.</p></div>
  <div class="card reveal"><div class="n grad-text">02 · Sent for you</div><h3>Lands in your client's inbox</h3><p class="muted small">You can tweak anything in Dealflow; the link always shows the latest version.</p></div>
  <div class="card reveal"><div class="n grad-text">03 · Your client</div><h3>Opens, accepts or asks for changes</h3><p class="muted small">No login. Accepting turns it into an invoice with your payment details.</p></div>
  <div class="card reveal"><div class="n grad-text">04 · Until paid</div><h3>Follow-ups on autopilot</h3><p class="muted small">Gentle, then firmer. They stop the moment the client pays.</p></div>
</section>

<section class="grid g3 feature" style="margin-top:16px">
  <div class="card reveal"><div class="ico">${ICON.spark}</div><h3>Why not just Claude?</h3><p class="muted">Claude can write the quote, but it can't host it, see that your client opened it, record their acceptance or send a reminder next Tuesday. Dealflow does.</p></div>
  <div class="card reveal"><div class="ico">${ICON.doc}</div><h3>Why not invoicing software?</h3><p class="muted">No forms. You describe the work in plain words, and your Claude writes a sharper quote than any template.</p></div>
  <div class="card reveal"><div class="ico">${ICON.zero}</div><h3>No AI bill</h3><p class="muted">There's no AI inside Dealflow. Your existing Claude plan does the writing, so we stay simple and cheap.</p></div>
</section>

<h2 class="section-title reveal">Made for people who <span class="serif grad-text"><i>sell their time</i></span></h2>
<p class="section-sub reveal">When you're the whole company, every unpaid invoice is personal.</p>
<section class="grid g2 feature" style="margin-top:18px">
  <div class="card reveal"><span class="badge b-sent">Built for</span><h3 style="margin-top:12px">Freelancers</h3><p class="muted">Designers, developers, writers, marketers and consultants. Quote in a sentence, look professional, and never write another "just following up" email.</p></div>
  <div class="card reveal"><span class="badge b-draft">Also great for</span><h3 style="margin-top:12px">Small business owners</h3><p class="muted">Studios, agencies and consultancies that send more quotes. Same flow, more volume, with team seats on the Studio plan.</p></div>
</section>

<section class="cta-band reveal">
  <h2>Stop chasing. <span class="serif"><i>Start closing.</i></span></h2>
  <p>Connect Claude in a minute. Your first three quotes are free.</p>
  ${user ? '<a class="btn lg" href="/app">Open your quotes →</a>' : '<a class="btn lg" href="/signup">Create your free account →</a>'}
</section>`,
  });
}

export function authPage({ mode, error, values = {}, next = '', demo }) {
  const isLogin = mode === 'login';
  return layout({
    title: isLogin ? 'Log in · Dealflow' : 'Create account · Dealflow',
    user: null,
    flash: error ? { type: 'err', text: error } : null,
    body: `<div class="card auth">
<div class="logo" style="width:40px;height:40px;border-radius:12px;font-size:18px;margin-bottom:16px">D</div>
<h1>${isLogin ? 'Welcome back' : 'Create your account'}</h1>
<p class="muted" style="margin-top:-6px">${isLogin ? 'Log in to see your quotes and invoices.' : 'Free to start. Connect your Claude next.'}</p>
<form method="post" action="/${mode}">
  <input type="hidden" name="next" value="${esc(next)}">
  ${isLogin ? '' : `<div class="field"><label>Your name</label><input type="text" name="name" required value="${esc(values.name)}"></div>
  <div class="field"><label>Business name</label><input type="text" name="business_name" placeholder="Shown on your quotes" value="${esc(values.business_name)}"></div>`}
  <div class="field"><label>Email</label><input type="email" name="email" required value="${esc(values.email)}"></div>
  <div class="field"><label>Password</label><input type="password" name="password" required minlength="${isLogin ? 1 : 8}"></div>
  <button class="btn primary block" type="submit">${isLogin ? 'Log in' : 'Create account'}</button>
</form>
<p class="muted small" style="margin-top:14px">${isLogin ? 'New here? <a href="/signup">Create an account</a>' : 'Already have an account? <a href="/login">Log in</a>'}</p>
${isLogin && demo ? `<div class="flash info small" style="margin:12px 0 0;animation:none"><div>Test account: <b>${esc(demo.email)}</b> / <b>${esc(demo.password)}</b> <button type="button" class="btn sm" style="margin-left:6px" data-fill-demo="${esc(demo.email)}|${esc(demo.password)}">Fill in</button></div></div>` : ''}
</div>`,
  });
}

// ---------- Owner dashboard ----------

function greeting() {
  const h = Number(new Date().toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: process.env.DISPLAY_TZ || 'Asia/Kolkata' }));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** data-count attributes so the browser can animate a single-currency total counting up. */
function countAttr(rows) {
  const cur = [...new Set(rows.map((r) => r.currency))];
  if (cur.length !== 1) return '';
  const total = rows.reduce((sum, r) => sum + totals(r).total, 0);
  return ` data-count="${total}" data-currency="${esc(cur[0])}"`;
}

function sumByCurrency(rows) {
  const m = {};
  for (const r of rows) m[r.currency] = (m[r.currency] || 0) + totals(r).total;
  const parts = Object.entries(m).map(([c, v]) => money(v, c));
  return parts.length ? parts.join(' + ') : money(0);
}

function rowActions(x, filter, emailOn) {
  const backTo = `/app?status=${filter}`;
  const hidden = `<input type="hidden" name="back" value="${esc(backTo)}">`;
  const canSend = x.client_email && !['paid', 'declined'].includes(x.status) && !x.archived_at;
  const sendLabel = x.status === 'draft' ? 'Send' : 'Resend';
  return `<div class="row-actions">
  ${canSend ? `<form method="post" action="/app/quotes/${x.id}/send">${hidden}<button class="btn sm" type="submit" title="${emailOn ? `Email to ${esc(x.client_email)}` : 'Email sending not configured'}">${sendLabel}</button></form>` : ''}
  ${x.archived_at
    ? `<form method="post" action="/app/quotes/${x.id}/unarchive">${hidden}<button class="btn sm" type="submit">Restore</button></form>`
    : `<form method="post" action="/app/quotes/${x.id}/archive">${hidden}<button class="btn sm" type="submit" title="Hide from this list and pause reminders">Archive</button></form>`}
  <form method="post" action="/app/quotes/${x.id}/delete">${hidden}<button class="btn sm danger" type="submit" data-confirm="Delete ${esc(docNumber(x))} permanently? The client link will stop working.">Delete</button></form>
</div>`;
}

export function dashboardPage({ user, quotes, archived = [], archivedCount = 0, filter, scheduledCount, flash, emailOn }) {
  const awaiting = quotes.filter((x) => x.status === 'accepted');
  const clientPaid = awaiting.filter((x) => x.client_paid_at);
  const paid = quotes.filter((x) => x.status === 'paid');
  const open = quotes.filter((x) => OPEN_STATUSES.includes(x.status));
  const filters = [['all', 'All'], ['unpaid', 'Unpaid'], ['accepted', 'Awaiting payment'],
    ['client_paid', `Client marked paid${clientPaid.length ? ` (${clientPaid.length})` : ''}`], ['paid', 'Paid'], ['draft', 'Drafts'],
    ['archived', `Archived${archivedCount ? ` (${archivedCount})` : ''}`]];
  const shown = filter === 'archived' ? archived
    : filter === 'all' ? quotes
      : filter === 'unpaid' ? quotes.filter((x) => !['paid', 'declined'].includes(x.status))
        : filter === 'client_paid' ? clientPaid
          : filter === 'accepted' ? awaiting.filter((x) => !x.client_paid_at)
            : quotes.filter((x) => x.status === filter);
  const rows = shown.map((x) => `<tr class="click" data-href="/app/quotes/${x.id}">
  <td><a href="/app/quotes/${x.id}"><b>${esc(docNumber(x))}</b></a></td>
  <td><span class="cell-title">${esc(x.title)}</span><div class="muted small">${esc(x.client_company || x.client_name)}</div></td>
  <td>${badge(displayStatus(x))}${x.view_count ? `<div class="muted small">opened ${x.view_count}×</div>` : ''}</td>
  <td class="num">${esc(money(totals(x).total, x.currency))}</td>
  <td class="muted small">${x.status === 'accepted' && x.due_date ? `Due ${esc(fmtDate(x.due_date))}` : esc(fmtDate(x.created_at))}</td>
  <td>${rowActions(x, filter, emailOn)}</td>
</tr>`).join('');
  const nothing = quotes.length === 0 && archivedCount === 0;
  return layout({
    title: 'Quotes · Dealflow',
    user,
    active: 'dash',
    flash,
    body: `
<div class="page-head"><div><h1>${greeting()}, ${esc((user.name || '').split(' ')[0] || 'there')}</h1><div class="sub">Here's where your money is.</div></div><span class="spacer"></span>
<form class="inline" method="post" action="/app/quotes/new"><button class="btn" type="submit">+ Blank quote</button></form>
<a class="btn primary" href="/app/connect">${ICON.spark.replace('<svg', '<svg width="16" height="16"')} Create from Claude</a></div>
<div class="grid g4" style="margin-bottom:18px">
  <div class="card kpi k-pay"><div class="icon">${ICON.clock}</div><div class="label">Awaiting payment</div><div class="value"${countAttr(awaiting)}>${esc(sumByCurrency(awaiting))}</div><div class="muted small">${awaiting.length} invoice(s)${clientPaid.length ? `, ${clientPaid.length} marked paid by client` : ''}</div></div>
  <div class="card kpi k-paid"><div class="icon">${ICON.wallet}</div><div class="label">Paid</div><div class="value"${countAttr(paid)}>${esc(sumByCurrency(paid))}</div><div class="muted small">${paid.length} invoice(s)</div></div>
  <div class="card kpi"><div class="icon">${ICON.doc}</div><div class="label">Open quotes</div><div class="value" data-count="${open.length}">${open.length}</div><div class="muted small">${esc(sumByCurrency(open))}</div></div>
  <div class="card kpi k-rem"><div class="icon">${ICON.bell}</div><div class="label">Reminders scheduled</div><div class="value" data-count="${scheduledCount}">${scheduledCount}</div><div class="muted small">sent automatically</div></div>
</div>
<div class="card">
  <div class="row" style="margin-bottom:8px">${filters.map(([k, label]) => `<a class="btn sm ${filter === k ? 'primary' : ''}" href="/app?status=${k}">${label}</a>`).join('')}</div>
  ${nothing ? `<div class="empty"><div class="orb">${ICON.spark.replace('<svg', '<svg width="28" height="28"')}</div><h2>No quotes yet</h2><p>Connect Claude, then ask it something like:</p>
  <div class="prompt" style="max-width:560px;margin:0 auto 16px;text-align:left" data-copy-text>"Create a Dealflow quote for Anurag at Meesho (your-email@example.com) for a logo redesign: 3 concepts, 2 revision rounds, ₹40,000, 18% GST, 50% upfront."</div>
  <p class="small">Dealflow emails it to the client right away and schedules follow-ups automatically.</p>
  <a class="btn primary" href="/app/connect">Connect Claude</a></div>`
    : shown.length === 0 ? '<div class="empty">Nothing here.</div>'
      : `<div class="table-scroll"><table><thead><tr><th>Number</th><th>Project</th><th>Status</th><th class="num">Total</th><th>Date</th><th class="actions">Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`}
</div>`,
  });
}

function toLocalInput(d) {
  return new Date(d).toISOString();
}

export function quoteEditPage({ user, quote, reminders, events, flash, emailOn }) {
  const t = totals(quote);
  const link = publicUrl(quote);
  const items = quote.items.length ? quote.items : [{ description: '', quantity: 1, unit_price: 0 }];
  const itemRows = items.map((it) => `<tr>
  <td><input type="text" data-k="description" value="${esc(it.description)}" placeholder="Description"></td>
  <td class="qty"><input type="number" step="any" data-k="quantity" value="${esc(it.quantity)}"></td>
  <td class="price"><input type="number" step="any" data-k="unit_price" value="${esc(it.unit_price)}"></td>
  <td class="amt" data-amt></td>
  <td class="del"><button type="button" class="btn sm danger" data-del-item title="Remove">×</button></td></tr>`).join('');
  const reminderHtml = reminders.map((r) => `<div class="reminder">
  <div class="row small" style="margin-bottom:6px">${rbadge(r.status)}${r.auto ? '<span class="badge b-draft">standard</span>' : ''}
    <span class="muted">${r.status === 'sent' ? `sent ${esc(fmtDateTime(r.sent_at))}${r.delivery === 'log' ? ' (recorded, email off)' : ''}` : `send at ${esc(fmtDateTime(r.send_at))}`}</span></div>
  ${r.error ? `<div class="small" style="color:var(--bad)">${esc(r.error)}</div>` : ''}
  ${['scheduled', 'failed'].includes(r.status) ? `<details><summary>${esc(fillTemplate(r.subject, quote, user))}</summary>
  <form method="post" action="/app/quotes/${quote.id}/reminders/${r.id}" style="margin-top:10px" data-local-time>
    <div class="field"><label>Send at</label><input type="datetime-local" data-iso="${esc(toLocalInput(r.send_at))}"><input type="hidden" name="send_at"></div>
    <div class="field"><label>Subject</label><input type="text" name="subject" value="${esc(r.subject)}"></div>
    <div class="field"><label>Message</label><textarea name="body" rows="6">${esc(r.body)}</textarea></div>
    <div class="row"><button class="btn sm primary" type="submit">Save</button>
    <button class="btn sm" type="submit" formaction="/app/quotes/${quote.id}/reminders/${r.id}/send">Send now</button>
    <button class="btn sm danger" type="submit" formaction="/app/quotes/${quote.id}/reminders/${r.id}/delete" data-confirm="Delete this reminder?">Delete</button></div>
  </form></details>` : `<details class="small"><summary>${esc(fillTemplate(r.subject, quote, user))}</summary><div class="prewrap muted" style="margin-top:6px">${esc(fillTemplate(r.body, quote, user))}</div></details>`}
</div>`).join('');

  const statusActions = [];
  if (quote.status === 'draft') statusActions.push(`<form class="inline" method="post" action="/app/quotes/${quote.id}/mark-sent"><button class="btn sm">Mark as sent</button></form>`);
  if (quote.status !== 'paid' && quote.status !== 'declined') statusActions.push(`<form class="inline" method="post" action="/app/quotes/${quote.id}/mark-paid"><button class="btn sm good">${quote.client_paid_at ? 'Confirm paid' : 'Mark paid'}</button></form>`);
  statusActions.push(quote.archived_at
    ? `<form class="inline" method="post" action="/app/quotes/${quote.id}/unarchive"><button class="btn sm">Restore</button></form>`
    : `<form class="inline" method="post" action="/app/quotes/${quote.id}/archive"><button class="btn sm" title="Hide from the list and pause reminders">Archive</button></form>`);

  return layout({
    title: `${docNumber(quote)} · ${quote.title} · Dealflow`,
    user,
    active: 'dash',
    flash,
    body: `
<div class="row" style="margin-bottom:6px"><a href="/app" class="small">← All quotes</a></div>
<div class="row" style="margin-bottom:18px">
  <h1 style="margin:0">${esc(docNumber(quote))}</h1>${badge(displayStatus(quote))}
  ${quote.archived_at ? '<span class="badge b-cancelled">Archived</span>' : ''}
  <span class="spacer"></span>${statusActions.join('')}
  <a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">View client page ↗</a>
</div>
${tracker(quote)}
${quote.status === 'changes_requested' && quote.change_request ? `<div class="flash info"><b>${esc(quote.client_name || 'Your client')} requested changes</b> (${esc(fmtDateTime(quote.change_requested_at))}):<div class="prewrap" style="margin-top:4px;font-weight:400">${esc(quote.change_request)}</div><div class="small" style="margin-top:6px;font-weight:400">Edit below (or ask Claude to), save, then click <b>Email link</b> to send the revised quote. Reminders are paused until you do.</div></div>` : ''}
${quote.status === 'accepted' && quote.client_paid_at ? `<div class="flash info"><b>${esc(quote.client_name || 'Your client')} marked this invoice as paid</b> on ${esc(fmtDateTime(quote.client_paid_at))}.${quote.client_paid_note ? ` Reference: <b>${esc(quote.client_paid_note)}</b>.` : ''}${quote.paid_proof_mime ? ` <a href="/app/quotes/${quote.id}/proof" target="_blank" rel="noopener">View payment screenshot ↗</a>` : ''} <span style="font-weight:400">Check your account, then click <b>Confirm paid</b>.</span></div>` : ''}
<div class="split">
<div>
<form method="post" action="/app/quotes/${quote.id}" id="quote-form" class="card">
  <input type="hidden" name="items_json" id="items_json">
  <div class="field"><label>Project title</label><input type="text" name="title" value="${esc(quote.title)}" required></div>
  <div class="grid g3">
    <div class="field"><label>Client name</label><input type="text" name="client_name" value="${esc(quote.client_name)}"></div>
    <div class="field"><label>Client company</label><input type="text" name="client_company" value="${esc(quote.client_company)}"></div>
    <div class="field"><label>Client email</label><input type="email" name="client_email" value="${esc(quote.client_email)}"></div>
  </div>
  <div class="field"><label>Scope summary</label><textarea name="summary" rows="4">${esc(quote.summary)}</textarea></div>
  <label>Line items</label>
  <div class="table-scroll"><table class="items" id="items" data-currency="${esc(quote.currency)}">
    <thead><tr><th>Description</th><th class="qty">Qty</th><th class="price">Unit price</th><th class="num">Amount</th><th></th></tr></thead>
    <tbody>${itemRows}</tbody></table></div>
  <button type="button" class="btn sm" id="add-item" style="margin:6px 0 16px">+ Add line</button>
  <div class="grid g4">
    <div class="field"><label>Currency</label><input type="text" name="currency" value="${esc(quote.currency)}" maxlength="3"></div>
    <div class="field"><label>Discount (flat)</label><input type="number" step="any" name="discount" value="${esc(Number(quote.discount))}" data-recalc></div>
    <div class="field"><label>Tax %</label><input type="number" step="any" name="tax_percent" value="${esc(Number(quote.tax_percent))}" data-recalc></div>
    <div class="field"><label>Total</label><div class="value" id="grand-total" style="font-size:20px;font-weight:800;padding-top:6px">${esc(money(t.total, quote.currency))}</div></div>
  </div>
  <div class="grid g2">
    <div class="field"><label>Valid until</label><input type="date" name="valid_until" value="${esc(isoDate(quote.valid_until))}"></div>
    <div class="field"><label>Payment due</label><input type="date" name="due_date" value="${esc(isoDate(quote.due_date))}"><div class="hint">Blank = 7 days after the client accepts</div></div>
  </div>
  <div class="field"><label>Payment terms</label><input type="text" name="payment_terms" value="${esc(quote.payment_terms)}" placeholder="e.g. 50% upfront, 50% on delivery"></div>
  <div class="field"><label>Terms & conditions</label><textarea name="terms" rows="5">${esc(quote.terms)}</textarea></div>
  <div class="row"><button class="btn primary" type="submit">Save changes</button><span class="muted small">Your client sees changes immediately on the same link.</span>
  <span class="spacer"></span><button class="btn sm danger" type="submit" formaction="/app/quotes/${quote.id}/delete" formnovalidate data-confirm="Delete this quote permanently? The client link will stop working.">Delete</button></div>
</form>
</div>
<aside class="stack">
  <div class="card">
    <h3>Client link</h3>
    <p class="muted small">Anyone with this link can view${isInvoice(quote) ? ' and pay' : ' and accept'}. No login needed.</p>
    ${copyField(link, 'client-link')}
    ${quote.client_email ? `<form method="post" action="/app/quotes/${quote.id}/send" style="margin-top:10px"><button class="btn sm block" type="submit">${quote.status === 'draft' ? 'Email' : 'Re-send'} link to ${esc(quote.client_email)}</button></form>` : '<p class="hint">Add a client email to send it from here.</p>'}
    ${emailOn ? '' : '<p class="hint">Email sending is not configured on this server; emails are recorded below instead.</p>'}
    <div class="small muted" style="margin-top:10px">Opened ${quote.view_count} time(s)${quote.viewed_at ? `, first ${esc(fmtDateTime(quote.viewed_at))}` : ''}</div>
    ${quote.accepted_by ? `<div class="small" style="margin-top:4px">Accepted by <b>${esc(quote.accepted_by)}</b> on ${esc(fmtDateTime(quote.accepted_at))}</div>` : ''}
    ${quote.client_paid_at ? `<div class="small" style="margin-top:4px">Client marked paid ${esc(fmtDateTime(quote.client_paid_at))}${quote.client_paid_note ? `, ref "${esc(quote.client_paid_note)}"` : ''}${quote.paid_proof_mime ? ` · <a href="/app/quotes/${quote.id}/proof" target="_blank" rel="noopener">screenshot</a>` : ''}</div>` : ''}
  </div>
  <div class="card">
    <h3>Payment reminders</h3>
    <p class="muted small">Sent automatically to the client. Pending ones are cancelled when you mark it paid, archive it, or the client declines or asks for changes.</p>
    ${reminderHtml || '<p class="small muted">None yet. Ask Claude: "Schedule 3 friendly-to-firm reminders for ' + esc(docNumber(quote)) + '".</p>'}
    <details style="margin-top:12px"><summary>+ Add a reminder</summary>
    <form method="post" action="/app/quotes/${quote.id}/reminders" style="margin-top:10px" data-local-time>
      <div class="field"><label>Send at</label><input type="datetime-local" data-iso="${esc(new Date(Date.now() + 86400000).toISOString())}"><input type="hidden" name="send_at"></div>
      <div class="field"><label>Subject</label><input type="text" name="subject" required value="Reminder: {{number}} for {{amount}}"></div>
      <div class="field"><label>Message</label><textarea name="body" rows="5" required>Hi {{client_name}},

Just a friendly reminder about {{number}} ({{amount}}), due {{due_date}}.

Thanks,
{{sender_name}}</textarea><div class="hint">Placeholders: {{client_name}} {{amount}} {{number}} {{due_date}} {{link}} {{sender_name}}</div></div>
      <button class="btn sm primary" type="submit">Schedule</button>
    </form></details>
  </div>
  <div class="card">
    <h3>Activity</h3>
    <ul class="timeline">${events.map((e) => `<li class="${e.actor === 'Client' ? 'client' : e.actor === 'Claude' ? 'claude' : ''}"><span class="who">${esc(e.actor)}</span> ${esc(e.message)}<div class="muted">${esc(fmtDateTime(e.created_at))}</div></li>`).join('')}</ul>
  </div>
</aside>
</div>`,
  });
}

export function connectPage({ user, mcpUrl, flash, demo }) {
  const cmd = `claude mcp add --transport http dealflow ${mcpUrl}`;
  const firstPrompt = 'Create a Dealflow quote for Anurag at Meesho (anurag@example.com): logo redesign with 3 concepts and 2 revision rounds for ₹40,000, plus brand guidelines for ₹15,000. 18% GST, 50% upfront.';
  const urlNote = demo
    ? 'This is the shared test account, so this link is fixed. Sign up for your own account to get a private one.'
    : 'Keep it private: anyone with this link can create and edit quotes in your account.';
  const step = (n, title, body) => `<li class="vstep"><span class="vnum">${n}</span><div class="vbody"><h3>${title}</h3>${body}</div></li>`;
  return layout({
    title: 'Connect Claude · Dealflow',
    user,
    active: 'connect',
    flash,
    body: `<div class="narrow" style="margin:0 auto">
<div class="page-head"><div><h1>Connect your Claude</h1>
<div class="sub">One-time setup, about a minute. Dealflow has no AI inside: your own Claude does the writing and talks to Dealflow through a private link.</div></div></div>

<div class="card" style="padding:14px 16px;margin-bottom:18px">
  <div class="small muted" style="font-weight:600;margin-bottom:8px">Which Claude do you use?</div>
  <div class="tabs" role="tablist">
    <button type="button" class="tab on" role="tab" data-tab="app" aria-selected="true">
      <b>Claude app</b><span>claude.ai or the desktop app · <em>most people</em></span></button>
    <button type="button" class="tab" role="tab" data-tab="code" aria-selected="false">
      <b>Claude Code</b><span>terminal · for developers</span></button>
  </div>
</div>

<section class="tab-panel" data-panel="app">
<ol class="vsteps card">
${step(1, 'Copy your Dealflow link', `${copyField(mcpUrl, 'mcp-url')}<p class="hint">${urlNote}</p>`)}
${step(2, 'Open Claude\'s connector settings', `<p>In Claude, click your name (bottom left) → <b>Settings</b> → <b>Connectors</b>.</p>
<a class="btn sm" href="https://claude.ai/settings/connectors" target="_blank" rel="noopener">Open Claude connectors ↗</a>
<p class="hint">On a Team or Enterprise plan, an admin may need to add it under <b>Organization settings → Connectors</b>.</p>`)}
${step(3, 'Add Dealflow as a custom connector', `<p>Click <b>Add custom connector</b>, fill in these two fields, then click <b>Add</b>:</p>
<div class="mock">
  <div><span>Name</span><code>Dealflow</code></div>
  <div><span>Remote MCP server URL</span><code>paste the link from step 1</code></div>
</div>
<p class="hint">Leave the advanced / OAuth fields empty.</p>`)}
${step(4, 'Switch it on in a new chat', `<p>Start a <b>new chat</b>. Click the <b>+</b> (or tools) button under the message box and make sure <b>Dealflow</b> is turned on.</p>`)}
${step(5, 'Ask for your first quote', `<div class="prompt" data-copy-text>"${esc(firstPrompt)}"</div>
<p class="hint" style="margin-top:8px">Click to copy. When Claude asks to use Dealflow, click <b>Allow</b> (or <b>Always allow</b>). The quote is emailed to the client and appears in <a href="/app">Quotes</a>.</p>`)}
</ol>
</section>

<section class="tab-panel" data-panel="code" hidden>
<ol class="vsteps card">
${step(1, 'Copy this command', `${copyField(cmd, 'mcp-cmd')}<p class="hint">${urlNote}</p>`)}
${step(2, 'Run it in your terminal', `<p>Paste it into a terminal where Claude Code is installed and press <b>Enter</b>.</p>`)}
${step(3, 'Check it\'s connected', `<p>Start <code>claude</code> and type <code>/mcp</code>. You should see <b>dealflow</b> with 9 tools.</p>`)}
${step(4, 'Ask for your first quote', `<div class="prompt" data-copy-text>"${esc(firstPrompt)}"</div>
<p class="hint" style="margin-top:8px">Approve the Dealflow tool when Claude Code asks.</p>`)}
</ol>
</section>

<div class="card" style="margin-top:18px">
  <h3>More things to ask</h3>
  <p class="muted small" style="margin-top:-4px">Click any line to copy it.</p>
  <div class="stack">
    <div class="prompt" data-copy-text>"Change the reminders for that quote: a friendly nudge in 2 days, a follow-up in 5, and a firm one in 10."</div>
    <div class="prompt" data-copy-text>"Which of my Dealflow invoices are unpaid? Has Meesho opened theirs?"</div>
    <div class="prompt" data-copy-text>"Meesho asked for 2 concepts instead of 3. Update the quote and bring the price down to ₹30,000."</div>
    <div class="prompt" data-copy-text>"Meesho paid. Mark Q-0001 paid."</div>
  </div>
</div>

<div class="card">
  <h3>Something not working?</h3>
  <div class="faq">
    <details><summary>I don't see "Add custom connector"</summary><p class="muted small">Your Claude plan or organization may not allow custom connectors. On Team or Enterprise plans, ask an admin to add Dealflow under Organization settings → Connectors.</p></details>
    <details><summary>Claude doesn't use Dealflow, or says it can't find it</summary><p class="muted small">Start a new chat and check that Dealflow is switched on in the + / tools menu. Mentioning "Dealflow" in your request helps.</p></details>
    <details><summary>Claude seems stuck</summary><p class="muted small">It's usually waiting for you to approve the tool. Scroll down in the chat and click Allow. Writing a detailed quote can also take 20–40 seconds.</p></details>
    <details><summary>The email didn't arrive</summary><p class="muted small">Check spam first. Then open the quote in Dealflow: the activity log shows whether the email was sent or why it failed, and you can re-send it from there.</p></details>
  </div>
</div>

${demo ? '' : `<div class="card">
  <h3>Reset your link</h3>
  <p class="muted small">Creates a new link. The old one stops working, so you'll need to add the new one in Claude.</p>
  <form method="post" action="/app/connect/reset"><button class="btn sm danger" data-confirm="Reset the connector link? The current one will stop working." type="submit">Reset link</button></form>
</div>`}
</div>`,
  });
}

export function settingsPage({ user, flash }) {
  return layout({
    title: 'Settings · Dealflow',
    user,
    active: 'settings',
    flash,
    body: `<div class="narrow" style="margin:0 auto">
<h1>Business settings</h1>
<p class="muted">Shown on every quote and invoice your clients see.</p>
<form method="post" action="/app/settings" class="card">
  <div class="grid g2">
    <div class="field"><label>Your name</label><input type="text" name="name" value="${esc(user.name)}"></div>
    <div class="field"><label>Business name</label><input type="text" name="business_name" value="${esc(user.business_name)}"></div>
  </div>
  <div class="field"><label>Address</label><textarea name="business_address" rows="3">${esc(user.business_address)}</textarea></div>
  <div class="field"><label>Contact email</label><input type="email" name="contact_email" value="${esc(user.contact_email)}" placeholder="${esc(user.email)}">
  <div class="hint">Shown to clients on the Contact button, used as reply-to on emails, and where Dealflow sends you alerts. Blank = your login email.</div></div>
  <div class="grid g2">
    <div class="field"><label>Tax ID (GSTIN / VAT)</label><input type="text" name="tax_id" value="${esc(user.tax_id)}"></div>
    <div class="field"><label>Default currency</label><input type="text" name="currency" maxlength="3" value="${esc(user.currency)}"></div>
  </div>
  <h3 style="margin-top:6px">Automatic follow-up</h3>
  <label class="check"><input type="checkbox" name="auto_send" ${user.auto_send ? 'checked' : ''}> Email new quotes from Claude to the client straight away</label>
  <label class="check"><input type="checkbox" name="auto_reminders" ${user.auto_reminders ? 'checked' : ''}> Schedule standard follow-up reminders after sending</label>
  <div class="field" style="max-width:260px"><label>Follow-up days after sending</label><input type="text" name="reminder_days" value="${esc(user.reminder_days)}" placeholder="3,7,14"><div class="hint">Comma-separated, up to 5. If Claude writes custom reminders, they replace these.</div></div>
  <div class="field"><label>Payment instructions</label><textarea name="payment_instructions" rows="4" placeholder="UPI ID, bank account, payment link...">${esc(user.payment_instructions)}</textarea>
  <div class="hint">Shown on invoices after your client accepts.</div></div>
  <button class="btn primary" type="submit">Save</button>
</form></div>`,
  });
}

// ---------- Public client page ----------

export function publicQuotePage({ quote, owner, viewer, flash }) {
  const t = totals(quote);
  const inv = isInvoice(quote);
  const kind = inv ? 'Invoice' : 'Quote';
  const cur = quote.currency;
  const isOwner = viewer && viewer.id === owner.id;
  const expired = !inv && quote.valid_until && new Date(`${isoDate(quote.valid_until)}T23:59:59Z`) < new Date();

  let actions = '';
  if (OPEN_STATUSES.includes(quote.status)) {
    const pendingChanges = quote.status === 'changes_requested' && quote.change_request
      ? `<div class="flash info" style="margin-bottom:14px">You requested changes on ${esc(fmtDate(quote.change_requested_at))}: <span class="prewrap">"${esc(quote.change_request)}"</span><br><span class="small">${esc(owner.business_name || owner.name)} will update this quote at the same link. You can still accept it as it is.</span></div>`
      : '';
    actions = expired
      ? `<div class="card"><b>This quote expired on ${esc(fmtDate(quote.valid_until))}.</b> <span class="muted">Reply to ${esc(owner.business_name || owner.name)} for an updated quote.</span></div>`
      : `<div class="card">${pendingChanges}<h2>Accept this quote</h2>
<p class="muted">Accepting confirms the scope and price above. You'll get an invoice right here on this page.</p>
<form method="post" action="/q/${esc(quote.public_id)}/accept" class="row" style="align-items:flex-end">
  <div style="flex:1;min-width:200px"><label>Your full name</label><input type="text" name="name" required value="${esc(quote.client_name)}"></div>
  <label class="small" style="display:flex;gap:6px;align-items:center;font-weight:500;flex-basis:100%;order:3"><input type="checkbox" required> I agree to the scope, price and terms above.</label>
  <button class="btn primary lg" type="submit">Accept quote</button>
</form>
<details style="margin-top:14px"><summary class="small" style="color:var(--accent)">Not quite right? Request changes or decline</summary>
<form method="post" action="/q/${esc(quote.public_id)}/changes" style="margin-top:10px">
  <div class="field"><label>What would you like changed?</label>
  <textarea name="changes" rows="3" required placeholder="e.g. Can we do 2 logo concepts instead of 3 and bring the price down?"></textarea></div>
  <div class="row">
    <button class="btn primary" type="submit">Send change request</button>
    <button class="btn danger" type="submit" formaction="/q/${esc(quote.public_id)}/decline" formnovalidate data-confirm="Decline this quote? ${esc(owner.business_name || owner.name)} will be notified.">Decline quote</button>
  </div>
  <p class="hint">${esc(owner.business_name || owner.name)} gets your message and can send an updated quote to this same link.</p>
</form></details></div>`;
  } else if (quote.status === 'accepted') {
    actions = `<div class="card"><h2>Pay ${esc(money(t.total, cur))}${quote.due_date ? ` by ${esc(fmtDate(quote.due_date))}` : ''}</h2>
${owner.payment_instructions ? `<div class="prewrap pay-box">${esc(owner.payment_instructions)}</div>` : `<p class="muted">Contact ${esc(owner.business_name || owner.name)} at <a href="mailto:${esc(contactEmail(owner))}">${esc(contactEmail(owner))}</a> for payment details.</p>`}
${quote.client_paid_at ? `<p class="flash ok" style="margin:14px 0 0">Thanks! You told us you paid on ${esc(fmtDate(quote.client_paid_at))}. ${esc(owner.business_name || owner.name)} will confirm shortly.</p>`
    : `<form method="post" action="/q/${esc(quote.public_id)}/paid" style="margin-top:14px" data-proof-form>
  <h3 style="margin-bottom:8px">Already paid? Let ${esc(owner.business_name || owner.name)} know</h3>
  <div class="field"><label>Payment reference / UTR</label><input type="text" name="note" placeholder="e.g. UTR 412345678901"></div>
  <div class="field"><label>Payment screenshot <span class="muted" style="font-weight:400">(optional)</span></label>
    <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" data-proof-file>
    <input type="hidden" name="proof">
    <div class="hint" data-proof-status>PNG, JPG or PDF, up to 5 MB.</div></div>
  <button class="btn good" type="submit">I've paid</button></form>`}</div>`;
  } else if (quote.status === 'paid') {
    actions = `<div class="card" style="text-align:center"><span class="stamp">PAID</span><p class="muted" style="margin-top:12px">Paid on ${esc(fmtDate(quote.paid_at))}. Thank you!</p></div>`;
  } else if (quote.status === 'declined') {
    actions = `<div class="card"><b>This quote was declined.</b> <span class="muted">Reply to ${esc(owner.business_name || owner.name)} if you'd like a revised version.</span></div>`;
  }

  return layout({
    title: `${kind} ${docNumber(quote)} from ${owner.business_name || owner.name}`,
    user: null,
    bare: true,
    flash,
    body: `<div class="doc">
${isOwner ? `<div class="flash info no-print">You're viewing your client's page. Your own visits aren't counted as client views. <a href="/app/quotes/${quote.id}">Edit</a></div>` : ''}
<div class="no-print">${tracker(quote)}</div>
<div class="paper">
  <div class="doc-head">
    <div><div class="doc-title grad-text">${kind}</div><div class="from">${esc(owner.business_name || owner.name)}</div>
      <div class="muted small prewrap">${esc(owner.business_address)}</div>
      ${owner.tax_id ? `<div class="muted small">Tax ID: ${esc(owner.tax_id)}</div>` : ''}</div>
    <div class="meta">
      <div><b>${esc(docNumber(quote))}</b></div>
      ${inv ? `<div class="muted">For quote ${esc(quoteNumber(quote))}</div><div>Issued ${esc(fmtDate(quote.accepted_at))}</div>${quote.due_date ? `<div>Due <b>${esc(fmtDate(quote.due_date))}</b></div>` : ''}`
    : `<div>Date ${esc(fmtDate(quote.created_at))}</div>${quote.valid_until ? `<div>Valid until ${esc(fmtDate(quote.valid_until))}</div>` : ''}`}
      <div style="margin-top:6px">${badge(quote.status)}</div>
    </div>
  </div>
  <div class="parties">
    <div><div class="muted small">${inv ? 'Bill to' : 'Prepared for'}</div><b>${esc(quote.client_name)}</b>
      ${quote.client_company ? `<div>${esc(quote.client_company)}</div>` : ''}${quote.client_email ? `<div class="muted small">${esc(quote.client_email)}</div>` : ''}</div>
    <div><div class="muted small">Project</div><b>${esc(quote.title)}</b></div>
  </div>
  ${quote.summary ? `<div class="section" style="margin-top:0;margin-bottom:22px"><h3>Scope</h3><div class="prewrap">${esc(quote.summary)}</div></div>` : ''}
  <div class="table-scroll"><table>
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
    <tbody>${quote.items.map((it) => `<tr><td>${esc(it.description)}</td><td class="num">${esc(it.quantity)}</td>
      <td class="num">${esc(money(it.unit_price, cur))}</td><td class="num">${esc(money(it.quantity * it.unit_price, cur))}</td></tr>`).join('')}</tbody>
  </table></div>
  <div class="totals">
    <div><span>Subtotal</span><span>${esc(money(t.subtotal, cur))}</span></div>
    ${t.discount ? `<div><span>Discount</span><span>−${esc(money(t.discount, cur))}</span></div>` : ''}
    ${t.taxPercent ? `<div><span>Tax (${esc(t.taxPercent)}%)</span><span>${esc(money(t.tax, cur))}</span></div>` : ''}
    <div class="grand"><span>Total</span><span>${esc(money(t.total, cur))}</span></div>
  </div>
  ${quote.payment_terms ? `<div class="section"><h3>Payment terms</h3><div class="prewrap">${esc(quote.payment_terms)}</div></div>` : ''}
  ${quote.terms ? `<div class="section"><h3>Terms & conditions</h3><div class="prewrap small">${esc(quote.terms)}</div></div>` : ''}
  ${quote.accepted_by ? `<div class="section"><h3>Acceptance</h3><div class="small">Accepted online by <b>${esc(quote.accepted_by)}</b> on ${esc(fmtDateTime(quote.accepted_at))}</div></div>` : ''}
</div>
<div class="action-bar stack">${actions}
<div class="row no-print" style="justify-content:center"><button class="btn sm" type="button" onclick="window.print()">Download / print PDF</button>
<a class="btn sm" title="${esc(contactEmail(owner))}" href="mailto:${esc(contactEmail(owner))}?subject=${encodeURIComponent(`${docNumber(quote)}: ${quote.title}`)}">Contact ${esc(owner.business_name || owner.name)}</a></div>
</div></div>`,
  });
}

export function messagePage({ title, text, user }) {
  return layout({
    title: `${title} · Dealflow`,
    user,
    body: `<div class="card empty" style="max-width:520px;margin:30px auto"><h1>${esc(title)}</h1><p>${esc(text)}</p><a class="btn" href="/">Go home</a></div>`,
  });
}

export { baseUrl, invoiceNumber };
