import type { AppManifest } from '@ankhorage/contracts';

export type Project = Readonly<{
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  manifest: ProjectManifest;
}>;

export type CreateProjectInput = Readonly<{ name: string }>;

export type UpdateProjectInput = Readonly<{ id: string; name: string }>;

/*** Persisted draft pointer and immutable AppManifest revision history for one project. */
export type ProjectManifest = Readonly<{
  draft: ProjectManifestDraft | null;
  revisions: readonly ProjectManifestRevision[];
}>;

/*** A persisted draft always points at the immutable revision produced by its last save. */
export type ProjectManifestDraft = Readonly<{
  revisionId: string;
  manifest: AppManifest;
  savedAt: string;
}>;

/*** An immutable, project-local AppManifest snapshot. */
export type ProjectManifestRevision = Readonly<{
  id: string;
  manifest: AppManifest;
  savedAt: string;
}>;

export type SaveProjectManifestInput = Readonly<{
  id: string;
  manifest: AppManifest;
  expectedRevisionId: string | null;
}>;

export type ReloadProjectManifestInput = Readonly<{ id: string }>;

export type MaterializeProjectRevisionInput = Readonly<{
  id: string;
  revisionId: string;
}>;
