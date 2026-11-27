import { composeAuthorizedApiRuntime } from '@ankhorage/api';
import { createFastifyApiServer } from '@ankhorage/api-fastify';
import type { InternalRestApiDefinition } from '@ankhorage/contracts/data';
import type { SecretStoreAdapter } from '@ankhorage/secrets/port';
import { describe, expect, test } from 'bun:test';

import { createTrustedZefixHost } from '../src/index.js';

describe('createTrustedZefixHost', () => {
  test('denies before Vault or transport access', async () => {
    const calls = { secret: 0, fetch: 0 };
    const host = createTrustedZefixHost({
      ...createHostInput(calls),
      authenticateCallerAsync: async () => undefined,
    });
    const response = await composeAuthorizedApiRuntime(host.composition).dispatchAsync(
      searchRequest(),
    );

    expect(response.status).toBe(403);
    expect(calls).toEqual({ secret: 0, fetch: 0 });
  });

  test('uses immutable scope, keeps Basic credentials server-side, and returns only company', async () => {
    const calls = { secret: 0, fetch: 0 };
    const host = createTrustedZefixHost(createHostInput(calls));
    const response = await composeAuthorizedApiRuntime(host.composition).dispatchAsync(
      searchRequest(),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ uid: 'CHE-123.456.789', name: 'Acme' }]);
    expect(calls).toEqual({ secret: 1, fetch: 1 });
  });

  test('denies a caller outside the immutable project and environment before side effects', async () => {
    const calls = { secret: 0, fetch: 0 };
    const host = createTrustedZefixHost({
      ...createHostInput(calls),
      authorizeCallerAsync: async () => false,
    });
    const response = await composeAuthorizedApiRuntime(host.composition).dispatchAsync(
      searchRequest(),
    );

    expect(response.status).toBe(403);
    expect(calls).toEqual({ secret: 0, fetch: 0 });
  });

  test('redacts Vault and transport failures without returning a result payload', async () => {
    const calls = { secret: 0, fetch: 0 };
    const host = createTrustedZefixHost({
      ...createHostInput(calls),
      secretStore: {
        ...createSecretStore(calls),
        resolve: async () => ({
          ok: false as const,
          error: { code: 'provider_error' as const, message: 'password=not-for-client' },
        }),
      },
    });
    const response = await composeAuthorizedApiRuntime(host.composition).dispatchAsync(
      searchRequest(),
    );

    expect(response).toEqual({
      status: 502,
      headers: {},
      body: { error: { code: 'zefix_unavailable' } },
    });
    expect(JSON.stringify(response)).not.toContain('password');
    expect(calls.fetch).toBe(0);
  });

  test('executes only the separately declared UID operation through its matching capability', async () => {
    const calls = { secret: 0, fetch: 0 };
    const host = createTrustedZefixHost({
      ...createHostInput(calls),
      definition: createUidDefinition(),
      operations: { 'zefix.uid': 'company.get-by-uid' },
    });
    const response = await composeAuthorizedApiRuntime(host.composition).dispatchAsync({
      operationId: 'zefix.uid',
      method: 'GET',
      params: { id: 'CHE-123.456.789' },
      query: {},
      headers: {},
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ uid: 'CHE-123.456.789', name: 'Acme' }]);
  });

  test('redacts malformed and transport responses without exposing provider details', async () => {
    const calls = { secret: 0, fetch: 0 };
    const host = createTrustedZefixHost({
      ...createHostInput(calls),
      fetch: async () => {
        calls.fetch += 1;
        throw new Error('Basic user:password must never escape');
      },
    });
    const response = await composeAuthorizedApiRuntime(host.composition).dispatchAsync(
      searchRequest(),
    );

    expect(response).toEqual({
      status: 502,
      headers: {},
      body: { error: { code: 'zefix_unavailable' } },
    });
    expect(JSON.stringify(response)).not.toContain('password');
  });

  test('redacts a malformed successful provider payload without returning a result slot', async () => {
    const calls = { secret: 0, fetch: 0 };
    const host = createTrustedZefixHost({
      ...createHostInput(calls),
      fetch: async () => {
        calls.fetch += 1;
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          text: async () => '[{"uid":42,"wire":"must-not-cross-host"}]',
        };
      },
    });
    const response = await composeAuthorizedApiRuntime(host.composition).dispatchAsync(
      searchRequest(),
    );

    expect(response).toEqual({
      status: 502,
      headers: {},
      body: { error: { code: 'zefix_unavailable' } },
    });
    expect(JSON.stringify(response)).not.toContain('wire');
    expect(calls.fetch).toBe(1);
  });

  test('rejects a mismatched declaration before registering a host handler', () => {
    const calls = { secret: 0, fetch: 0 };
    const definition = createDefinition();
    const host = createTrustedZefixHost({
      ...createHostInput(calls),
      definition: {
        ...definition,
        handlers: {
          'zefix.search': { operationId: 'zefix.search', capability: 'projects.zefix.get-by-uid' },
        },
      },
    });

    expect(() => composeAuthorizedApiRuntime(host.composition)).toThrow(
      'No approved handler is registered for API operation zefix.search.',
    );
    expect(calls).toEqual({ secret: 0, fetch: 0 });
  });

  test('rejects swapped canonical HTTP methods before Vault or transport access', () => {
    const calls = { secret: 0, fetch: 0 };
    const search = createTrustedZefixHost({
      ...createHostInput(calls),
      definition: createDefinitionWithMethod('GET'),
    });
    const uid = createTrustedZefixHost({
      ...createHostInput(calls),
      definition: createUidDefinitionWithMethod('POST'),
      operations: { 'zefix.uid': 'company.get-by-uid' },
    });

    expect(() => composeAuthorizedApiRuntime(search.composition)).toThrow(
      'No approved handler is registered for API operation zefix.search.',
    );
    expect(() => composeAuthorizedApiRuntime(uid.composition)).toThrow(
      'No approved handler is registered for API operation zefix.uid.',
    );
    expect(calls).toEqual({ secret: 0, fetch: 0 });
  });

  test('redacts malformed Vault credential payloads before transport execution', async () => {
    const calls = { secret: 0, fetch: 0 };
    const host = createTrustedZefixHost({
      ...createHostInput(calls),
      secretStore: {
        ...createSecretStore(calls),
        resolve: async () => ({ ok: true as const, data: { username: 'user' } }),
      },
    });
    const response = await composeAuthorizedApiRuntime(host.composition).dispatchAsync(
      searchRequest(),
    );

    expect(response).toEqual({
      status: 502,
      headers: {},
      body: { error: { code: 'zefix_unavailable' } },
    });
    expect(calls.fetch).toBe(0);
    expect(JSON.stringify(response)).not.toContain('username');
  });

  test('registers the approved host operation with Fastify without transport side effects', async () => {
    const calls = { secret: 0, fetch: 0 };
    const server = createFastifyApiServer();
    const host = createTrustedZefixHost(createHostInput(calls));
    const routes = await host.registerFastifyAsync(server);

    expect(routes).toHaveLength(1);
    expect(calls).toEqual({ secret: 0, fetch: 0 });
    await server.close();
  });
});

