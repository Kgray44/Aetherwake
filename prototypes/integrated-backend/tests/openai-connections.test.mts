import test from "node:test";
import type { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { get } from "node:http";
import { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import {
  OpenAIConnections,
  CHATGPT_PLAN_REGISTRATION,
  type OpenAIConnectionsOptions,
} from "../src/openai-connections.mts";
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }),
  jwk = {
    ...rsa.publicKey.export({ format: "jwk" }),
    kid: "offline-coordinator-rsa",
    alg: "RS256",
    use: "sig",
  };
const issuer = "https://auth.openai.com",
  clientId = "oaiapp_coordinator_fixture",
  eligibility = {
    kind: "local-personal-project",
    scope: "current-owner-local-installation",
    decisionRef: "owner-local-synthetic",
  } as const;
const marker = "SYNTHETIC_PRIVATE_TOKEN_MARKER";
function token(nonce: string, changes: Record<string, unknown> = {}) {
  const header = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: jwk.kid }),
    ).toString("base64url"),
    payload = Buffer.from(
      JSON.stringify({
        iss: issuer,
        aud: clientId,
        sub: "synthetic-subject",
        nonce,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        ...changes,
      }),
    ).toString("base64url");
  const input = header + "." + payload;
  return (
    input +
    "." +
    sign("RSA-SHA256", Buffer.from(input), rsa.privateKey).toString("base64url")
  );
}
function fixture() {
  const root = mkdtempSync(
      join(tmpdir(), "aerynth-openai-coordinator-synthetic-"),
    ),
    path = join(root, "canonical.sqlite"),
    kernel = WorkspaceKernel.open(path);
  const note = kernel.createNote("Canonical untouched", "Exact sentinel note.");
  let db!: DatabaseSync;
  kernel.withTransaction((same) => {
    db = same;
  });
  const key = createHash("sha256")
    .update("SYNTHETIC AES TEST STAND-IN, NOT OS STORAGE")
    .digest();
  let available = true,
    nonce = "",
    currentToken = marker,
    identityOnly = false,
    revokedStatus = 200,
    scopeChanges: Record<string, unknown> = {},
    cryptoGate: Promise<void> | null = null,
    onFinalSeal: (() => void) | undefined;
  let modelResponse: (() => Response) | undefined;
  const calls: { url: string; method: string }[] = [],
    crypto = { available: 0, seal: 0, open: 0 };
  const options: OpenAIConnectionsOptions = {
    db,
    transaction: (work) => kernel.withTransaction(work),
    localEligibility: eligibility,
    nativeHost: {
      secrets: {
        available: async () => {
          crypto.available++;
          return available;
        },
        seal: async (plain) => {
          crypto.seal++;
          if (JSON.parse(plain).registration.enabled && cryptoGate) {
            onFinalSeal?.();
            await cryptoGate;
          }
          const iv = randomBytes(12),
            cipher = createCipheriv("aes-256-gcm", key, iv);
          return Buffer.concat([
            iv,
            cipher.update(plain, "utf8"),
            cipher.final(),
            cipher.getAuthTag(),
          ]);
        },
        open: async (value) => {
          crypto.open++;
          const bytes = Buffer.from(value),
            decipher = createDecipheriv(
              "aes-256-gcm",
              key,
              bytes.subarray(0, 12),
            );
          decipher.setAuthTag(bytes.subarray(-16));
          return Buffer.concat([
            decipher.update(bytes.subarray(12, -16)),
            decipher.final(),
          ]).toString("utf8");
        },
      },
    },
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      if (url === issuer + "/.well-known/openid-configuration")
        return Response.json({
          issuer,
          authorization_endpoint: issuer + "/api/accounts/authorize",
          token_endpoint: issuer + "/api/accounts/oauth/token",
          jwks_uri: issuer + "/.well-known/jwks.json",
          id_token_signing_alg_values_supported: ["RS256"],
          revocation_endpoint: issuer + "/api/accounts/oauth/revoke",
        });
      if (url === issuer + "/.well-known/jwks.json")
        return Response.json({ keys: [jwk] });
      if (url === issuer + "/api/accounts/oauth/token") {
        const form = new URLSearchParams(String(init?.body));
        assert.equal(form.get("client_id"), clientId);
        assert.equal(form.get("resource"), "https://api.openai.com/v1");
        if (form.get("grant_type") === "refresh_token") {
          assert.equal(form.has("scope"), false);
          currentToken = marker + "_ROTATED";
        }
        return Response.json({
          access_token: currentToken,
          refresh_token: marker + "_REFRESH",
          id_token: token(nonce, scopeChanges),
          token_type: "Bearer",
          expires_in: 3600,
          scope: identityOnly
            ? "openid profile email"
            : "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
        });
      }
      if (url === issuer + "/api/accounts/oauth/revoke")
        return new Response(null, { status: revokedStatus });
      if (url === "https://api.openai.com/v1/models") {
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer " + currentToken,
        );
        if (modelResponse) return modelResponse();
        return Response.json({
          models: [
            {
              slug: "fixture-model",
              display_name: "Fixture model",
              visibility: "list",
            },
            { slug: "hidden", display_name: "Hidden", visibility: "hide" },
          ],
        });
      }
      throw Error("unexpected synthetic network request");
    },
  };
  let coordinator = new OpenAIConnections(options);
  const callback = async (start: { authorizationUrl: string }) => {
    const authorization = new URL(start.authorizationUrl);
    nonce = authorization.searchParams.get("nonce")!;
    const url =
      authorization.searchParams.get("redirect_uri")! +
      "?" +
      new URLSearchParams({
        state: authorization.searchParams.get("state")!,
        code: "synthetic-code",
        client_id: clientId,
      });
    await new Promise<void>((resolve, reject) => {
      get(url, (response) => {
        response.resume();
        response.once("end", () => resolve());
      }).on("error", reject);
    });
  };
  const connect = async () => {
    const start = await coordinator.begin();
    const finishing = coordinator.finish(start.attemptId);
    await callback(start);
    return { status: await finishing, start };
  };
  return {
    root,
    path,
    db,
    kernel,
    note,
    options,
    calls,
    crypto,
    get coordinator() {
      return coordinator;
    },
    callback,
    connect,
    setAvailable: (value: boolean) => {
      available = value;
    },
    setModelResponse: (value: () => Response) => {
      modelResponse = value;
    },
    setIdentityOnly: () => {
      identityOnly = true;
    },
    setRevokedStatus: (value: number) => {
      revokedStatus = value;
    },
    setClaims: (value: Record<string, unknown>) => {
      scopeChanges = value;
    },
    gateFinalSeal: (ready: () => void) => {
      onFinalSeal = ready;
      let release!: () => void;
      cryptoGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    async reopen() {
      await coordinator.close();
      coordinator = new OpenAIConnections(options);
    },
    async close() {
      await coordinator.close();
      assert.equal(
        kernel.getResource(note.id).resource.title,
        "Canonical untouched",
      );
      assert.equal(
        kernel.getResource(note.id).note.content,
        "Exact sentinel note.",
      );
      kernel.close();
      assert.ok(statSync(path).size < 4 * 1024 * 1024);
      const target = resolve(root);
      assert.ok(target.startsWith(resolve(tmpdir()) + sep));
      rmSync(target, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 10,
      });
    },
  };
}
const assertSafe = (value: unknown) => {
  const json = JSON.stringify(value);
  for (const secret of [
    marker,
    "authorizationUrl",
    "oaiapp_",
    "synthetic-subject",
    "refreshToken",
    "idToken",
    "clientId",
    "scope=",
    "/authorize?",
  ])
    assert.ok(!json.includes(secret), "public output leaked private field");
};

