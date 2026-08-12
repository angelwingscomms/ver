import { describe, it, expect, vi, beforeEach } from 'vitest';

const poll_result = { status: 'pending' as string };
const tokens = { accessToken: 'at', refreshToken: 'rt', idToken: 'it', accountId: 'acc' };

const codex_fetch = vi.fn(async () => new Response('ok'));
const refreshed = { accessToken: 'at2', refreshToken: 'rt2', accountId: 'acc' };

vi.mock('@opencoredev/loginwithchatgpt-core', () => ({
	resolveConfig: () => ({ codexBaseUrl: 'https://codex.test/backend-api/codex' }),
	createCodexFetch: vi.fn((o: { getAuth: () => Promise<unknown> }) => {
		auth_of = o.getAuth;
		return codex_fetch;
	}),
	ensureFreshTokens: vi.fn(
		async (
			_c: unknown,
			_t: unknown,
			o: { onRefresh?: (t: typeof refreshed) => Promise<void> }
		) => {
			await o?.onRefresh?.(refreshed);
			return refreshed;
		}
	),
	requestDeviceCode: vi.fn(async () => ({
		deviceAuthId: 'dev1',
		userCode: 'ABCD-EFGHI',
		verificationUrl: 'https://auth.openai.com/codex/device',
		interval: 5,
		expiresAt: Date.now() + 900000
	})),
	pollDeviceCode: vi.fn(async () => poll_result),
	exchangeDeviceAuthorization: vi.fn(async () => tokens),
	parseUser: vi.fn(() => ({ accountId: 'acc', email: 'me@openai.com', name: 'Ed' })),
	listCodexModels: vi.fn(async () => ['gpt-5.5'])
}));
vi.mock('./user', () => ({
	get_user: vi.fn(async () => null),
	save_user: vi.fn(async () => {}),
	set_user_fields: vi.fn(async () => {})
}));

let auth_of: (() => Promise<unknown>) | undefined;

const { start_chatgpt_login, poll_chatgpt_login, codex_call } = await import('./cg');
const { get_user, save_user, set_user_fields } = vi.mocked(await import('./user'));
const { decrypt_chatgpt_secret, encrypt_chatgpt_secret } = await import('./cg_crypto');

const env = { QDRANT_URL: 'u', QDRANT_KEY: 'k', LWC_KEY: 'secret' };

beforeEach(() => {
	vi.clearAllMocks();
	poll_result.status = 'pending';
});

describe('chatgpt device login', () => {
	it('hands back a code and an encrypted pending cookie', async () => {
		const { pending, body } = await start_chatgpt_login(env);
		expect(body.user_code).toBe('ABCD-EFGHI');
		expect(pending).not.toContain('dev1');
		expect(await decrypt_chatgpt_secret<{ i: string }>('secret', pending)).toMatchObject({
			i: 'dev1',
			c: 'ABCD-EFGHI'
		});
	});

	it('treats a missing or unreadable cookie as expired', async () => {
		expect(await poll_chatgpt_login(env, undefined)).toEqual({ status: 'expired' });
		expect(await poll_chatgpt_login(env, 'garbage')).toEqual({ status: 'expired' });
	});

	it('stays pending until the user authorizes', async () => {
		const { pending } = await start_chatgpt_login(env);
		expect(await poll_chatgpt_login(env, pending)).toEqual({ status: 'pending' });
		expect(set_user_fields).not.toHaveBeenCalled();
	});

	it('creates an account keyed by the chatgpt email when nobody is signed in', async () => {
		const { pending } = await start_chatgpt_login(env);
		poll_result.status = 'authorized';
		const r = await poll_chatgpt_login(env, pending);
		expect(r).toMatchObject({ status: 'authenticated', id: 'me@openai.com', n: 'Ed' });
		expect(save_user).toHaveBeenCalledWith(
			env,
			'me@openai.com',
			'Ed',
			undefined,
			'me@openai.com',
			'chatgpt'
		);
		const fields = set_user_fields.mock.calls[0][2];
		expect(await decrypt_chatgpt_secret('secret', fields.cg!)).toEqual(tokens);
		expect(fields.cgl).toEqual(['gpt-5.5']);
	});

	it('links tokens to the signed-in account instead of making a new one', async () => {
		const { pending } = await start_chatgpt_login(env);
		poll_result.status = 'authorized';
		const r = await poll_chatgpt_login(env, pending, 'ed@ver.app');
		expect(r).toMatchObject({ status: 'authenticated', id: 'ed@ver.app' });
		expect(save_user).not.toHaveBeenCalled();
		expect(set_user_fields.mock.calls[0][1]).toBe('ed@ver.app');
	});

	it('expires a pending code past its deadline', async () => {
		const stale = await encrypt_chatgpt_secret('secret', {
			i: 'dev1',
			c: 'ABCD-EFGHI',
			e: Date.now() - 1
		});
		expect(await poll_chatgpt_login(env, stale)).toEqual({ status: 'expired' });
	});
});

describe('codex proxy call', () => {
	it('refuses when the account has no chatgpt tokens', async () => {
		get_user.mockResolvedValue({ s: 'u', n: 'a', d: 1 });
		await expect(codex_call(env, 'a@b.com', '{}')).rejects.toThrow('no chatgpt account connected');
	});

	it('posts the body to the codex responses endpoint and stores refreshed tokens', async () => {
		get_user.mockResolvedValue({
			s: 'u',
			n: 'a',
			d: 1,
			cg: await encrypt_chatgpt_secret('secret', tokens)
		});
		const body = JSON.stringify({ model: 'gpt-5.5', input: 'hi' });
		await codex_call(env, 'a@b.com', body);
		expect(codex_fetch).toHaveBeenCalledWith(
			'https://codex.test/backend-api/codex/responses',
			expect.objectContaining({ method: 'POST', body })
		);
		expect(await auth_of!()).toEqual({ accessToken: 'at2', accountId: 'acc' });
		const stored = set_user_fields.mock.calls.at(-1)![2].cg!;
		expect(await decrypt_chatgpt_secret('secret', stored)).toEqual(refreshed);
	});
});
