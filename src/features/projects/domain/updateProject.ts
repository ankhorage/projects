import type { Project, UpdateProjectInput } from '../../../types/projects.js';

/*** Apply a valid mutable project change while preserving identity. */
export function updateProject(project: Project, input: UpdateProjectInput, now: Date): Project {
  const name = normalizeProjectName(input.name);

  return { ...project, name, updatedAt: now.toISOString() };
}

/*** Normalize a project name at the domain boundary. */
function normalizeProjectName(name: string): string {
  const normalized = name.trim();

  if (normalized.length === 0 || normalized.length > 120) {
    throw new Error('A project name must contain between 1 and 120 characters.');
  }

  return normalized;
}
