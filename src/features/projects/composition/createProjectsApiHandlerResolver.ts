import type {
  ApiApprovedHandler,
  ApiHandler,
  ApiHandlerResolutionRequest,
  ApiHandlerResolver,
  ApiRequest,
} from '@ankhorage/api';
import { isAppManifest } from '@ankhorage/contracts';
import type { DataOperationIntent, DataOperationMethod } from '@ankhorage/contracts/data';
import { isRecord } from '@ankhorage/utility/object';

import { CAPABILITIES } from '../../../capabilities/index.js';
import { projects } from '../application/projects.js';
import { deriveProjectIdentity } from '../domain/deriveProjectIdentity.js';
import type { ProjectMaterializer, ProjectRepository } from '../ports/ProjectRepository.js';

type CreateProjectsApiHandlerResolverInput = Readonly<{
  repository: ProjectRepository;
  materializer?: ProjectMaterializer;
  allowDelete?: boolean;
}>;

type ProjectsApiOperation = Readonly<{
  intent: DataOperationIntent;
  method: DataOperationMethod;
  handler: ApiHandler;
}>;

/*** Create the Projects-owned resolver for host-approved server API operations. */
export function createProjectsApiHandlerResolver(
  input: CreateProjectsApiHandlerResolverInput,
): ApiHandlerResolver {
  return (request) => resolveProjectsApiHandler(input, request);
}

/*** Resolve only canonical Projects operations declared by the host API definition. */
function resolveProjectsApiHandler(
  input: CreateProjectsApiHandlerResolverInput,
  request: ApiHandlerResolutionRequest,
): ApiApprovedHandler | undefined {
  const capability = CAPABILITIES.find(
    (candidate) => candidate.id === request.declaration.capability,
  );
  const operation = capability && createProjectsApiOperations(input)[capability.id];

  if (
    !capability ||
    !operation ||
    request.binding.operationId !== capability.id ||
    request.binding.operation.intent !== operation.intent ||
    request.binding.method !== operation.method ||
    (capability.id === 'projects.delete' && input.allowDelete !== true)
  ) {
    return undefined;
  }

  return {
    capability,
    approval: {
      operationId: request.binding.operationId,
      intent: operation.intent,
      method: operation.method,
      capabilityId: capability.id,
      owner: capability.owner,
      scope: request.context,
    },
    handler: operation.handler,
  };
}

/*** Bind each fixed Projects capability to its existing owner action. */
function createProjectsApiOperations(
  input: CreateProjectsApiHandlerResolverInput,
): Readonly<Record<string, ProjectsApiOperation>> {
  return {
    'projects.list': {
      intent: 'read',
      method: 'GET',
      handler: async (_request, context) => ({
        body: (await projects.list(input.repository)).filter(
          (project) => project.id === context.composition?.projectId,
        ),
      }),
    },
    'projects.read': createReadOperation(input.repository),
    'projects.create': createCreateOperation(input.repository),
    'projects.update': createUpdateOperation(input.repository),
    'projects.save': createSaveOperation(input.repository),
    'projects.reload': createReloadOperation(input.repository),
    'projects.revision': createRevisionOperation(input.repository),
    'projects.materialize': createMaterializeOperation(input.repository, input.materializer),
    'projects.delete': createDeleteOperation(input.repository),
  };
}

/*** Read exactly the project selected by the API composition scope. */
function createReadOperation(repository: ProjectRepository): ProjectsApiOperation {
  return {
    intent: 'read',
    method: 'GET',
    handler: async (request, context) =>
      readProjectResponse(repository, request, context.composition?.projectId),
  };
}

/*** Create only the project identity selected by the API composition scope. */
function createCreateOperation(repository: ProjectRepository): ProjectsApiOperation {
  return {
    intent: 'create',
    method: 'POST',
    handler: async (request, context) => {
      const name = readName(request.body);
      const projectId = context.composition?.projectId;
      try {
        if (!name || !projectId || deriveProjectIdentity(name) !== projectId) {
          return invalidResponse('Project creation does not match the composition scope.');
        }
        return { status: 201, body: await projects.create(repository, { name }) };
      } catch (error) {
        return projectActionFailureResponse(error);
      }
    },
  };
}

/*** Update exactly the project selected by the API composition scope. */
function createUpdateOperation(repository: ProjectRepository): ProjectsApiOperation {
  return {
    intent: 'update',
    method: 'PATCH',
    handler: async (request, context) => {
      const id = readScopedProjectId(request, context.composition?.projectId);
      const name = readName(request.body);
      if (!id || !name)
        return invalidResponse('Project update requires a scoped projectId and name.');
      try {
        return missingResponse(await projects.update(repository, { id, name }));
      } catch (error) {
        return projectActionFailureResponse(error);
      }
    },
  };
}

