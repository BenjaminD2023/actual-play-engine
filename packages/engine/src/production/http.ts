import { validateProject } from './spec.js';
import { ProductionError } from './errors.js';
import type { ActualPlayEngine } from '../engine.js';
import { ProtocolError, type ViewerKind } from '@actualplay/protocol';
import type { HttpUser as PublicUser } from '../http/auth.js';
import { requireUser } from '../http/auth.js';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function normalizeHost(host: string): string {
  return host.replace(/^localhost\b/i, '127.0.0.1');
}

function assertSameOrigin(request: Request): void {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host') ?? new URL(request.url).host;
  const expected = normalizeHost(host);
  if (origin) {
    if (normalizeHost(new URL(origin).host) !== expected) {
      throw new ProtocolError('forbidden', 'Cross-origin request blocked.');
    }
    return;
  }
  if (referer && normalizeHost(new URL(referer).host) !== expected) {
    throw new ProtocolError('forbidden', 'Cross-origin request blocked.');
  }
}

function viewerFor(user: PublicUser | null, fallback: ViewerKind): ViewerKind {
  if (!user) return fallback;
  if (user.role === 'admin' || user.role === 'dm' || user.role === 'player' || user.role === 'audience') return user.role;
  return fallback;
}

async function readPackBuffer(request: Request): Promise<Buffer> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('pack') ?? form.get('file');
    if (file instanceof Blob) return Buffer.from(await file.arrayBuffer());
    throw new ProtocolError('invalid_request', 'Multipart body must include a pack file.');
  }
  if (contentType.includes('application/json')) {
    const body = (await request.json()) as { zipBase64?: string; pack?: string; data?: string };
    const raw = body.zipBase64 ?? body.pack ?? body.data;
    if (!raw) throw new ProtocolError('invalid_request', 'JSON body must include pack data.');
    return Buffer.from(raw, 'base64');
  }
  const bytes = Buffer.from(await request.arrayBuffer());
  if (!bytes.length) throw new ProtocolError('invalid_request', 'Empty pack body.');
  return bytes;
}

function runStatus(run: { steps?: Array<{ status?: string }> }): number {
  const steps = run.steps ?? [];
  if (steps.some((step) => step.status === 'failed')) return 502;
  if (steps.some((step) => step.status === 'unconfirmed')) return 202;
  return 200;
}

function assertCanExecute(user: PublicUser, dmUserIds: string[]): void {
  if (user.role === 'player' || user.role === 'audience') {
    throw new ProtocolError('forbidden', 'Players cannot execute production actions.');
  }
  if (user.role === 'admin' || user.role === 'dm') return;
  if (dmUserIds.includes(user.id)) return;
  throw new ProtocolError('forbidden', 'Not allowed to execute this deployment.');
}

