import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { CAPABILITIES } from '../src/capabilities/index.js';
import { createProjectRepositoryFileSystemAsync, projects } from '../src/index.js';

const directories: string[] = [];

afterEach(async () =>
  Promise.all(
    directories.map(async (directory) => rm(directory, { recursive: true, force: true })),
  ),
);

describe('projects', () => {
  test('publishes the five project capability descriptors', () => {
    expect(CAPABILITIES.map((capability) => capability.id)).toEqual([
      'projects.list',
      'projects.read',
      'projects.create',
      'projects.update',
      'projects.delete',
    ]);
    expect(
      CAPABILITIES.every((capability) => capability.owner === '@ankhorage/projects'),
    ).toBeTrue();
  });

  test('creates, lists, reads, updates, and deletes a persisted project', async () => {
    const directory = await createDirectoryAsync();
    const repository = await createProjectRepositoryFileSystemAsync({ directory });
    const created = await projects.create(
      repository,
      { name: '  First project  ' },
      new Date('2026-11-14T10:00:00.000Z'),
    );

    expect(created.name).toBe('First project');
    expect(created.id).toBe('first-project');
    expect(await projects.list(repository)).toEqual([created]);
    expect(await projects.read(repository, created.id)).toEqual(created);

    const updated = await projects.update(
      repository,
      { id: created.id, name: 'Second project' },
      new Date('2026-11-14T11:00:00.000Z'),
    );
    expect(updated).toEqual({
      ...created,
      name: 'Second project',
      updatedAt: '2026-11-14T11:00:00.000Z',
    });
    expect(await projects.delete(repository, created.id)).toEqual(updated);
    expect(await projects.read(repository, created.id)).toBeNull();
  });

  test('rejects traversal identities and does not follow a project-file symlink', async () => {
    const directory = await createDirectoryAsync();
    const repository = await createProjectRepositoryFileSystemAsync({ directory });
    const target = join(directory, 'outside.json');
    const id = 'first-project';
    await writeFile(target, '{"secret":true}');
    await symlink(target, join(directory, 'projects', `${id}.json`));

    await expect(projects.read(repository, '../outside')).rejects.toThrow(
      'Project identity is invalid.',
    );
    await expect(projects.read(repository, id)).rejects.toThrow('must be a regular file');
    await expect(projects.delete(repository, id)).rejects.toThrow('must be a regular file');
    expect(await readFile(target, 'utf8')).toBe('{"secret":true}');
  });

  test('rejects an overlapping delete while an update owns the project identity', async () => {
    const directory = await createDirectoryAsync();
    const repository = await createProjectRepositoryFileSystemAsync({ directory });
    const created = await projects.create(repository, { name: 'First project' });
    const updated = {
      ...created,
      name: 'Updated project',
      updatedAt: '2026-11-14T11:00:00.000Z',
    };
    const updating = repository.updateAsync(updated);
    const deleting = repository.deleteAsync(created.id);

    await expect(deleting).rejects.toThrow(`Project identity '${created.id}' is busy.`);
    expect(await updating).toEqual(updated);
    expect(await projects.read(repository, created.id)).toEqual(updated);
  });
});

/*** Create and retain a unique temporary project storage directory. */
async function createDirectoryAsync(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ankhorage-projects-'));
  directories.push(directory);
  return directory;
}