test("no-host and unavailable storage status are real, no crypto/network/schema/registration side effects", async () => {
  const f = fixture();
  try {
    const none = new OpenAIConnections({ ...f.options, nativeHost: undefined });
    assert.equal((await none.status()).state, "unavailable");
    assert.equal(f.crypto.available, 0);
    assert.equal(f.calls.length, 0);
    assert.equal(
      f.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='openai_native_auth_schema'",
        )
        .get(),
      undefined,
    );
    await none.close();
    f.setAvailable(false);
    const status = await f.coordinator.status();
    assert.equal(status.storageAvailable, false);
    assert.equal(status.state, "unavailable");
    assert.equal(f.crypto.available, 1);
    assert.equal(f.calls.length, 0);
    assert.equal(
      f.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='openai_native_auth_schema'",
        )
        .get(),
      undefined,
    );
    assertSafe(status);
  } finally {
    await f.close();
  }
});
test("canonical schema initialization/status do not imply inference, create resources or contact OpenAI", async () => {
  const f = fixture();
  try {
    const status = await f.coordinator.status();
    assert.equal(status.state, "disconnected");
    assert.equal(status.storageAvailable, true);
    assert.equal(status.registrationVersion, null);
    assert.equal(status.inferenceVerified, false);
    assert.equal(status.nativeAccountMemory, false);
    assert.equal(status.nativeAccountSync, false);
    assert.equal(f.calls.length, 0);
    assert.equal(
      f.db
        .prepare("SELECT count(*) AS n FROM openai_native_auth_registration")
        .get()!.n,
      0,
    );
    assertSafe(status);
    await assert.rejects(
      f.coordinator.status({
        type: "status",
        providerId: "chatgpt-plan-responses",
        url: "https://evil.invalid",
      } as never),
      /invalid_connection_request/,
    );
  } finally {
    await f.close();
  }
});
test("actual synthetic loopback and RSA sign-in persist exact canonical registration; safe DTO and restart", async () => {
  const f = fixture();
  try {
    const { status, start } = await f.connect();
    assert.equal(status.state, "ready");
    assert.equal(status.planUsageEnabled, true);
    assert.equal(status.registrationVersion, 2);
    assertSafe(status);
    assert.ok(new URL(start.authorizationUrl).searchParams.get("state"));
    const credential = await f.coordinator.resolveCredential(2);
    assert.equal(credential.bearer, marker);
    assert.equal(credential.providerId, "chatgpt-plan-responses");
    assert.ok(!readFileSync(f.path).includes(Buffer.from(marker)));
    await f.coordinator.revalidateCredential(2, credential.boundaryDigest);
    await assert.rejects(
      f.coordinator.revalidateCredential(2, "a".repeat(64)),
      /credential_boundary_mismatch/,
    );
    await f.reopen();
    assert.deepEqual(await f.coordinator.status(), status);
    assert.equal(
      (await f.coordinator.resolveCredential(2)).boundaryDigest,
      credential.boundaryDigest,
    );
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM resources").get()!.n,
      1,
    );
  } finally {
    await f.close();
  }
});
test("identity-only and expired grants stay truthful and cannot become model inference credentials", async () => {
  const f = fixture();
  try {
    f.setIdentityOnly();
    const { status } = await f.connect();
    assert.equal(status.state, "identity-only");
    assert.equal(status.planUsageEnabled, false);
    await assert.rejects(
      f.coordinator.resolveCredential(2),
      /plan_credentials_unavailable/,
    );
    const before = f.calls.length;
    await assert.rejects(
      f.coordinator.modelCatalog(2),
      /plan_credentials_unavailable/,
    );
    assert.equal(f.calls.length, before);
    assertSafe(status);
  } finally {
    await f.close();
  }
});
test("native begin URL stays private and callback is listener-owned; cancel and stale attempt are fenced", async () => {
  const f = fixture();
  try {
    const start = await f.coordinator.begin();
    const status = await f.coordinator.status();
    assert.equal(status.pending, true);
    assertSafe(status);
    await assert.rejects(f.coordinator.begin(), /connection_busy/);
    await assert.rejects(
      f.coordinator.finish("foreign-attempt"),
      /connection_attempt_unavailable/,
    );
    const finishing = f.coordinator.finish(start.attemptId);
    const rejected = assert.rejects(finishing, /connection_cancelled/);
    const cancelled = await f.coordinator.cancel(start.attemptId);
    await rejected;
    assert.equal(cancelled.pending, false);
    assert.equal(cancelled.state, "disconnected");
    assert.equal(
      f.calls.filter((call) => call.url.endsWith("/oauth/token")).length,
      0,
    );
    await assert.rejects(
      f.coordinator.finish(start.attemptId),
      /connection_attempt_unavailable/,
    );
    assertSafe(cancelled);
  } finally {
    await f.close();
  }
});
test("cancel during real token seal prevents late token CAS and leaves only disconnected issued mapping", async () => {
  const f = fixture();
  let release!: () => void;
  try {
    let ready!: () => void;
    const sealing = new Promise<void>((resolve) => {
      ready = resolve;
    });
    release = f.gateFinalSeal(ready);
    const start = await f.coordinator.begin(),
      finishing = f.coordinator.finish(start.attemptId);
    const rejected = assert.rejects(finishing, /connection_cancelled/);
    await f.callback(start);
    await sealing;
    const cancelled = await f.coordinator.cancel(start.attemptId);
    await rejected;
    release();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(cancelled.state, "disconnected");
    assert.equal(cancelled.planUsageEnabled, false);
    assert.equal(
      f.db.prepare("SELECT version FROM openai_native_auth_registration").get()!
        .version,
      1,
    );
    assert.equal(
      f.db.prepare("SELECT owner FROM openai_native_auth_lease").get()!.owner,
      null,
    );
    assertSafe(await f.coordinator.status());
  } finally {
    release?.();
    await f.close();
  }
});
test("fresh selected-token catalog/refresh/version and disconnect revocation remain isolated", async () => {
  const f = fixture();
  try {
    await f.connect();
    const catalog = await f.coordinator.modelCatalog(2);
    assert.deepEqual(catalog.models, [
      { id: "fixture-model", label: "Fixture model" },
    ]);
    assert.equal(catalog.catalogOnly, true);
    const old = await f.coordinator.resolveCredential(2);
    const refreshed = await f.coordinator.refresh(2);
    assert.equal(refreshed.registrationVersion, 3);
    await assert.rejects(
      f.coordinator.resolveCredential(2),
      /plan_credentials_unavailable/,
    );
    await assert.rejects(
      f.coordinator.revalidateCredential(3, old.boundaryDigest),
      /credential_boundary_mismatch/,
    );
    f.setRevokedStatus(503);
    const disconnected = await f.coordinator.disconnect(3);
    assert.equal(disconnected.remoteRevocation, "unconfirmed");
    assert.equal(disconnected.status.state, "disconnected");
    assert.equal(disconnected.status.registrationVersion, 4);
    assertSafe(disconnected);
    await f.reopen();
    assert.equal((await f.coordinator.status()).state, "disconnected");
    assert.equal(
      f.calls.filter(
        (call) => call.url === "https://api.openai.com/v1/responses",
      ).length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("model discovery failure preserves ready identity and publishes only version-bound safe observations", async () => {
  const f = fixture();
  try {
    await f.connect();
    assert.equal((await f.coordinator.status()).modelCatalog, undefined);
    for (const [status, body, shape, remoteCode] of [
      [
        403,
        {
          error: {
            code: "subscription_sharing_user_not_eligible",
            message: marker,
          },
        },
        "error",
        "subscription_sharing_user_not_eligible",
      ],
      [503, { detail: marker }, "detail", null],
      [200, { data: [{ id: marker }] }, "data", null],
    ] as const) {
      f.setModelResponse(() =>
        Response.json(body, {
          status,
          headers: { "x-request-id": "req_synthetic_catalog" },
        }),
      );
      await assert.rejects(
        f.coordinator.modelCatalog(2),
        /model_catalog_unavailable|invalid_model_catalog/,
      );
      const current = await f.coordinator.status();
      assert.equal(current.state, "ready");
      assert.equal(current.planUsageEnabled, true);
      assert.equal(current.registrationVersion, 2);
      assert.equal(current.modelCatalog?.state, "unavailable");
      assert.equal(current.modelCatalog?.diagnostic.httpStatus, status);
      assert.equal(current.modelCatalog?.diagnostic.bodyShape, shape);
      assert.equal(current.modelCatalog?.diagnostic.remoteCode, remoteCode);
      assert.equal(
        current.modelCatalog?.diagnostic.serverRequestId,
        "req_synthetic_catalog",
      );
      assertSafe(current);
    }
    f.setModelResponse(() =>
      Response.json({
        models: [
          {
            slug: "fixture-model",
            display_name: "Fixture",
            visibility: "list",
          },
        ],
      }),
    );
    await f.coordinator.modelCatalog(2);
    assert.equal((await f.coordinator.status()).modelCatalog?.state, "ready");
    const refreshed = await f.coordinator.refresh(2);
    assert.equal(refreshed.state, "ready");
    assert.equal(refreshed.registrationVersion, 3);
    assert.equal(refreshed.modelCatalog, undefined);
    await f.reopen();
    assert.equal((await f.coordinator.status()).modelCatalog, undefined);
    assert.equal(
      f.calls.filter((call) => call.url.endsWith("/v1/models")).length,
      4,
    );
    assert.equal(
      f.calls.filter((call) => call.url.endsWith("/v1/responses")).length,
      0,
    );
  } finally {
    await f.close();
  }
});
test("catalog byte-limit failure is safely distinguished from authorization and raw response data", async () => {
  const f = fixture();
  try {
    await f.connect();
    f.setModelResponse(() => new Response("x".repeat(262145)));
    await assert.rejects(
      f.coordinator.modelCatalog(2),
      /response_capacity_exceeded/,
    );
    const status = await f.coordinator.status();
    assert.equal(status.state, "ready");
    assert.equal(
      status.modelCatalog?.failureCode,
      "response_capacity_exceeded",
    );
    assert.equal(status.modelCatalog?.diagnostic.httpStatus, 200);
    assertSafe(status);
  } finally {
    await f.close();
  }
});

test("future/partial schema and wrong same-db transaction fail without reset or source writes", async () => {
  const f = fixture();
  try {
    f.db.exec(
      "CREATE TABLE openai_native_auth_schema(version INTEGER); INSERT INTO openai_native_auth_schema VALUES(2)",
    );
    const before = f.db.prepare("SELECT total_changes() AS n").get()!.n;
    const status = await f.coordinator.status();
    assert.equal(status.state, "unavailable");
    assert.equal(status.errorCode, "unsupported_native_auth_schema");
    assert.equal(
      f.db.prepare("SELECT version FROM openai_native_auth_schema").get()!
        .version,
      2,
    );
    assert.equal(f.db.prepare("SELECT total_changes() AS n").get()!.n, before);
    assert.equal(f.calls.length, 0);
  } finally {
    await f.close();
  }
});
test("failed identity keeps no inference authority and all errors remain code only", async () => {
  const f = fixture();
  try {
    f.setClaims({ nonce: "wrong" });
    await assert.rejects(f.connect(), /identity_nonce_or_time_mismatch/);
    const status = await f.coordinator.status();
    assert.equal(status.state, "disconnected");
    assert.equal(status.registrationVersion, 1);
    assertSafe(status);
    assert.equal(
      f.db.prepare("SELECT owner FROM openai_native_auth_lease").get()!.owner,
      null,
    );
  } finally {
    await f.close();
  }
});
test("no-host runtime does not import jose or provider modules in an actual fresh Node process", async () => {
  const moduleUrl = new URL("../src/openai-connections.mts", import.meta.url)
    .href;
  const script = `import {registerHooks} from 'node:module';import{DatabaseSync}from'node:sqlite';registerHooks({resolve(s,c,n){if(s==='jose'||s.includes('/openai-provider/'))throw Error('unexpected_provider_import');return n(s,c);}});const {OpenAIConnections}=await import(${JSON.stringify(moduleUrl)});const db=new DatabaseSync(':memory:');const c=new OpenAIConnections({db,transaction(){throw Error('unexpected_database_call')}});const s=await c.status();if(s.state!=='unavailable')throw Error('wrong_status');await c.close();db.close();process.stdout.write('NO_HOST_OK');`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "",
    errors = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    errors += String(chunk);
  });
  const timer = setTimeout(() => child.kill(), 5000);
  const exit = await new Promise<number | null>((resolve) =>
    child.once("exit", resolve),
  );
  clearTimeout(timer);
  assert.equal(exit, 0, errors);
  assert.equal(output, "NO_HOST_OK");
});
test("expired persisted session fails closed without model call or silent refresh", async () => {
  const f = fixture();
  let expired: OpenAIConnections | undefined;
  try {
    await f.connect();
    await f.coordinator.close();
    expired = new OpenAIConnections({
      ...f.options,
      now: () => Date.now() + 3600001,
    });
    const count = f.calls.length,
      status = await expired.status();
    assert.equal(status.state, "expired");
    assert.equal(status.planUsageEnabled, false);
    assert.equal(status.registrationVersion, 2);
    await assert.rejects(
      expired.resolveCredential(2),
      /plan_credentials_unavailable/,
    );
    assert.equal(f.calls.length, count);
    assertSafe(status);
  } finally {
    await expired?.close();
    await f.close();
  }
});
test("recovery status reads only scalar metadata; unauthorized repair denies, approved repair clears actual authority", async () => {
  const f = fixture();
  let repaired: OpenAIConnections | undefined;
  try {
    await f.connect();
    f.db
      .prepare("UPDATE openai_native_auth_lease SET owner=?,expires_at=0")
      .run("synthetic-dead-owner");
    const opened = f.crypto.open,
      fence = Number(
        f.db.prepare("SELECT fence FROM openai_native_auth_lease").get()!.fence,
      ),
      status = await f.coordinator.status();
    assert.equal(status.state, "recovery-required");
    assert.equal(status.registrationVersion, 2);
    assert.equal(f.crypto.open, opened);
    await assert.rejects(
      f.coordinator.resolveCredential(2),
      /auth_lock_recovery_required/,
    );
    await assert.rejects(
      f.coordinator.recover(fence, 2),
      /auth_recovery_unavailable/,
    );
    let reviews = 0;
    repaired = new OpenAIConnections({
      ...f.options,
      authorizeRecovery: async (review) => {
        reviews++;
        assert.deepEqual(review, {
          registrationId: CHATGPT_PLAN_REGISTRATION,
          expectedFence: fence,
          expectedVersion: 2,
        });
      },
    });
    const result = await repaired.recover(fence, 2);
    assert.equal(reviews, 1);
    assert.equal(result.state, "disconnected");
    assert.equal(result.registrationVersion, 3);
    assertSafe(result);
    await assert.rejects(
      repaired.resolveCredential(3),
      /plan_credentials_unavailable/,
    );
  } finally {
    await repaired?.close();
    await f.close();
  }
});
test("wrong same-db transaction is rejected before migration; listener expiry releases pending and sockets", async () => {
  const f = fixture(),
    other = WorkspaceKernel.open(":memory:");
  let wrong: OpenAIConnections | undefined,
    short: OpenAIConnections | undefined;
  try {
    wrong = new OpenAIConnections({
      ...f.options,
      transaction: (work) => other.withTransaction(work),
    });
    assert.equal(
      (await wrong.status()).errorCode,
      "native_auth_connection_mismatch",
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='openai_native_auth_schema'",
        )
        .get(),
      undefined,
    );
    short = new OpenAIConnections({ ...f.options, listenerTimeoutMs: 30 });
    const start = await short.begin();
    await new Promise((resolve) => setTimeout(resolve, 45));
    const status = await short.status();
    assert.equal(status.pending, false);
    assert.equal(status.state, "disconnected");
    await assert.rejects(
      short.finish(start.attemptId),
      /connection_attempt_unavailable/,
    );
    assert.equal(
      f.calls.filter((call) => call.url.endsWith("/oauth/token")).length,
      0,
    );
  } finally {
    await short?.close();
    await wrong?.close();
    other.close();
    await f.close();
  }
});
