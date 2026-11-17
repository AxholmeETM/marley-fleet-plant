# AGENTS.md: how an AI agent works on this project

You are working on the Marley Construction fleet and plant system, built by Ben (Axholme ETM) as a demo to pitch to Marley Construction. The live preview is https://marley-fleet-plant.ben-cc3.workers.dev and **every push to `main` goes live**.

## Source of truth

Read these before any non-trivial change. They win over chat history and over guesses.

| Question | Document |
| --- | --- |
| What are we building and for whom? | [PRD.md](PRD.md) |
| How does it look? | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) |
| What does the user do? | [UX_FLOWS.md](UX_FLOWS.md) |
| How is it built? | [ARCHITECTURE.md](ARCHITECTURE.md) |
| What data exists? | [DATABASE.md](DATABASE.md) |
| Which routes exist and who can use them? | [API.md](API.md) |
| What must be protected? | [SECURITY.md](SECURITY.md) |
| How is code written? | [CODE_STYLE.md](CODE_STYLE.md) |
| How do we know it works? | [TESTING.md](TESTING.md) |
| Settings and secrets | [ENVIRONMENT.md](ENVIRONMENT.md) |
| What do users see when it fails? | [ERROR_HANDLING.md](ERROR_HANDLING.md) |
| How does it get online? | [DEPLOYMENT.md](DEPLOYMENT.md) |
| What do we log and watch? | [OBSERVABILITY.md](OBSERVABILITY.md) |
| What has Ben already decided? | [DECISIONS.md](DECISIONS.md) |
| What's next? | [ROADMAP.md](ROADMAP.md) |
| What changed? | [CHANGELOG.md](CHANGELOG.md) |

## The loop

1. **Context.** Read the relevant docs and the code you'll touch. Summarise what you understand and flag gaps.
2. **Plan.** List files, routes, schema changes, permission rules, tests and risks.
3. **Ben reviews the plan** for anything that changes behaviour, data or permissions. Small fixes he asked for directly can go ahead.
4. **Implement** the smallest correct change. Reuse existing patterns, helpers and CSS. Touch nothing unrelated.
5. **Validate.** `npm test`. Open the changed pages at desktop and phone width. Read the final diff.
6. **Update docs** in the same change: DECISIONS for anything Ben decided, CHANGELOG for what users will notice, and whichever doc the change affects.

## Hard rules

- **Never store or copy fuel card PINs.** Full card numbers are for admins only.
- Check permissions on the server in every route (see SECURITY.md). Never rely on hiding a button.
- Keep the code Cloudflare Workers-safe (see ARCHITECTURE.md).
- Don't push to `main` without Ben's OK: it's live. Work on a branch and open a pull request.
- Don't change the live database by hand; schema changes go in `src/db.js`, data fixes in a `.sql` file Ben runs.
- Don't use or copy anything from the Falgate repository.
- Don't re-decide something already in DECISIONS.md. If a request conflicts with it, ask.

## When unsure

If something important is undefined or two docs disagree, **ask Ben instead of guessing**. Write down the answer in DECISIONS.md.

## Finish with

What changed, files changed, tests run and results, anything left, and which docs you updated.
