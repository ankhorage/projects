export { createProjectRepositoryFileSystemAsync } from './features/projects/adapters/createProjectRepositoryFileSystemAsync.js';
export { projects } from './features/projects/application/projects.js';
export { createProjectsApiHandlerResolver } from './features/projects/composition/createProjectsApiHandlerResolver.js';
export type {
  ProjectMaterializer,
  ProjectRepository,
} from './features/projects/ports/ProjectRepository.js';
export type {
  CreateProjectInput,
  MaterializeProjectRevisionInput,
  Project,
  ProjectManifest,
  ProjectManifestDraft,
  ProjectManifestRevision,
  ReloadProjectManifestInput,
  SaveProjectManifestInput,
  UpdateProjectInput,
} from './types/projects.js';
