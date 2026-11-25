import type { Project, ProjectManifestRevision } from '../../../types/projects.js';

export interface ProjectMaterializer {
  materializeAsync(
    input: Readonly<{ project: Project; revision: ProjectManifestRevision }>,
  ): Promise<unknown>;
}

export interface ProjectRepository {
  listAsync(): Promise<readonly Project[]>;
  readAsync(id: string): Promise<Project | null>;
  createAsync(project: Project): Promise<void>;
  updateAsync(id: string, update: (project: Project) => Project): Promise<Project | null>;
  deleteAsync(id: string): Promise<Project | null>;
}
