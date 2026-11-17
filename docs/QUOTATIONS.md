# Quotation Management

Generic quotation module for products, services, courses, subscriptions and
custom work. A quotation is a commercial offer that can be sent to a customer,
accepted or rejected, and converted once into a draft invoice.

## Features

- Product-agnostic line items with free-text description, category, item type
  and unit (suggestions are UI-only).
- Server-owned numbering (`FM-QTN-<year>-####`) and server-recalculated totals.
- Historical `clientSnapshot` so old quotations/PDFs do not change when a client
  record is edited.
- Status lifecycle with derived expiry (`draft`, `sent`, `accepted`, `rejected`,
  `expired`, `converted`).
- PDF generation using the shared Chrome instance.
- Email delivery through Nodemailer and WhatsApp delivery through Meta Cloud API.
- Idempotent, single-invoice conversion with transaction support on replica sets
  and a safe claim/verify fallback on standalone MongoDB.
- Responsive admin UI for list, creation, editing (drafts only), detail, PDF
  preview/download, delivery, decision recording and conversion.

## Numbering

Quotation numbers use the `Counter` collection with `_id = quotationNumber_<year>`.
The counter is atomic (`findOneAndUpdate` + `$inc`) and returns numbers such as
`FM-QTN-2026-0001`. Deleted or rejected quotations never cause number reuse.
Numbering is independent of invoice numbering.

## Calculation order

The authoritative implementation is `services/quotationCalculator.js`.

1. `base = round(quantity * unitPrice)`
2. `discountAmount = round(base * discountValue / 100)` for `percent`, or
   `round(discountValue)` for `amount`, capped at `base`
3. `taxable = round(base - discountAmount)`
4. `taxAmount = round(taxable * taxPercent / 100)`
5. `lineTotal = round(taxable + taxAmount)`
6. Totals sum rounded line values; `grandTotal = subTotal - discountTotal +
   taxTotal + shippingCharges`

All money values are rounded to 2 decimals with half-up behaviour
(`Math.round((n + EPSILON) * 100) / 100`). Clients may send line items and
shipping, but totals, numbering, snapshots and conversion fields are
server-owned and ignored on input.

## Lifecycle

| From | Action | To | Rule |
| --- | --- | --- | --- |
| `draft` | send email/WhatsApp | `sent` (on provider acceptance) | Not expired |
| `draft`, `sent` | administrator records acceptance | `accepted` | Not expired; note optional |
| `draft`, `sent` | administrator records rejection | `rejected` | Note optional |
| `accepted` | convert to invoice | `converted` | Exactly one invoice; retries return the same invoice |
| `draft` | update/delete | `draft` / deleted | Only drafts are editable |
| `draft`, `rejected` | delete | deleted | Conversion history cannot be deleted |

Expiry is derived, not stored by a background job: a `draft` or `sent`
quotation whose `validUntil` date is before today is displayed as `expired` and
cannot be sent, accepted or converted. Editing the draft and extending validity
restores the normal lifecycle.

Accepting/rejecting through the API records an administrator decision. It is not
a cryptographically verified customer signature; the UI labels it accordingly.

## API

All routes require an authenticated admin (`Authorization: Bearer <token>`).
The API is mounted under the server's existing `/api` prefix.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/quotations` | Paginated list with `search`, `status`, `client`, `issueFrom`, `issueTo`, `page`, `limit` |
| `POST` | `/quotations` | Create a draft |
| `GET` | `/quotations/:id` | Get a quotation (client populated, snapshot retained) |
| `PUT` | `/quotations/:id` | Update a draft and recalculate totals |
| `DELETE` | `/quotations/:id` | Delete a draft or rejected quotation |
| `POST` | `/quotations/:id/accept` | Record administrator acceptance (`note` optional) |
| `POST` | `/quotations/:id/reject` | Record rejection (`note` optional) |
| `GET` | `/quotations/:id/pdf` | Generate/download the quotation PDF |
| `POST` | `/quotations/:id/send-email` | Email the PDF to the client |
| `POST` | `/quotations/:id/send-whatsapp` | Send via WhatsApp Cloud API |
| `POST` | `/quotations/:id/convert-to-invoice` | Create or return the linked draft invoice |

List responses include `data`, `total`, `page`, `pages` and `stats`
(per-effective-status counts and values plus `all`).

Conversion returns `201` when it creates an invoice and `200` when it returns the
already-linked invoice. Invoice numbering is allocated by the existing invoice
logic. Converted invoices remain drafts and are never marked paid automatically.

### Conversion safety

On MongoDB replica sets the invoice creation and quotation update run in one
transaction. On standalone MongoDB the controller uses a short-lived conversion
claim and then verifies/recovers the invoice; duplicate key errors are handled so
concurrent requests converge on one invoice. The unique sparse index
`uniq_invoice_source_quotation` on `Invoice.sourceQuotation` is the final
database-level guarantee. Keep that index in production.

## Configuration

Required for the module:

| Variable | Purpose |
| --- | --- |
| `MONGO_URI` | Database connection |
| `JWT_SECRET`, `ADMIN_*` | Existing admin authentication |
| `COMPANY_NAME`, `COMPANY_WEBSITE`, `COMPANY_PHONE`, `COMPANY_EMAIL` | Branding on PDFs |
| `SMTP_*` | Email delivery (without these, email attempts are logged as failures) |
| `WHATSAPP_*` | WhatsApp delivery (without these, the API returns a manual share link) |
| `CHROME_PATH` | Optional explicit Chrome/Chromium executable for PDFs |

Delivery failures never throw away the quotation. They are recorded in
`sentLog` with `success: false` and a sanitized error. Provider acceptance means
the provider accepted the request, not that the customer opened or read it.

On Windows the bundled `puppeteer-core` uses the installed Chrome (commonly
`C:\Program Files\Google\Chrome\Application\chrome.exe`); set `CHROME_PATH` if
Chrome is installed elsewhere. PDFs include local `fonts/` and `images/` assets.

## Tests

From the backend repository:

```powershell
npm test
```

or targeted:

```powershell
node --test test/quotationCalculator.test.js
node --test test/quotation.api.test.js
node --test test/quotation.transaction.test.js
```

The suite covers calculation rounding/caps, validation and mass-assignment,
numbering under concurrency, listing/filtering, expiry, lifecycle permissions,
PDF generation (including multi-page markers), delivery failures, idempotent and
concurrent conversion, transaction conversion on a replica set, and an invoice
regression check. `mongodb-memory-server` needs its cached MongoDB binary or
network access on first run.

## Admin UI

Routes added to `Flareminds_billingUi-main`:

- `/quotations` — filters, status stats, PDF/email/WhatsApp/edit/delete actions
- `/quotations/new` — create a draft
- `/quotations/:id` — document view, PDF preview, delivery log, decisions and conversion
- `/quotations/:id/edit` — draft editing only

The frontend mirrors the calculation order for provisional display only; the
server response is always authoritative. `VITE_API_URL` must point at the API
base URL (for example `http://localhost:5000/api`).

## Operational notes

- Ensure the `Invoice.sourceQuotation` unique sparse index exists in every
  environment that can convert quotations.
- Quotation PDFs and delivery are rate-limited by the existing shared PDF and
  delivery limiters.
- Deleting an accepted/converted quotation is intentionally refused; delete the
  linked draft invoice separately only if business policy allows it.
- Currency is displayed with the quotation's stored `currency` field; arithmetic
  assumes a single currency per quotation.
