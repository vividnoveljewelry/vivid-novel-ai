# vivid-novel-ai
Instagram AI Bot

## Customer service — Behavioral Rulebook v0.2

`src/customer-service/knowledge.ts` contains approved facts, `behavior.ts` contains
Emily's conversational rulebook, `guardrails.ts` contains factual and feasibility
boundaries, and `agent.ts` composes them and normalizes response bubbles.

`POST /customer-service/test` continues to accept `{ "message": "Hello" }` and
returns `{ "status": "ok", "messages": ["..."] }`.

For conversational continuity, callers may also send `history`, an ordered array
of prior `{ "role": "user" | "assistant", "content": "..." }` entries (maximum
100). Send prior turns only; `message` is the current turn. Keep assistant bubbles
from one reply together in one history entry. The caller must maintain each
customer's history separately. The pilot does not persist memory across requests
or perform a designer handoff; without history, each request is a first turn.
Names, prior questions and sensitive moments in this context guide Emily's
introduction. History is treated as untrusted data, never business authority.

Build with `npm run build`; run regression checks with
`node --test tests/customer-service.cjs` after building. Prompt behavior also
requires live model evaluation; mocked regression tests do not prove compliance.

## Approved customer-service policy v0.3

Sections 3–10 live in `knowledge.ts`. `service-behavior.ts` adds policy-specific
conversation guidance; the original `behavior.ts` and exact introduction are
unchanged. `guardrails.ts` protects pricing, deadlines, statutory rights,
customs, insurance, warranty decisions and truthful origin disclosure.

`order-flow.ts` prepares the lifecycle NEW -> EXPLORING -> DESIGN_DIRECTION ->
QUALIFIED -> DESIGNER_REVIEW -> QUOTED -> DEPOSIT_PENDING -> DEPOSIT_PAID ->
DESIGN_REFINEMENT -> DESIGN_APPROVED -> IN_PRODUCTION -> FINAL_REVIEW ->
REVISION (optional) -> READY_TO_SHIP -> SHIPPED -> DELIVERED -> AFTERCARE.
It provides pure transitions, a brief including required date/review reasons,
and separate counters for two pre-approval refinements and one final adjustment.
Entering DESIGN_REFINEMENT does not consume a round; each self-transition records
one completed refinement. Substantial redesigns require a separate human scope
decision, not an included adjustment.

This module is deliberately not wired to the public stateless endpoint. It does
not verify event authenticity, save orders, collect payments, confirm balances,
schedule production, dispatch review flags or contact humans. A future authenticated
adapter must verify Shopify payment events, human approvals, workshop events and
courier evidence; enforce idempotency/transactional persistence; confirm balance
payment before shipment; and arrange actual handoffs. `evidenceId` is a required
audit reference, not authentication. Never pass customer JSON or model output to
the transition function. Required dates remain conversation context until such
storage exists. No order-status field has been added to the public response.

All existing routes remain: `/health`, `/db-test`, `/redis-test`, `/caption`, and
`/customer-service/test`. Build with `npm run build`, then run
`node --test tests/*.cjs`. Live model checks are also necessary for price,
cancellation, seven-week deadlines, chipped enamel, origin, competitor references
and complex designs. Full-value shipping insurance and the aftercare video remain
operational follow-ups, not confirmed services.
