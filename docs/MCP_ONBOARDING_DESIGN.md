# MCP onboarding and backend market data

Status: proposed implementation, not shipped in MCP 0.2.1.

## Backend placement

Run Theta Terminal as a private backend service with Java 21 and THETADATA_API_KEY. The Node backend uses PAPER_THETA_TERMINAL_URL over the private network. The public MCP package never downloads Terminal, receives its key, or connects to ThetaData directly. The Mac installation is only a development setup; it is not a production dependency.

ThetaData Free supports historical end-of-day data, not executable real-time option bid/ask quotes. Free-tier connectivity/history tests do not enable live-priced trading or imply Value Options entitlement. Keep the execution freshness/source checks and fail closed when the provider cannot supply eligible data.

## Current behavior and missing capability

The published stdio MCP supports trading and records after a paper account and account token already exist. Account-scoped tokens intentionally cannot create accounts, join another competition, or issue tokens. Removing accountId restrictions from those tokens would silently widen existing grants.

The missing capability is a user-authorized management session, separate from an account trading token. A human must sign in and approve management permissions before the agent can provision resources on their behalf. KH website registration versus existing-user sign-in is awaiting the owner's clarification.

## Proposed user flow

1. Install the local MCP package through the published, pinned npx command.
2. Sign in through the KH browser UI and approve the requested user-level management permissions.
3. Let the agent list competitions, create a paper practice account, or join a competition. Joining creates the fixed-funded competition account through the existing transaction.
4. Optionally issue/revoke a limited account trading token for another agent. The authenticated management session already identifies the current user; creating a child token is not a prerequisite for every operation.
5. Store credentials through the client/local credential facility. Do not ask users to put passwords, provider keys, or long-lived management tokens in tool arguments.

For HTTP authorization use the MCP authorization framework with authorization-code/PKCE, resource-bound access tokens, explicit consent, short expiry, secure refresh rotation and revocation. Stdio itself remains a local transport; its upstream client obtains credentials separately. Existing PAPER_TRADING_TOKEN and PAPER_TRADING_TOKEN_FILE setups remain supported with their original account boundaries.

## Tool scope

| Tool | Permission / behavior |
| --- | --- |
| paper_list_competitions | Public discovery or existing-user visibility rules; no private-contest enumeration |
| paper_create_account | User-approved account-management scope; practice accounts only |
| paper_join_competition | User-approved management scope; existing one-entry/fixed-deposit rules |
| paper_create_token | Separate token-issuance permission; owned account only; child scopes cannot exceed the grant |
| paper_list_tokens | Metadata only; never return token hashes or old secrets |
| paper_revoke_token | Own delegated/account tokens only; explicit write action |
| paper_create_competition | User management permission for unlisted; saved admin role additionally required for public |

Token issuance should provide a secure one-time handoff or store the child credential locally and return metadata, rather than automatically printing it into model transcripts. Grant revocation must also define the fate of delegated tokens; children must not outlive the authority that issued them. Use idempotency for account and token creation to avoid duplicates after ambiguous timeouts.

## Implementation acceptance checks

- Existing account tokens cannot gain management capabilities or cross account boundaries.
- A newly authorized user with no paper accounts can create one and join a public competition using the local MCP.
- Users cannot create public competitions by spoofing roles, tool parameters or token scopes.
- Failed/expired consent, PKCE mismatch, replay, redirect manipulation and revoked grants are rejected.
- Token issuance cannot escalate scopes or become an unbounded credential chain.
- Management calls share the existing Mongo-backed quota and concurrency controls; no automatic replay of writes.
- End-to-end browser consent plus local stdio tests precede a new npm version and deployment.

References:
- https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- https://docs.thetadata.us/Articles/Getting-Started/Subscriptions.html
