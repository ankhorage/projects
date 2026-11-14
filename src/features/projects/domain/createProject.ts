import type { CreateProjectInput, Project } from '../../../types/projects.js';
import { deriveProjectIdentity } from './deriveProjectIdentity.js';

/*** Create a valid project with an immutable identity. */
export function createProject(input: CreateProjectInput, now: Date): Project {
  const name = normalizeProjectName(input.name);
  const timestamp = now.toISOString();

  return { id: deriveProjectIdentity(name), name, createdAt: timestamp, updatedAt: timestamp };
}

/*** Normalize a project name at the domain boundary. */
function normalizeProjectName(name: string): string {
  const normalized = name.trim();

  if (normalized.length === 0 || normalized.length > 120) {
    throw new Error('A project name must contain between 1 and 120 characters.');
  }

  return normalized;
}
