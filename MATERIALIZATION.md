# Project revision materialization

`projects.materialize` is deliberately separate from `projects.save`. It accepts only a project-local
immutable revision and delegates its execution through `ProjectMaterializer`; it does not read a live
draft and it does not implement a generator.

The filesystem repository provides the required persistence foundation: project path isolation,
no-follow reads, atomic replacement, validation on every read, and a per-adapter, per-project
single-writer mutex. A storage directory therefore has one designated adapter writer. Separate
processes or adapter instances still require external locking.

## Published Expo composition

`createExpoProjectMaterializer` is the Projects-owned concrete composition for one immutable
revision and one caller-owned empty target directory. It uses only released owner APIs:

- Templates materializes the selected template's manifest metadata and packaged assets into an
  isolated staging directory.
- Expo Runtime resolves the generated package, native config, and runtime shell sources.
- Navigator resolves and emits the deterministic Expo Router layout and routes.

Projects validates the target before writing, rejects owner diagnostics and output collisions, and
uses exclusive file creation for every final file. It does not import Studio source or recreate an
owner emitter. Hosts still provide the selected published template and the narrow Navigator module
bindings that represent their screen/guard implementations.
