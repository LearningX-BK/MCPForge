# `consumers/` — the consumer registry

A **Consumer** is the software holding the session: an agent, a client, a platform, the portal
itself. Every call needs **both** a registered consumer and a resolved human identity, and
authorization is the **intersection** of what the consumer may do and what the human may do —
never the union, never a substitute (02 §11.2, 05 §1.3, CLAUDE.md non-negotiable 6).

One file per consumer: `consumers/<id>.consumer.yaml`, `kind: Consumer`, validated by
`forge validate` and compiled by `forge codegen` into
`generated/consumers/<id>.authorization.json`.

## How a record gets here

**Not by a command writing one.** A registration is a grant, and every grant in this
architecture is a reviewed git diff with an approval record. So:

```
forge consumer new <id> --class <class> --owner <team> --steward <person> \
                        --human-in-the-loop <true|false> --by <subject>
```

**stages a change proposal** under `.mcpforge/proposals/<proposal-id>/` containing the proposed
`consumers/<id>.consumer.yaml` and its pending approval record for `approvals/`. Nothing under
`consumers/` or `approvals/` is written by any command. A human proposes the change for review
and the **named approver** completes the approval record. `suspend`, `rotate` and `retire` work
the same way. There is no direct-write path, and a test proves it
(`core/gateway/consumer/consumer.proposal.test.ts`).

**Dynamic Client Registration does not exist here.** The `registration_endpoint` is absent from
the gateway's published metadata and a `POST` to it is refused with an agent-actionable `next`
naming this flow (W0-N2).

## Credentials

`credential.ref` is a `secretRef://consumer/<id>/client` — **a reference, never a value, ever**
(CLAUDE.md non-negotiable 8). `forge consumer issue-credential <id> --by <subject>` mints the
value and prints it **exactly once**; it is refused when `CI=true` and when the environment
class is `staging` or `prod`, where registration goes through the portal instead.

## Lifecycle

`status:` is `active | suspended | retired`, and an `active` registration whose `expiresAt` has
passed is treated as **expired** — registrations expire, and renewal is a re-approval, not a
no-op. Ids are **immutable**: renaming is a retire-and-register pair, both recorded, because
audit rows and consumption edges reference the id. For an immediate cut-off that needs no
merge, the kill switch has a consumer granularity: `forge kill consumer:<id> --reason "…"`.
