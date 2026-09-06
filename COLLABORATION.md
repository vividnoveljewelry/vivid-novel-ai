# Vivid Novel collaboration studio

Emily remains the customer-facing voice. Staff advise privately; direct human replies require exceptional HUMAN mode. Existing endpoints and the stateless `/customer-service/test` contract remain unchanged. The approved knowledge, Behavioral Rulebook v0.2 and guardrails files are unchanged. Persistent context is added only by server code, never accepted from customer input.

## Access

Open `/admin/` on the existing Railway service. Sign in with `ADMIN_TOKEN` from Railway → Vivid Novel AI → vivid-novel-ai → Variables, and enter your staff name for audit attribution. Tokens must have at least 32 characters. Login uses an 8-hour HttpOnly, SameSite=Strict cookie, Secure over HTTPS. Mutations require a same-origin request or bearer authentication. The static login page is public; every data and action endpoint requires authentication. Never put the token in a URL or repository. Rotate the environment variable to revoke sessions. V1 uses shared-token authentication; staff names are self-reported, not individual verified identities. Individual accounts and role permissions are future work.

## Workflow

- EMILY: replies read persisted facts/history. Outputs are explicitly `sent_simulated` until a real channel exists.
- CONSULT: a specific private question is saved and Needs Human is raised. Emily waits; the response keeps `{status:'ok', messages:[]}`. No notification outside the dashboard is claimed.
- REVIEW: private note → Emily draft → staff edits/approves → outbound rows marked `approved`. Approval does not imply delivery and does not automatically return to autonomous mode. Click Return to Emily when ready.
- HUMAN: Emily customer-facing output is blocked both in service logic and a database trigger. Staff can store approved direct replies. Private drafts remain possible. Return to Emily restores eligibility and invalidates old drafts.

The inbox shows mode, unread count and Needs Human. Open a conversation to see the customer-facing thread, structured client/commission card, automatic staff briefing, private team panel, review editor and recent audit events. Use **New client / demo** to create an explicitly marked demo. No seed runs automatically. Structured designer fields include feasibility, timeline status and suggested price. A suggested price is never the final quote. Check actual designer review only when a person has really reviewed the scoped design; it does not assert that all images were reviewed.

## Storage and safety

`db/migrations/001_collaboration.sql` creates only new `vn_` tables: clients, conversations, commissions, messages, facts, consultations, reviews, audit and references. `vn_migrations` records applied checksums. Startup and `npm run migrate` use a transaction and an advisory lock; a failed migration rolls back and prevents startup. Re-running is safe; editing an applied migration is rejected. There are no drops or alterations to existing application tables. Back up production before future schema changes; rollback application code leaves these additive tables intact.

All mutations serialize on the conversation row. Model generation occurs outside the lock; its resulting reply/draft is accepted only if the conversation version is unchanged. Human/customer updates invalidate pending reviews. Incoming external IDs and repeated approval are idempotent. Message sequence preserves bubble ordering. Internal roles cannot have outbound delivery states. References are metadata only; no upload or remote fetch is implemented.

Facts include source, authority, confirmation, evidence, actor, optional message provenance and timestamps. Authority is system/Shopify-confirmed (4) > human/designer-confirmed (3) > customer (2) > AI/unconfirmed (1). A database trigger rejects demotion; the application records rejected writes in audit. Staff endpoints always write human provenance and cannot spoof system/Shopify. Generated summaries are display-only and never write facts. Initial automatic extraction is deliberately narrow: explicit budget and no-gemstone statements; other reliable details can be confirmed in the memory card. Full history is durable, and the last 60 simulated conversational messages plus structured memory are supplied to Emily. Approved-but-unsent outbound is excluded from delivered conversation context.

The commission lifecycle reuses the existing `transitionOrder` rules. Staff can make permitted human transitions with evidence. Deposit-paid, workshop and courier stages remain blocked until authenticated, verified adapters exist. A customer promise or arbitrary source field cannot advance them. The UI therefore prepares the full lifecycle without pretending commerce/production integrations are present.

## API

All `/admin/api` routes require an admin cookie or `Authorization: Bearer <ADMIN_TOKEN>`. Optional `X-Staff-Name` supplies audit attribution.

- `GET/POST /admin/api/conversations`: inbox / create `{name,demo}`.
- `GET /admin/api/conversations/:id`: complete staff record and briefing.
- `POST .../:id/customer`: `{message,externalId}` simulated incoming message.
- `POST .../:id/mode`: `{mode}`.
- `POST .../:id/facts`: `{key,value,evidence}` human-confirmed memory.
- `POST .../:id/notes`: `{note,designerConfirmed,feasibility,timeline_status,suggested_price}` private note and draft.
- `POST .../:id/reviews/:rid/approve`: `{messages:["edited bubble"]}` stores approved outbound.
- `POST .../:id/human-send`: `{message}` stores exceptional human outbound.
- `POST .../:id/reply`: request Emily simulation using latest context.
- `POST .../:id/stage`: `{stage,evidence}` permitted human lifecycle transition.
- `POST .../:id/read`: acknowledge unread count.
- `POST /customer-service/messages`: admin bearer required; `{conversationId,message,externalId}` durable simulated ingress, same status/messages envelope.

The original `/customer-service/test` remains stateless for regression compatibility. Use the durable route or dashboard for persistent memory. Do not connect Instagram directly to either route without signature verification and channel identity mapping.

## Build and validation

`npm ci && npm run build && npm test`. Tests use embedded Postgres (PGlite) to execute the real migration and triggers, with a deterministic model stub. The suite covers the six requested scenarios, idempotency, mode/approval races, private-message constraints and payment evidence, plus existing behavioral and endpoint tests. Live checks must additionally exercise the real deployed model and Railway database.

## Remaining integrations

`src/customer-service/integrations.ts` defines explicit boundaries only. Instagram OAuth, webhook signature validation, identity mapping, media ingestion, retries and delivered receipts are not implemented. Shopify order lookup/payment webhook verification, workshop/courier events and notifications are not implemented. No `sent` or `delivered` status exists for outgoing V1 messages. Token-authenticated manual simulation is not a production channel adapter. Feasibility detection is conservative keyword routing; expand multilingual intent coverage before opening real inbound channels.
