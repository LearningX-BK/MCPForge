# W0-P33 — Adding a tool end to end from the portal (design note)

**Status:** APPROVED by the owner, 30 Sep 2026: all four recommendations (A: git clone on the VM, bind-mounted; C: gateway reload endpoint; D: portal probe for local and dev only; remote: local only for now). Built as W0-P33a to P33d.

**Owner decision being designed:** *"Full path in the portal (Recommended)"*: "Draft, propose, super admin reviews and approves, the portal merges to git and runs codegen and validate, then the gateway reloads. The tool reads 'Not probed' until a probe runs, which the portal could also trigger."

What stays fixed, whatever is chosen below:
- **Git is the source of truth.** The portal writes to git, never to a database.
- The UI vocabulary stays **Save draft · Propose · Discard**, plus **Approve** and **Merge**. Nothing is labelled Save.
- **Merged is not deployed** (03 §6.1). A merged tool is not live until the gateway has loaded it. It cannot run until a probe has enabled it.
- Every elevated tool still needs a binding grant (non-negotiable 7), and a new write tool still needs its full `writeSafety` block (non-negotiable 4). The portal cannot merge anything that `forge validate` refuses.

---

## 1. What exists today, and why it is not enough

| Piece | Today | Gap |
|---|---|---|
| Authoring | Build route: guided form and YAML editor, drafts, live structural checks, sandbox run | none for authoring |
| Save draft / Propose | `LocalGit` commits a branch and a review record | only in a **disposable sandbox** (`.mcpforge/change-host-sandbox/`), seeded once from the repo; by design it never touches the definitions the gateway reads |
| Approve / Merge | not built | `ChangeHost` has no `approve` or `merge` |
| Codegen / validate | CLI only (`forge codegen`, `forge validate`) | not callable from the portal |
| Gateway picks up a change | catalogue loaded **once at startup** (`loadRuntimeCatalogue`) | no reload |
| Deployed container | definitions baked into the image, **no `.git`** (`.dockerignore`) | nowhere to merge to |

## 2. The shape proposed

```
 VM
 ├── /opt/mcpforge/defs        a real git clone: manifests/ roles/ packages/ consumers/
 │                             enums/ evals/ approvals/ generated/ overlays/
 │                             (bind-mounted into the container, read-write)
 └── container mcpforge-core
       portal ── Save draft / Propose ──► branch forge/<id> in the defs clone (ChangeHost = LocalGit on the clone)
              ── Approve (super admin) ─► approvals/<date>-change-<id>.yaml committed on the branch
              ── Merge (super admin) ───► in the clone: checkout branch, forge validate + forge codegen,
                                          refuse on any failure or diff; else merge --no-ff into main
              ── (automatic) ───────────► ask the gateway to reload
       gateway ◄── reload: re-run loadRuntimeCatalogue on the clone; swap it in only if it loads cleanly
```

### 2.1 Where git lives (decision A)
- **Recommended: a git clone on the VM, bind-mounted as the definitions tree.** The image keeps the code; the clone holds the definitions. `LocalGit` moves from the sandbox to this clone. A remote is optional. With one, Merge can also push (the `HostedGit` seam, later); with none, the portal says "local only — no remote configured" (CLAUDE.md §3.1).
- Alternative: keep definitions in the image and have the portal export a patch for a developer to apply and rebuild. That isn't "full path in the portal", so it isn't recommended.

### 2.2 Who may approve and merge (decision B)
- Approve: anyone whose read authority covers every tool the change touches, **and** a super admin for anything that adds or widens a grant (a new tool, a role, a consumer). A super admin approving their own change is allowed and flagged `selfApproved: true` in the approval record (W0-P32; W0-P22's rule makes that a warning, not a failure).
- Merge: **super admin only**, and only an approved change.
- The approval record is written by the portal in the existing `approvals/` shape, with `approver` = the approver's `Principal.subject` (W0-P22's rule), `requestedBy` = the author's subject, and the change id.

### 2.3 Codegen and validate (fixed, not a choice)
They run in the portal's server process, on the branch, **before** the merge:
- `forge validate` must be ok.
- `forge codegen` output is committed on the branch as its own commit, so the reviewer can see the blast radius.
- A failure refuses the merge, with the rule's own `next`. Nothing half-merged is left: the merge is one `git merge --no-ff` after everything passed.

### 2.4 How the gateway picks the change up (decision C)
- **Recommended: a reload endpoint on the gateway, callable only by a super admin through the portal's consumer.** It re-runs `loadRuntimeCatalogue` on the clone and swaps the served catalogue **only if the new one loads cleanly**. Otherwise it keeps serving the old one and reports why.
  - A plan minted against the old catalogue stays bound to its tool version and plan hash, so a changed tool fails its confirm with `PLAN_ARGUMENT_MISMATCH` or a version mismatch, never a silent execute.
  - Live MCP sessions receive `notifications/tools/list_changed`, which the kill-switch path already sends.
- Alternative: restart the container (`docker compose restart`). Simpler, but it drops every live MCP session and needs host access from the portal, or a human.

### 2.5 The probe (decision D)
- A merged tool reads **Not probed** and cannot execute until a probe enables it. That's unchanged and correct.
- **Recommended: a super admin may trigger `forge probe` from the portal for environment class `local` and `dev` only.** For `staging` and `prod` it stays a CLI act, because the probe runs checks against a real instance.

## 3. What the VM needs
- `git` installed. The clone at `/opt/mcpforge/defs`, with a git identity (`user.name` / `user.email`) for the portal's commits. The author of each change is recorded separately, by subject.
- `docker-compose.yml` gains the read-write bind mount of the clone, and `MCPFORGE_DEFINITIONS_ROOT` pointing the gateway, the portal and `forge` at it.
- A backup of the clone. It is now the system of record for definitions. The runtime store is still only events (W0-C6).

## 4. Proposed task split (after approval)
1. **P33a** — Definitions root: `MCPFORGE_DEFINITIONS_ROOT` read by the gateway, portal and CLI; compose mount; DEPLOY.md.
2. **P33b** — `ChangeHost.approve` and `ChangeHost.merge` in `LocalGit` against the clone; the approval record writer; validate and codegen gate; super-admin checks; portal Approve and Merge buttons in the change tray.
3. **P33c** — Gateway catalogue reload: endpoint, clean-load-or-keep-old swap, `list_changed`, policy tests. This is on the security spine, so it runs on Opus.
4. **P33d** — Portal-triggered probe for `local` and `dev`.

## 5. Questions for the owner
- **A.** Definitions in a git clone on the VM, bind-mounted (recommended), or stay in the image?
- **C.** Gateway reload endpoint (recommended), or a container restart?
- **D.** Portal may trigger a probe for `local`/`dev` only (recommended), or never (CLI only)?
- Is a remote (for example GitHub or OCI DevOps) wanted for the clone, so Merge also pushes? Or local only for now?

## 6. Owner answers, 30 Sep 2026 (verbatim option labels)
- A: "Git clone on the VM (Recommended)"
- C: "Reload endpoint (Recommended)"
- D: "Local and dev only (Recommended)"
- Remote: "Local only for now (Recommended)"
