import { describe, it, expect, vi, beforeEach } from 'vitest';
import { slug, search_bible, call_llm, MODEL, withRetry } from './core';

vi.mock('ai', () => ({
	generateText: vi.fn(),
	streamText: vi.fn()
}));
vi.mock('@ai-sdk/openai', () => ({
	createOpenAI: vi.fn(() => vi.fn(() => 'openrouter-model'))
}));
vi.mock('@ai-sdk/google', () => ({
	createGoogleGenerativeAI: vi.fn(() => vi.fn(() => 'gemini-model'))
}));

const { generateText, streamText } = vi.mocked(await import('ai'));

beforeEach(() => vi.clearAllMocks());

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
	it('returns text and usage from generateText', async () => {
		generateText.mockResolvedValue({
			text: 'hello',
			toolCalls: [],
			usage: { inputTokens: 10, outputTokens: 20, inputTokenDetails: {} },
			finishReason: 'stop',
			response: { messages: [] }
		});
		const r = await call_llm('k', [{ role: 'user', content: 'q' }]);
		expect(r.message.content).toBe('hello');
		expect(r.usage?.prompt_tokens).toBe(10);
		expect(r.usage?.completion_tokens).toBe(20);
	});

	it('maps tool calls correctly', async () => {
		generateText.mockResolvedValue({
			text: null,
			toolCalls: [
				{
					toolCallId: 'call_1',
					toolName: 'search_bible',
					input: { query: 'love', scope: 'verses' }
				}
			],
			usage: { inputTokens: 5, outputTokens: 10, inputTokenDetails: {} },
			finishReason: 'tool_calls',
			response: { messages: [] }
		});
		const r = await call_llm('k', [{ role: 'user', content: 'q' }], 'openrouter', MODEL, false);
		expect(r.message.content).toBeNull();
		expect(r.message.tool_calls).toHaveLength(1);
		expect(r.message.tool_calls![0].function.name).toBe('search_bible');
		expect(JSON.parse(r.message.tool_calls![0].function.arguments)).toEqual({
			query: 'love',
			scope: 'verses'
		});
	});

	it('only includes finish tool when forceFinish is true', async () => {
		generateText.mockResolvedValue({
			text: null,
			toolCalls: [
				{
					toolCallId: 'call_2',
					toolName: 'finish',
					input: { answer: 'The answer is 42.' }
				}
			],
			usage: { inputTokens: 5, outputTokens: 10, inputTokenDetails: {} },
			finishReason: 'tool_calls',
			response: { messages: [] }
		});
		const r = await call_llm('k', [{ role: 'user', content: 'q' }], 'openrouter', MODEL, true);
		expect(r.message.tool_calls![0].function.name).toBe('finish');
	});

	it('uses gemini provider when specified', async () => {
		generateText.mockResolvedValue({
			text: 'gemini reply',
			toolCalls: [],
			usage: { inputTokens: 3, outputTokens: 6, inputTokenDetails: {} },
			finishReason: 'stop',
			response: { messages: [] }
		});
		const r = await call_llm('gk', [{ role: 'user', content: 'q' }], 'gemini', 'gemini-2.0-flash');
		expect(r.message.content).toBe('gemini reply');
	});

	it('uses streamText for the codex provider and omits temperature', async () => {
		streamText.mockResolvedValue({
			text: Promise.resolve('codex answer'),
			toolCalls: Promise.resolve([]),
			usage: Promise.resolve({ inputTokens: 4, outputTokens: 7, inputTokenDetails: {} })
		});
		const r = await call_llm(
			'ignored',
			[
				{ role: 'system', content: 'sys' },
				{ role: 'user', content: 'q' }
			],
			'codex',
			'gpt-5.5',
			false,
			{ get_auth: async () => ({ accessToken: 'at', accountId: 'aid' }) }
		);
		expect(r.message.content).toBe('codex answer');
		expect(r.usage?.prompt_tokens).toBe(4);
		const opts = streamText.mock.calls[0][0];
		expect(opts.system).toBe('sys');
		expect(opts.temperature).toBeUndefined();
		expect(streamText).toHaveBeenCalledTimes(1);
	});

	it('passes temperature for openrouter', async () => {
		generateText.mockResolvedValue({
			text: 'hi',
			toolCalls: [],
			usage: { inputTokens: 1, outputTokens: 1, inputTokenDetails: {} },
			finishReason: 'stop',
			response: { messages: [] }
		});
		await call_llm('k', [{ role: 'user', content: 'q' }]);
		expect(generateText.mock.calls[0][0].temperature).toBe(0.6);
	});

	it('converts tool messages to the v7 parts format', async () => {
		generateText.mockResolvedValue({
			text: 'done',
			toolCalls: [],
			usage: { inputTokens: 1, outputTokens: 1, inputTokenDetails: {} },
			finishReason: 'stop',
			response: { messages: [] }
		});
		await call_llm('k', [
			{ role: 'user', content: 'q' },
			{
				role: 'assistant',
				content: null,
				tool_calls: [
					{
						id: 'call_1',
						type: 'function',
						function: { name: 'search_bible', arguments: '{"query":"love"}' }
					}
				]
			},
			{ role: 'tool', tool_call_id: 'call_1', content: '{"r":[]}' }
		]);
		const opts = generateText.mock.calls[0][0] as Record<string, unknown>;
		const msgs = opts['messages'] as Record<string, unknown>[];
		expect(msgs[1]).toEqual({
			role: 'assistant',
			content: [
				{
					type: 'tool-call',
					toolCallId: 'call_1',
					toolName: 'search_bible',
					input: { query: 'love' }
				}
			]
		});
		expect(msgs[2]).toEqual({
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: 'call_1',
					toolName: 'search_bible',
					output: { type: 'text', value: '{"r":[]}' }
				}
			]
		});
	});
});

describe('withRetry', () => {
	it('gives up immediately on quota errors', async () => {
		const onError = vi.fn();
		const r = await withRetry(
			async () => {
				throw new Error('You exceeded your current quota, please check your plan');
			},
			9,
			onError,
			1,
			'llm'
		);
		expect(r).toBeUndefined();
		expect(onError).toHaveBeenCalledTimes(1);
	});

	it('retries non-quota errors up to success', async () => {
		const onError = vi.fn();
		let calls = 0;
		const r = await withRetry(
			async () => {
				calls++;
				if (calls < 3) throw new Error('boom');
				return 'ok';
			},
			9,
			onError,
			1,
			'llm'
		);
		expect(r).toBe('ok');
		expect(onError).toHaveBeenCalledTimes(2);
		expect(calls).toBe(3);
	});
});
