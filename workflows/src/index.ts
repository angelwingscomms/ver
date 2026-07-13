import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import {
	MAX_TURNS,
	SYSTEM_PROMPT,
	call_llm,
	search_bible,
	type Msg
} from '../../src/lib/deepresearch/core';

type E = { OPENROUTER_KEY: { get(): Promise<string> } };
type P = { q: string };

const RETRY = {
	retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
	timeout: '10 minutes'
} as const;

export class DeepResearchWorkflow extends WorkflowEntrypoint<E, P> {
	async run(event: WorkflowEvent<P>, step: WorkflowStep) {
		const q = event.payload.q;
		const key = await this.env.OPENROUTER_KEY.get();
		const messages: Msg[] = [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: q }
		];
		let answer = '';
		for (let t = 0; t < MAX_TURNS && !answer; t++) {
			const m = await step.do(`llm-${t}`, RETRY, () =>
				call_llm(key, messages, t === MAX_TURNS - 1)
			);
			messages.push(m);
			if (!m.tool_calls?.length) {
				messages.push({
					role: 'user',
					content:
						'Continue: call search_bible to research further, or call finish with your complete final answer.'
				});
				continue;
			}
			for (const c of m.tool_calls) {
				let args: Record<string, unknown>;
				try {
					args = JSON.parse(c.function.arguments || '{}');
				} catch {
					args = {};
				}
				if (c.function.name === 'finish') {
					answer = String(args.answer ?? '');
					if (answer) break;
					messages.push({
						role: 'tool',
						tool_call_id: c.id,
						content:
							'finish rejected: answer was empty. Keep researching, then call finish with the full answer.'
					});
					continue;
				}
				const r = await step.do(`search-${t}-${c.id}`, RETRY, () => search_bible(args));
				messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(r) });
			}
		}
		if (!answer)
			answer =
				[...messages].reverse().find((m) => m.role === 'assistant' && m.content)?.content ??
				'No answer produced.';
		return { q, m: `# question\n\n${q}\n\n# answer\n\n${answer}` };
	}
}

export default {
	fetch: () => new Response('ver-workflows', { status: 404 })
};
