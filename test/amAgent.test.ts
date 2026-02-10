import { parseJsonFromStdout } from '../src/spher/amAgent';

describe('parseJsonFromStdout', () => {
  test('parses JSON on last non-empty line', () => {
    const stdout = `info: starting\n{"result": "ok", "value": 42}\n`;
    const parsed = parseJsonFromStdout(stdout) as any;
    expect(parsed).toBeDefined();
    expect(parsed.result).toBe('ok');
    expect(parsed.value).toBe(42);
  });

  test('skips non-json trailing lines and parses last json line', () => {
    const stdout = `log: step1\n{"a":1}\nnon-json\n{"b":2}\n`;
    const parsed = parseJsonFromStdout(stdout) as any;
    expect(parsed).toBeDefined();
    expect(parsed.b).toBe(2);
  });

  test('returns undefined when no JSON present', () => {
    const stdout = `just logs\nno json here\n`;
    const parsed = parseJsonFromStdout(stdout);
    expect(parsed).toBeUndefined();
  });
});
