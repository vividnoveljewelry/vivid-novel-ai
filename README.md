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
