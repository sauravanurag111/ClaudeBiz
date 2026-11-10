import { q, one } from './db.js';
import {
  fillTemplate, logEvent, publicUrl, editUrl, docNumber, totals, money, markSent, addReminders, defaultReminders,
} from './quotes.js';
import { esc } from './views.js';

/**
 * Email delivery. Uses Brevo's transactional email API when BREVO_API_KEY is set
 * (free plan, no domain needed: verify one sender address). Without it, emails are
 * recorded in the app as "logged" so the flow still works end to end.
 */
export function emailMode() {
  return process.env.BREVO_API_KEY && process.env.SENDER_EMAIL ? 'email' : 'log';
}

function emailHtml(bodyText, quote, user, buttonLabel) {
  const paragraphs = esc(bodyText).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`).join('');
  const t = totals(quote);
  return `<!doctype html><html><body style="margin:0;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif;color:#1d1d27">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;padding:28px">
<tr><td style="font-size:15px;line-height:1.55">${paragraphs}
<div style="margin:22px 0;padding:16px;border-radius:10px;background:#f4f4f7">
<div style="font-size:13px;color:#666">${esc(docNumber(quote))} · ${esc(quote.title)}</div>
<div style="font-size:22px;font-weight:bold;margin-top:4px">${esc(money(t.total, quote.currency))}</div></div>
<a href="${publicUrl(quote)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${esc(buttonLabel)}</a>
<p style="font-size:12px;color:#888;margin-top:26px">Sent by ${esc(user.business_name || user.name)} via Dealflow</p>
</td></tr></table></td></tr></table></body></html>`;
}

export async function sendEmail({ to, toName, subject, text, html, user }) {
  if (emailMode() === 'log') return { delivery: 'log' };
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: process.env.SENDER_EMAIL, name: user.business_name || user.name || 'Dealflow' },
      to: [{ email: to, name: toName || to }],
      replyTo: { email: user.email, name: user.name || user.business_name || user.email },
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });
  if (!res.ok) throw new Error(`Email provider error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { delivery: 'email' };
}

/** Email the client the link to the quote or invoice. */
export async function sendQuoteEmail(quote, user, { subject, message } = {}) {
  if (!quote.client_email) throw new Error('This quote has no client email address. Add one first.');
  const kind = ['accepted', 'paid'].includes(quote.status) ? 'invoice' : 'quote';
  const subj = subject || `${kind === 'invoice' ? 'Invoice' : 'Quote'} ${docNumber(quote)} from ${user.business_name || user.name}: ${quote.title}`;
  const body = fillTemplate(message || `Hi {{client_name}},\n\nPlease find the ${kind} for "{{title}}" at the link below. `
    + `${kind === 'quote' ? 'You can review it and accept it online in one click.' : 'Payment details are on the page.'}\n\n`
    + 'Thanks,\n{{sender_name}}', quote, user);
  const text = `${body}\n\n${publicUrl(quote)}`;
  const result = await sendEmail({
    to: quote.client_email, toName: quote.client_name, subject: subj, text, user,
    html: emailHtml(body, quote, user, kind === 'invoice' ? 'View invoice' : 'Review & accept quote'),
  });
  return result;
}

/**
 * Send a quote to the client and line up its follow-ups. Used when Claude creates a quote
 * (automatic first send) and when the owner clicks Send. Never throws for email problems:
 * the quote is saved either way and the result says what happened.
 */
export async function deliverQuote(quote, user, actor, { subject, message, reminders } = {}) {
  const result = { emailed: false, email_error: null, reminders_scheduled: 0 };
  if (!quote.client_email) {
    result.email_error = 'No client email on this quote, so nothing was sent.';
    return { quote, ...result };
  }
  try {
    const { delivery } = await sendQuoteEmail(quote, user, { subject, message });
    result.emailed = delivery === 'email';
    if (!result.emailed) result.email_error = 'Email sending is not configured on this server.';
    await logEvent(quote.id, actor, result.emailed
      ? `Emailed ${quote.status === 'accepted' ? 'invoice' : 'quote'} link to ${quote.client_email}`
      : 'Send requested, but email is not configured (share the link manually)');
    if (result.emailed) quote = await markSent(quote, actor);
  } catch (err) {
    result.email_error = err.message;
    await logEvent(quote.id, 'Dealflow', `Email to ${quote.client_email} failed: ${err.message}`);
  }
  if (['paid', 'declined'].includes(quote.status)) return { quote, ...result };
  if (reminders && reminders.length) {
    result.reminders_scheduled = (await addReminders(quote, reminders, {}, actor)).length;
  } else if (user.auto_reminders) {
    const pending = await one(`SELECT count(*)::int AS n FROM reminders WHERE quote_id = $1 AND status = 'scheduled'`, [quote.id]);
    if (!pending.n) {
      result.reminders_scheduled = (await addReminders(quote, defaultReminders(user.reminder_days), { auto: true }, 'Dealflow')).length;
    }
  }
  return { quote, ...result };
}

