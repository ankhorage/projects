# Public API

## CreateProjectInput

Kind: `unknown`
Module: `src/types/projects.ts`
Source: `src/types/projects.ts:11:1`

## createProjectRepositoryFileSystemAsync

Kind: `function`
Module: `src/features/projects/adapters/createProjectRepositoryFileSystemAsync.ts`
Source: `src/features/projects/adapters/createProjectRepositoryFileSystemAsync.ts:31:1`

Create a path-isolated filesystem implementation of the project repository port.

The keyed mutex coordinates mutations only through this adapter instance in one Node.js process.
Assign each storage directory to one writer; coordinating separate adapter instances or processes
requires external locking and is unsupported by this adapter.

### Signatures

- `(options: Readonly<{ directory: string; }>) => Promise<ProjectRepository>`
  - options: `Readonly<{ directory: string; }>`
  - returns: `Promise<ProjectRepository>`

## createProjectsApiHandlerResolver

Kind: `function`
Module: `src/features/projects/composition/createProjectsApiHandlerResolver.ts`
Source: `src/features/projects/composition/createProjectsApiHandlerResolver.ts:30:1`

Create the Projects-owned resolver for host-approved server API operations.

### Signatures

- `(input: Readonly<{ repository: ProjectRepository; materializer?: ProjectMaterializer; allowDelete?: boolean; }>) => ApiHandlerResolver`
  - input: `Readonly<{ repository: ProjectRepository; materializer?: ProjectMaterializer; allowDelete?: boolean; }>`
  - returns: `ApiHandlerResolver`

## MaterializeProjectRevisionInput

Kind: `unknown`
Module: `src/types/projects.ts`
Source: `src/types/projects.ts:43:1`

## Project

Kind: `unknown`
Module: `src/types/projects.ts`
Source: `src/types/projects.ts:3:1`

## ProjectManifest

Kind: `unknown`
Module: `src/types/projects.ts`
Source: `src/types/projects.ts:16:1`

Persisted draft pointer and immutable AppManifest revision history for one project.

## ProjectManifestDraft

Kind: `unknown`
Module: `src/types/projects.ts`
Source: `src/types/projects.ts:22:1`

A persisted draft always points at the immutable revision produced by its last save.

## ProjectManifestRevision

Kind: `unknown`
Module: `src/types/projects.ts`
Source: `src/types/projects.ts:29:1`

An immutable, project-local AppManifest snapshot.

## ProjectMaterializer

Kind: `type`
Module: `src/features/projects/ports/ProjectRepository.ts`
Source: `src/features/projects/ports/ProjectRepository.ts:3:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| materializeAsync | method | `(input: Readonly<{ project: Project; revision: ProjectManifestRevision; }>) => Promise<void>` | yes |  |

## ProjectRepository

Kind: `type`
Module: `src/features/projects/ports/ProjectRepository.ts`
Source: `src/features/projects/ports/ProjectRepository.ts:9:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| createAsync | method | `(project: Project) => Promise<void>` | yes |  |
| deleteAsync | method | `(id: string) => Promise<Project \| null>` | yes |  |
| listAsync | method | `() => Promise<readonly Project[]>` | yes |  |
| readAsync | method | `(id: string) => Promise<Project \| null>` | yes |  |
| updateAsync | method | `(id: string, update: (project: Project) => Project) => Promise<Project \| null>` | yes |  |

## projects

Kind: `value`
Module: `src/features/projects/application/projects.ts`
Source: `src/features/projects/application/projects.ts:17:14`

Expose the project repository actions through an explicit port.

## ReloadProjectManifestInput

Kind: `unknown`
Module: `src/types/projects.ts`
Source: `src/types/projects.ts:41:1`

## SaveProjectManifestInput

Kind: `unknown`
Module: `src/types/projects.ts`
Source: `src/types/projects.ts:35:1`

## UpdateProjectInput

Kind: `unknown`
Module: `src/types/projects.ts`
Source: `src/types/projects.ts:13:1`
