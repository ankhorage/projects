import { constants, link, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { isAppManifest } from '@ankhorage/contracts';
import { createKeyedAsyncMutex } from '@ankhorage/utility/concurrency';
import { isRecord } from '@ankhorage/utility/object';

import type { Project } from '../../../types/projects.js';
import type { ProjectRepository } from '../ports/ProjectRepository.js';

type FileSystemProjectRepositoryOptions = Readonly<{ directory: string }>;
type StoredProject = StoredProjectW1 | StoredProjectW2;
type StoredProjectW1 = Readonly<{ version: 1; project: StoredProjectW1Value }>;
type StoredProjectW1Value = Readonly<{
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  manifest?: never;
}>;
type StoredProjectW2 = Readonly<{ version: 1; project: Project }>;
type ReadProjectResult = Readonly<{ project: Project; requiresMigration: boolean }>;

/***
 * Create a path-isolated filesystem implementation of the project repository port.
 *
 * The keyed mutex coordinates mutations only through this adapter instance in one Node.js process.
 * Assign each storage directory to one writer; coordinating separate adapter instances or processes
 * requires external locking and is unsupported by this adapter.
 */
export async function createProjectRepositoryFileSystemAsync(
  options: FileSystemProjectRepositoryOptions,
): Promise<ProjectRepository> {
  const directory = join(options.directory, 'projects');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertStorageDirectoryAsync(directory);
  const mutations = createKeyedAsyncMutex<string>({
    createBusyError: (id) => new Error(`Project identity '${id}' is busy.`),
  });

  return {
    listAsync: async (): Promise<readonly Project[]> => {
      const entries = await readdir(directory, { withFileTypes: true });
      const projects = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map(async (entry) => readProjectWithMigrationAsync(directory, mutations, entry.name)),
      );
      return projects
        .filter((project): project is Project => project !== null)
        .sort((left, right) => left.id.localeCompare(right.id));
    },
    readAsync: async (id: string): Promise<Project | null> =>
      readProjectWithMigrationAsync(directory, mutations, projectFileName(id)),
    createAsync: async (project: Project): Promise<void> =>
      mutations.run(project.id, async () => writeProjectAsync(directory, project, true)),
    updateAsync: async (
      id: string,
      update: (project: Project) => Project,
    ): Promise<Project | null> =>
      mutations.run(id, async () => {
        const result = await readProjectAsync(directory, projectFileName(id));
        if (result === null) return null;
        const updated = update(result.project);
        if (updated.id !== id) throw new Error('Project update cannot change identity.');
        await writeProjectAsync(directory, updated, false);
        return updated;
      }),
    deleteAsync: async (id: string): Promise<Project | null> =>
      mutations.run(id, async () => deleteProjectAsync(directory, id)),
  };
}

/*** Confirm that the storage directory itself cannot be a symlink. */
async function assertStorageDirectoryAsync(directory: string): Promise<void> {
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    if (!(await handle.stat()).isDirectory()) {
      throw new Error('Project storage must be a directory.');
    }
  } finally {
    await handle.close();
  }
}

