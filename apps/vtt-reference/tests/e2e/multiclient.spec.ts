import { expect, test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const shotDir = process.env.VTT_E2E_SHOTS ?? path.join(process.cwd(), 'test-results/views');
fs.mkdirSync(shotDir, { recursive: true });

async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 20_000 });
}

async function vttJson(page: Page, pathName: string) {
  return page.evaluate(async (pathName) => {
    const response = await fetch(`/api/actualplay${pathName}`, { credentials: 'include' });
    return { status: response.status, body: await response.json() };
  }, pathName);
}

async function vttCommand(page: Page, type: string, payload: Record<string, unknown>, sceneInstanceId?: string) {
  return page.evaluate(
    async ({ type, payload, sceneInstanceId }) => {
      const snap = await fetch('/api/actualplay/vtt/snapshot', { credentials: 'include' }).then((response) => response.json());
      const response = await fetch('/api/actualplay/vtt/commands', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          protocolVersion: 1,
          type,
          sessionId: snap.sessionId,
          sceneInstanceId: sceneInstanceId ?? snap.sceneInstanceId,
          payload,
        }),
      });
      return { status: response.status, body: await response.json() };
    },
    { type, payload, sceneInstanceId }
  );
}

test('required views render a canvas or operator controls', async ({ page }) => {
  await login(page, 'admin', 'admin');
  await page.getByTestId('prepare-live').click();
  await expect(page.getByTestId('view-status')).toContainText(/live show ready|token\.create ok|fog\.reveal ok/, {
    timeout: 20_000,
  });
  const routes: Array<[string, string]> = [
    ['/director', 'Director console'],
    ['/prepare', 'Preparation editor'],
    ['/player', 'Player view'],
    ['/audience', 'Audience view'],
    ['/broadcast', 'Broadcast 16:9'],
    ['/projector', 'Projector'],
    ['/overlay', 'Transparent overlay'],
    ['/operator', 'Mobile operator'],
    ['/replay', 'Replay'],
    ['/preflight', 'Preflight'],
    ['/rehearsal', 'Rehearsal'],
  ];
  for (const [href, title] of routes) {
    await page.goto(href);
    await expect(page.getByTestId('view-title')).toHaveText(title);
    if (href === '/preflight') {
      await expect(page.getByTestId('preflight-status')).toBeVisible();
    }
    if (href === '/replay') {
      await expect(page.getByTestId('replay-play')).toBeVisible();
      await expect(page.getByTestId('replay-readonly')).toContainText(/not mutated/i);
    }
    const shot = path.join(shotDir, `${href.slice(1) || 'home'}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    if (!['/operator', '/preflight'].includes(href)) {
      const canvas = page.locator('[data-testid="vtt-canvas"]');
      await expect(canvas).toBeVisible();
      const box = await canvas.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(200);
      expect(box?.height ?? 0).toBeGreaterThan(200);
    }
  }
});

test('multi-client ownership, hidden JSON, and read-only views', async ({ browser }: { browser: Browser }) => {
  const dm = await browser.newContext();
  const p1 = await browser.newContext();
  const p2 = await browser.newContext();
  const aud = await browser.newContext();
  const broadcast = await browser.newContext();
  const projector = await browser.newContext();
  const operator = await browser.newContext();
  const dmPage = await dm.newPage();
  await login(dmPage, 'admin', 'admin');
  await dmPage.getByTestId('prepare-live').click();
  await expect(dmPage.getByTestId('view-status')).toContainText(/live show ready|ok/, { timeout: 20_000 });
  const dmSnap = await vttJson(dmPage, '/vtt/snapshot');
  expect(JSON.stringify(dmSnap.body)).toContain('Lurker');
  const tokens = (dmSnap.body as { live?: { tokens?: Array<{ id: string; name: string }> } }).live?.tokens ?? [];
  const ranger = tokens.find((token) => token.name === 'Ranger');
  const cleric = tokens.find((token) => token.name === 'Cleric');
  expect(ranger?.id).toBeTruthy();
  expect(cleric?.id).toBeTruthy();

  const p1Page = await p1.newPage();
  await login(p1Page, 'p1', 'p1');
  await p1Page.goto('/player');
  await expect(p1Page.getByTestId('view-title')).toHaveText('Player view');
  const p1Snap = await vttJson(p1Page, '/vtt/snapshot');
  const raw = JSON.stringify(p1Snap.body);
  expect(raw).not.toContain('Lurker');
  const own = await vttCommand(p1Page, 'token.move', { tokenId: ranger!.id, x: 140, y: 140 });
  expect(own.status).toBe(200);
  const stolen = await vttCommand(p1Page, 'token.move', { tokenId: cleric!.id, x: 10, y: 10 });
  expect(stolen.status).toBe(403);
  expect(JSON.stringify(stolen.body)).toMatch(/forbidden/i);

  const p2Page = await p2.newPage();
  await login(p2Page, 'p2', 'p2');
  const p2stolen = await vttCommand(p2Page, 'token.move', { tokenId: ranger!.id, x: 5, y: 5 });
  expect(p2stolen.status).toBe(403);

  const audPage = await aud.newPage();
  await login(audPage, 'audience', 'audience');
  await audPage.goto('/audience');
  await expect(audPage.getByTestId('view-title')).toHaveText('Audience view');
  const audMove = await vttCommand(audPage, 'token.move', { tokenId: ranger!.id, x: 8, y: 8 });
  expect(audMove.status).toBe(403);

  const bcPage = await broadcast.newPage();
  await login(bcPage, 'audience', 'audience');
  await bcPage.goto('/broadcast');
  await expect(bcPage.getByTestId('view-title')).toHaveText('Broadcast 16:9');
  await expect(bcPage.getByTestId('prepare-live')).toHaveCount(0);
  await expect(bcPage.getByTestId('broadcast-overlay')).toBeVisible();
  const bcSnap = await vttJson(bcPage, '/vtt/snapshot');
  expect(JSON.stringify(bcSnap.body)).not.toContain('Lurker');

  const projPage = await projector.newPage();
  await login(projPage, 'audience', 'audience');
  await projPage.goto('/projector');
  await expect(projPage.getByTestId('view-title')).toHaveText('Projector');
  const projSnap = await vttJson(projPage, '/vtt/snapshot');
  expect(JSON.stringify(projSnap.body)).not.toContain('Lurker');

  const opPage = await operator.newPage();
  await login(opPage, 'dm', 'dm');
  await opPage.goto('/operator');
  await expect(opPage.getByTestId('view-title')).toHaveText('Mobile operator');
  await expect(opPage.getByRole('button', { name: 'next turn' })).toBeVisible();

  await dmPage.screenshot({ path: path.join(shotDir, 'desktop-director.png') });
  await p1Page.screenshot({ path: path.join(shotDir, 'desktop-player.png') });
  await bcPage.screenshot({ path: path.join(shotDir, 'broadcast-1080.png'), fullPage: false });
  await opPage.screenshot({ path: path.join(shotDir, 'operator-mobile.png') });

  const afterSeq = ((await vttJson(dmPage, '/vtt/snapshot')).body as { lastEventSequence?: number }).lastEventSequence ?? 0;
  const fog = await vttCommand(dmPage, 'fog.reveal', { shape: 'rect', points: [{ x: 0, y: 0 }, { x: 80, y: 80 }] });
  expect(fog.status).toBe(200);
  const liveSnap = await vttJson(dmPage, '/vtt/snapshot');
  const doorId = ((liveSnap.body as { live?: { doors?: Array<{ id: string }> } }).live?.doors ?? [])[0]?.id;
  expect(doorId).toBeTruthy();
  const doorState = await vttCommand(dmPage, 'door.setState', { doorId, state: 'open' });
  expect(doorState.status).toBe(200);

  await p1Page.getByRole('button', { name: '-1' }).first().click();
  const hpAfter = await p1Page.evaluate(async () => {
    const response = await fetch('/api/actualplay/players', { credentials: 'include' });
    return response.json();
  });
  expect(JSON.stringify(hpAfter)).toMatch(/Ranger|current_hp/);

  const opened = await vttCommand(dmPage, 'poll.open', { question: 'What now?', options: ['Fight', 'Talk'] });
  expect(opened.status).toBe(200);
  await audPage.reload();
  await expect(audPage.getByTestId('vote-Fight')).toBeVisible({ timeout: 10_000 });
  await audPage.getByTestId('vote-Fight').click();
  await bcPage.reload();
  await expect(bcPage.getByTestId('broadcast-polls')).toBeVisible();

  await opPage.getByRole('button', { name: 'advance rundown' }).click();
  await opPage.getByRole('button', { name: 'next turn' }).click();
  await opPage.getByRole('button', { name: 'marker' }).click();

  const p1Gone = await p1.newPage();
  await p1Gone.close();
  const moved = await vttCommand(dmPage, 'token.move', { tokenId: ranger!.id, x: 160, y: 160 });
  expect(moved.status).toBe(200);
  const p1b = await p1.newPage();
  await login(p1b, 'p1', 'p1');
  const gap = await vttJson(p1b, `/vtt/events?after=${afterSeq}`);
  expect(((gap.body as { events?: unknown[] }).events ?? []).length).toBeGreaterThan(0);

  const midi = await dmPage.evaluate(async () => {
    const response = await fetch('/api/actualplay/midi/relay', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actionType: 'recording_marker', actionData: { label: 'e2e-midi' } }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(midi.status).toBe(200);

  const button = await dmPage.evaluate(async () => {
    const created = await fetch('/api/actualplay/buttons', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'E2E', action_type: 'recording_marker', action_data: { label: 'e2e-btn' } }),
    }).then((response) => response.json());
    const pressed = await fetch(`/api/actualplay/buttons/${created.button.id}/press`, {
      method: 'POST',
      credentials: 'include',
    });
    return { status: pressed.status };
  });
  expect(button.status).toBe(200);

  await dmPage.goto('/replay');
  await expect(dmPage.getByTestId('replay-readonly')).toContainText(/not mutated/i);
  await expect(dmPage.getByTestId('replay-play')).toBeVisible();
  await dmPage.goto('/preflight');
  await expect(dmPage.getByTestId('preflight-status')).toBeVisible();

  await bcPage.setViewportSize({ width: 1920, height: 1080 });
  await bcPage.goto('/broadcast');
  await expect(bcPage.getByTestId('broadcast-overlay')).toBeVisible();
  await bcPage.screenshot({ path: path.join(shotDir, 'broadcast-1920.png') });

  await p1Page.setViewportSize({ width: 768, height: 1024 });
  await p1Page.goto('/player');
  await expect(p1Page.getByTestId('view-title')).toHaveText('Player view');
  await p1Page.screenshot({ path: path.join(shotDir, 'player-tablet.png'), fullPage: false });
  await p1Page.setViewportSize({ width: 390, height: 844 });
  await p1Page.goto('/player');
  await p1Page.screenshot({ path: path.join(shotDir, 'player-phone.png'), fullPage: false });

  await audPage.setViewportSize({ width: 390, height: 844 });
  await audPage.goto('/audience');
  await expect(audPage.getByTestId('view-title')).toHaveText('Audience view');
  await audPage.screenshot({ path: path.join(shotDir, 'audience-phone.png'), fullPage: false });

  await projPage.setViewportSize({ width: 1920, height: 1080 });
  await projPage.goto('/projector');
  await projPage.screenshot({ path: path.join(shotDir, 'projector-1920.png'), fullPage: false });

  await audPage.setViewportSize({ width: 1920, height: 1080 });
  await audPage.goto('/overlay');
  await expect(audPage.getByTestId('view-title')).toHaveText('Transparent overlay');
  const overlaySnap = await vttJson(audPage, '/vtt/snapshot');
  expect(JSON.stringify(overlaySnap.body)).not.toContain('Lurker');
  await audPage.screenshot({ path: path.join(shotDir, 'overlay-1920.png'), fullPage: false });

  await opPage.setViewportSize({ width: 390, height: 844 });
  await opPage.goto('/operator');
  await expect(opPage.getByTestId('view-title')).toHaveText('Mobile operator');
  await opPage.screenshot({ path: path.join(shotDir, 'operator-phone.png'), fullPage: false });

  await dm.close();
  await p1.close();
  await p2.close();
  await aud.close();
  await broadcast.close();
  await projector.close();
  await operator.close();
});
