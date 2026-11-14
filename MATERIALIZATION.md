# Project revision materialization

`projects.materialize` is deliberately separate from `projects.save`. It accepts only a project-local
immutable revision and delegates its execution through `ProjectMaterializer`; it does not read a live
draft and it does not implement a generator.

The filesystem repository provides the required persistence foundation: project path isolation,
no-follow reads, atomic replacement, validation on every read, and a per-adapter, per-project
single-writer mutex. A storage directory therefore has one designated adapter writer. Separate
processes or adapter instances still require external locking.

## Current composition blocker

The published public APIs were audited on 2026-11-14:

- Templates PR [#841](https://github.com/ankhorage/templates/pull/841) adds a root-exported
  `materializeTemplateRevision`, but it is still open and therefore is not a released dependency.
  The currently published `@ankhorage/templates@12.5.26` exports authoring composition and template
  artifacts, but no project-revision-to-target materializer.
- `@ankhorage/navigator@3.5.22` exposes independent Navigator planning/generation APIs, but no
  composition API that receives a stored `AppManifest` revision and coordinates the full target.
- `@ankhorage/expo-runtime@7.0.3` exposes runtime output planning only; it has no published
  materializer and its declared Contracts range is still `^25.0.0`, not the W2
  `@ankhorage/contracts@26.10.0` boundary.

Consequently this package intentionally exports only the injected `ProjectMaterializer` port and
the explicit revision lookup/delegation action. Wiring must wait for Templates PR #841 to be
released, plus a released compatible Navigator/Expo Runtime composition API. No sibling-source
import, local generator, database adapter, or Flow was added here.
