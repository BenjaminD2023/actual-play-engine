const CUE_NUMBER_PATTERN = /^[A-Za-z0-9._-]+$/;

export function assertCueNumber(cueNumber: string): string {
  const trimmed = cueNumber.trim();
  if (!trimmed) {
    throw new Error('Cue number is required.');
  }
  if (/\s/.test(trimmed)) {
    throw new Error(`Cue number "${trimmed}" contains spaces, which OSC addresses cannot use.`);
  }
  if (!CUE_NUMBER_PATTERN.test(trimmed)) {
    throw new Error(`Cue number "${trimmed}" is not a valid OSC cue identifier.`);
  }
  return trimmed;
}

export function workspacePrefix(workspaceId: string | null | undefined): string {
  return workspaceId ? `/workspace/${workspaceId}` : '';
}

export function qlabAddress(workspaceId: string | null | undefined, suffix: string): string {
  const normalized = suffix.startsWith('/') ? suffix : `/${suffix}`;
  return `${workspacePrefix(workspaceId)}${normalized}`;
}

/** Map legacy `/cue/{n}/go` to official `/cue/{n}/start`. */
export function canonicalizeCueMethod(method: string): string {
  return method === 'go' ? 'start' : method;
}

export function cueAddress(
  workspaceId: string | null | undefined,
  cueNumber: string,
  method: string
): string {
  const cue = assertCueNumber(cueNumber);
  const canonical = canonicalizeCueMethod(method);
  return qlabAddress(workspaceId, `/cue/${cue}/${canonical}`);
}

export function replyAddress(requestAddress: string): string {
  return `/reply${requestAddress}`;
}

export function isReplyFor(messageAddress: string, requestAddress: string): boolean {
  const expected = replyAddress(requestAddress);
  return messageAddress === expected || messageAddress === `/reply${requestAddress}`;
}
