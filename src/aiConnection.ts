export type ConnectionStatus = { state: 'disconnected' | 'connecting' | 'connected' | 'error'; pageId?: string; configuration?: object; error?: string; lastAction?: string };
export type OperationHandler = (operation: string, args: Record<string, any>, active: () => boolean) => Promise<unknown>;
export function createAIConnection(handler: OperationHandler, changed: (s: ConnectionStatus) => void, currentName?: () => string) {
  let abort: AbortController | undefined;
  let session: { origin: string; pageId: string; token: string } | undefined;
  let status: ConnectionStatus = { state: 'disconnected' };
  const update = (patch: Partial<ConnectionStatus>) => { status = { ...status, ...patch }; changed(status); };
  async function request(origin: string, path: string, token: string, body?: unknown, signal?: AbortSignal) {
    const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw Error(`ai.connectionError`);
    return response.json();
  }
  async function disconnect() {
    abort?.abort(); abort = undefined;
    const old = session; session = undefined;
    status = { state: 'disconnected' }; changed(status);
    if (old) await request(old.origin, `/pages/${old.pageId}/disconnect`, old.token, {}, AbortSignal.timeout(2000)).catch(() => {});
  }
  async function connect(origin: string, name: string) {
    await disconnect();
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('ai.localOnly');
    const controller = new AbortController(); abort = controller;
    update({ state: 'connecting', error: undefined });
    try {
      const data = await request(url.origin, '/pages/connect', '', { name }, AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]));
      if (controller.signal.aborted) return;
      session = { origin: url.origin, pageId: data.pageId, token: data.token };
      update({ state: 'connected', pageId: data.pageId, configuration: data.configuration });
      const current = session;
      void (async () => {
        try {
          while (!controller.signal.aborted) {
            const label = currentName ? `?name=${encodeURIComponent(currentName())}` : '';
            const result = await request(current.origin, `/pages/${current.pageId}/requests${label}`, current.token, undefined, controller.signal);
            for (const task of result.requests) {
              const active = () => !controller.signal.aborted && session === current && Date.now() < task.expiresAt;
              if (!active()) continue;
              let output;
              try { output = { result: await handler(task.operation, task.args, active) }; }
              catch (error) { output = { error: error instanceof Error ? error.message : 'ai.operationError' }; }
              if (!controller.signal.aborted) {
                await request(current.origin, `/pages/${current.pageId}/response`, current.token, { id: task.id, ...output }, controller.signal);
                update({ lastAction: task.operation });
              }
            }
          }
        } catch { if (!controller.signal.aborted) { session = undefined; update({ state: 'error', error: 'ai.connectionError', configuration: undefined, pageId: undefined }); } }
      })();
    } catch (e) { if (!controller.signal.aborted) update({ state: 'error', error: 'ai.connectionError' }); }
  }
  return { connect, disconnect };
}
