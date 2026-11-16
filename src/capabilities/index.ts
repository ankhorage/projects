import type { Capability } from '@ankhorage/contracts/capability';

/*** Publish the canonical descriptors for project repository operations. */
export const CAPABILITIES = [
  {
    id: 'projects.list',
    owner: '@ankhorage/projects',
    access: ['read'],
    binding: { kind: 'storage', bindableAs: ['target'] },
    label: 'List projects',
    description: 'List persisted project identities.',
  },
  {
    id: 'projects.read',
    owner: '@ankhorage/projects',
    access: ['read'],
    binding: { kind: 'storage', bindableAs: ['target'] },
    label: 'Read project',
    description: 'Read one persisted project by identity.',
  },
  {
    id: 'projects.create',
    owner: '@ankhorage/projects',
    access: ['write'],
    binding: { kind: 'storage', bindableAs: ['target'] },
    label: 'Create project',
    description: 'Create one persisted project with a canonical identity.',
  },
  {
    id: 'projects.update',
    owner: '@ankhorage/projects',
    access: ['write'],
    binding: { kind: 'storage', bindableAs: ['target'] },
    label: 'Update project',
    description: 'Update one existing persisted project.',
  },
  {
    id: 'projects.save',
    owner: '@ankhorage/projects',
    access: ['write'],
    binding: { kind: 'storage', bindableAs: ['target'] },
    label: 'Save project manifest',
    description: 'Persist a validated AppManifest draft as an immutable project revision.',
  },
  {
    id: 'projects.reload',
    owner: '@ankhorage/projects',
    access: ['read'],
    binding: { kind: 'storage', bindableAs: ['target'] },
    label: 'Reload project manifest',
    description: 'Read the persisted project manifest draft and immutable revision history.',
  },
  {
    id: 'projects.revision',
    owner: '@ankhorage/projects',
    access: ['read'],
    binding: { kind: 'storage', bindableAs: ['target'] },
    label: 'Read project manifest revision',
    description: 'Read one immutable project manifest revision by identity.',
  },
  {
    id: 'projects.materialize',
    owner: '@ankhorage/projects',
    access: ['invoke'],
    binding: { kind: 'action', bindableAs: ['target'] },
    label: 'Materialize project revision',
    description:
      'Materialize one stored immutable project revision through an injected owner generator.',
  },
  {
    id: 'projects.delete',
    owner: '@ankhorage/projects',
    access: ['write'],
    binding: { kind: 'storage', bindableAs: ['target'] },
    label: 'Delete project',
    description: 'Delete one persisted project by identity.',
  },
] as const satisfies readonly Capability[];
