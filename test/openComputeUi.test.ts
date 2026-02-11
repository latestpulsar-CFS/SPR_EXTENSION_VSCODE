jest.resetModules();

import { registerCommands } from '../src/commands/register';

describe('spher.openComputeUi command', () => {
  const fakeDeps: any = {
    client: {},
    panel: { info: () => {}, updateState: () => {}, updateEvents: () => {} },
    audit: { append: async () => {} },
    baseUrl: () => 'http://127.0.0.1:7072',
    setToken: async () => {},
    clearToken: async () => {},
    computeUiUrl: () => 'codex://open-in-targets',
    amAgentConfig: () => ({ amAgentPath: 'am-agent', allowCargoFallback: true, orchestratorManifestPath: '', amAgentCwd: '' })
  };

  const ctx: any = { subscriptions: [] };

  beforeAll(() => {
    registerCommands(ctx, fakeDeps);
  });

  const getRegistered = () => require('vscode').__registered || {};

  test('shows error for unsupported scheme', async () => {
    const vscode = require('vscode');
    const registered = getRegistered();
    await registered['spher.openComputeUi']();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  test('opens allowed scheme file', async () => {
    const vscode = require('vscode');
    vscode.window.showErrorMessage.mockClear();
    fakeDeps.computeUiUrl = () => 'file:///C:/path/index.html';
    const registered = getRegistered();
    await registered['spher.openComputeUi']();
    expect(vscode.env.openExternal).toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });
});
