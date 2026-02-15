jest.resetModules();

import { registerCommands } from '../src/commands/register';

describe('command registration smoke tests', () => {
  const fakeDeps: any = {
    client: {},
    panel: { info: () => {}, updateState: () => {}, updateEvents: () => {} },
    audit: { append: async () => {}, openInEditor: jest.fn(), readRecent: jest.fn().mockResolvedValue([{ action: 'connect', ok: true }]), exportTo: async () => {} },
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

  test('shows error for unsupported compute ui scheme', async () => {
    const vscode = require('vscode');
    const registered = getRegistered();
    await registered['spher.openComputeUi']();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  test('opens allowed compute ui scheme file', async () => {
    const vscode = require('vscode');
    vscode.window.showErrorMessage.mockClear();
    fakeDeps.computeUiUrl = () => 'file:///C:/path/index.html';
    const registered = getRegistered();
    await registered['spher.openComputeUi']();
    expect(vscode.env.openExternal).toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  test('opens audit log from dedicated command', async () => {
    const registered = getRegistered();
    await registered['spher.openAuditLog']();
    expect(fakeDeps.audit.openInEditor).toHaveBeenCalled();
  });

  test('shows audit summary in json document', async () => {
    const vscode = require('vscode');
    const registered = getRegistered();
    await registered['spher.showAuditSummary']();
    expect(fakeDeps.audit.readRecent).toHaveBeenCalledWith(20);
    expect(vscode.workspace.openTextDocument).toHaveBeenCalled();
    expect(vscode.window.showTextDocument).toHaveBeenCalled();
  });
});
