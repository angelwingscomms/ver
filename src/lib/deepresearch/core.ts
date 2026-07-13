export const MODEL = 'deepseek/deepseek-v4-flash';
export const MAX_TURNS = 100;
export const SEARCH_URL = 'https://ver.apexlinks.org/api/search';

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
- Aim for dozens of searches before finishing (up to roughly 90 in total).

When your research is complete, call the finish tool exactly once. Its answer must be self-contained Markdown: the full synthesis, every referenced passage cited as Book chapter:verse with the retrieved wording, and a clear line of reasoning from the texts to the conclusion.`;

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
						type: 'string',
						description:
							'Optional exact book name filter, e.g. "Genesis", "1 Samuel", "Song of Solomon"'
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
			.replace(/^-+|-+$/g, '')
			.slice(0, 60)
			.replace(/-+$/, '') || 'research'
	);
}

export async function search_bible(args: Record<string, unknown>): Promise<unknown> {
	const p = new URLSearchParams();
	p.set('q', String(args.query ?? ''));
	p.set(args.scope === 'chapters' ? 'c' : 'v', '');
	if (args.book) p.set('b', String(args.book));
	if (args.chapter != null && args.chapter !== '') p.set('x', String(args.chapter));
	const res = await fetch(`${SEARCH_URL}?${p}`);
	if (!res.ok) throw new Error(`search ${res.status}: ${(await res.text()).slice(0, 300)}`);
	return res.json();
}

export async function call_llm(key: string, messages: Msg[], force_finish: boolean): Promise<Msg> {
	const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: MODEL,
			messages,
			tools: TOOLS,
			tool_choice: force_finish ? { type: 'function', function: { name: 'finish' } } : 'auto',
			temperature: 0.6
		})
	});
	if (!res.ok) throw new Error(`llm ${res.status}: ${(await res.text()).slice(0, 300)}`);
	return ((await res.json()) as { choices: { message: Msg }[] }).choices[0].message;
}
