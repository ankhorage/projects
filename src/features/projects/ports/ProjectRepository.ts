import type { Project } from '../../../types/projects.js';

export interface ProjectRepository {
  listAsync(): Promise<readonly Project[]>;
  readAsync(id: string): Promise<Project | null>;
  createAsync(project: Project): Promise<void>;
  updateAsync(id: string, update: (project: Project) => Project): Promise<Project | null>;
  deleteAsync(id: string): Promise<Project | null>;
}
