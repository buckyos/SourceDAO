---
name: usdb-release-fragments
description: Maintain USDB release-note fragments while implementing or reviewing changes across usdb, go-ethereum, and SourceDAO. Use when work may affect protocol behavior, operators, deployment, compatibility, security, or release-visible functionality, and before preparing a release tag to audit unclassified changes.
---

# USDB Release Fragments

Keep release semantics current while code context is still available. Do not
wait for GitHub Release generation to reconstruct behavior from commit subjects.

This file is canonical in the USDB repository. The identically named copies in
`go-ethereum` and `SourceDAO` must remain byte-for-byte identical. From USDB,
run `python3 docker/scripts/tools/sync_project_skills.py check` to verify them or
replace `check` with `sync` to update the copies.

## Source Of Truth

Before writing a fragment, read:

- `.release-notes/README.md` for the current schema and allowed values;
- `doc/publish/usdb-release-change-management.md` for release and review rules;
- `docker/scripts/tools/release_notes.py` only when validator behavior is unclear.

When working from a sibling `go-ethereum` or `SourceDAO` checkout, locate the
workspace's `usdb` repository and use those canonical files. If they are not
available, do not guess the schema.

## Decide Whether To Record

Create or update an unpublished fragment when a completed change has an
independently reviewable effect on users, protocol behavior, operators,
deployment, compatibility, security, or release-visible APIs.

Do not create one fragment per commit or file. One functional change, bug fix,
or operational contract should normally have one fragment even when it spans
several commits and repositories. Put a cross-repository fragment in the
repository that owns the primary behavior and list every affected scope.

Pure refactoring, formatting, test maintenance, or CI maintenance with no
release-visible effect normally needs no fragment. Recommend the commit trailer
`Release-Note: none` instead. Treat consensus, security, data compatibility,
genesis, activation, and deployment changes conservatively when uncertain.

## Workflow

1. Inspect `git status`, the relevant diff, existing unpublished fragments, and
   the last published release boundary before deciding the fragment granularity.
2. Reuse an unpublished fragment only when the new work is part of the same
   behavior contract. Otherwise create a globally unique lowercase kebab-case
   `change_id` and matching JSON file name.
3. Describe observable results and important failure or recovery boundaries in
   `details`; do not merely repeat the commit subject or list touched files.
4. Add only concrete actions to `operator_actions`. Do not invent migration,
   reset, or configuration work that the implementation does not require.
5. Set compatibility flags conservatively. A network identity change requires
   `network_reset`; a local derived-data incompatibility requires
   `data_rebuild`; operator-owned settings require `config_change`; replacing
   or restarting runtime components requires `restart_required`.
6. Validate from the USDB repository:

   ```bash
   python3 docker/scripts/tools/release_notes.py validate-fragments \
     --repository-root .
   ```

7. Report the fragment path and recommended `Release-Note: <change_id>` trailer
   in the work summary. Do not commit merely to add the trailer unless the user
   explicitly authorizes a commit.

## Timing

Use two checkpoints:

- Development checkpoint: create the fragment once behavior and tests are
  stable enough to explain accurately; update it with later findings before
  publication.
- Pre-tag checkpoint: review all three repository ranges from the previous
  release revisions to the proposed heads, consolidate overly granular entries,
  and classify every missing commit before freezing dependency revisions and
  creating the next immutable tag.

If a USDB or SourceDAO fragment changes its repository revision, update the Go
compatibility lock afterward. Run the required CI again before tagging.

## Invariants

- Never edit or delete a fragment already included in a published release.
- Never duplicate one `change_id` across repositories.
- Never use a release ID as a substitute for a stable functional change ID.
- Never infer compatibility solely from prose; compare manifests during release
  preparation as an independent check.
- Never commit, tag, push, or alter release state without explicit authorization.