/*** Compose a trusted host with local fakes only; no real Vault or Zefix request is possible. */
function createHostInput(calls: { secret: number; fetch: number }) {
  return {
    appId: 'acquisition-app',
    projectId: 'project-a',
    environment: 'production',
    definition: createDefinition(),
    operations: { 'zefix.search': 'company.search' as const },
    authenticateCallerAsync: async () => ({ subject: 'user-a' }),
    authorizeCallerAsync: async (input: { projectId: string; environment: string }) =>
      input.projectId === 'project-a' && input.environment === 'production',
    secretStore: createSecretStore(calls),
    fetch: async (_url: string, init: { headers: Readonly<Record<string, string>> }) => {
      calls.fetch += 1;
      expect(init.headers.authorization).toBe(`Basic ${btoa('user:password')}`);
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        text: async () => '[{"uid":"CHE-123.456.789","name":"Acme","wire":"never-client"}]',
      };
    },
  };
}

/*** Declare exactly one internal operation and its Projects-owned host capability. */
function createDefinition(): InternalRestApiDefinition {
  return {
    id: 'acquisition-host',
    origin: 'internal',
    protocol: 'rest',
    basePath: '/internal',
    endpoints: {
      zefix: {
        id: 'zefix',
        kind: 'http',
        operations: {
          'zefix.search': { id: 'zefix.search', protocol: 'http', intent: 'read', method: 'POST' },
        },
      },
    },
    handlers: {
      'zefix.search': { operationId: 'zefix.search', capability: 'projects.zefix.search' },
    },
  };
}

/*** Declare the distinct UID lookup operation and its exact host capability. */
function createUidDefinition(): InternalRestApiDefinition {
  return {
    ...createDefinition(),
    endpoints: {
      zefix: {
        id: 'zefix',
        kind: 'http',
        operations: {
          'zefix.uid': { id: 'zefix.uid', protocol: 'http', intent: 'read', method: 'GET' },
        },
      },
    },
    handlers: {
      'zefix.uid': { operationId: 'zefix.uid', capability: 'projects.zefix.get-by-uid' },
    },
  };
}

/*** Change only the search declaration method for negative host-composition coverage. */
function createDefinitionWithMethod(method: 'GET' | 'POST'): InternalRestApiDefinition {
  return {
    ...createDefinition(),
    endpoints: {
      zefix: {
        id: 'zefix',
        kind: 'http',
        operations: {
          'zefix.search': { id: 'zefix.search', protocol: 'http', intent: 'read', method },
        },
      },
    },
  };
}

/*** Change only the UID declaration method for negative host-composition coverage. */
function createUidDefinitionWithMethod(method: 'GET' | 'POST'): InternalRestApiDefinition {
  return {
    ...createUidDefinition(),
    endpoints: {
      zefix: {
        id: 'zefix',
        kind: 'http',
        operations: {
          'zefix.uid': { id: 'zefix.uid', protocol: 'http', intent: 'read', method },
        },
      },
    },
  };
}

/*** Construct one canonical internal request without client-controlled composition identities. */
function searchRequest() {
  return {
    operationId: 'zefix.search',
    method: 'POST' as const,
    params: {},
    query: {},
    headers: {},
    body: { name: 'Acme' },
  };
}

/*** Provide a fully local SecretStore adapter that records only resolve calls. */
function createSecretStore(calls: { secret: number }): SecretStoreAdapter {
  return {
    list: async () => ({ ok: true, data: [] }),
    getMetadata: async () => ({ ok: false, error: { code: 'not_found', message: 'not used' } }),
    create: async () => ({ ok: false, error: { code: 'permission_denied', message: 'not used' } }),
    replace: async () => ({ ok: false, error: { code: 'permission_denied', message: 'not used' } }),
    remove: async () => ({ ok: false, error: { code: 'permission_denied', message: 'not used' } }),
    resolve: async (input) => {
      calls.secret += 1;
      expect(input).toEqual({
        scope: { projectId: 'project-a', environment: 'production' },
        ref: 'zefix-credentials',
      });
      return { ok: true, data: { username: 'user', password: 'password' } };
    },
  };
}
