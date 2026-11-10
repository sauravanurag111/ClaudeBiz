import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { one } from './db.js';
import {
  createQuote, updateQuote, findQuote, listQuotes, getReminders, getEvents, markPaid,
  addReminders, quoteForClaude, publicUrl, totals, money, fmtDateTime, docNumber, STATUS_LABEL, baseUrl,
  displayStatus, setArchived,
} from './quotes.js';
import { deliverQuote, emailMode } from './reminders.js';

const INSTRUCTIONS = `Dealflow turns quotes into invoices and chases payment for a freelancer or small business.
You (Claude) do all the writing: scope, line items, terms and reminder emails. Dealflow stores them, gives the
client a public link to review and accept, converts accepted quotes into invoices, and sends your reminder
emails on schedule until the invoice is paid.
create_quote AUTOMATICALLY emails the quote to the client (if a client_email is given) and schedules follow-up
reminders, so the user does not need to ask separately. You can personalise both in the same create_quote call with
email_message and reminders. Only pass send_now=false if the user explicitly wants a draft first.
Later: send_quote re-sends, schedule_reminders changes the follow-ups, mark_paid closes it out.
Quotes can be referred to by number (Q-0003 / INV-0002) or id. Always show the user the client_link and edit_link.
Reminder subject/body may use placeholders: {{client_name}}, {{amount}}, {{number}}, {{due_date}}, {{link}},
{{title}}, {{sender_name}}, {{business_name}}. Dealflow fills them in when it sends.`;

const reminderSchema = z.object({
  send_in_days: z.number().optional().describe('Days from now (fractions allowed, 0 = within a minute)'),
  send_at: z.string().optional().describe('Exact ISO datetime instead of send_in_days'),
  subject: z.string(),
  body: z.string().describe('Plain text email. Can use {{client_name}}, {{amount}}, {{number}}, {{due_date}}, {{link}}, {{sender_name}}'),
});

function deliveryNote(d, quote) {
  if (d.emailed) return `Emailed to ${quote.client_email}.`;
  return `NOT emailed: ${d.email_error} The quote is saved; share client_link manually or retry with send_quote.`;
}

const itemSchema = z.object({
  description: z.string().describe('What is being delivered, e.g. "Logo concepts (3 directions)"'),
  quantity: z.number().default(1).describe('Quantity or hours'),
  unit_price: z.number().describe('Price per unit, in the quote currency, before tax'),
});

const ref = z.union([z.string(), z.number()])
  .describe('Quote number like "Q-0003", invoice number like "INV-0002", or the numeric id');

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
function fail(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function mustFind(user, quoteRef) {
  const quote = await findQuote(user.id, quoteRef);
  if (!quote) throw new Error(`No quote or invoice "${quoteRef}" found. Use list_quotes to see what exists.`);
  return quote;
}

function wrap(fn) {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(err.message || String(err));
    }
  };
}

