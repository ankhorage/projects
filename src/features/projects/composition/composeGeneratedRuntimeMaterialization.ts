import type { NavigatorGenerationBindings } from '@ankhorage/contracts/navigator';

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
