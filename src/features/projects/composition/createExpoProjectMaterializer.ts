import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';

import type { AppCategory, AppManifest } from '@ankhorage/contracts';
import type {
  NavigatorGenerationBindings,
  NavigatorRuntimePlatform,
} from '@ankhorage/contracts/navigator';
import {
  resolveExpoRuntimeGeneratedAppScaffold,
  resolveExpoRuntimeGeneratedAppSources,
} from '@ankhorage/expo-runtime/generated-app';
import { resolveExpoRuntimePlan } from '@ankhorage/expo-runtime/planning';
import { createNavigatorPlan, generateNavigator } from '@ankhorage/navigator';
import { materializeTemplateRevision } from '@ankhorage/templates';

import type { Project, ProjectManifestRevision } from '../../../types/projects.js';
import { composeGeneratedRuntimeMaterialization } from './composeGeneratedRuntimeMaterialization.js';

/*** Inputs fixed by the host before materializing one immutable Projects revision. */
export interface CreateExpoProjectMaterializerInput {
  readonly targetDirectory: string;
  readonly template: Readonly<{ category: AppCategory; slug: string }>;
  readonly navigator: Readonly<{
    readonly bindings: NavigatorGenerationBindings;
    readonly platform: NavigatorRuntimePlatform;
    readonly expoRouterVersion: string;
  }>;
}

/*** The public result of materializing one runnable, self-contained Expo project directory. */
export interface ExpoProjectMaterializationResult {
  readonly projectId: string;
  readonly revisionId: string;
  readonly targetDirectory: string;
  readonly files: readonly string[];
}

/*** A concrete Projects materializer composed solely from released owner APIs. */
export interface ExpoProjectMaterializer {
  materializeAsync(
    input: Readonly<{
      project: Project;
      revision: ProjectManifestRevision;
    }>,
  ): Promise<ExpoProjectMaterializationResult>;
}

/*** Create the public, caller-targeted Expo materializer for stored immutable project revisions. */
export function createExpoProjectMaterializer(
  input: CreateExpoProjectMaterializerInput,
): ExpoProjectMaterializer {
  return {
    materializeAsync: async ({ project, revision }) =>
      materializeExpoProjectAsync(input, project, revision),
  };
}

