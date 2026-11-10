import pg from 'pg';

const { Pool } = pg;

// Keep DATE columns as plain 'YYYY-MM-DD' strings so time zones never shift them.
pg.types.setTypeParser(1082, (v) => v);

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Point it at a Postgres database (e.g. a free Neon project).');
  process.exit(1);
}

// Public hosts (Neon, Supabase, Render external URLs) need TLS. Local sockets and
// private service hostnames without a dot (e.g. Render's internal "dpg-xxxx-a") do not.
function wantsSsl(url) {
  if (process.env.DATABASE_SSL) return process.env.DATABASE_SSL === 'true';
  try {
    const host = new URL(url).hostname;
    return host.includes('.') && host !== '127.0.0.1';
  } catch {
    return false;
  }
}
const needsSsl = wantsSsl(process.env.DATABASE_URL);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 5,
});

export async function q(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

export async function one(text, params = []) {
  const rows = await q(text, params);
  return rows[0] || null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  mcp_key       TEXT NOT NULL UNIQUE,
  business_name TEXT NOT NULL DEFAULT '',
  business_address TEXT NOT NULL DEFAULT '',
  tax_id        TEXT NOT NULL DEFAULT '',
  payment_instructions TEXT NOT NULL DEFAULT '',
  currency      TEXT NOT NULL DEFAULT 'INR',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_id      TEXT NOT NULL UNIQUE,
  seq            INTEGER NOT NULL,
  title          TEXT NOT NULL,
  client_name    TEXT NOT NULL DEFAULT '',
  client_email   TEXT NOT NULL DEFAULT '',
  client_company TEXT NOT NULL DEFAULT '',
  currency       TEXT NOT NULL DEFAULT 'INR',
  items          JSONB NOT NULL DEFAULT '[]',
  tax_percent    NUMERIC(6,2) NOT NULL DEFAULT 0,
  discount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  summary        TEXT NOT NULL DEFAULT '',
  terms          TEXT NOT NULL DEFAULT '',
  payment_terms  TEXT NOT NULL DEFAULT '',
  valid_until    DATE,
  due_date       DATE,
  status         TEXT NOT NULL DEFAULT 'draft',
  sent_at        TIMESTAMPTZ,
  viewed_at      TIMESTAMPTZ,
  view_count     INTEGER NOT NULL DEFAULT 0,
  accepted_at    TIMESTAMPTZ,
  accepted_by    TEXT,
  declined_at    TIMESTAMPTZ,
  decline_reason TEXT,
  invoice_seq    INTEGER,
  client_paid_note TEXT,
  client_paid_at TIMESTAMPTZ,
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, seq)
);

CREATE TABLE IF NOT EXISTS reminders (
  id         SERIAL PRIMARY KEY,
  quote_id   INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  send_at    TIMESTAMPTZ NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'scheduled',
  sent_at    TIMESTAMPTZ,
  delivery   TEXT,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reminders_due ON reminders (status, send_at);

CREATE TABLE IF NOT EXISTS events (
  id         SERIAL PRIMARY KEY,
  quote_id   INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  actor      TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_quote ON events (quote_id, created_at);
`;

export async function migrate() {
  await pool.query(SCHEMA);
}
