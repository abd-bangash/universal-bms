# Administrator guide

For the person who looks after the system day to day: the Owner, or someone the Owner trusts. Release 1
runs on the testing environment (`docs/deployment-testing.md` explains how it is deployed).

## 1. Signing in and the first checks

1. Sign in with the Owner account created for your business.
2. Open **Settings → Business** and check the business name, address, currency, time zone, date format
   and document numbering. Documents (quotations, invoices, receipts) take their header, footer and
   numbers from here.
3. Open **Settings → System status** (Owner only). Everything under _Core services_ should read
   **Working**.

## 2. Settings

| Where                           | What you set                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings → Business             | Name, contact details, logo, currency, time zone, date format, document numbers and footers, the required deposit percentage, discount limits |
| Settings → Industry and modules | The industry profile, which modules are switched on, units of measure, tax classes, lost reasons                                              |
| Finance → Accounts              | Cash, bank and wallet accounts; tick _show to customers_ to include one in the bank-details message                                           |
| Finance → Accounts              | Also the payment methods (Cash, Bank transfer ...) and which account each one lands in                                                        |
| Settings → Audit log            | Who did what and when; filter by person, record type and date                                                                                 |

## 3. Staff, roles and permissions

- **Staff** (Staff menu; roles are under Staff → Roles): invite people, set their role, deactivate people who leave. Deactivating signs
  them out at once and keeps their history.
- **Roles:** Owner, Manager, Salesperson, Cashier, Inventory Staff, Account Staff, Production Staff,
  AI/Automation Operator, Viewer. You can copy a role and change its permissions; the editor lists every
  permission by area.
- Only the Owner can see **System status**. Managers cannot change settings, roles, fields, workflows,
  integrations or accounts.
- Give people the least they need: a cashier needs no access to reports, a salesperson sees only their
  own leads and orders unless given _view all_.
- A staff member's commission percentage is set on their staff page.
- At least one Owner must always exist; the system refuses to remove the last one.

## 4. Integrations (WhatsApp)

1. Open **Integrations** in the main menu (needs _manage integrations_).
2. Choose WhatsApp and enter the **phone number ID** and **access token** from your Meta developer app.
   Secrets are stored encrypted and are never shown again, only the last characters.
3. Press **Test connection**. A green status means messages can flow.
4. In Meta's dashboard set the webhook address to `<API address>/api/v1/webhooks/whatsapp` and the verify
   token to the value of `META_WEBHOOK_VERIFY_TOKEN`; subscribe to _messages_.
5. If the status turns **Error**, the page shows the last error and when it happened. A common cause is
   an expired token: reconnect with a new one.

## 5. The AI assistant

Open **Automation → AI**.

- **Mode:** _Off_ (default) or _Assist_. In Assist the assistant reads new messages and prepares a
  summary, the details it found (size, material, colour, quantity ...), matching products and a draft
  reply. **Nothing is sent or saved until a person approves it.**
- **Provider and model:** Anthropic. The API key is set under Integrations (AI).
- **Tone, reply language, reply length** and **escalation keywords** (words that always hand the
  conversation to a person, e.g. _refund_, _complaint_).
- **Confidence threshold:** details below it are shown as uncertain.
- **Limits:** a daily request limit and a monthly token budget. At the limit the assistant stops until
  the next period and staff carry on by hand; 0 blocks it entirely.
- **Knowledge:** short facts the assistant may use (opening hours, delivery areas, care instructions).
  Do not put prices there; prices come from the catalogue.
- **AI log:** every call with who approved what. What the provider receives is described in
  `docs/ai-data-handling.md`.

## 6. Monitoring

Settings → System status shows, refreshed every 30 seconds:

- **Core services:** database, queue store (Redis) and file storage.
- **Integrations:** status, last success, last error.
- **Background jobs:** waiting, running, delayed and failed counts per queue, and the number of jobs given
  up on (the dead-letter queue). A rising failed count means something outside is failing: check
  Integrations first.
- **Backups:** the time of the last successful backup, with a warning after 24 hours.

Alerts the operator should set up on the hosting platform (Requirement 51.5): API unavailable
(`GET /api/v1/health/live`), elevated error rate, queue backlog, failed backup, integration failure,
storage above 80 %.

## 7. Backups

The recovery point objective is 24 hours, so take a backup **at least daily** and keep a copy off the
database server.

```bash
# take a backup (checks that the file can be read, then reports the time to the system status page)
DATABASE_URL=postgresql://... \
BACKUP_RECORD_COMMAND="pnpm --filter api backup:record" \
  scripts/backup.sh ./backups

# rehearse a restore into a scratch database (created and dropped by the script)
ADMIN_DATABASE_URL=postgresql://.../postgres \
  scripts/restore-test.sh ./backups/bms-<timestamp>.dump
```

The restore script counts workspaces, users, orders, audit events and migrations in the restored copy
and fails if the data is not there. Record the date of every rehearsal in `docs/known-limitations.md`.
Keep backups for at least 14 days. Files (product images, documents) live in the storage bucket and are
protected by the bucket's own versioning or replication, not by the database dump.

To restore for real: stop the API, create an empty database, `pg_restore --no-owner --dbname=<url>
<dump>`, point `DATABASE_URL` at it, start the API (it applies any newer migrations on deploy).

## 8. Demo data

- `pnpm --filter api seed:demo` creates the demo business "Demo Furniture Co" (sign in as
  `owner@demo.test`, `manager@demo.test`, ...). Running it again adds nothing twice.
- `pnpm --filter api demo:reset` wipes the demo business and its users and creates it again, for
  training. It works only on a workspace marked as demo.
- `pnpm --filter api workspace:clear-demo -- --workspace demo-furniture-co --yes` is for go-live: it
  removes customers, leads, orders, payments, stock, conversations and the like, keeps everything
  configured (staff, roles, settings, templates, knowledge) and stops the workspace being a demo.
  Without `--yes` it only lists what would go.

## 9. Credentials

Rotate token-signing keys, storage keys and the Meta tokens as described in
`docs/deployment-testing.md` section 7. Never change `INTEGRATION_ENCRYPTION_KEY` once integrations are
connected without reconnecting each one. Secrets are never kept in the repository.
