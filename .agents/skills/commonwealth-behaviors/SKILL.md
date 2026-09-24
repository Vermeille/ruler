---
name: commonwealth-behaviors
description: Reconcile Commonwealth behavior specification files under specs/ with the implementation. Use when behavior lines are marked implemented, edited, or deleted, or when asked to apply behavior-spec changes to the simulation code.
---

# Commonwealth behavior specifications

Behavior files under `specs/` are the human-readable contract for implemented simulation behavior. Each behavior has a stable ID and a status marker.

Before changing code, read the relevant behavior files and inspect the implementation locations referenced by the behavior IDs. Treat the behavior description as the intended product behavior and the code as the current implementation.

## Status markers

### `[I]` — implemented

`[I] CODE: description`

The behavior is implemented and the description matches the intended behavior. There is nothing to do for that line.

Do not rewrite, refactor, or otherwise touch the implementation merely because an `[I]` behavior was encountered.

### `[E]` — edited

`[E] CODE: edited description`

The behavior description has changed. Adapt the implementation so that the behavior described by the edited line becomes true.

Use the existing behavior ID to find every relevant implementation location. One ID may appear at multiple code locations, and several IDs may share one code location. Change all implementation necessary to make the edited description accurate while preserving unrelated behaviors.

Update focused tests when the changed behavior requires it. Preserve the project's four-arrow rule architecture, generic Effect vocabulary, step-cache semantics, determinism, conservation rules, and causality/provenance conventions.

Once the implementation and tests match the edited behavior, change the line from `[E]` back to `[I]`. Keep the same behavior ID and the edited description.

Do not leave an `[E]` marker after the implementation has been reconciled.

### `[X]` — delete

`[X] CODE: description`

The behavior must no longer exist.

Use the behavior ID to find every implementation location that participates in that behavior. Remove the behavior from the code without deleting unrelated behavior that happens to share the same rule, function, or code location. Update or remove tests that specifically require the deleted behavior.

After the behavior has been removed from the implementation, remove its `[I] CODE` references from the code. Then delete the `[X]` line from the behavior file entirely.

Do not convert `[X]` to `[I]`. A deleted behavior disappears from both the implementation references and the behavior specification.

## Reconciliation procedure

When asked to apply behavior-file changes:

1. Scan the relevant `specs/**/*.md` files for `[E]` and `[X]` lines.
2. Ignore `[I]` lines except as context for preserving neighboring behavior.
3. For each `[E]`, trace its ID through the code, implement the new description, update tests, then restore the line to `[I]`.
4. For each `[X]`, trace its ID through the code, remove only that behavior, update tests, remove all code references to the ID, then delete the spec line.
5. Run the behavior-spec consistency check and the tests relevant to the changed mechanics. Run broader CI checks when the change crosses systems.
6. Finish with no unresolved `[E]` or `[X]` markers in the behavior files you were asked to reconcile.

The goal is mechanical synchronization between readable behavior specifications and the actual simulator. Do not reinterpret an edited or deleted behavior into something merely close to what the line says. Humans have already done the difficult part by changing the contract; the code should follow it.
