import {
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import { isRecord } from '@ankhorage/utility/object';

import type { Project } from '../../../types/projects.js';
import type { ProjectRepository } from '../ports/ProjectRepository.js';

type FileSystemProjectRepositoryOptions = Readonly<{ directory: string }>;
type StoredProject = Readonly<{ version: 1; project: Project }>;

/*** Create a path-isolated filesystem implementation of the project repository port. */
export async function createProjectRepositoryFileSystemAsync(
  options: FileSystemProjectRepositoryOptions,
): Promise<ProjectRepository> {
  const directory = join(options.directory, 'projects');
  await mkdir(directory, { recursive: true, mode: 0o700 });

  return {
    listAsync: async (): Promise<readonly Project[]> => {
      const entries = await readdir(directory, { withFileTypes: true });
      const projects = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map(async (entry) => readProjectAsync(directory, entry.name)),
      );
      return projects
        .filter((project): project is Project => project !== null)
        .sort((left, right) => left.id.localeCompare(right.id));
    },
    readAsync: async (id: string): Promise<Project | null> =>
      readProjectAsync(directory, projectFileName(id)),
    createAsync: async (project: Project): Promise<void> =>
      writeProjectAsync(directory, project, true),
    updateAsync: async (project: Project): Promise<Project | null> => {
      const fileName = projectFileName(project.id);
      if ((await readProjectAsync(directory, fileName)) === null) return null;
      await writeProjectAsync(directory, project, false);
      return project;
    },
    deleteAsync: async (id: string): Promise<Project | null> => {
      const fileName = projectFileName(id);
      const project = await readProjectAsync(directory, fileName);
      if (project === null) return null;
      await unlink(join(directory, fileName));
      return project;
    },
  };
}

/*** Read a regular, schema-valid project file without following a symlink. */
async function readProjectAsync(directory: string, fileName: string): Promise<Project | null> {
  const path = join(directory, fileName);
  try {
    if (!(await lstat(path)).isFile())
      throw new Error(`Project storage entry '${fileName}' must be a regular file.`);
    const stored = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!isStoredProject(stored) || projectFileName(stored.project.id) !== fileName) {
      throw new Error(`Project storage entry '${fileName}' is invalid.`);
    }
    return stored.project;
  } catch (error: unknown) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

/*** Atomically create or replace a project file without exposing a partial document. */
async function writeProjectAsync(
  directory: string,
  project: Project,
  createOnly: boolean,
): Promise<void> {
  const fileName = projectFileName(project.id);
  const target = join(directory, fileName);
  const temporary = join(directory, `.${fileName}.${crypto.randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify({ version: 1, project } satisfies StoredProject), {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    if (createOnly) await link(temporary, target);
    else await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

/*** Convert only canonical project identities into a local storage filename. */
function projectFileName(id: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error('Project identity is invalid.');
  }
  return `${id}.json`;
}

/*** Verify a parsed storage document before it enters the application. */
function isStoredProject(value: unknown): value is StoredProject {
  if (!isRecord(value)) return false;
  const { project } = value;
  return (
    value.version === 1 &&
    isRecord(project) &&
    typeof project.id === 'string' &&
    typeof project.name === 'string' &&
    typeof project.createdAt === 'string' &&
    typeof project.updatedAt === 'string'
  );
}

/*** Identify the missing-file condition that represents an absent project. */
function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
