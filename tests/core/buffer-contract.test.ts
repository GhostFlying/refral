import { expect, test } from 'vitest';
import { runBufferCoreContract } from './buffer-contract';
import { createJsContractCore } from './js-buffer-factory';

test('JS implements the shared Buffer handle, allocation and loss contract', async () => {
  const result = await runBufferCoreContract(createJsContractCore);
  expect(result.core).toBe('js');
  expect(result.evidence.checks.filter(check => !check.passed)).toEqual([]);
});
