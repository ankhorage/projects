import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import type { AppManifest } from '@ankhorage/contracts';
import { CAPABILITIES } from '../src/capabilities/index.js';
import { createProjectRepositoryFileSystemAsync, projects } from '../src/index.js';
import type { Project, ProjectRepository } from '../src/index.js';

const directories: string[] = [];

afterEach(async () =>
  Promise.all(
    directories.map(async (directory) => rm(directory, { recursive: true, force: true })),
  ),
);

describe('projects', () => {
  test('publishes project capabilities for CRUD, persisted revisions, and explicit materialization', () => {
    expect(CAPABILITIES.map((capability) => capability.id)).toEqual([
      'projects.list',
      'projects.read',
      'projects.create',
      'projects.update',
      'projects.save',
      'projects.reload',
      'projects.materialize',
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

  test('retains a project file when delete validation fails', async () => {
    const directory = await createDirectoryAsync();
    const repository = await createProjectRepositoryFileSystemAsync({ directory });
    const file = join(directory, 'projects', 'first-project.json');
    const stored = '{"version":1,"project":{"id":"other-project"}}';
    await writeFile(file, stored);

    await expect(repository.deleteAsync('first-project')).rejects.toThrow('is invalid');
    expect(await readFile(file, 'utf8')).toBe(stored);
  });

  test('updates the project snapshot supplied by the atomic repository operation', async () => {
    const current: Project = {
      id: 'first-project',
      name: 'Current project',
      createdAt: '2026-11-14T10:00:00.000Z',
      updatedAt: '2026-11-14T10:30:00.000Z',
      manifest: { draft: null, revisions: [] },
    };
    const repository: ProjectRepository = {
      listAsync: async () => [],
      readAsync: async () => {
        throw new Error('Update must not read outside the repository mutation.');
      },
      createAsync: async () => undefined,
      updateAsync: async (id, update) => (id === current.id ? update(current) : null),
      deleteAsync: async () => null,
    };

    expect(
      await projects.update(
        repository,
        { id: current.id, name: 'Updated project' },
        new Date('2026-11-14T11:00:00.000Z'),
      ),
    ).toEqual({ ...current, name: 'Updated project', updatedAt: '2026-11-14T11:00:00.000Z' });
  });

  test('migrates a published W1 project file once without changing its identity or timestamps', async () => {
    const directory = await createDirectoryAsync();
    const repository = await createProjectRepositoryFileSystemAsync({ directory });
    const file = join(directory, 'projects', 'first-project.json');
    const w1 = {
      version: 1,
      project: {
        id: 'first-project',
        name: 'First project',
        createdAt: '2026-11-14T10:00:00.000Z',
        updatedAt: '2026-11-14T10:30:00.000Z',
      },
    };
    await writeFile(file, JSON.stringify(w1));

    expect(await projects.read(repository, 'first-project')).toEqual({
      ...w1.project,
      manifest: { draft: null, revisions: [] },
    });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      version: 1,
      project: { ...w1.project, manifest: { draft: null, revisions: [] } },
    });

    const saved = await projects.save(repository, {
      id: 'first-project',
      manifest: createManifest(),
      expectedRevisionId: null,
    });
    expect(saved).toMatchObject({
      id: w1.project.id,
      createdAt: w1.project.createdAt,
      updatedAt: expect.any(String),
      manifest: { draft: { revisionId: 'revision-1' }, revisions: [{ id: 'revision-1' }] },
    });
    expect(await projects.read(repository, 'first-project')).toEqual(saved);
  });

  test('does not downgrade an invalid current project document into a W1 migration', async () => {
    const directory = await createDirectoryAsync();
    const repository = await createProjectRepositoryFileSystemAsync({ directory });
    const file = join(directory, 'projects', 'first-project.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        project: {
          id: 'first-project',
          name: 'First project',
          createdAt: '2026-11-14T10:00:00.000Z',
          updatedAt: '2026-11-14T10:30:00.000Z',
          manifest: { draft: null, revisions: 'not-an-array' },
        },
      }),
    );

    await expect(projects.read(repository, 'first-project')).rejects.toThrow('is invalid');
  });

  test('rejects an overlapping delete while an update owns the project identity', async () => {
    const directory = await createDirectoryAsync();
    const repository = await createProjectRepositoryFileSystemAsync({ directory });
    const created = await projects.create(repository, { name: 'First project' });
    const updating = repository.updateAsync(created.id, (project) => ({
      ...project,
      name: 'Updated project',
      updatedAt: '2026-11-14T11:00:00.000Z',
    }));
    const deleting = repository.deleteAsync(created.id);

    await expect(deleting).rejects.toThrow(`Project identity '${created.id}' is busy.`);
    expect(await updating).toEqual({
      ...created,
      name: 'Updated project',
      updatedAt: '2026-11-14T11:00:00.000Z',
    });
    expect(await projects.read(repository, created.id)).toEqual({
      ...created,
      name: 'Updated project',
      updatedAt: '2026-11-14T11:00:00.000Z',
    });
  });

  test('saves, reloads, reads, and materializes immutable manifest revisions', async () => {
    const directory = await createDirectoryAsync();
    const repository = await createProjectRepositoryFileSystemAsync({ directory });
    const project = await projects.create(repository, { name: 'First project' });
    const manifest = createManifest();

    const saved = await projects.save(
      repository,
      { id: project.id, manifest, expectedRevisionId: null },
      new Date('2026-11-14T11:00:00.000Z'),
    );
    const revision = {
      id: 'revision-1',
      manifest,
      savedAt: '2026-11-14T11:00:00.000Z',
    };
    if (saved === null) throw new Error('The created project must be available for saving.');
    expect(saved?.manifest).toEqual({
      draft: { revisionId: revision.id, manifest, savedAt: revision.savedAt },
      revisions: [revision],
    });
    expect(await projects.reload(repository, { id: project.id })).toEqual(saved.manifest);
    expect((await projects.reload(repository, { id: project.id }))?.revisions).toEqual([revision]);

    const materialized: string[] = [];
    expect(
      await projects.materialize(
        repository,
        {
          materializeAsync: async ({ revision: materializedRevision }) => {
            materialized.push(materializedRevision.id);
          },
        },
        { id: project.id, revisionId: revision.id },
      ),
    ).toEqual(revision);
    expect(materialized).toEqual([revision.id]);
  });

  test('rejects stale manifest saves without overwriting the current immutable revision', async () => {
    const directory = await createDirectoryAsync();
    const repository = await createProjectRepositoryFileSystemAsync({ directory });
    const project = await projects.create(repository, { name: 'First project' });
    const first = await projects.save(
      repository,
      { id: project.id, manifest: createManifest(), expectedRevisionId: null },
      new Date('2026-11-14T11:00:00.000Z'),
    );

    await expect(
      projects.save(repository, {
        id: project.id,
        manifest: createManifest(),
        expectedRevisionId: null,
      }),
    ).rejects.toThrow("expected 'null', found 'revision-1'");
    expect((await projects.reload(repository, { id: project.id }))?.revisions).toEqual(
      first?.manifest.revisions,
    );
  });

  test('persists a revision snapshot independently from later caller mutations', async () => {
    const directory = await createDirectoryAsync();
    const repository = await createProjectRepositoryFileSystemAsync({ directory });
    const project = await projects.create(repository, { name: 'First project' });
    const manifest = createManifest();
    await projects.save(repository, { id: project.id, manifest, expectedRevisionId: null });
    manifest.metadata.name = 'Mutated outside the repository';

    expect(
      (await projects.reload(repository, { id: project.id }))?.draft?.manifest.metadata.name,
    ).toBe('Example');
  });

  test('rejects an overlapping manifest save while one save owns the project identity', async () => {
    const directory = await createDirectoryAsync();
    const repository = await createProjectRepositoryFileSystemAsync({ directory });
    const project = await projects.create(repository, { name: 'First project' });
    const saving = projects.save(repository, {
      id: project.id,
      manifest: createManifest(),
      expectedRevisionId: null,
    });

    await expect(
      projects.save(repository, {
        id: project.id,
        manifest: createManifest(),
        expectedRevisionId: null,
      }),
    ).rejects.toThrow(`Project identity '${project.id}' is busy.`);
    expect((await saving)?.manifest.revisions).toHaveLength(1);
  });
});

/*** Create the smallest canonical AppManifest accepted by the released Contracts parser. */
function createManifest(): AppManifest {
  return {
    metadata: {
      name: 'Example',
      slug: 'example',
      version: '1.0.0',
      category: 'developer_tools',
      themeId: 'default',
    },
    themes: {
      default: {
        id: 'default',
        name: 'Default',
        light: { primaryColor: '#3366ff', harmony: 'analogous' },
        dark: { primaryColor: '#6699ff', harmony: 'analogous' },
      },
    },
    activeThemeId: 'default',
    infra: {
      environments: {
        local: {
          deployment: { compute: { provider: 'local' }, runtime: { provider: 'minikube' } },
          database: { provider: 'supabase', tier: 'dev' },
          objectStorage: { provider: 'supabase', buckets: { media: true } },
          networking: { domain: 'example.test' },
        },
      },
      apis: {},
      modules: {},
    },
    navigator: { type: 'stack', initialRouteName: 'home', routes: [] },
    screens: {},
    settings: { localization: { defaultLocale: 'en', locales: ['en'] } },
  };
}

/*** Create and retain a unique temporary project storage directory. */
async function createDirectoryAsync(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ankhorage-projects-'));
  directories.push(directory);
  return directory;
}
