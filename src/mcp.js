import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { one } from './db.js';
import {
  createQuote, updateQuote, findQuote, listQuotes, getReminders, getEvents, markPaid, markSent,
  addReminders, quoteForClaude, logEvent, publicUrl, totals, money, fmtDateTime, docNumber, STATUS_LABEL, baseUrl,
} from './quotes.js';
import { sendQuoteEmail, emailMode } from './reminders.js';

const INSTRUCTIONS = `Dealflow turns quotes into invoices and chases payment for a freelancer or small business.
You (Claude) do all the writing: scope, line items, terms and reminder emails. Dealflow stores them, gives the
client a public link to review and accept, converts accepted quotes into invoices, and sends your reminder
emails on schedule until the invoice is paid.
Typical flow: create_quote -> share the client_link (or send_quote to email it) -> schedule_reminders -> mark_paid.
Quotes can be referred to by number (Q-0003 / INV-0002) or id. Always show the user the client_link and edit_link.
Reminder subject/body may use placeholders: {{client_name}}, {{amount}}, {{number}}, {{due_date}}, {{link}},
{{title}}, {{sender_name}}, {{business_name}}. Dealflow fills them in when it sends.`;

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
      email: user.email,
      address: user.business_address,
      tax_id: user.tax_id,
      default_currency: user.currency,
      payment_instructions: user.payment_instructions,
      quotes: counts,
      dashboard: `${baseUrl()}/app`,
      email_sending: emailMode() === 'email' ? 'enabled' : 'not configured (emails are recorded in the app only)',
    });
  }));

  server.registerTool('create_quote', {
    title: 'Create quote',
    description: 'Create a quote for a client. You write the title, a short scope summary, line items, payment terms and terms & conditions. Returns a public client_link the client opens to review and accept (no login), and an edit_link for the owner.',
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
    },
  }, wrap(async (args) => {
    const quote = await createQuote(user, args, 'Claude');
    return ok(quoteForClaude(quote, {
      next_steps: 'Share client_link with the client, or call send_quote to email it. Then schedule_reminders to follow up automatically.',
    }));
  }));

  server.registerTool('list_quotes', {
    title: 'List quotes and invoices',
    description: 'List quotes/invoices with their status (draft, sent, viewed, accepted = invoice awaiting payment, paid, declined), total, and whether the client opened them.',
    inputSchema: {
      status: z.enum(['all', 'unpaid', 'draft', 'sent', 'viewed', 'accepted', 'paid', 'declined']).optional()
        .describe('"unpaid" = everything not paid or declined. Default all'),
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
        status: r.status,
        status_label: STATUS_LABEL[r.status],
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
    description: 'Email the client a link to the quote (or invoice, once accepted). You may write the email message; otherwise a short default is used. Marks a draft as sent.',
    inputSchema: {
      quote: ref,
      subject: z.string().optional(),
      message: z.string().optional().describe('Email body. Placeholders like {{client_name}} are filled in. The link button is added automatically'),
    },
  }, wrap(async ({ quote: r, subject, message }) => {
    let quote = await mustFind(user, r);
    const { delivery } = await sendQuoteEmail(quote, user, { subject, message });
    quote = await markSent(quote, 'Claude');
    await logEvent(quote.id, 'Claude', delivery === 'email'
      ? `Emailed link to ${quote.client_email}` : 'Send requested (email not configured, link must be shared manually)');
    return ok({
      sent: delivery === 'email',
      note: delivery === 'email'
        ? `Emailed to ${quote.client_email}.`
        : 'Email sending is not configured on this Dealflow server, so nothing was emailed. Share client_link with the client directly.',
      ...quoteForClaude(quote),
    });
  }));

  server.registerTool('schedule_reminders', {
    title: 'Schedule payment reminders',
    description: 'Schedule follow-up emails to the client for a quote or invoice. You write each email; make them progressively firmer but polite. Dealflow sends them on schedule even after this chat ends, and cancels any that are still pending once the invoice is marked paid or the quote is declined.',
    inputSchema: {
      quote: ref,
      reminders: z.array(z.object({
        send_in_days: z.number().optional().describe('Days from now (fractions allowed, 0 = within a minute)'),
        send_at: z.string().optional().describe('Exact ISO datetime instead of send_in_days'),
        subject: z.string(),
        body: z.string().describe('Plain text email. Can use {{client_name}}, {{amount}}, {{number}}, {{due_date}}, {{link}}, {{sender_name}}'),
      })).min(1).max(10),
      replace_existing: z.boolean().optional().describe('Delete reminders that have not been sent yet before adding these. Default false'),
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
