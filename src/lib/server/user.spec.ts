import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsert = vi.fn();
const retrieve = vi.fn();

vi.mock('./qdrant', async (orig) => ({
	...(await orig<typeof import('./qdrant')>()),
	client: async () => ({ upsert, retrieve })
}));

const { get_user, save_user, create_pw_user, set_user_fields } = await import('./user');

const env = { QDRANT_URL: 'u', QDRANT_KEY: 'k' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const point = () => upsert.mock.calls.at(-1)![1].points[0];

beforeEach(() => {
	vi.clearAllMocks();
	retrieve.mockResolvedValue([]);
});

describe('user records', () => {
	it('writes points under a qdrant-legal uuid id', async () => {
		await save_user(env, 'a@b.com', 'a');
		expect(point().id).toMatch(UUID);
	});

	it('reads back the point it wrote', async () => {
		await save_user(env, 'a@b.com', 'a');
		const written = point();
		retrieve.mockResolvedValue([{ payload: written.payload }]);
		await get_user(env, 'a@b.com');
		expect(retrieve.mock.calls[0][1].ids).toEqual([written.id]);
	});

	it('refuses to overwrite an existing account on register', async () => {
		retrieve.mockResolvedValue([{ payload: { s: 'u', n: 'a', d: 1, o: 'local', h: 'x' } }]);
		expect(await create_pw_user(env, 'a@b.com', 'password1')).toBe(false);
		expect(upsert).not.toHaveBeenCalled();
	});

	it('clears fields set to undefined instead of keeping the old value', async () => {
		retrieve.mockResolvedValue([
			{ payload: { s: 'u', n: 'a', d: 1, cg: 'tok', cgm: 'a@b.com', cgl: ['gpt-5.5'] } }
		]);
		await set_user_fields(env, 'a@b.com', {
			cg: undefined,
			cgn: undefined,
			cgm: undefined,
			cgl: undefined
		});
		expect(point().payload).toEqual({ s: 'u', n: 'a', d: 1 });
	});

	it('keeps untouched fields when one field changes', async () => {
		retrieve.mockResolvedValue([{ payload: { s: 'u', n: 'a', d: 1, h: 'hash' } }]);
		await set_user_fields(env, 'a@b.com', { cg: 'tok' });
		expect(point().payload).toEqual({ s: 'u', n: 'a', d: 1, h: 'hash', cg: 'tok' });
	});

	it('stores fields for a signed-in account that has no record yet', async () => {
		await set_user_fields(env, 'a@b.com', { cg: 'tok' });
		expect(point().payload).toMatchObject({ s: 'u', n: 'a@b.com', cg: 'tok' });
	});

	it('fails loudly when the record cannot be read', async () => {
		retrieve.mockRejectedValue(new Error('qdrant down'));
		await expect(set_user_fields(env, 'a@b.com', { cg: 'tok' })).rejects.toThrow('qdrant down');
		expect(upsert).not.toHaveBeenCalled();
	});

	it('waits for a write to apply so the next read sees it', async () => {
		await save_user(env, 'a@b.com', 'a');
		expect(upsert.mock.calls.at(-1)![1].wait).toBe(true);
	});
});
