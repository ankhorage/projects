import type { CreateProjectInput, Project, UpdateProjectInput } from '../../../types/projects.js';
import { createProject } from '../domain/createProject.js';
import { updateProject } from '../domain/updateProject.js';
import type { ProjectRepository } from '../ports/ProjectRepository.js';

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
  ): Promise<Project | null> => {
    const project = await repository.readAsync(input.id);
    return project === null ? null : repository.updateAsync(updateProject(project, input, now));
  },
  delete: async (repository: ProjectRepository, id: string): Promise<Project | null> =>
    repository.deleteAsync(id),
};
