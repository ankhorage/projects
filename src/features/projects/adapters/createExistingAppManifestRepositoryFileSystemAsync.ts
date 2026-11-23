import { createHash } from 'node:crypto';
import { constants, open, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { parseAppManifest } from '@ankhorage/contracts';
import { createKeyedAsyncMutex } from '@ankhorage/utility/concurrency';

import type {
  ExistingAppManifestProject,
  ExistingAppManifestReadResult,
  ExistingAppManifestSaveResult,
  SaveExistingAppManifestInput,
} from '../../../types/existingAppManifests.js';
import { isProjectIdentity } from '../domain/isProjectIdentity.js';
import type { ExistingAppManifestRepository } from '../ports/ExistingAppManifestRepository.js';

type ExistingAppManifestRepositoryOptions = Readonly<{ directory: string }>;
type ExistingAppDirectoryResult =
  Readonly<{ status: 'found'; directory: string }> | Readonly<{ status: 'missing-project' }>;

const APP_DIRECTORY_NAME = 'apps';
const APP_IDENTITY_FILE_NAME = 'package.json';
const MANIFEST_FILE_NAME = 'ankh.config.json';

/***
 * Create a filesystem repository that keeps each existing app-root manifest authoritative.
 *
 * The keyed mutex coordinates mutations only through this adapter instance in one Node.js process.
 * Callers must coordinate multiple instances or processes that share one application root.
 */
export async function createExistingAppManifestRepositoryFileSystemAsync(
  options: ExistingAppManifestRepositoryOptions,
): Promise<ExistingAppManifestRepository> {
  const appsDirectory = join(options.directory, APP_DIRECTORY_NAME);
  await assertExistingAppsDirectoryAsync(appsDirectory);
  const mutations = createKeyedAsyncMutex<string>({
    createBusyError: (id) => new Error(`Project identity '${id}' is busy.`),
  });

  return {
    listAsync: async (): Promise<readonly ExistingAppManifestProject[]> => {
      const entries = await readdir(appsDirectory, { withFileTypes: true });
      const projects = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && isProjectIdentity(entry.name))
          .map(async (entry) => readExistingAppManifestAsync(appsDirectory, entry.name)),
      );
      return projects
        .filter(isFoundExistingAppManifest)
        .map(({ project }) => project)
        .sort((left, right) => left.id.localeCompare(right.id));
    },
    readAsync: async (id: string): Promise<ExistingAppManifestReadResult> =>
      readExistingAppManifestAsync(appsDirectory, id),
    saveAsync: async (
      input: SaveExistingAppManifestInput,
    ): Promise<ExistingAppManifestSaveResult> =>
      mutations.run(input.id, async () => saveExistingAppManifestAsync(appsDirectory, input)),
  };
}

/*** Confirm that the caller-owned app root exists and cannot be a symbolic link. */
async function assertExistingAppsDirectoryAsync(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    if (!(await handle.stat()).isDirectory()) {
      throw new Error('Existing app root must be a directory.');
    }
  } catch (error: unknown) {
    if (isMissingFileError(error))
      throw new Error('Existing app root must exist.', { cause: error });
    throw error;
  } finally {
    await handle?.close();
  }
}

/*** Read one canonical manifest only after confirming the caller-owned app identity marker. */
async function readExistingAppManifestAsync(
  appsDirectory: string,
  id: string,
): Promise<ExistingAppManifestReadResult> {
  assertProjectIdentity(id);
  const appDirectory = await resolveExistingAppDirectoryAsync(appsDirectory, id);
  if (appDirectory.status === 'missing-project') return appDirectory;
  return readManifestAsync(appDirectory.directory, id);
}

/*** Resolve one application directory only when its existing package marker is a regular file. */
async function resolveExistingAppDirectoryAsync(
  appsDirectory: string,
  id: string,
): Promise<ExistingAppDirectoryResult> {
  const directory = join(appsDirectory, id);
  const handle = await openDirectoryOrMissingAsync(directory);
  if (handle === null) return { status: 'missing-project' };
  await handle.close();
  return (await isRegularFileAsync(join(directory, APP_IDENTITY_FILE_NAME)))
    ? { status: 'found', directory }
    : { status: 'missing-project' };
}

