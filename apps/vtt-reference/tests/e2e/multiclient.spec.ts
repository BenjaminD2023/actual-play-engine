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

  const opPage = await operator.newPage();
  await login(opPage, 'dm', 'dm');
  await opPage.goto('/operator');
  await expect(opPage.getByTestId('view-title')).toHaveText('Mobile operator');
  await expect(opPage.getByRole('button', { name: 'next turn' })).toBeVisible();

  await dmPage.screenshot({ path: path.join(shotDir, 'desktop-director.png') });
  await p1Page.screenshot({ path: path.join(shotDir, 'desktop-player.png') });
  await bcPage.screenshot({ path: path.join(shotDir, 'broadcast-1080.png'), fullPage: false });
  await opPage.screenshot({ path: path.join(shotDir, 'operator-mobile.png') });

  await dm.close();
  await p1.close();
  await p2.close();
  await aud.close();
  await broadcast.close();
  await projector.close();
  await operator.close();
});
