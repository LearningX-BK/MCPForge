// MCPForge — W0-J14: `locateYamlPointer` — JSON Pointer -> YAML line.
import { describe, expect, it } from 'vitest';
import { locateYamlPointer } from './yaml-location';

const YAML = `apiVersion: mcpforge/v1
kind: Tool
id: jde.ap.voucher.create
binding:
  type: function
  identity:
    carries: unverified
input:
  - name: amount
    type: number
`;

describe('locateYamlPointer', () => {
  it('locates a top-level scalar field', () => {
    expect(locateYamlPointer(YAML, '/id').line).toBe(3);
  });

  it('locates a nested field', () => {
    expect(locateYamlPointer(YAML, '/binding/type').line).toBe(5);
  });

  it('locates a doubly-nested field', () => {
    expect(locateYamlPointer(YAML, '/binding/identity/carries').line).toBe(7);
  });

  it('locates an array element field', () => {
    expect(locateYamlPointer(YAML, '/input/0/name').line).toBe(9);
  });

  it('falls back to line 1 for a pointer the document does not have', () => {
    expect(locateYamlPointer(YAML, '/nonexistent/field').line).toBe(1);
  });

  it('falls back to line 1 for the document root', () => {
    expect(locateYamlPointer(YAML, '/').line).toBe(1);
  });

  it('never throws on unparseable YAML', () => {
    expect(() => locateYamlPointer(':::not yaml:::', '/id')).not.toThrow();
    expect(locateYamlPointer(':::not yaml:::', '/id').line).toBeGreaterThanOrEqual(1);
  });
});
