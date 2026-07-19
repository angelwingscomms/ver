import { describe, it, expect, vi, afterEach } from 'vitest';
import { slug, search_bible, call_llm, MODEL, TOOLS } from './core';

afterEach(() => vi.unstubAllGlobals());

describe('slug', () => {
	it('kebab-cases the question', () => {
		expect(slug('What is the New Covenant?')).toBe('what-is-the-new-covenant');
	});
	it('falls back for empty input', () => {
		expect(slug('???')).toBe('research');
	});
});

describe('search_bible', () => {
	it('builds verse-scope url with filters', async () => {
		const fetch_mock = vi.fn(async () => new Response(JSON.stringify({ r: [] })));
		vi.stubGlobal('fetch', fetch_mock);
		await search_bible({ query: 'light', scope: 'verses', book: 10, chapter: 3 });
		const url = String((fetch_mock.mock.calls[0] as any)[0]);
		expect(url).toContain('q=light');
		expect(url).toContain('v=');
		expect(url).toContain('b=10');
		expect(url).toContain('x=3');
	});
	it('builds chapter-scope url without filters', async () => {
		const fetch_mock = vi.fn(async () => new Response(JSON.stringify({ r: [] })));
		vi.stubGlobal('fetch', fetch_mock);
		await search_bible({ query: 'exodus from egypt', scope: 'chapters' });
		const url = String((fetch_mock.mock.calls[0] as any)[0]);
		expect(url).toContain('c=');
		expect(url).not.toContain('b=');
	});
	it('throws on http error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('boom', { status: 500 }))
		);
		await expect(search_bible({ query: 'x', scope: 'verses' })).rejects.toThrow('search 500');
	});
	it('returns a normalized {r: unknown[]} shape', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ r: [{ t: 'x' }] })))
		);
		const r = (await search_bible({ query: 'x', scope: 'verses' })) as { r: unknown[] };
		expect(Array.isArray(r.r)).toBe(true);
		expect(r.r).toHaveLength(1);
	});
});

describe('call_llm', () => {
	it('sends model and tools, returns the assistant message', async () => {
		const fetch_mock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						choices: [{ message: { role: 'assistant', content: 'hi' } }],
						usage: { prompt_tokens: 1, completion_tokens: 2 }
					})
				)
		);
		vi.stubGlobal('fetch', fetch_mock);
		const r = await call_llm('k', [{ role: 'user', content: 'q' }], false);
		expect(r.message.content).toBe('hi');
		expect(r.usage?.prompt_tokens).toBe(1);
		const body = JSON.parse((fetch_mock.mock.calls[0] as any)[1].body as string);
		expect(body.model).toBe(MODEL);
		expect(body.tool_choice).toBe('auto');
		expect(body.tools).toHaveLength(TOOLS.length);
	});
	it('forces the finish tool when force_finish is true', async () => {
		const fetch_mock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({ choices: [{ message: { role: 'assistant', content: null } }] })
				)
		);
		vi.stubGlobal('fetch', fetch_mock);
		await call_llm('k', [], true);
		const body = JSON.parse((fetch_mock.mock.calls[0] as any)[1].body as string);
		expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'finish' } });
	});
	it('throws on http error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 429 }))
		);
		await expect(call_llm('k', [], false)).rejects.toThrow('llm 429');
	});
});
