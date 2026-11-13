import { describe, expect, it } from 'vitest';
import support from '../../docs/support.json' with { type: 'json' };

describe('support matrix', () => {
  it('identifies the WebGL1 prototype profile', () => {
    expect(support.profile).toBe('webgl1-prototype');
    expect(Array.isArray(support.entries)).toBe(true);
  });
});
