import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { register } from '../electron/automation.cjs';
import { callEditor } from '../mcp/bridge-client.mjs';

test('MCP keeps background jobs awake and restores idle throttling', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'clipo-awake-'));
  const handles = new Map<string, (...args: any[]) => any>();
  const listeners = new Map<string, (...args: any[]) => any>();
  const changes: boolean[] = [];
  let busy = true;
  let listOnly = false;
  const frame = { url: 'app://clipo' };
  let event: any;
  const contents = {
    mainFrame: frame, isLoadingMainFrame: () => false,
    setBackgroundThrottling: (value: boolean) => changes.push(value),
    send: (channel: string, request: any) => {
      if (channel === 'agent:request') queueMicrotask(() => listeners.get('agent:response')!(event, {
        requestId: request.requestId,
        result: listOnly ? { projects: [] } : { exporting: false, captioning: false, job: { id: 'test-job', status: busy ? 'running' : 'completed' } },
      }));
    },
  };
  event = { sender: contents, senderFrame: frame };
  const adapter = register({ app: { getPath: () => dir }, ipcMain: {
    handle: (name: string, fn: (...args: any[]) => any) => handles.set(name, fn),
    on: (name: string, fn: (...args: any[]) => any) => listeners.set(name, fn),
    removeHandler: (name: string) => handles.delete(name), removeAllListeners: (name: string) => listeners.delete(name),
  }, getWindow: () => ({ isDestroyed: () => false, webContents: contents }), isAppUrl: () => true });
  try {
    await handles.get('agent:ready')!(event);
    const options = { discoveryFile: path.join(dir, 'automation.json') };
    await callEditor('clipo_get_job', {}, options);
    assert.deepEqual(changes, [false]);
    await new Promise(resolve => setTimeout(resolve, 1650));
    assert.deepEqual(changes, [false], 'running job must stay awake between polls');
    listOnly = true;
    await callEditor('clipo_list_projects', {}, options);
    await new Promise(resolve => setTimeout(resolve, 1650));
    assert.equal(changes.at(-1), false, 'a library read must not throttle an active job');
    listOnly = false;
    busy = false;
    await callEditor('clipo_get_job', {}, options);
    assert.equal(changes.at(-1), false);
    await new Promise(resolve => setTimeout(resolve, 1650));
    assert.equal(changes.at(-1), true);
  } finally { adapter.cleanup(); await rm(dir, { recursive: true, force: true }); }
});