export function buildMcpServer(user) {
  const server = new McpServer(
    { name: 'dealflow', version: '1.0.0' },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool('get_business_profile', {
    title: 'Get business profile',
    description: 'Who the quotes are from: business name, default currency, payment instructions, and a count of quotes. Call this first if you need the sender details.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, wrap(async () => {
    const counts = await one(
      `SELECT count(*)::int AS total,
         count(*) FILTER (WHERE status NOT IN ('paid','declined'))::int AS open,
         count(*) FILTER (WHERE status = 'paid')::int AS paid
       FROM quotes WHERE user_id = $1`, [user.id]);
    return ok({
      business_name: user.business_name,
      owner_name: user.name,
      email: user.contact_email || user.email,
      address: user.business_address,
      tax_id: user.tax_id,
      default_currency: user.currency,
      payment_instructions: user.payment_instructions,
      quotes: counts,
      dashboard: `${baseUrl()}/app`,
      email_sending: emailMode() === 'email' ? 'enabled' : 'not configured (emails are recorded in the app only)',
      auto_send_new_quotes: user.auto_send,
      auto_follow_ups: user.auto_reminders ? `on, days ${user.reminder_days}` : 'off',
    });
  }));

  server.registerTool('create_quote', {
    title: 'Create quote',
    description: 'Create a quote for a client and, by default, email it to them right away and schedule follow-up reminders. You write the title, a short scope summary, line items, payment terms and terms & conditions, and optionally the cover email and reminder emails. Returns a public client_link the client opens to review and accept (no login), and an edit_link for the owner.',
    inputSchema: {
      title: z.string().describe('Short project title, e.g. "Brand identity redesign"'),
      client_name: z.string().describe('Client contact name'),
      client_email: z.string().optional().describe('Client email, needed for sending and reminders'),
      client_company: z.string().optional(),
      currency: z.string().optional().describe('ISO code like INR, USD, EUR. Defaults to the business currency'),
      items: z.array(itemSchema).min(1).describe('Line items'),
      tax_percent: z.number().optional().describe('Tax rate applied after discount, e.g. 18 for 18% GST'),
      discount: z.number().optional().describe('Flat discount amount (not percent) taken off the subtotal'),
      summary: z.string().optional().describe('Scope of work / what is included, 2-6 sentences or a short list'),
      payment_terms: z.string().optional().describe('e.g. "50% upfront, 50% on delivery"'),
      terms: z.string().optional().describe('Terms & conditions, revisions, timelines, etc.'),
      valid_days: z.number().optional().describe('How many days the quote is valid (default 14)'),
      due_days: z.number().optional().describe('Payment due this many days from today. If omitted, due 7 days after acceptance'),
      send_now: z.boolean().optional().describe('Email the quote to the client immediately. Default: the account setting (on). Set false only if the user wants to review a draft first'),
      email_subject: z.string().optional().describe('Subject of the cover email'),
      email_message: z.string().optional().describe('Cover email body you write. Placeholders like {{client_name}} work; the button to the quote is added automatically'),
      reminders: z.array(reminderSchema).max(10).optional().describe('Follow-up emails you write. If omitted, Dealflow schedules its standard follow-ups (account setting, default days 3, 7, 14)'),
    },
  }, wrap(async ({ send_now: sendNow, email_subject: subject, email_message: message, reminders, ...args }) => {
    let quote = await createQuote(user, args, 'Claude');
    const shouldSend = sendNow ?? user.auto_send;
    if (!shouldSend) {
      return ok(quoteForClaude(quote, { emailed: false, note: 'Saved as a draft. Use send_quote when the user is ready.' }));
    }
    const d = await deliverQuote(quote, user, 'Claude', { subject, message, reminders });
    quote = d.quote;
    return ok(quoteForClaude(quote, {
      emailed: d.emailed,
      email_note: deliveryNote(d, quote),
      reminders_scheduled: d.reminders_scheduled,
    }));
  }));

  server.registerTool('list_quotes', {
    title: 'List quotes and invoices',
    description: 'List quotes/invoices with their status (draft, sent, viewed, accepted = invoice awaiting payment, paid, declined), total, and whether the client opened them.',
    inputSchema: {
      status: z.enum(['all', 'unpaid', 'draft', 'sent', 'viewed', 'changes_requested', 'accepted', 'client_paid', 'paid', 'declined', 'archived']).optional()
        .describe('"unpaid" = everything not paid or declined; "client_paid" = client says they paid, awaiting confirmation; archived quotes only appear under "archived". Default all'),
    },
    annotations: { readOnlyHint: true },
  }, wrap(async ({ status }) => {
    const rows = await listQuotes(user.id, status);
    const summary = rows.reduce((acc, r) => {
      const t = totals(r).total;
      if (r.status === 'accepted') acc.awaiting_payment += t;
      if (r.status === 'paid') acc.paid += t;
      return acc;
    }, { awaiting_payment: 0, paid: 0 });
    return ok({
      count: rows.length,
      totals_by_currency_note: 'Totals are summed in each quote\'s own currency; mixed currencies are not converted.',
      awaiting_payment: summary.awaiting_payment,
      paid: summary.paid,
      quotes: rows.map((r) => ({
        id: r.id,
        number: docNumber(r),
        title: r.title,
        client: r.client_company || r.client_name,
        status: displayStatus(r),
        status_label: STATUS_LABEL[displayStatus(r)],
        total: money(totals(r).total, r.currency),
        opened_by_client: r.view_count > 0,
        due_date: r.due_date,
        client_says_paid: !!r.client_paid_at,
        created: fmtDateTime(r.created_at),
        client_link: publicUrl(r),
      })),
    });
  }));

  server.registerTool('get_quote', {
    title: 'Get quote details',
    description: 'Full details of one quote/invoice: line items, totals, status, client activity (opened, accepted, says paid) and scheduled reminders.',
    inputSchema: { quote: ref },
    annotations: { readOnlyHint: true },
  }, wrap(async ({ quote: r }) => {
    const quote = await mustFind(user, r);
    const reminders = await getReminders(quote.id);
    const events = await getEvents(quote.id);
    return ok(quoteForClaude(quote, {
      reminders: reminders.map((x) => ({
        id: x.id, send_at: x.send_at, status: x.status, subject: x.subject, body: x.body, error: x.error,
      })),
      activity: events.slice(0, 20).map((e) => `${fmtDateTime(e.created_at)} · ${e.actor}: ${e.message}`),
    }));
  }));

  server.registerTool('update_quote', {
    title: 'Update quote',
    description: 'Change a quote. Only the fields you pass are changed. Passing items replaces ALL line items, so include the full list. Accepted or paid invoices can still be edited.',
    inputSchema: {
      quote: ref,
      title: z.string().optional(),
      client_name: z.string().optional(),
      client_email: z.string().optional(),
      client_company: z.string().optional(),
      currency: z.string().optional(),
      items: z.array(itemSchema).optional(),
      tax_percent: z.number().optional(),
      discount: z.number().optional(),
      summary: z.string().optional(),
      payment_terms: z.string().optional(),
      terms: z.string().optional(),
      valid_until: z.string().optional().describe('YYYY-MM-DD'),
      due_date: z.string().optional().describe('YYYY-MM-DD'),
    },
  }, wrap(async ({ quote: r, ...patch }) => {
    const quote = await mustFind(user, r);
    const updated = await updateQuote(quote, patch, 'Claude');
    return ok(quoteForClaude(updated));
  }));

  server.registerTool('send_quote', {
    title: 'Email quote to client',
    description: 'Email (or re-email) the client a link to the quote, or the invoice once accepted. You may write the email message; otherwise a short default is used. Marks a draft as sent and schedules standard follow-ups if none are pending.',
    inputSchema: {
      quote: ref,
      subject: z.string().optional(),
      message: z.string().optional().describe('Email body. Placeholders like {{client_name}} are filled in. The link button is added automatically'),
    },
  }, wrap(async ({ quote: r, subject, message }) => {
    const d = await deliverQuote(await mustFind(user, r), user, 'Claude', { subject, message });
    return ok({
      sent: d.emailed,
      note: deliveryNote(d, d.quote),
      reminders_scheduled: d.reminders_scheduled,
      ...quoteForClaude(d.quote),
    });
  }));

  server.registerTool('schedule_reminders', {
    title: 'Schedule payment reminders',
    description: 'Schedule follow-up emails to the client for a quote or invoice. You write each email; make them progressively firmer but polite. Dealflow sends them on schedule even after this chat ends, and cancels any that are still pending once the invoice is marked paid or the quote is declined.',
    inputSchema: {
      quote: ref,
      reminders: z.array(reminderSchema).min(1).max(10),
      replace_existing: z.boolean().optional().describe('Delete ALL reminders that have not been sent yet before adding these. Dealflow\'s standard automatic follow-ups are always replaced. Default false'),
    },
  }, wrap(async ({ quote: r, reminders, replace_existing }) => {
    const quote = await mustFind(user, r);
    if (['paid', 'declined'].includes(quote.status)) throw new Error(`${docNumber(quote)} is ${quote.status}; reminders are not needed.`);
    const created = await addReminders(quote, reminders, { replace: !!replace_existing }, 'Claude');
    return ok({
      scheduled: created.map((x) => ({ id: x.id, send_at: x.send_at, subject: x.subject })),
      sends_to: quote.client_email || '(no client email yet: add one or reminders will fail)',
      email_sending: emailMode() === 'email' ? 'enabled' : 'not configured: reminders will be recorded in the app but not emailed',
      edit_link: `${baseUrl()}/app/quotes/${quote.id}`,
    });
  }));

  server.registerTool('archive_quote', {
    title: 'Archive or restore a quote',
    description: 'Hide a quote/invoice from the main list (archive) or bring it back (restore). Archived quotes stop sending reminders. Nothing is deleted.',
    inputSchema: { quote: ref, archived: z.boolean().default(true).describe('true = archive, false = restore') },
  }, wrap(async ({ quote: r, archived }) => {
    const updated = await setArchived(await mustFind(user, r), archived, 'Claude');
    return ok(quoteForClaude(updated));
  }));

  server.registerTool('mark_paid', {
    title: 'Mark invoice paid',
    description: 'Record that the client has paid. Cancels any pending reminders.',
    inputSchema: { quote: ref },
  }, wrap(async ({ quote: r }) => {
    const quote = await mustFind(user, r);
    const updated = await markPaid(quote, 'Claude');
    return ok(quoteForClaude(updated));
  }));

  return server;
}

/** Express handler for POST/GET/DELETE /mcp/:key (stateless Streamable HTTP). */
export async function handleMcp(req, res) {
  const user = await one('SELECT * FROM users WHERE mcp_key = $1', [req.params.key]);
  if (!user) {
    res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unknown Dealflow connector link. Copy it again from the Connect Claude page.' }, id: null });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
    return;
  }
  const server = buildMcpServer(user);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
