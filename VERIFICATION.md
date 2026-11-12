# Verification — 12 November 2026

- `npm run check`: passed.
- `npm test`: 6 tests passed, including 1,000 valid randomized assignments and HTTP integration tests of OTP login, local test login, role checks, result isolation, immutable draws, cross-origin write rejection, OTP reuse rejection, and rejection of test login in production. Test email delivery uses an in-memory mailbox; no external recipients.
- Dependency installation audit after updating Nodemailer: 0 vulnerabilities reported.
- Browser visual and interaction QA was not performed: the in-app browser Node REPL execution tool was unavailable in this session.
- Live SMTP delivery and deployment are not configured or verified. `.env.example` documents required settings. Runtime member data, local settings, and OTP outbox files are excluded from Git.
- Better Auth falls back to one shared rate-limit bucket per endpoint when client IP metadata is unavailable. Limits permit a 12-person office team to sign in through a shared network; OTPs retain a five-attempt per-code limit. Configure trusted proxy/IP forwarding for an internet-facing deployment with more users.
- This project has its own Git repository, package manifest, lockfile, and database path. Clone it into a permanent directory before entering real data.