/*** Read a regular, schema-valid project file through a no-follow file handle. */
async function readProjectAsync(
  directory: string,
  fileName: string,
  expectedFileName = fileName,
): Promise<ReadProjectResult | null> {
  const path = join(directory, fileName);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!(await handle.stat()).isFile())
      throw new Error(`Project storage entry '${fileName}' must be a regular file.`);
    const stored = JSON.parse(await handle.readFile({ encoding: 'utf8' })) as unknown;
    if (!isStoredProject(stored) || projectFileName(stored.project.id) !== expectedFileName) {
      throw new Error(`Project storage entry '${fileName}' is invalid.`);
    }
    if (isStoredProjectW1(stored)) {
      return {
        project: { ...stored.project, manifest: { draft: null, revisions: [] } },
        requiresMigration: true,
      };
    }
    return { project: stored.project, requiresMigration: false };
  } catch (error: unknown) {
    if (isMissingFileError(error)) return null;
    if (isSymlinkError(error)) {
      throw new Error(`Project storage entry '${fileName}' must be a regular file.`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

/*** Read a project and atomically persist the one supported W1-to-W2 document migration. */
async function readProjectWithMigrationAsync(
  directory: string,
  mutations: ReturnType<typeof createKeyedAsyncMutex<string>>,
  fileName: string,
): Promise<Project | null> {
  const result = await readProjectAsync(directory, fileName);
  if (result === null) return null;
  if (!result.requiresMigration) return result.project;

  return mutations.run(result.project.id, async () => {
    const current = await readProjectAsync(directory, fileName);
    if (current === null) return null;
    if (current.requiresMigration) await writeProjectAsync(directory, current.project, false);
    return current.project;
  });
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
  await writeTemporaryProjectAsync(temporary, project);
  try {
    if (createOnly) await link(temporary, target);
    else await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

/*** Write a private temporary project file without following or replacing an existing entry. */
async function writeTemporaryProjectAsync(temporary: string, project: Project): Promise<void> {
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(JSON.stringify({ version: 1, project } satisfies StoredProject), 'utf8');
  } finally {
    await handle.close();
  }
}

/*** Atomically detach a project, restoring it when validation or deletion cannot complete. */
async function deleteProjectAsync(directory: string, id: string): Promise<Project | null> {
  const fileName = projectFileName(id);
  const target = join(directory, fileName);
  const temporary = join(directory, `.${fileName}.${crypto.randomUUID()}.delete`);
  try {
    await rename(target, temporary);
  } catch (error: unknown) {
    if (isMissingFileError(error)) return null;
    throw error;
  }

  try {
    const result = await readProjectAsync(
      directory,
      temporary.slice(directory.length + 1),
      fileName,
    );
    if (result === null) throw new Error(`Project storage entry '${fileName}' disappeared.`);
    await rm(temporary);
    return result.project;
  } catch (error: unknown) {
    await rename(temporary, target);
    throw error;
  }
}

/*** Convert only canonical project identities into a local storage filename. */
function projectFileName(id: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error('Project identity is invalid.');
  }
  return `${id}.json`;
}

/*** Verify a parsed current or published-W1 storage document before it enters the application. */
function isStoredProject(value: unknown): value is StoredProject {
  return isStoredProjectW1(value) || isStoredProjectW2(value);
}

/*** Recognize only the published W1 document shape that has no persisted manifest field. */
function isStoredProjectW1(value: unknown): value is StoredProjectW1 {
  if (!isRecord(value)) return false;
  const { project } = value;
  return (
    value.version === 1 &&
    isRecord(project) &&
    typeof project.id === 'string' &&
    typeof project.name === 'string' &&
    typeof project.createdAt === 'string' &&
    typeof project.updatedAt === 'string' &&
    !('manifest' in project)
  );
}

/*** Validate the current persisted project document at the filesystem boundary. */
function isStoredProjectW2(value: unknown): value is StoredProjectW2 {
  if (!isRecord(value)) return false;
  const { project } = value;
  return (
    value.version === 1 &&
    isRecord(project) &&
    typeof project.id === 'string' &&
    typeof project.name === 'string' &&
    typeof project.createdAt === 'string' &&
    typeof project.updatedAt === 'string' &&
    isProjectManifest(project.manifest)
  );
}

/*** Validate persisted manifest draft and revision invariants at the filesystem boundary. */
function isProjectManifest(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.revisions)) return false;
  const { revisions, draft } = value;
  const ids = new Set<string>();
  const areRevisionsValid = revisions.every(
    (revision) =>
      isRecord(revision) &&
      typeof revision.id === 'string' &&
      typeof revision.savedAt === 'string' &&
      isAppManifest(revision.manifest) &&
      !ids.has(revision.id) &&
      (ids.add(revision.id), true),
  );
  if (!areRevisionsValid || (draft !== null && !isRecord(draft))) return false;
  return (
    draft === null ||
    (typeof draft.revisionId === 'string' &&
      typeof draft.savedAt === 'string' &&
      isAppManifest(draft.manifest) &&
      revisions.some(
        (revision) =>
          isRecord(revision) &&
          revision.id === draft.revisionId &&
          revision.savedAt === draft.savedAt &&
          JSON.stringify(revision.manifest) === JSON.stringify(draft.manifest),
      ))
  );
}

/*** Identify the missing-file condition that represents an absent project. */
function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/*** Identify no-follow failures caused by a symbolic link at the opened path. */
function isSymlinkError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ELOOP';
}
