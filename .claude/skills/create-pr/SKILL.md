---
name: create-pr
description: Commit the finished changes in the TNCSC CRS repo and open a GitHub Pull Request against `dev` — after checking the build, reviewing what is being committed, and pushing the branch. Use when the user says "create PR", "/create-pr", "open a pull request" or picks the Create PR option offered after a change.
---

# Create PR — TNCSC CRS

Opens a Pull Request for the work in the current checkout. The base branch is
always **`dev`**, never `main`.

## 1. Make sure it is ready

Run, and stop to report if anything fails — never open a PR over a red check:

```bash
npx tsc --noEmit -p .
npx next build
```

Run the verify suites that cover what changed (see the Tools section of
CLAUDE.md — e.g. `npm run verify:statements` after `src/legacy/*`,
`verify:rollup` after the roll-up, `verify:clear-execute`, `verify:live-sync`,
`verify:chain-rebuild`, `verify:activity-log`, `verify:crs29-*`). If a suite
fails for a reason unrelated to the change (for example stale
`public/golden-stores.json`), say so plainly in the PR body instead of hiding it.

## 2. Review exactly what goes in

```bash
git status --short
git diff --stat
```

- Never commit `.env*`, `backups/`, `public/golden-stores.json` or anything with
  staff phone numbers or credentials.
- Stage files **by name**, not `git add -A`.
- If the working tree mixes unrelated work, tell the user and ask whether to
  split it before committing.

## 3. Branch

- On `dev` or `main`: create a feature branch first (`git switch -c <short-topic>`).
- On a feature branch whose previous PR is already merged: reusing it is fine —
  push it again; GitHub opens a new PR for the new commits.
- `git fetch origin` and check `git rev-list --left-right --count origin/dev...HEAD`
  so the PR does not carry surprises.

## 4. Commit

One commit per coherent change, conventional title (`feat(scope): …`,
`fix(scope): …`), a body that says what changed and why, and what was verified.
Write the message to a file in the scratchpad and use `git commit -F`. End the
message with the attribution line from the current system reminder, if any.
Never skip hooks.

## 5. Push and open the PR

`gh` is not on the Bash PATH on this machine:

```bash
GH=/c/Users/TharikAliR/AppData/Local/Programs/GitHubCLI/bin/gh.exe
git push origin <branch>
"$GH" pr create --base dev --head <branch> --title "<title>" --body-file <scratchpad>/pr.md
```

The PR body: a short summary, what changed per area, anything the reviewer must
do (e.g. **run a new migration** in `supabase/migrations/`), decisions to
confirm, and verification — including what was NOT verified. End it with the
attribution line from the current system reminder, if any.

If `gh` reports expired authentication, ask the user to run `gh auth login`;
never try to reuse stored git credentials.

## 6. After

- Bind the PR to the session (`mcp__ccd_pr__bind_pr`) if the app did not, and
  read CI with `mcp__ccd_pr__get_status` rather than polling `gh`.
- Report the PR link, the commit, CI state and mergeability.
- Never enable auto-merge or merge unless the user asks.
