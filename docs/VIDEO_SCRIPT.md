# Dealflow pitch video script (≤ 5:00)

Record your screen with your face in a corner (Loom works well). Before you start, have these open in tabs:
1. Claude, in a **new chat** with the Dealflow connector enabled
2. The Dealflow dashboard, logged in to the account the connector points to
3. A **private/incognito window** for the client view

Lines in **[brackets]** are for you to fill in. Timings follow the brief.

---

## 1. Who I am (0:00–0:45)

> Hi, I'm **[Your name]**, founder of Dealflow.
> **[Your background in 2–3 sentences: current role and company, years of experience, what you build or own,
> e.g. "I'm a ___ at ___, where I work on ___ for ___ users."]**
> I'm building Dealflow because **[a personal link, e.g. "I've freelanced on the side and spent more time chasing
> invoices than doing the work" / "I've watched friends running agencies lose weeks of cash flow to unpaid invoices"]**.

## 2. My best work (0:45–1:15)

> One thing I'm proud of: **[project]**. **[What you did]**, and it **[result with a number: % improvement, ₹ saved,
> users, time cut, e.g. "cut checkout latency 40% for 10M monthly users"]**.
> I like shipping small things that move a real number, and that's how I built Dealflow: one flow, end to end, in 24 hours.

## 3. Why Dealflow wins (1:15–2:15)

> **Who it's for:** freelancers and small agencies (designers, developers, marketers, consultants) who already pay
> for Claude.
> **The problem:** the gap between "the client said yes" and "the money arrived". Writing quotes takes too long. You
> send a PDF on WhatsApp and get no signal back. Then you have to chase payment, which is awkward, so it happens late
> or never.
> **Why not just Claude?** Claude can write a great quote, but it can't host it, it can't tell you the client opened it,
> it can't record their acceptance, and it can't send a reminder next Tuesday after the chat has closed.
> **Why not invoicing software?** Those tools make you fill in forms. In Dealflow you describe the job in plain words,
> and your own Claude writes the quote and the follow-ups.
> So Claude does the thinking, and Dealflow keeps the deal live until you're paid. We have no AI inside and no AI bill.

## 4. Demo (2:15–4:15)

**In Claude** (0:30). Paste:
> Create a Dealflow quote for Priya at Acme Corp (priya@acme.com): logo redesign with 3 concepts and 2 revision
> rounds for ₹40,000, plus brand guidelines for ₹15,000. 18% GST, 50% upfront, 50% on delivery.

Say: *"Claude is writing the scope, line items and terms, and now it's calling Dealflow's create_quote tool."*
Click the edit link Claude returns.

**In Dealflow** (0:30). Say: *"Here's exactly what Claude wrote, now saved in my app."*
- Change the brand guidelines price to 20,000 and add a line "Social media kit: 8,000". Point at the total updating live.
- Click **Save**. *"The client sees this immediately on the same link."*

**As the client** (0:30). Copy the client link and open it in the incognito window.
- *"No login, a clean quote."* Tick the box, click **Accept quote**. *"It's now invoice INV-0001 with my payment details."*
- Back in the dashboard, refresh. Point at **Opened**, **Accepted by Priya** and the activity timeline.

**Back in Claude** (0:30). Paste:
> Schedule 3 payment reminders for that invoice: a friendly nudge in 3 days, a follow-up in 7 and a firm one in 14.

*"Claude wrote three emails, and Dealflow will send them on schedule even after I close this chat."* Show them on the
quote page. Optionally click **Send now** on the first one.
Then:
> Priya just paid. Mark it paid.

*"The invoice is paid and the remaining reminders are cancelled automatically."*

## 5. The money (4:15–5:00)

> **Cost to run:** about ₹26 per customer per month (hosting, database, email and billing fees). AI cost is zero,
> because the customer's own Claude plan does the writing. That's about 96% gross margin.
> **Price:** free for 3 active quotes, Pro at ₹499 a month, Studio at ₹1,499 for teams, and $9 or $29 outside India.
> **First 100 customers:** my own network of freelancers and agency owners, build-in-public demo clips on LinkedIn and X,
> Indian freelancer communities, MCP connector directories, and a viral loop: every quote a client opens says
> "Sent with Dealflow".
> **Year 1:** 1,000 paying customers, about ₹84 lakh ARR, with payment links and WhatsApp reminders live.
> **Year 3:** 12,000 customers and about ₹10 crore ARR, as the accounts-receivable layer for small businesses in India
> and South-East Asia, plus a small fee on payments collected through Dealflow.
> Thank you.

---

**Tips:** Do one dry run first so Claude has already been granted tool permission. Keep the browser zoom at 110–125% so
it's readable. If Claude takes a while to answer, cut that wait in editing.
