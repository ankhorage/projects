import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import type { AppManifest } from '@ankhorage/contracts';
import { resolveExpoRuntimeGeneratedAppSources } from '@ankhorage/expo-runtime/generated-app';
import { resolveExpoRuntimePlan } from '@ankhorage/expo-runtime/planning';
import { createExpoProjectMaterializer } from '../src/index.js';
import type { Project, ProjectManifestRevision } from '../src/index.js';

const directories: string[] = [];

afterEach(async () =>
  Promise.all(
    directories.map(async (directory) => rm(directory, { recursive: true, force: true })),
  ),
);

describe('createExpoProjectMaterializer', () => {
  test('materializes one immutable revision into an empty caller-owned Expo target', async () => {
    const parentDirectory = await createDirectoryAsync();
    const targetDirectory = join(parentDirectory, 'generated');
    await mkdir(targetDirectory);
    const materializer = createExpoProjectMaterializer({
      targetDirectory,
      template: { category: 'books_reading', slug: 'reader' },
      navigator: {
        bindings: { screens: {}, guards: {} },
        platform: 'web',
        expoRouterVersion: '57.0.32',
      },
    });

    const result = await materializer.materializeAsync({
      project: createProject(),
      revision: createRevision(),
    });

    expect(result).toMatchObject({
      projectId: 'reader-project',
      revisionId: 'revision-1',
      targetDirectory,
    });
    expect(result.files).toEqual(
      expect.arrayContaining([
        'README.md',
        'ankh.config.json',
        'ankh.template.json',
        'app.config.ts',
        'assets/images/the-jungle-book.png',
        'package.json',
        'src/app/_layout.tsx',
        'src/ankh.manifest.ts',
        'src/generated/runtimeManifestScreens.tsx',
        'src/generated/runtimeShell.tsx',
      ]),
    );
    expect(JSON.parse(await readFile(join(targetDirectory, 'package.json'), 'utf8'))).toMatchObject(
      {
        main: 'expo-router/entry',
        dependencies: {
          expo: '57.0.34',
          'expo-router': '~57.0.32',
        },
      },
    );
    expect(await readFile(join(targetDirectory, 'src/app/_layout.tsx'), 'utf8')).toContain('Stack');
  });

  test('refuses a nonempty target before an owner materializer can write into it', async () => {
    const parentDirectory = await createDirectoryAsync();
    const targetDirectory = join(parentDirectory, 'generated');
    await mkdir(targetDirectory);
    await writeFile(join(targetDirectory, 'keep.txt'), 'keep');
    const materializer = createExpoProjectMaterializer({
      targetDirectory,
      template: { category: 'books_reading', slug: 'reader' },
      navigator: {
        bindings: { screens: {}, guards: {} },
        platform: 'web',
        expoRouterVersion: '57.0.32',
      },
    });

    await expect(
      materializer.materializeAsync({ project: createProject(), revision: createRevision() }),
    ).rejects.toThrow('Materialization target must be empty');
    expect(await readFile(join(targetDirectory, 'keep.txt'), 'utf8')).toBe('keep');
  });

  test('materializes Runtime-owned manifest screens with their published bindings and dependencies', async () => {
    const parentDirectory = await createDirectoryAsync();
    const targetDirectory = join(parentDirectory, 'generated');
    const manifest = createRuntimeScreenManifest();
    const runtime = resolveExpoRuntimeGeneratedAppSources(
      manifest,
      resolveExpoRuntimePlan(manifest),
      {
        manifestModuleSpecifier: '../ankh.manifest',
        screenModuleSpecifier: '../generated/runtimeManifestScreens',
      },
    );
    const homeBinding = runtime.navigatorBindings.screens.home;
    expect(homeBinding).toBeDefined();
    expect(runtime.navigatorBindings).toEqual({
      guards: {},
      screens: {
        home: {
          module: '../generated/runtimeManifestScreens',
          exportName: 'ManifestScreen0',
        },
      },
    });
    await mkdir(targetDirectory);
    const materializer = createExpoProjectMaterializer({
      targetDirectory,
      template: { category: 'books_reading', slug: 'reader' },
      navigator: {
        // A matching caller binding remains supported and merges with the Runtime-owned binding.
        bindings: { guards: {}, screens: { home: homeBinding! } },
        platform: 'web',
        expoRouterVersion: '57.0.32',
      },
    });

    await materializer.materializeAsync({
      project: createProject(),
      revision: { ...createRevision(), manifest },
    });

    const packageJson = JSON.parse(
      await readFile(join(targetDirectory, 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
    };
    expect(packageJson.dependencies['@ankhorage/runtime']).toBe(
      runtime.dependencies['@ankhorage/runtime'],
    );
    expect(packageJson.dependencies['@ankhorage/zora']).toBe(
      runtime.dependencies['@ankhorage/zora'],
    );
    expect(
      await readFile(join(targetDirectory, 'src/generated/runtimeManifestScreens.tsx'), 'utf8'),
    ).toBe(runtime.files[0]?.source);
    expect(
      await readFile(join(targetDirectory, 'src/generated/runtimeManifestScreens.tsx'), 'utf8'),
    ).toContain('createManifestScreen("home")');
  });

  test('rejects a caller binding that replaces a Runtime-owned manifest screen', async () => {
    const parentDirectory = await createDirectoryAsync();
    const targetDirectory = join(parentDirectory, 'generated');
    await mkdir(targetDirectory);
    const materializer = createExpoProjectMaterializer({
      targetDirectory,
      template: { category: 'books_reading', slug: 'reader' },
      navigator: {
        bindings: {
          guards: {},
          screens: { home: { module: '../caller/Home', exportName: 'Home' } },
        },
        platform: 'web',
        expoRouterVersion: '57.0.32',
      },
    });

    await expect(
      materializer.materializeAsync({
        project: createProject(),
        revision: { ...createRevision(), manifest: createRuntimeScreenManifest() },
      }),
    ).rejects.toThrow("Navigator binding conflicts with generated Runtime screen 'home'.");
  });
});

/*** Create the smallest persisted Project that owns the immutable revision used in this composition test. */
function createProject(): Project {
  return {
    id: 'reader-project',
    name: 'Reader project',
    createdAt: '2026-11-25T00:00:00.000Z',
    updatedAt: '2026-11-25T00:00:00.000Z',
    manifest: { draft: null, revisions: [] },
  };
}

/*** Create a minimal published AppManifest revision accepted by every composed owner API. */
function createRevision(): ProjectManifestRevision {
  return {
    id: 'revision-1',
    savedAt: '2026-11-25T00:00:00.000Z',
    manifest: createManifest(),
  };
}

/*** Create a stack-only manifest so Navigator emits the owner-owned Expo Router entry layout. */
function createManifest(): AppManifest {
  return {
    metadata: {
      name: 'Reader',
      slug: 'reader',
      version: '1.0.0',
      category: 'books_reading',
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
          networking: { domain: 'reader.test' },
        },
      },
      apis: {},
      modules: {},
    },
    navigator: { type: 'stack', routes: [] },
    screens: {},
    settings: { localization: { defaultLocale: 'en', locales: ['en'] } },
  };
}

/*** Create a manifest whose routed screen is owned by the published Expo Runtime source generator. */
function createRuntimeScreenManifest(): AppManifest {
  return {
    ...createManifest(),
    navigator: { type: 'stack', routes: [{ name: 'home', screenId: 'home' }] },
    screens: {
      home: { id: 'home', name: 'Home', root: { id: 'home-root', type: 'Screen' } },
    },
  };
}

/*** Create and retain a temporary parent whose child is the caller-owned materialization target. */
async function createDirectoryAsync(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ankhorage-projects-expo-'));
  directories.push(directory);
  return directory;
}