export async function handleProductionRequest(
  engine: ActualPlayEngine,
  request: Request,
  rest: string[],
  user: PublicUser | null
): Promise<Response> {
  const method = request.method.toUpperCase();
  const [head, ...tail] = rest;

  try {
    assertSameOrigin(request);
    if (!engine.production.enabled) {
      throw new ProtocolError('unavailable', 'Production is disabled on this engine.');
    }
    const actor = engine.vtt.actorFrom({
      userId: user?.id ?? null,
      role: user?.role ?? 'system',
      viewer: viewerFor(user, 'api'),
    });

    if (head === 'import' && method === 'POST') {
      requireUser(user, ['admin']);
      const buffer = await readPackBuffer(request);
      const report = engine.production.importPack(buffer, actor);
      const deployment = engine.production.createDeployment({ revisionId: report.revisionId }, actor);
      return json({ report, deployment });
    }

    if (head === 'import' && method === 'GET') {
      requireUser(user, ['admin']);
      const deployment = deploymentForRequest(engine, request, head ?? '');
      const revision = deployment ? engine.production.tables.getRevision(deployment.packageRevisionId) : null;
      return json({
        report: revision
          ? {
              revisionId: revision.id,
              manifest: revision.manifest,
              compatible: true,
              security: [],
              validation: validateProject(revision.project),
              requiredBindings: revision.project.cueSlots.filter((slot) => slot.required).map((slot) => slot.id),
              actorSlots: revision.project.actors.map((item) => item.id),
              warnings: validateProject(revision.project).issues.filter(issue => issue.level !== 'error'),
              errors: [],
            }
          : null,
        deployment,
      });
    }

    if (head === 'bindings' && method === 'GET') {
      requireUser(user, ['admin']);
      const deployment = deploymentForRequest(engine, request, head ?? '');
      if (!deployment) return json({ slots: [], actors: [], players: [], deploymentId: null });
      const revision = engine.production.tables.getRevision(deployment.packageRevisionId);
      const session = engine.store.getActiveSession();
      return json({
        deploymentId: deployment.id,
        slots: (revision?.project.cueSlots ?? []).map((slot) => ({
          slot,
          binding: deployment.cueBindings.find((item) => item.slotId === slot.id) ?? {
            slotId: slot.id,
            kind: 'show_cue',
            cueName: slot.suggestedCueName || slot.key,
            cueNumber: null,
            oscTemplateId: null,
            tested: false,
            lastResult: null,
            acceptedWarning: null,
          },
        })),
        actors: (revision?.project.actors ?? []).map((item) => ({
          actorId: item.id,
          name: item.name,
          bindingSlot: item.bindingSlot,
          playerId: deployment.actorBindings.find((bind) => bind.actorId === item.id)?.playerId ?? null,
          userId: deployment.actorBindings.find((bind) => bind.actorId === item.id)?.userId ?? null,
        })),
        players: session ? engine.store.listPlayers(session.id) : [],
      });
    }

    if (head === 'bindings' && tail[1] === 'test' && method === 'POST') {
      requireUser(user, ['admin']);
      const deployment = deploymentForRequest(engine, request, head ?? '');
      if (!deployment) throw new ProtocolError('not_found', 'No deployment is active.');
      const binding = await engine.production.testBinding(deployment.id, decodeURIComponent(tail[0] ?? ''), actor);
      return json({ binding });
    }

    if (head === 'bindings' && (method === 'PUT' || method === 'POST') && !tail[1]) {
      requireUser(user, ['admin']);
      const deployment = deploymentForRequest(engine, request, head ?? '');
      if (!deployment) throw new ProtocolError('not_found', 'No deployment is active.');
      const body = (await request.json()) as {
        slotId?: string;
        kind?: string;
        cueName?: string | null;
        cueNumber?: string | null;
        oscTemplateId?: string | null;
        binding?: Record<string, unknown>;
      };
      const slotId = String(body.slotId ?? tail[0] ?? '');
      const existing = deployment.cueBindings.find((item) => item.slotId === slotId);
      const next = {
        slotId,
        kind: (body.kind as 'show_cue' | undefined) ?? existing?.kind ?? 'show_cue',
        cueName: 'cueName' in body ? body.cueName ?? null : existing?.cueName ?? null,
        cueNumber: 'cueNumber' in body ? body.cueNumber ?? null : existing?.cueNumber ?? null,
        oscTemplateId: 'oscTemplateId' in body ? body.oscTemplateId ?? null : existing?.oscTemplateId ?? null,
        tested: false,
        lastResult: null,
        acceptedWarning: null,
      };
      const updated = engine.production.bindCue(deployment.id, next, actor);
      return json({ binding: updated.cueBindings.find((item) => item.slotId === slotId), deployment: updated });
    }

    if (head === 'actors' && method === 'PUT') {
      requireUser(user, ['admin']);
      const deployment = deploymentForRequest(engine, request, head ?? '');
      if (!deployment) throw new ProtocolError('not_found', 'No deployment is active.');
      const body = (await request.json()) as { actorId?: string; playerId?: string | null; userId?: string | null };
      const updated = engine.production.bindActor(
        deployment.id,
        { actorId: String(body.actorId), playerId: body.playerId ?? null, userId: body.userId ?? null },
        actor
      );
      return json({ deployment: updated });
    }

    if (head === 'deck' && method === 'GET') {
      requireUser(user, ['admin', 'dm']);
      const deployment = deploymentForRequest(engine, request, head ?? '');
      if (!deployment) return json({ pages: [], variables: {}, published: false, lastRun: null, deploymentId: null });
      const pages = engine.production.listControls(deployment.id, { ...actor, role: user!.role === 'admin' ? 'dm' : user!.role, viewer: 'dm' });
      const runs = engine.production.tables.listRuns(deployment.id);
      return json({
        pages,
        variables: engine.production.tables.getVariables(deployment.id),
        published: deployment.published,
        lastRun: runs.at(-1) ?? null,
        deploymentId: deployment.id,
      });
    }

    if (head === 'log' && method === 'GET') {
      requireUser(user, ['admin', 'dm']);
      const deployment = deploymentForRequest(engine, request, head ?? '');
      const runs = deployment ? engine.production.tables.listRuns(deployment.id) : [];
      return json({
        entries: runs.map((run) => ({
          at: run.startedAt,
          kind: 'run',
          message: `${run.actionId} ${run.steps.map((step) => step.status).join(',')}`,
          actionId: run.actionId,
        })),
        runs,
      });
    }

    if (head === 'runs' && method === 'GET' && !tail[0]) {
      requireUser(user, ['admin', 'dm']);
      const deployment = deploymentForRequest(engine, request, head ?? '');
      const runs = deployment ? engine.production.tables.listRuns(deployment.id) : [];
      return json({ runs, lastRun: runs.at(-1) ?? null });
    }

    if ((head === 'createDeployment' || (head === 'deployments' && tail.length === 0)) && method === 'POST') {
      requireUser(user, ['admin']);
      const body = (await request.json()) as { revisionId?: string; sessionId?: string; dmUserIds?: string[] };
      const deployment = engine.production.createDeployment(
        { revisionId: String(body.revisionId ?? ''), sessionId: body.sessionId, dmUserIds: body.dmUserIds },
        actor
      );
      return json({ deployment });
    }

    if ((head === 'bindCue' || (head === 'deployments' && tail[1] === 'bind-cue') || (head === 'deployments' && tail[1] === 'bindCue')) && method === 'POST') {
      requireUser(user, ['admin']);
      const body = (await request.json()) as {
        deploymentId?: string;
        slotId?: string;
        kind?: string;
        cueName?: string | null;
        cueNumber?: string | null;
        oscTemplateId?: string | null;
      };
      const deploymentId = String(body.deploymentId ?? tail[0] ?? '');
      const deployment = engine.production.bindCue(
        deploymentId,
        {
          slotId: String(body.slotId ?? ''),
          kind: (body.kind as 'show_cue') ?? 'show_cue',
          cueName: body.cueName ?? null,
          cueNumber: body.cueNumber ?? null,
          oscTemplateId: body.oscTemplateId ?? null,
          tested: false,
          lastResult: null,
          acceptedWarning: null,
        },
        actor
      );
      return json({ deployment });
    }

    if ((head === 'bindActor' || (head === 'deployments' && (tail[1] === 'bind-actor' || tail[1] === 'bindActor'))) && method === 'POST') {
      requireUser(user, ['admin']);
      const body = (await request.json()) as { deploymentId?: string; actorId?: string; playerId?: string | null; userId?: string | null };
      const deployment = engine.production.bindActor(
        String(body.deploymentId ?? tail[0] ?? ''),
        { actorId: String(body.actorId ?? ''), playerId: body.playerId ?? null, userId: body.userId ?? null },
        actor
      );
      return json({ deployment });
    }

    if ((head === 'preflight' || (head === 'deployments' && tail[1] === 'preflight')) && method === 'GET') {
      requireUser(user, ['admin', 'dm']);
      const deploymentId =
        (tail[0] && tail[1] === 'preflight' ? tail[0] : new URL(request.url).searchParams.get('deploymentId')) ||
        deploymentForRequest(engine, request, head ?? '')?.id ||
        '';
      return json(engine.production.preflight(deploymentId, actor));
    }

    if ((head === 'rehearse' || (head === 'deployments' && tail[1] === 'rehearse')) && method === 'POST') {
      requireUser(user, ['admin', 'dm']);
      const body = await safeJson(request);
      const deploymentId = String(body.deploymentId ?? tail[0] ?? deploymentForRequest(engine, request, head ?? '')?.id ?? '');
      const deployment = await engine.production.rehearse(deploymentId, actor);
      return json({ deployment });
    }

    if ((head === 'publishDeployment' || head === 'publish' || (head === 'deployments' && tail[1] === 'publish')) && method === 'POST') {
      requireUser(user, ['admin']);
      const body = await safeJson(request);
      const deploymentId = String(body.deploymentId ?? tail[0] ?? deploymentForRequest(engine, request, head ?? '')?.id ?? '');
      const deployment = await engine.production.publishDeployment(deploymentId, actor);
      return json({ deployment });
    }

    if ((head === 'rollbackDeployment' || head === 'rollback' || (head === 'deployments' && tail[1] === 'rollback')) && method === 'POST') {
      requireUser(user, ['admin']);
      const body = await safeJson(request);
      const deploymentId = String(body.deploymentId ?? tail[0] ?? '');
      const deployment = await engine.production.rollbackDeployment(deploymentId, actor);
      return json({ deployment });
    }

    if (
      (head === 'executeAction' || (head === 'deployments' && tail[1] === 'actions' && tail[3] !== 'retry') || (head === 'actions' && tail[1] === 'execute')) &&
      method === 'POST'
    ) {
      const actorUser = requireUser(user, ['admin', 'dm', 'player', 'audience']);
      if (actorUser.role === 'player' || actorUser.role === 'audience') {
        return json({ error: 'forbidden', message: 'Players cannot execute production actions.' }, 403);
      }
      const body = await safeJson(request);
      const deploymentId = String(
        body.deploymentId ?? (head === 'deployments' ? tail[0] : body.deploymentId) ?? deploymentForRequest(engine, request, head ?? '')?.id ?? ''
      );
      const actionId = String(body.actionId ?? (head === 'deployments' ? tail[2] : tail[0]) ?? '');
      const deployment = engine.production.getDeployment(deploymentId, actor);
      assertCanExecute(actorUser, deployment.dmUserIds);
      const run = await engine.production.executeAction(deploymentId, actionId, actor, typeof body.runId === 'string' ? body.runId : undefined);
      return json({ run }, runStatus(run));
    }

    if ((head === 'retryExternal' || (head === 'runs' && tail[1] === 'retry')) && method === 'POST') {
      const actorUser = requireUser(user, ['admin', 'dm']);
      const body = await safeJson(request);
      const runId = String(body.runId ?? tail[0] ?? '');
      const prior = engine.production.tables.getRun(runId);
      if (!prior) throw new ProtocolError('not_found', 'Action run was not found.');
      const deployment = engine.production.getDeployment(prior.deploymentId, actor);
      assertCanExecute(actorUser, deployment.dmUserIds);
      const run = await engine.production.retryExternal(runId, actor);
      return json({ run }, runStatus(run));
    }

    if ((head === 'diffRevisions' || head === 'diff' || (head === 'revisions' && tail[1] === 'diff')) && method === 'GET') {
      requireUser(user, ['admin', 'dm']);
      const params = new URL(request.url).searchParams;
      const from = String(params.get('from') ?? tail[0] ?? '');
      const to = String(params.get('to') ?? tail[2] ?? '');
      return json(engine.production.diffRevisions(from, to));
    }

    if ((head === 'getDeployment' || (head === 'deployments' && tail.length === 1)) && method === 'GET') {
      requireUser(user, ['admin', 'dm', 'player', 'audience']);
      const deploymentId = head === 'deployments' ? tail[0]! : new URL(request.url).searchParams.get('deploymentId') ?? '';
      return json({ deployment: engine.production.getDeployment(deploymentId, actor) });
    }

    if ((head === 'listControls' || (head === 'deployments' && tail[1] === 'controls')) && method === 'GET') {
      requireUser(user, ['admin', 'dm', 'player', 'audience']);
      const deploymentId =
        head === 'deployments' ? tail[0]! : new URL(request.url).searchParams.get('deploymentId') ?? '';
      return json({ pages: engine.production.listControls(deploymentId, actor) });
    }

    return json({ error: 'Not found' }, 404);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHENTICATED') {
      return json({ error: 'unauthenticated', message: 'Authentication required' }, 401);
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return json({ error: 'forbidden', message: 'Forbidden' }, 403);
    }
    if (error instanceof ProductionError) return json(error.toJSON(), error.httpStatus);
    if (error instanceof ProtocolError) return json(error.toJSON(), error.httpStatus);
    throw error;
  }
}

async function safeJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function deploymentForRequest(engine: ActualPlayEngine, request: Request, head: string) {
  const requested = new URL(request.url).searchParams.get('deploymentId');
  if (requested) return engine.production.tables.getDeployment(requested);
  if (['deck', 'actions', 'log', 'runs', 'executeAction', 'retryExternal'].includes(head)) return engine.production.currentDeployment();
  const sessionId = engine.store.getActiveSession()?.id;
  return engine.production.tables.listDeployments(sessionId).at(-1) ?? null;
}
