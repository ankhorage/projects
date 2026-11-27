import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import type { AppManifest } from '@ankhorage/contracts';
import {
  createExistingAppManifestRepositoryFileSystemAsync,
  existingAppManifests,
} from '../src/index.js';

const directories: string[] = [];

afterEach(async () =>
  Promise.all(
    directories.map(async (directory) => rm(directory, { recursive: true, force: true })),
  ),
);

describe('existing app manifests', () => {
  test('lists and reads only manifest-bearing directories with existing app identities', async () => {
    const directory = await createDirectoryAsync();
    await createExistingAppAsync(directory, 'first-project', createManifest());
    await createExistingAppAsync(directory, 'without-manifest');
    await mkdir(join(directory, 'apps', 'without-package'), { recursive: true });
    const repository = await createExistingAppManifestRepositoryFileSystemAsync({ directory });

    expect((await existingAppManifests.list(repository)).map(({ id }) => id)).toEqual([
      'first-project',
    ]);
    expect(await existingAppManifests.read(repository, 'missing-project')).toEqual({
      status: 'missing-project',
    });
    expect(await existingAppManifests.read(repository, 'without-package')).toEqual({
      status: 'missing-project',
    });
    expect(await existingAppManifests.read(repository, 'without-manifest')).toEqual({
      status: 'missing-manifest',
    });
  });

  test('distinguishes invalid existing manifests without creating project metadata', async () => {
    const directory = await createDirectoryAsync();
    await createExistingAppAsync(directory, 'first-project');
    await writeFile(join(directory, 'apps', 'first-project', 'ankh.config.json'), '{invalid');
    const repository = await createExistingAppManifestRepositoryFileSystemAsync({ directory });

    expect(await existingAppManifests.read(repository, 'first-project')).toMatchObject({
      status: 'invalid-manifest',
    });
    expect(await directoryExistsAsync(join(directory, 'projects'))).toBeFalse();
  });

  test('replaces only the canonical manifest atomically and returns its new content digest', async () => {
    const directory = await createDirectoryAsync();
    await createExistingAppAsync(directory, 'first-project', createManifest());
    const repository = await createExistingAppManifestRepositoryFileSystemAsync({ directory });
    const current = await existingAppManifests.read(repository, 'first-project');
    if (current.status !== 'found') throw new Error('The existing manifest must be readable.');
    const manifest = createManifest();
    manifest.metadata.name = 'Saved example';

    const saved = await existingAppManifests.save(repository, {
      id: 'first-project',
      manifest,
      expectedManifestDigest: current.project.manifestDigest,
    });

    expect(saved).toMatchObject({
      status: 'saved',
      project: { id: 'first-project', manifest: { metadata: { name: 'Saved example' } } },
    });
    expect(
      await readFile(join(directory, 'apps', 'first-project', 'ankh.config.json'), 'utf8'),
    ).toBe(JSON.stringify(manifest));
    expect(await directoryExistsAsync(join(directory, 'apps', 'first-project'))).toBeTrue();
    expect(await directoryExistsAsync(join(directory, 'projects'))).toBeFalse();
  });

  test('fails closed on a stale content digest without overwriting the manifest', async () => {
    const directory = await createDirectoryAsync();
    const manifest = createManifest();
    await createExistingAppAsync(directory, 'first-project', manifest);
    const repository = await createExistingAppManifestRepositoryFileSystemAsync({ directory });
    const current = await existingAppManifests.read(repository, 'first-project');
    if (current.status !== 'found') throw new Error('The existing manifest must be readable.');
    const externallySaved = createManifest();
    externallySaved.metadata.name = 'External save';
    const manifestPath = join(directory, 'apps', 'first-project', 'ankh.config.json');
    await writeFile(manifestPath, JSON.stringify(externallySaved));

    expect(
      await existingAppManifests.save(repository, {
        id: 'first-project',
        manifest,
        expectedManifestDigest: current.project.manifestDigest,
      }),
    ).toMatchObject({ status: 'conflict' });
    expect(await readFile(manifestPath, 'utf8')).toBe(JSON.stringify(externallySaved));
  });

  test('rejects traversal and symbolic links without following another project path', async () => {
    const directory = await createDirectoryAsync();
    await createExistingAppAsync(directory, 'first-project');
    const target = join(directory, 'outside.json');
    await writeFile(target, JSON.stringify(createManifest()));
    await symlink(target, join(directory, 'apps', 'first-project', 'ankh.config.json'));
    const repository = await createExistingAppManifestRepositoryFileSystemAsync({ directory });

    await expect(existingAppManifests.read(repository, '../outside')).rejects.toThrow(
      'Project identity is invalid.',
    );
    await expect(existingAppManifests.read(repository, 'first-project')).rejects.toThrow(
      'must be a regular file',
    );
    expect(await readFile(target, 'utf8')).toBe(JSON.stringify(createManifest()));
  });
});

/*** Create a caller-owned existing application directory without adding Projects-owned records. */
async function createExistingAppAsync(
  directory: string,
  id: string,
  manifest?: AppManifest,
): Promise<void> {
  const appDirectory = join(directory, 'apps', id);
  await mkdir(appDirectory, { recursive: true });
  await writeFile(join(appDirectory, 'package.json'), JSON.stringify({ name: id }));
  if (manifest) await writeFile(join(appDirectory, 'ankh.config.json'), JSON.stringify(manifest));
}

/*** Report whether a path remains an existing directory without exposing test setup errors. */
async function directoryExistsAsync(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/*** Create and retain a caller-owned root containing the canonical applications directory. */
async function createDirectoryAsync(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ankhorage-existing-app-manifests-'));
  directories.push(directory);
  await mkdir(join(directory, 'apps'));
  return directory;
}

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
