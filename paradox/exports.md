# Public API

## CreateProjectInput

Kind: `unknown`
Module: `src/types/projects.ts`
Source: `src/types/projects.ts:8:1`

## createProjectRepositoryFileSystemAsync

Kind: `function`
Module: `src/features/projects/adapters/createProjectRepositoryFileSystemAsync.ts`
Source: `src/features/projects/adapters/createProjectRepositoryFileSystemAsync.ts:23:1`

Create a path-isolated filesystem implementation of the project repository port.

### Signatures

- `(options: Readonly<{ directory: string; }>) => Promise<ProjectRepository>`
  - options: `Readonly<{ directory: string; }>`
  - returns: `Promise<ProjectRepository>`

## Project

Kind: `unknown`
Module: `src/types/projects.ts`
Source: `src/types/projects.ts:1:1`

## ProjectRepository

Kind: `type`
Module: `src/features/projects/ports/ProjectRepository.ts`
Source: `src/features/projects/ports/ProjectRepository.ts:3:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| createAsync | method | `(project: Project) => Promise<void>` | yes |  |
| deleteAsync | method | `(id: string) => Promise<Project \| null>` | yes |  |
| listAsync | method | `() => Promise<readonly Project[]>` | yes |  |
| readAsync | method | `(id: string) => Promise<Project \| null>` | yes |  |
| updateAsync | method | `(project: Project) => Promise<Project \| null>` | yes |  |

## projects

Kind: `value`
Module: `src/features/projects/application/projects.ts`
Source: `src/features/projects/application/projects.ts:7:14`

Expose the project repository actions through an explicit port.

## UpdateProjectInput

Kind: `unknown`
Module: `src/types/projects.ts`
Source: `src/types/projects.ts:10:1`
