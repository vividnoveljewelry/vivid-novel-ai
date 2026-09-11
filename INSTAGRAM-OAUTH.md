# Instagram connection pilot

Emily Auto-Replies stay PAUSED. The additive migration sets the saved control to false; the admin enable endpoint rejects enabling during this pilot. Webhook verification is unchanged. Webhook POST remains acknowledgement-only. No outbound adapter, subscriptions or customer messages are enabled by OAuth.

## Official specification checked 2026-09-11

- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login (updated March 13, 2026): authorization-code business login, exact authorization and exchange parameters, state, 60-day tokens and refresh conditions.
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started : v26.0 /me, id, user_id, username and account_type.
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api : instagram_business_basic and instagram_business_manage_messages.

## Railway variables

Set these manually on Vivid Novel AI / production / vivid-novel-ai:

- INSTAGRAM_APP_ID: the Instagram App ID under Instagram > API setup with Instagram login > Set up Instagram business login > Business login settings.
- INSTAGRAM_APP_SECRET: the Instagram App Secret from that same area (not a substitute Facebook app credential).
- INSTAGRAM_TOKEN_ENCRYPTION_KEY: a cryptographically random 32-byte key encoded as standard base64 (44 characters). Generate and save it privately with a trusted password manager or local cryptographic tool. Keep it stable across deployments; changing it makes existing stored tokens unreadable and requires reconnection.

Existing ADMIN_TOKEN and PostgreSQL variables are reused. Preserve META_INSTAGRAM_VERIFY_TOKEN. No access-token environment variable is needed; successful OAuth saves AES-256-GCM ciphertext in PostgreSQL.

## Connect

1. In Meta Business login settings, register exactly:
   https://vivid-novel-ai-production.up.railway.app/auth/instagram/callback
   Confirm no trailing slash was added.
2. Populate the three Railway variables and deploy the configuration.
3. Sign into https://vivid-novel-ai-production.up.railway.app/admin/ and open Settings > Connect Instagram.
4. Authorize with the professional @vivid.novel account. Standard Access applies only to owned/managed accounts added in the App Dashboard; other accounts need Advanced Access and review.
5. Success is established only when Meta returns a valid token and /me verifies the professional identity. Inspect Settings for connected status, verified account ID and expiry.

The username check is an account-selection policy, not an identity source. Both IDs, username and type come from Meta. An existing binding cannot be replaced by a different professional account or app-scoped ID.

## Security and lifecycle

POST /admin/api/instagram/connect requires existing admin authentication and same-origin protection. It sets a dedicated Secure, HttpOnly, SameSite=Lax callback cookie; the admin cookie remains Strict. The 256-bit state and browser nonce are hashed in PostgreSQL and bound to the current admin credential. State expires after ten minutes and is atomically consumed before errors or code exchange. Credential rotation invalidates pending states. No callback query values or provider errors are logged or reflected.

Token exchange uses multipart POST to api.instagram.com/oauth/access_token, followed by server-side GET graph.instagram.com/access_token with ig_exchange_token. Identity is fetched from graph.instagram.com/v26.0/me. The token is never returned by the admin status API or pages. The access token and secret necessarily appear in the documented server-to-server GET query parameters; do not add outbound URL tracing or log response bodies.

Every six hours (and at startup), the server considers refreshing tokens. Refresh runs only when the token is at least 24 hours old, is unexpired, has the basic permission and has seven days or less remaining. A PostgreSQL lock serializes workers. Refresh uses ig_refresh_token and stores the returned expiry; errors preserve the previous token and expose only a safe status. Expired tokens require Reconnect Instagram. No actual refresh or OAuth success is claimed until authorization occurs.

Validation: build and run the tests, including tests/instagram-oauth.cjs with embedded PostgreSQL and mocked Meta responses. These do not send real Instagram messages. Production validation must check health, unauthenticated Connect rejection, invalid callback state rejection and deployment logs. End-to-end OAuth remains a user authorization step.
