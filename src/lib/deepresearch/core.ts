export const MODEL = 'deepseek/deepseek-v4-flash';
export const EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b';
export const FREE_SEARCHES = 54;
export const FREE_STEPS = FREE_SEARCHES;
export const SEARCH_URL = 'https://ver.apexlinks.org/api/search';

/** $/M tokens for embedding model input */
export const EMBEDDING_PRICE = 0.01;

export type ToolCall = {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
};
export type Msg = {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | null;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
};

export const SYSTEM_PROMPT = `You are a deep Bible research agent. Your ONLY source of truth is the search_bible tool, which performs semantic search over the complete text of the Bible (Young's Literal Translation).

First-principles rules:
- Build every claim, connection and conclusion EXCLUSIVELY from verse and chapter text returned by search_bible during this session.
- Drop everything you know or think you know about the Bible: no doctrines, commentaries, creeds, scholarly consensus or existing interpretations may serve as evidence.
- Your background knowledge may only suggest what to search next; nothing enters the answer unless retrieved text confirms it.
- Never cite a verse you have not retrieved in this session. Quote retrieved text verbatim.
- Derive meaning from patterns internal to the retrieved corpus: repeated vocabulary, structural parallels, coherence across books.
- If retrieved text is ambiguous or insufficient on a point, say so plainly instead of filling the gap.

Method:
- Research exhaustively and at length. Search many semantic angles per concept: synonyms, related motifs, imagery, both 'verses' and 'chapters' scope, book/chapter filters.
- Deliberately search for counter-evidence to your working hypotheses and resolve tensions using retrieved text only.
- Keep searching an angle until new queries stop returning new relevant passages, then pivot to another angle. Do not stop at the first plausible answer.
- Aim for dozens of searches before finishing (up to roughly 90 in total).`;

export function systemPrompt(maxSearches: number): string {
	return `You have exactly ${maxSearches} search_bible calls available for this entire research session. Budget them strategically — each call returns 10 relevant passages. Once you exhaust your searches, no further searches will be allowed and you must call finish.

${BASE_SYSTEM}`;
}

export const TOOLS = [
	{
		type: 'function',
		function: {
			name: 'search_bible',
			description:
				"Semantic search over the entire Bible (Young's Literal Translation). Returns the 10 most similar passages as {b: book, c: chapter, v: verse, t: text, s: similarity score}.",
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'Plain-language description of the meaning to search for'
					},
					scope: {
						type: 'string',
						enum: ['verses', 'chapters'],
						description: 'Search individual verses or whole chapters'
					},
					book: {
						type: 'integer',
						description:
							'Optional book filter as a number: 1=Genesis, 2=Exodus, …, 9=1 Samuel, 22=Song of Solomon, …, 66=Revelation'
					},
					chapter: {
						type: 'integer',
						description: 'Optional chapter number filter (use with book)'
					}
				},
				required: ['query', 'scope']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'finish',
			description: 'Finish the research and submit the complete final answer.',
			parameters: {
				type: 'object',
				properties: {
					answer: {
						type: 'string',
						description:
							'The complete final answer in Markdown. Cite every referenced passage as Book chapter:verse.'
					}
				},
				required: ['answer']
			}
		}
	}
];

export function slug(q: string): string {
	return (
		q
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+/g, '')
			.slice(0, 60)
			.replace(/-+$/g, '') || 'research'
	);
}

export type RetryError = {
	message: string;
	turn: number;
	attempt: number;
	timestamp: number;
	detail: string;
};

export async function withRetry<T>(
	fn: () => Promise<T>,
	maxRetries: number,
	onError: (err: RetryError) => void,
	turn: number,
	context: string
): Promise<T | undefined> {
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (e) {
			const errMsg = String(e);
			const detail = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : errMsg;
			const re: RetryError = { message: errMsg, turn, attempt, timestamp: Date.now(), detail };
			onError(re);
			console.error(`[retry ${context}] turn ${turn} attempt ${attempt}/${maxRetries} failed:`, e);
			if (attempt < maxRetries) {
				const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
				console.log(`[retry ${context}] retrying in ${delay}ms…`);
				await new Promise((r) => setTimeout(r, delay));
			} else {
				console.error(`[retry ${context}] turn ${turn} ALL ${maxRetries} RETRIES EXHAUSTED`);
				return undefined;
			}
		}
	}
	return undefined;
}

export type SearchResult = {
	r: unknown[];
	usage?: { prompt_tokens: number };
};

export async function search_bible(args: Record<string, unknown>, searchUrl?: string): Promise<SearchResult> {
	const p = new URLSearchParams();
	p.set('q', String(args.query ?? ''));
	p.set(args.scope === 'chapters' ? 'c' : 'v', '');
	if (args.book) p.set('b', String(args.book));
	if (args.chapter != null && args.chapter !== '') p.set('x', String(args.chapter));
	const res = await fetch(`${searchUrl ?? SEARCH_URL}?${p}`);
	if (!res.ok) throw new Error(`search ${res.status}: ${(await res.text()).slice(0, 300)}`);
	const j = (await res.json()) as { r?: unknown[]; usage?: { prompt_tokens: number } };
	return {
		r: Array.isArray(j.r) ? j.r : [],
		usage: j.usage
	};
}

export type Usage = {
	prompt_tokens: number;
	completion_tokens: number;
	prompt_tokens_details?: { cached_tokens?: number };
	total_cost?: number;
};

export type EmbeddingResp = {
	data: { embedding: number[] }[];
	usage?: { prompt_tokens: number; total_tokens: number };
};

export type LlmResp = { message: Msg; usage?: Usage };

export async function call_llm(
	key: string,
	messages: Msg[],
	forceFinish = false
): Promise<LlmResp> {
	const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: MODEL,
			messages,
			tools: TOOLS,
			tool_choice: forceFinish ? { type: 'function', function: { name: 'finish' } } : 'auto',
			temperature: 0.6
		})
	});
	if (!res.ok) throw new Error(`llm ${res.status}: ${(await res.text()).slice(0, 300)}`);
	const j = (await res.json()) as {
		choices: { message: Msg }[];
		usage?: Usage;
	};
	return { message: j.choices[0].message, usage: j.usage };
}

export const BASE_SYSTEM = SYSTEM_PROMPT;
