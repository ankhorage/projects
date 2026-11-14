import { parseAppManifest } from '@ankhorage/contracts';

import type { Project, SaveProjectManifestInput } from '../../../types/projects.js';

/*** Save a validated AppManifest as the next immutable revision after checking the draft version. */
export function saveProjectManifest(
  project: Project,
  input: SaveProjectManifestInput,
  now: Date,
): Project {
  const parsed = parseAppManifest(input.manifest);
  if (!parsed.ok) throw new Error(parsed.message);

  const currentRevisionId = project.manifest.draft?.revisionId ?? null;
  if (input.expectedRevisionId !== currentRevisionId) {
    throw new Error(
      `Project manifest revision conflict: expected '${input.expectedRevisionId}', found '${currentRevisionId}'.`,
    );
  }

  const savedAt = now.toISOString();
  const id = `revision-${project.manifest.revisions.length + 1}`;
  const manifest = structuredClone(parsed.manifest);
  const revision = { id, manifest, savedAt };
  return {
    ...project,
    updatedAt: savedAt,
    manifest: {
      draft: { revisionId: id, manifest, savedAt },
      revisions: [...project.manifest.revisions, revision],
    },
  };
}
