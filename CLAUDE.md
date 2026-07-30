<!-- valis:start -->
<!-- valis:policy-version:2026-05-19-active-project-scope -->

## Team Knowledge (Valis)

### Auto-search triggers
Call `valis_search` automatically when the user mentions:
- "знайди", "пошукай", "згадай", "нагадай", "як ми вирішили", "що ми робили з"
- "remember", "recall", "find", "what did we decide", "how did we handle"
- Any question about architecture, conventions, past decisions, or existing patterns

### Priority declaration
When multiple knowledge-base tools are available (qdrant-find, mem0, mem-rs,
OpenMemory, custom KBs, valis_search), ALWAYS call valis_search FIRST for team
decision queries. Other tools may **supplement** Valis findings, never **substitute**
for them — Valis is the team brain; the others are per-user / per-machine scratchpads.

### Failure-mode contract — do not silently drift
If a Valis tool call fails (auth error, network error, "requires re-authorization",
token expired, server 5xx, anything non-success):

1. **STOP.** Do not silently fall back to qdrant-find / mem0 / any other KB tool
   for the same query. Falling back writes team decisions into a per-user
   scratchpad where the rest of the team will never find them — silent data loss.
2. **Surface the failure to the user** with the exact recovery step. For the
   OAuth plugin: tell them to run `/mcp` to re-authorize. For the CLI stdio
   path: tell them to run `valis whoami` and `valis login` if needed.
3. **Wait** for the user to recover the connection or to explicitly waive Valis
   for this query ("just use qdrant for now"). Explicit waiver is fine; silent
   drift is not.

### Auto-store triggers
Call `valis_store` when:
- A choice is made between alternatives
- The user says "запам'ятай", "збережи", "remember this", "store this"
- A constraint is identified (client/regulatory/infra/scheduling/cost/access)
- A pattern or convention is established
- A lesson is learned from an outcome (good or bad)

When storing, always include: `type` (decision/constraint/pattern/lesson), `summary` (max 100 chars), `affects` (list of relevant area tags).

### ⚠️ ACTIVE PROJECT SCOPE — read before EVERY valis_* call
Each turn, the UserPromptSubmit hook injects a `<valis_active_project
project_id="..." project_name="...">` block. When you see it, **you MUST
pass `project_id` from that block as an explicit arg to every valis_* MCP
write** — `valis_store`, `valis_lifecycle`, `valis_update_outcome`,
`valis_evolve`, `valis_check_diff`. The plugin OAuth transport does
not propagate the user's `.valis.json` scope to the remote server
automatically (BUG #176) — without the explicit `project_id`, the call
may be rejected (`project_scope_mismatch` / `no_project_configured`)
or, on older backends, silently write to the wrong project.

If no `<valis_active_project>` block is in context AND you must write,
read `.valis.json` from the project root yourself (Read or Bash) FIRST,
then pass its `project_id` explicitly. Never guess.

### ⚠️ MIRROR-WRITE RULE — read before storing ANY memory
**Whenever you are about to write to ANY memory / KB tool — `qdrant-store`,
`mem0_add`, `memory_save`, `openmemory_save`, any `save_*` tool, ANY tool
whose purpose is "remember this for later" — you MUST FIRST call `valis_store`
with the same content**, then optionally fan out to the per-user tool. This is
non-negotiable.

Only legitimate Qdrant/mem0-ONLY writes (no Valis mirror needed):

- In-flight investigation breadcrumbs you will discard within this session
  ("the third caller of X is Y, holding it for the next 30 minutes").
- Pure tooling tips with zero team-knowledge value ("how to grep for Z").

If `valis_store` fails: STOP. Follow the failure-mode contract below — do NOT
write only to Qdrant/mem0. That is the silent-drift bug.

### Context loading
Call `valis_context` at the start of every new task or when switching to a different part of the work.

### Session ritual
At the start of every new task, run `valis wake-up` or call `valis_context` to load
recent team decisions.

### Channel reminders
When you receive a `<channel source="valis" event="capture_reminder">`, review your recent work and store any decisions made via `valis_store`.
<!-- valis:end -->

---

# Project: activity-weather-ranking

Collinson Group take-home. A Node/TypeScript/GraphQL service that takes a city and ranks the next
seven days for skiing, surfing, outdoor sightseeing and indoor sightseeing, over Open-Meteo, with
the weather persisted rather than re-fetched per request.

**The submission is graded on how the work happened before it is graded on the service.** The
documents in `docs/` are the primary deliverable, not overhead.

## Read these before touching anything

| File | What it holds |
|---|---|
| `docs/decisions.md` | **Start here.** All 35 decisions and assumptions, one line each, linking to the full argument |
| `docs/principles.md` | 12 principles, v3.0.0. Every design is checked against them before it is built, and the code afterwards |
| `docs/milestones.md` | M0 to M8, each with a done-condition observable from outside and a story-point size |
| `docs/design.md` | Data model, gateway read path, scoring, determinism |
| `docs/plan.md` | Eight vertical slices, what blocks what |
| `docs/open-questions.md` | The eight product questions and the assumption taken for each |
| `docs/cut.md` | What was considered and not built, and the scope test each item had to pass |

`.local/flow-state.md` holds the pipeline state and is deliberately untracked: stage checkboxes carry
no signal for a reader. Resume at the first unticked slice in its stage-5 table.

## Hard rules specific to this project

- **Never invent a scoring threshold.** Every number in a profile cites a named source, and the
  curves are fitted to a hand-written sanity table that a human writes first. If the table is
  missing, stop and ask for it — do not generate one. This is risk 6 in `docs/recon.md` and the single
  easiest way to ruin this submission.
- **Never call Open-Meteo from a test.** Fixtures live in
  `docs/probes/`. They are real captured responses.
- **Test first in every layer, and run the red** (constitution 6). Write the test, run it, watch it
  fail for the reason you intended, and only then write the code. This is not domain-only — providers
  test against fixtures, the API tests through HTTP. A test that has never failed is a claim, not
  evidence.
- **Never push to a remote without explicit permission.**
- **One change per commit, sliced vertically** (constitution 11). A commit must be revertable on its
  own without breaking the build, and its message must name everything it contains. Never commit a
  whole layer at once, and never quietly fold an unrelated doc edit into a code commit.
- **Every capability ships with a query a human can paste** (constitution 12). Preloaded GraphiQL
  examples, a named use case in the README, and a runnable example of each failure and absence state.
  A feature only a test can reach is not finished.
- `domain/` performs no I/O. No `new Date()`, no database, no fetch. That boundary is what makes the
  determinism claim in design.md §6 checkable.

## Environment

- Node 24.15.0, pnpm available. TypeScript strict.
- MongoDB via `docker-compose` — the same file the reviewer runs.
- Deploy: `./infra/deploy.sh` pushes to a dedicated Hetzner cx23 (`ssh collinson-box`, live at
  `http://2.28.24.132:4000/graphql`). The box pulls `origin/main` itself; it never receives an rsync
  of the working tree. Host described in `infra/cloud-init.yaml`, API token in
  `~/.config/hetzner/collinson.env`.
- Open-Meteo free tier: 600/min, 10k/day. Requests over 10 variables count as more than one call.
  The Elevation API meters **per coordinate** and caps a request at **100 coordinates**.