/*** Save a validated manifest only for the project selected by the composition scope. */
function createSaveOperation(repository: ProjectRepository): ProjectsApiOperation {
  return {
    intent: 'update',
    method: 'PUT',
    handler: async (request, context) => {
      const id = readScopedProjectId(request, context.composition?.projectId);
      const body = readManifestSaveBody(request.body);
      if (!id || !body)
        return invalidResponse('Manifest save requires a scoped projectId and valid body.');
      try {
        return missingResponse(await projects.save(repository, { id, ...body }));
      } catch (error) {
        return projectActionFailureResponse(error);
      }
    },
  };
}

/*** Reload the draft and revision history only for the scoped project. */
function createReloadOperation(repository: ProjectRepository): ProjectsApiOperation {
  return {
    intent: 'read',
    method: 'GET',
    handler: async (request, context) => {
      const id = readScopedProjectId(request, context.composition?.projectId);
      return id
        ? missingResponse(await projects.reload(repository, { id }))
        : invalidResponse('Invalid project scope.');
    },
  };
}

/*** Read one immutable revision only from the scoped project. */
function createRevisionOperation(repository: ProjectRepository): ProjectsApiOperation {
  return {
    intent: 'read',
    method: 'GET',
    handler: async (request, context) => {
      const id = readScopedProjectId(request, context.composition?.projectId);
      const { revisionId } = request.params;
      if (!id || !revisionId)
        return invalidResponse('Revision lookup requires scoped projectId and revisionId.');
      return missingResponse(await projects.revision(repository, { id, revisionId }));
    },
  };
}

/*** Delegate materialization only when the host explicitly provides its owner port. */
function createMaterializeOperation(
  repository: ProjectRepository,
  materializer: ProjectMaterializer | undefined,
): ProjectsApiOperation {
  return {
    intent: 'action',
    method: 'POST',
    handler: async (request, context) => {
      const id = readScopedProjectId(request, context.composition?.projectId);
      const { revisionId } = request.params;
      if (!id || !revisionId)
        return invalidResponse('Materialization requires scoped projectId and revisionId.');
      if (!materializer) return unavailableResponse();
      return missingResponse(
        await projects.materialize(repository, materializer, { id, revisionId }),
      );
    },
  };
}

/*** Delete only the scoped project after the host explicitly enables destructive resolution. */
function createDeleteOperation(repository: ProjectRepository): ProjectsApiOperation {
  return {
    intent: 'delete',
    method: 'DELETE',
    handler: async (request, context) => {
      const id = readScopedProjectId(request, context.composition?.projectId);
      return id
        ? missingResponse(await projects.delete(repository, id))
        : invalidResponse('Invalid project scope.');
    },
  };
}

/*** Read one project using only the resource id equal to the approved project scope. */
async function readProjectResponse(
  repository: ProjectRepository,
  request: ApiRequest,
  projectId: string | undefined,
) {
  const id = readScopedProjectId(request, projectId);
  return id
    ? missingResponse(await projects.read(repository, id))
    : invalidResponse('Invalid project scope.');
}

/*** Return a typed missing-resource response without exposing storage details. */
function missingResponse<T>(value: T | null) {
  return value === null
    ? { status: 404, body: { error: { code: 'project_not_found' } } }
    : { body: value };
}

/*** Return an invalid-request response before a repository action receives untrusted input. */
function invalidResponse(message: string) {
  return { status: 400, body: { error: { code: 'invalid_request', message } } };
}

/*** Return an explicit blocked result when no host materializer has been configured. */
function unavailableResponse() {
  return { status: 503, body: { error: { code: 'materialization_unavailable' } } };
}

/*** Translate only expected owner-domain failures while preserving unexpected storage failures. */
function projectActionFailureResponse(error: unknown) {
  if (!(error instanceof Error)) throw error;
  if (
    error.message.includes('already exists') ||
    error.message.startsWith('Project manifest revision conflict:')
  ) {
    return { status: 409, body: { error: { code: 'project_conflict' } } };
  }
  if (error.message.startsWith('A project name must')) {
    return invalidResponse(error.message);
  }
  throw error;
}

/*** Accept only a resource parameter exactly matching the API composition project scope. */
function readScopedProjectId(
  request: ApiRequest,
  projectId: string | undefined,
): string | undefined {
  const id = request.params.projectId;
  return id && id === projectId ? id : undefined;
}

/*** Read a non-empty project name from one untrusted API request body. */
function readName(value: unknown): string | undefined {
  return isRecord(value) && typeof value.name === 'string' ? value.name : undefined;
}

/*** Validate the one manifest-save body shape accepted by the Projects API handler. */
function readManifestSaveBody(value: unknown) {
  if (!isRecord(value) || !isAppManifest(value.manifest)) return undefined;
  if (value.expectedRevisionId !== null && typeof value.expectedRevisionId !== 'string')
    return undefined;
  return { manifest: value.manifest, expectedRevisionId: value.expectedRevisionId };
}
