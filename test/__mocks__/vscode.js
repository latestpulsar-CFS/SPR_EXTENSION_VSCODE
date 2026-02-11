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
    showInformationMessage: jest.fn()
  },
  workspace: {
    getConfiguration: () => ({ get: (_, d) => d })
  }
  ,
  __registered: registered
};
