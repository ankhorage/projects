import type { NavigatorGenerationBindings } from '@ankhorage/contracts/navigator';

const generatedDevelopmentDependencies = {
  '@ankhorage/ankh': '^0.13.7',
  '@ankhorage/devtools': '^2.12.2',
  typescript: '~6.0.3',
} as const;

const generatedScripts = {
  'devtools:sync': 'ankh devtools sync .',
} as const;

/*** Compose generated Runtime dependencies and bindings with caller-owned Navigator extensions. */
export function composeGeneratedRuntimeMaterialization(
  input: Readonly<{
    readonly callerBindings: NavigatorGenerationBindings;
    readonly packageSource: string;
    readonly runtimeBindings: NavigatorGenerationBindings;
    readonly runtimeDependencies: Readonly<Record<string, string>>;
  }>,
): Readonly<{ navigatorBindings: NavigatorGenerationBindings; packageSource: string }> {
  assertNoConflictingRuntimeBindings(input.callerBindings, input.runtimeBindings);
  const packageJson = JSON.parse(input.packageSource) as Readonly<{
    dependencies: Readonly<Record<string, string>>;
    devDependencies?: Readonly<Record<string, string>>;
    scripts?: Readonly<Record<string, string>>;
  }>;
  return {
    navigatorBindings: {
      guards: { ...input.callerBindings.guards, ...input.runtimeBindings.guards },
      screens: { ...input.callerBindings.screens, ...input.runtimeBindings.screens },
    },
    packageSource: `${JSON.stringify(
      {
        ...packageJson,
        dependencies: { ...packageJson.dependencies, ...input.runtimeDependencies },
        devDependencies: {
          ...packageJson.devDependencies,
          ...generatedDevelopmentDependencies,
        },
        scripts: { ...packageJson.scripts, ...generatedScripts },
      },
      null,
      2,
    )}\n`,
  };
}

/*** Reject a caller attempt to replace an immutable Runtime-owned manifest screen binding. */
function assertNoConflictingRuntimeBindings(
  callerBindings: NavigatorGenerationBindings,
  runtimeBindings: NavigatorGenerationBindings,
): void {
  for (const [screenId, runtimeBinding] of Object.entries(runtimeBindings.screens)) {
    const callerEntry = Object.entries(callerBindings.screens).find(([id]) => id === screenId);
    const callerBinding = callerEntry?.[1];
    if (
      callerBinding !== undefined &&
      (callerBinding.module !== runtimeBinding.module ||
        callerBinding.exportName !== runtimeBinding.exportName)
    ) {
      throw new Error(`Navigator binding conflicts with generated Runtime screen '${screenId}'.`);
    }
  }
}
