<script lang="ts">
	import { goto } from '$app/navigation';

	type R = { i: string; q: string; l: string; c: number; s: string };
	let items = $state<R[]>([]);
	let q = $state('');
	let starting = $state(false);
	let msg = $state('');
	let timer: ReturnType<typeof setInterval> | undefined;

	async function load() {
		try {
			const r = await fetch('/api/deepresearch');
			if (r.ok) items = ((await r.json()) as { r: R[] }).r;
		} catch {
			/* keep last list */
		}
	}

	$effect(() => {
		load();
		timer = setInterval(load, 5000);
		return () => {
			if (timer) clearInterval(timer);
		};
	});

	async function start() {
		if (!q.trim() || starting) return;
		starting = true;
		msg = '';
		try {
			const r = await fetch('/api/deepresearch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ q: q.trim() })
			});
			const d = (await r.json()) as { i?: string; l?: string; message?: string; error?: string };
			if (r.status === 401) {
				goto('/login');
				return;
			}
			if (r.status === 402) {
				msg = 'Insufficient tokens — please deposit from the menu.';
				return;
			}
			if (!r.ok || !d.i) {
				msg = d.error ?? d.message ?? 'failed to start';
				return;
			}
			goto(`/deepresearch/${d.i}?l=${encodeURIComponent(d.l ?? '')}&q=${encodeURIComponent(q.trim())}`);
		} catch {
			msg = 'failed to start';
		} finally {
			starting = false;
		}
	}

	function ago(c: number): string {
		const s = Math.floor((Date.now() - c) / 1000);
		if (s < 60) return `${s}s ago`;
		if (s < 3600) return `${Math.floor(s / 60)}m ago`;
		if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
		return `${Math.floor(s / 86400)}d ago`;
	}

	function badge(s: string): string {
		return s === 'complete' ? 'done' : s === 'errored' || s === 'terminated' ? 'err' : 'run';
	}
</script>

<svelte:head>
	<title>Deep Bible Research</title>
	<meta
		name="description"
		content="Long-running, first-principles Bible research synthesized purely from retrieved scripture."
	/>
</svelte:head>

<main>
	<header class="hero">
		<p class="kicker">Young's Literal Translation</p>
		<h1>Deep Research</h1>
		<p class="lede">
			Start a question, or open any past research below. An agent searches scripture exhaustively and
			synthesizes an answer from the retrieved text alone — leave it open or come back later.
		</p>
	</header>

	<form
		onsubmit={(e) => {
			e.preventDefault();
			start();
		}}
	>
		<textarea
			placeholder="e.g. What does the Bible itself say bread means, from Genesis to Revelation?"
			bind:value={q}
			rows="3"
			aria-label="Research question"
			onkeydown={(e) => {
				if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
					e.preventDefault();
					start();
				}
			}}></textarea>
		<button type="submit" disabled={starting}>{starting ? 'Starting…' : 'Start research'}</button>
	</form>
	{#if msg}
		<p class="msg">{msg}</p>
	{/if}

	<section class="list">
		{#each items as r (r.i)}
			<a
				class="item"
				href={`/deepresearch/${r.i}?l=${encodeURIComponent(r.l)}&q=${encodeURIComponent(r.q)}`}
			>
				<span class="q">{r.q}</span>
				<span class="meta">
					<span class={`badge ${badge(r.s)}`}>{r.s}</span>
					<span class="time">{ago(r.c)}</span>
				</span>
			</a>
		{:else}
			<p class="empty">No research yet — ask the first question above.</p>
		{/each}
	</section>
</main>

<style>
	main {
		max-width: 760px;
		margin: 0 auto;
		padding: 4rem 1.25rem 5rem;
	}
	.hero {
		text-align: left;
		margin-bottom: 2.5rem;
	}
	.kicker {
		text-transform: uppercase;
		letter-spacing: 0.22em;
		font-size: 0.7rem;
		color: #1e40af;
		margin: 0 0 0.6rem;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
	}
	h1 {
		font-size: clamp(2.2rem, 6vw, 3.2rem);
		font-weight: 600;
		margin: 0;
		letter-spacing: -0.01em;
		color: #16233f;
	}
	.lede {
		margin: 0.75rem auto 0;
		max-width: 34rem;
		color: #475569;
		font-size: 1.05rem;
		line-height: 1.5;
	}
	form {
		display: grid;
		gap: 0.6rem;
		background: #ffffff;
		padding: 0.7rem;
		border: 1px solid #dbe3f0;
		border-radius: 14px;
		box-shadow:
			0 1px 2px rgba(22, 35, 63, 0.04),
			0 12px 30px -18px rgba(22, 35, 63, 0.25);
	}
	textarea {
		width: 100%;
		padding: 0.8rem 0.9rem;
		font-size: 1rem;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
		color: #16233f;
		background: #f4f7fc;
		border: 1px solid #dbe3f0;
		border-radius: 9px;
		resize: vertical;
	}
	textarea:focus {
		outline: none;
		background: #fff;
		border-color: #2563eb;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
	}
	button {
		height: 3rem;
		padding: 0 1.4rem;
		font-size: 1rem;
		font-weight: 600;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
		color: #fff;
		background: #1d4ed8;
		border: none;
		border-radius: 9px;
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: #1e40af;
	}
	button:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.msg {
		text-align: left;
		color: #1d4ed8;
		margin: 1rem 0 0;
		font-size: 0.98rem;
	}
	.list {
		margin-top: 2rem;
		display: grid;
		gap: 0.6rem;
	}
	.item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		text-decoration: none;
		padding: 0.9rem 1.1rem;
		background: #fff;
		border: 1px solid #e4e9f2;
		border-radius: 12px;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease,
			transform 0.15s ease;
	}
	.item:hover {
		border-color: #2563eb;
		box-shadow: 0 10px 26px -18px rgba(22, 35, 63, 0.4);
		transform: translateY(-1px);
	}
	.q {
		color: #16233f;
		font-size: 1.02rem;
		font-weight: 500;
		line-height: 1.35;
		word-break: break-word;
	}
	.meta {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}
	.badge {
		text-transform: uppercase;
		font-size: 0.62rem;
		letter-spacing: 0.08em;
		font-weight: 700;
		padding: 0.18rem 0.5rem;
		border-radius: 999px;
		color: #fff;
	}
	.badge.run {
		background: #0891b2;
	}
	.badge.done {
		background: #059669;
	}
	.badge.err {
		background: #dc2626;
	}
	.time {
		font-size: 0.78rem;
		color: #94a3b8;
		white-space: nowrap;
	}
	.empty {
		text-align: left;
		color: #94a3b8;
		margin-top: 1.5rem;
	}
</style>