/** Tell the business owner when their client acts. Best effort: never blocks the client. */
export async function notifyOwner(quote, subject, text) {
  try {
    const user = await one('SELECT * FROM users WHERE id = $1', [quote.user_id]);
    if (!user || emailMode() !== 'email') return;
    await sendEmail({
      to: user.email, toName: user.name, subject, user,
      text: `${text}\n\nOpen in Dealflow: ${editUrl(quote)}`,
      html: `<p style="font-family:Arial,sans-serif;font-size:15px">${esc(text).replace(/\n/g, '<br>')}</p>
<p><a href="${editUrl(quote)}" style="font-family:Arial,sans-serif">Open ${esc(docNumber(quote))} in Dealflow</a></p>`,
    });
  } catch (err) {
    console.error('Owner notification failed:', err.message);
  }
}

async function deliverReminder(reminder) {
  const quote = await one('SELECT * FROM quotes WHERE id = $1', [reminder.quote_id]);
  if (!quote) return;
  if (['paid', 'declined', 'changes_requested'].includes(quote.status) || quote.archived_at) {
    await q(`UPDATE reminders SET status = 'cancelled' WHERE id = $1`, [reminder.id]);
    return;
  }
  const user = await one('SELECT * FROM users WHERE id = $1', [quote.user_id]);
  const subject = fillTemplate(reminder.subject, quote, user);
  const body = fillTemplate(reminder.body, quote, user);
  try {
    if (!quote.client_email) throw new Error('No client email address on this quote');
    const { delivery } = await sendEmail({
      to: quote.client_email, toName: quote.client_name, subject, user,
      text: `${body}\n\n${publicUrl(quote)}`,
      html: emailHtml(body, quote, user, quote.status === 'accepted' ? 'View & pay invoice' : 'View quote'),
    });
    await q(`UPDATE reminders SET status = 'sent', sent_at = now(), delivery = $2, error = NULL WHERE id = $1`,
      [reminder.id, delivery]);
    await logEvent(quote.id, 'Dealflow',
      delivery === 'email'
        ? `Reminder emailed to ${quote.client_email}: "${subject}"`
        : `Reminder recorded (email sending not configured): "${subject}"`);
    if (quote.status === 'draft') {
      await q(`UPDATE quotes SET status = 'sent', sent_at = now() WHERE id = $1`, [quote.id]);
    }
  } catch (err) {
    await q(`UPDATE reminders SET status = 'failed', error = $2 WHERE id = $1`, [reminder.id, String(err.message).slice(0, 500)]);
    await logEvent(quote.id, 'Dealflow', `Reminder failed: ${err.message}`);
  }
}

export async function sendReminderNow(reminderId) {
  const r = await one('SELECT * FROM reminders WHERE id = $1', [reminderId]);
  if (r && ['scheduled', 'failed'].includes(r.status)) await deliverReminder(r);
}

let running = false;
/** Send every reminder that is due. Safe to call often (interval + external cron ping). */
export async function runDueReminders() {
  if (running) return 0;
  running = true;
  try {
    // Claim due reminders atomically so two instances never send the same one.
    const due = await q(
      `UPDATE reminders SET status = 'sending' WHERE id IN (
         SELECT id FROM reminders WHERE status = 'scheduled' AND send_at <= now()
         ORDER BY send_at LIMIT 50 FOR UPDATE SKIP LOCKED) RETURNING *`);
    for (const r of due) await deliverReminder(r);
    return due.length;
  } finally {
    running = false;
  }
}

export function startScheduler() {
  const tick = () => runDueReminders().catch((err) => console.error('Reminder run failed:', err));
  setInterval(tick, 60_000).unref();
  setTimeout(tick, 5_000).unref();
}
