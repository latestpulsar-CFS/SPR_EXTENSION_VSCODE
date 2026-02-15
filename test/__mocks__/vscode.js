const registered = {};

module.exports = {
  commands: {
    registerCommand: (id, cb) => {
      registered[id] = cb;
      return { dispose: () => {} };
    }
  },
  Uri: {
    parse: (u) => ({ scheme: String(u).split(':')[0] || '' })
  },
  env: {
    openExternal: jest.fn().mockResolvedValue(true)
  },
  window: {
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showTextDocument: jest.fn().mockResolvedValue(true)
  },
  workspace: {
    getConfiguration: () => ({ get: (_, d) => d }),
    openTextDocument: jest.fn().mockResolvedValue({ uri: { scheme: "untitled" } })
  }
  ,
  __registered: registered
};