/*** Coordinate owner plans and Template output into one prevalidated caller-owned Expo target. */
async function materializeExpoProjectAsync(
  input: CreateExpoProjectMaterializerInput,
  project: Project,
  revision: ProjectManifestRevision,
): Promise<ExpoProjectMaterializationResult> {
  assertReleasedOwnerApis();
  const targetDirectory = await assertEmptyTargetDirectoryAsync(input.targetDirectory);
  const generatedFiles = createGeneratedFiles(revision.manifest, input.navigator);
  const stagingDirectory = await mkdtemp(`${dirname(targetDirectory)}/.ankhorage-projects-`);
  try {
    const template = await ownerApis.materializeTemplateRevision({
      cwd: stagingDirectory,
      projectSlug: revision.manifest.metadata.slug,
      template: input.template,
      manifest: revision.manifest,
    });
    const templateFiles = await readTemplateFilesAsync(template.projectPath, template.createdFiles);
    assertNoPathCollisions(
      templateFiles.map(({ relativePath }) => relativePath),
      generatedFiles.map(({ relativePath }) => relativePath),
    );
    await writeFilesAsync(targetDirectory, [...templateFiles, ...generatedFiles]);
    return createMaterializationResult(
      project,
      revision,
      targetDirectory,
      templateFiles,
      generatedFiles,
    );
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

/*** Produce every Runtime- and Navigator-owned file before Template or target filesystem writes. */
function createGeneratedFiles(
  manifest: AppManifest,
  navigatorInput: CreateExpoProjectMaterializerInput['navigator'],
): readonly MaterializedFile[] {
  const runtimePlan = ownerApis.resolveExpoRuntimePlan(manifest);
  assertNoErrors(runtimePlan.diagnostics, 'Expo Runtime');
  const runtime = ownerApis.resolveExpoRuntimeGeneratedAppSources(manifest, runtimePlan, {
    manifestModuleSpecifier: '../ankh.manifest',
    screenModuleSpecifier: '../generated/runtimeManifestScreens',
  });
  assertNoErrors(runtime.diagnostics, 'Expo Runtime');
  const scaffold = ownerApis.resolveExpoRuntimeGeneratedAppScaffold(manifest, runtimePlan);
  const packageSource = composeGeneratedRuntimeMaterialization({
    callerBindings: navigatorInput.bindings,
    packageSource:
      scaffold.files.find(({ relativePath }) => relativePath === 'package.json')?.source ?? '',
    runtimeBindings: runtime.navigatorBindings,
    runtimeDependencies: runtime.dependencies,
  });
  const navigatorPlan = ownerApis.createNavigatorPlan(manifest.navigator, {
    platform: navigatorInput.platform,
    expoRouterVersion: navigatorInput.expoRouterVersion,
  });
  const navigator = ownerApis.generateNavigator(
    navigatorPlan,
    packageSource.navigatorBindings,
    createRootNavigatorGenerationOptions(manifest),
  );
  assertNoErrors(navigator.diagnostics, 'Navigator');
  const files = [
    ...scaffold.files.map((file): MaterializedFile => ({
      relativePath: file.relativePath,
      source: file.relativePath === 'package.json' ? packageSource.packageSource : file.source,
    })),
    ...runtime.files.map((file): MaterializedFile => ({
      relativePath: file.relativePath,
      source: file.source,
    })),
    {
      relativePath: 'src/ankh.manifest.ts',
      source: `export default ${JSON.stringify(manifest, null, 2)} as const;\n`,
    },
    ...navigator.files.map((file): MaterializedFile => ({
      relativePath: file.path,
      source: file.contents,
    })),
  ];
  assertUniqueRelativePaths(files.map(({ relativePath }) => relativePath));
  return files;
}

/*** Opt into the generated Runtime provider shell and preserve each manifest's configured public start route. */
function createRootNavigatorGenerationOptions(manifest: AppManifest) {
  return {
    ...(manifest.navigator.initialRouteName === undefined ? {} : { rootRedirect: true as const }),
    rootLayoutWrapper: {
      module: '@/generated/runtimeShell',
      exportName: 'GeneratedRuntimeShell',
    },
  };
}

/*** Return the stable public materialization identity and complete sorted generated-file inventory. */
function createMaterializationResult(
  project: Project,
  revision: ProjectManifestRevision,
  targetDirectory: string,
  templateFiles: readonly MaterializedFile[],
  generatedFiles: readonly MaterializedFile[],
): ExpoProjectMaterializationResult {
  return {
    projectId: project.id,
    revisionId: revision.id,
    targetDirectory,
    files: [...templateFiles, ...generatedFiles]
      .map(({ relativePath }) => relativePath)
      .sort((left, right) => left.localeCompare(right)),
  };
}

/*** Narrow the released owner API boundary so optional peer implementations cannot leak into Projects. */
const ownerApis = {
  materializeTemplateRevision: materializeTemplateRevision as unknown as (
    request: Readonly<{
      cwd: string;
      projectSlug: string;
      template: Readonly<{ category: AppCategory; slug: string }>;
      manifest: AppManifest;
    }>,
  ) => Promise<Readonly<{ projectPath: string; createdFiles: readonly string[] }>>,
  createNavigatorPlan: createNavigatorPlan,
  generateNavigator: generateNavigator,
  resolveExpoRuntimePlan: resolveExpoRuntimePlan as unknown as (
    manifest: Pick<AppManifest, 'screens'>,
  ) => RuntimePlan,
  resolveExpoRuntimeGeneratedAppSources: resolveExpoRuntimeGeneratedAppSources as unknown as (
    manifest: AppManifest,
    plan: RuntimePlan,
    options: Readonly<{ manifestModuleSpecifier: string; screenModuleSpecifier: string }>,
  ) => RuntimeGeneratedSources,
  resolveExpoRuntimeGeneratedAppScaffold: resolveExpoRuntimeGeneratedAppScaffold as unknown as (
    manifest: Pick<AppManifest, 'metadata'>,
    plan: RuntimePlan,
  ) => Readonly<{ files: readonly Readonly<{ relativePath: string; source: string }>[] }>,
};

type RuntimePlan = Readonly<{
  diagnostics: readonly Readonly<{ severity: 'error' | 'warning'; message: string }>[];
}>;

/*** Reject unavailable owner emitters rather than reproducing their source in Projects. */
function assertReleasedOwnerApis(): void {
  if (
    typeof ownerApis.materializeTemplateRevision !== 'function' ||
    typeof ownerApis.createNavigatorPlan !== 'function' ||
    typeof ownerApis.generateNavigator !== 'function' ||
    typeof ownerApis.resolveExpoRuntimePlan !== 'function' ||
    typeof ownerApis.resolveExpoRuntimeGeneratedAppSources !== 'function' ||
    typeof ownerApis.resolveExpoRuntimeGeneratedAppScaffold !== 'function'
  ) {
    throw new Error('Required released owner materialization API is unavailable.');
  }
}

/*** Resolve one existing, empty, non-symlink target directory before writing any output. */
async function assertEmptyTargetDirectoryAsync(target: string): Promise<string> {
  const resolvedTarget = resolve(target);
  const stats = await lstat(resolvedTarget);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Materialization target must be a regular directory: ${resolvedTarget}`);
  }
  if ((await readdir(resolvedTarget)).length > 0) {
    throw new Error(`Materialization target must be empty: ${resolvedTarget}`);
  }
  return realpath(resolvedTarget);
}

/*** Reject owner diagnostics that make a generated application invalid before filesystem side effects. */
function assertNoErrors(
  diagnostics: readonly Readonly<{ severity: 'error' | 'warning'; message: string }>[],
  owner: string,
): void {
  const errors = diagnostics.filter(({ severity }) => severity === 'error');
  if (errors.length > 0) {
    throw new Error(
      `${owner} cannot materialize this revision: ${errors.map(({ message }) => message).join(' ')}`,
    );
  }
}

/*** Read exactly the files reported by Templates while keeping every path inside its staging project. */
async function readTemplateFilesAsync(
  projectPath: string,
  files: readonly string[],
): Promise<readonly MaterializedFile[]> {
  return Promise.all(
    files.map(async (relativePath) => ({
      relativePath: assertSafeRelativePath(projectPath, relativePath),
      source: await readFile(resolve(projectPath, relativePath)),
    })),
  );
}

/*** Write all materialized files with exclusive creation so no existing caller file is overwritten. */
async function writeFilesAsync(
  targetDirectory: string,
  files: readonly MaterializedFile[],
): Promise<void> {
  for (const file of files) {
    const relativePath = assertSafeRelativePath(targetDirectory, file.relativePath);
    const targetPath = resolve(targetDirectory, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.source, { flag: 'wx' });
  }
}

/*** Ensure an owner-reported project-relative path never crosses its designated directory. */
function assertSafeRelativePath(directory: string, candidate: string): string {
  const resolvedPath = resolve(directory, candidate);
  const pathRelative = relative(directory, resolvedPath);
  if (
    candidate.length === 0 ||
    pathRelative.length === 0 ||
    pathRelative === '..' ||
    pathRelative.startsWith('../') ||
    basename(resolvedPath) === '..'
  ) {
    throw new Error(`Materialized file path escapes its target directory: ${candidate}`);
  }
  return pathRelative;
}

/*** Reject duplicate paths emitted by one owner before any write can begin. */
function assertUniqueRelativePaths(paths: readonly string[]): void {
  if (new Set(paths).size !== paths.length) {
    throw new Error('An owner emitted duplicate generated file paths.');
  }
}

/*** Reject a collision across owner outputs instead of silently selecting one producer. */
function assertNoPathCollisions(
  templatePaths: readonly string[],
  generatedPaths: readonly string[],
): void {
  const templatePathSet = new Set(templatePaths);
  const collision = generatedPaths.find((path) => templatePathSet.has(path));
  if (collision !== undefined) {
    throw new Error(`Owner outputs collide at generated file path: ${collision}`);
  }
}

type MaterializedFile = Readonly<{ relativePath: string; source: string | Uint8Array }>;

type RuntimeGeneratedSources = Readonly<{
  dependencies: Readonly<Record<string, string>>;
  diagnostics: readonly Readonly<{ severity: 'error' | 'warning'; message: string }>[];
  files: readonly Readonly<{ relativePath: string; source: string }>[];
  navigatorBindings: NavigatorGenerationBindings;
}>;
