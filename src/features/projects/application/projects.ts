import type {
  CreateProjectInput,
  MaterializeProjectRevisionInput,
  Project,
  ProjectManifest,
  ProjectManifestRevision,
  ReloadProjectManifestInput,
  SaveProjectManifestInput,
  UpdateProjectInput,
} from '../../../types/projects.js';
import { createProject } from '../domain/createProject.js';
import { saveProjectManifest } from '../domain/saveProjectManifest.js';
import { updateProject } from '../domain/updateProject.js';
import type { ProjectMaterializer, ProjectRepository } from '../ports/ProjectRepository.js';

/*** Expose the project repository actions through an explicit port. */
export const projects = {
  list: async (repository: ProjectRepository): Promise<readonly Project[]> =>
    repository.listAsync(),
  read: async (repository: ProjectRepository, id: string): Promise<Project | null> =>
    repository.readAsync(id),
  create: async (
    repository: ProjectRepository,
    input: CreateProjectInput,
    now = new Date(),
  ): Promise<Project> => {
    const project = createProject(input, now);
    const existing = await repository.listAsync();
    if (existing.some((candidate) => candidate.id === project.id)) {
      throw new Error(`Project identity '${project.id}' already exists.`);
    }
    await repository.createAsync(project);
    return project;
  },
  update: async (
    repository: ProjectRepository,
    input: UpdateProjectInput,
    now = new Date(),
  ): Promise<Project | null> =>
    repository.updateAsync(input.id, (project) => updateProject(project, input, now)),
  save: async (
    repository: ProjectRepository,
    input: SaveProjectManifestInput,
    now = new Date(),
  ): Promise<Project | null> =>
    repository.updateAsync(input.id, (project) => saveProjectManifest(project, input, now)),
  reload: async (
    repository: ProjectRepository,
    input: ReloadProjectManifestInput,
  ): Promise<ProjectManifest | null> => (await repository.readAsync(input.id))?.manifest ?? null,
  revision: async (
    repository: ProjectRepository,
    input: MaterializeProjectRevisionInput,
  ): Promise<ProjectManifestRevision | null> => {
    const project = await repository.readAsync(input.id);
    return (
      project?.manifest.revisions.find((candidate) => candidate.id === input.revisionId) ?? null
    );
  },
  materialize: async (
    repository: ProjectRepository,
    materializer: ProjectMaterializer,
    input: MaterializeProjectRevisionInput,
  ): Promise<ProjectManifestRevision | null> => {
    const project = await repository.readAsync(input.id);
    const revision = project?.manifest.revisions.find(
      (candidate) => candidate.id === input.revisionId,
    );
    if (project === null || revision === undefined) return null;
    await materializer.materializeAsync({ project, revision });
    return revision;
  },
  delete: async (repository: ProjectRepository, id: string): Promise<Project | null> =>
    repository.deleteAsync(id),
};
