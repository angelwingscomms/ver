import { describe, it, expect } from 'vitest';
import { encrypt_chatgpt_secret, decrypt_chatgpt_secret } from './cg_crypto';

describe('cg_crypto', () => {
	it('round-trips a payload', async () => {
		const v = { accessToken: 'at', accountId: 'aid', n: 42 };
		const enc = await encrypt_chatgpt_secret('k', v);
		expect(enc).not.toContain('at');
		expect(enc).not.toContain('aid');
		expect(enc).not.toContain('42');
		expect(await decrypt_chatgpt_secret<typeof v>('k', enc)).toEqual(v);
	});

	it('fails with the wrong key', async () => {
		const enc = await encrypt_chatgpt_secret('k1', { x: 1 });
		await expect(decrypt_chatgpt_secret('k2', enc)).rejects.toThrow();
	});

	it('fails on malformed payload', async () => {
		await expect(decrypt_chatgpt_secret('k', 'nope')).rejects.toThrow();
	});
});