/*** Read, validate, and content-version one canonical manifest file without following symlinks. */
async function readManifestAsync(
  directory: string,
  id: string,
): Promise<ExistingAppManifestReadResult> {
  const path = join(directory, MANIFEST_FILE_NAME);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!(await handle.stat()).isFile())
      throw new Error('Existing app manifest must be a regular file.');
    const contents = await handle.readFile({ encoding: 'utf8' });
    return parseExistingAppManifest(contents, id);
  } catch (error: unknown) {
    if (isMissingFileError(error)) return { status: 'missing-manifest' };
    if (isSymlinkError(error)) {
      throw new Error('Existing app manifest must be a regular file.', { cause: error });
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

/*** Parse exactly the released AppManifest schema and retain a digest of its persisted bytes. */
function parseExistingAppManifest(contents: string, id: string): ExistingAppManifestReadResult {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error: unknown) {
    return invalidManifestResult(
      error instanceof Error ? error.message : 'Manifest is not valid JSON.',
    );
  }
  const parsed = parseAppManifest(value);
  if (!parsed.ok) return invalidManifestResult(parsed.message);
  return {
    status: 'found',
    project: {
      id,
      manifest: parsed.manifest,
      manifestDigest: createManifestDigest(contents),
    },
  };
}

/*** Return one typed invalid-manifest result without assigning historical project metadata. */
function invalidManifestResult(message: string): ExistingAppManifestReadResult {
  return { status: 'invalid-manifest', message };
}

/*** Replace a canonical manifest only when its persisted content still has the expected digest. */
async function saveExistingAppManifestAsync(
  appsDirectory: string,
  input: SaveExistingAppManifestInput,
): Promise<ExistingAppManifestSaveResult> {
  const current = await readExistingAppManifestAsync(appsDirectory, input.id);
  if (current.status !== 'found') return current;
  if (current.project.manifestDigest !== input.expectedManifestDigest) {
    return { status: 'conflict', actualManifestDigest: current.project.manifestDigest };
  }
  const parsed = parseAppManifest(input.manifest);
  if (!parsed.ok) return { status: 'invalid-manifest', message: parsed.message };
  const contents = JSON.stringify(parsed.manifest);
  await replaceManifestAtomicallyAsync(join(appsDirectory, input.id), contents);
  return {
    status: 'saved',
    project: {
      id: input.id,
      manifest: parsed.manifest,
      manifestDigest: createManifestDigest(contents),
    },
  };
}

/*** Atomically replace only the existing canonical manifest, never the app root. */
async function replaceManifestAtomicallyAsync(directory: string, contents: string): Promise<void> {
  const target = join(directory, MANIFEST_FILE_NAME);
  const temporary = join(directory, `.${MANIFEST_FILE_NAME}.${crypto.randomUUID()}.tmp`);
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(contents, 'utf8');
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

/*** Open one directory without treating a missing directory as a filesystem-security failure. */
async function openDirectoryOrMissingAsync(path: string) {
  try {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    if (!(await handle.stat()).isDirectory())
      throw new Error('Existing app project must be a directory.');
    return handle;
  } catch (error: unknown) {
    if (isMissingFileError(error)) return null;
    if (isSymlinkError(error)) {
      throw new Error('Existing app project must be a directory.', { cause: error });
    }
    throw error;
  }
}

/*** Recognize an existing regular identity file without following symbolic links. */
async function isRegularFileAsync(path: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    return (await handle.stat()).isFile();
  } catch (error: unknown) {
    if (isMissingFileError(error)) return false;
    if (isSymlinkError(error))
      throw new Error('Existing app identity file must be a regular file.', { cause: error });
    throw error;
  } finally {
    await handle?.close();
  }
}

/*** Narrow a read result to a valid existing application manifest. */
function isFoundExistingAppManifest(
  result: ExistingAppManifestReadResult,
): result is Readonly<{ status: 'found'; project: ExistingAppManifestProject }> {
  return result.status === 'found';
}

/*** Reject values that could escape the caller-owned application root. */
function assertProjectIdentity(id: string): void {
  if (!isProjectIdentity(id)) throw new Error('Project identity is invalid.');
}

/*** Produce a stable content token for optimistic concurrency. */
function createManifestDigest(contents: string): string {
  return createHash('sha256').update(contents, 'utf8').digest('hex');
}

/*** Identify the missing-file condition used for absent caller-owned paths. */
function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/*** Identify no-follow failures caused by symbolic links at opened paths. */
function isSymlinkError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ELOOP';
}
