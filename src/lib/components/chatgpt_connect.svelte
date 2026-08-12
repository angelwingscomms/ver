<script lang="ts">
	let st = $state<'load' | 'idle' | 'adding' | 'waiting' | 'connected' | 'noauth' | 'error'>('load');
	let code = $state('');
	let url = $state('');
	let interval = $state(5);
	let email = $state('');
	let name = $state('');
	let err = $state('');
	let timer = $state<ReturnType<typeof setInterval> | null>(null);

	refresh();

	async function refresh() {
		try {
			const j = (await (await fetch('/api/chatgpt')).json()) as {
				connected?: boolean;
				m?: string;
				n?: string;
			};
			st = j.connected ? 'connected' : 'idle';
			email = j.m ?? '';
			name = j.n ?? '';
		} catch {
			st = 'idle';
		}
	}

	function stop() {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	}

	async function connect() {
		err = '';
		if (st === 'waiting' || st === 'adding') return;
		const popup = window.open('', 'ver-chatgpt-login', 'popup,width=520,height=720');
		st = 'adding';
		try {
			const r = await fetch('/api/chatgpt/login', { method: 'POST' });
			if (r.status === 401) {
				st = 'noauth';
				if (popup) popup.close();
				return;
			}
			if (!r.ok) throw new Error(`login ${r.status}`);
			const j = (await r.json()) as {
				user_code: string;
				verification_url: string;
				interval: number;
			};
			code = j.user_code;
			url = j.verification_url;
			interval = Math.max(j.interval, 3);
			await navigator.clipboard.writeText(code);
			st = 'waiting';
			if (popup) popup.location.href = url;
			stop();
			timer = setInterval(poll, interval * 1000);
		} catch (e) {
			st = 'error';
			err = String(e);
			if (popup) popup.close();
		}
	}

	async function poll() {
		try {
			const j = (await (await fetch('/api/chatgpt/poll', { method: 'POST' })).json()) as {
				status: string;
				m?: string;
				n?: string;
			};
			if (j.status === 'authenticated') {
				stop();
				st = 'connected';
				email = j.m ?? '';
				name = j.n ?? '';
			} else if (j.status === 'expired') {
				stop();
				st = 'error';
				err = 'code expired, try again';
			}
		} catch {
			/* poll best-effort, next tick retries */
		}
	}

	async function disconnect() {
		stop();
		await fetch('/api/chatgpt/disconnect', { method: 'POST' }).catch(() => {});
		st = 'idle';
		code = '';
		email = '';
		name = '';
	}
</script>

<div class="cg">
	{#if st === 'connected'}
		<p class="ok">connected{name ? ` as ${name}` : ''}{email ? ` (${email})` : ''}</p>
		<button type="button" onclick={disconnect}>disconnect</button>
	{:else if st === 'waiting'}
		<p class="wait">open chatgpt and enter code <b class="code">{code}</b></p>
		<p class="hint">
			<a href={url} target="_blank" rel="noopener">open {url}</a> — code copied to clipboard
		</p>
	{:else if st === 'noauth'}
		<p class="hint">sign in first, then connect chatgpt here</p>
	{:else}
		<button type="button" disabled={st === 'adding' || st === 'load'} onclick={connect}>
			{st === 'adding' ? 'connecting…' : st === 'load' ? 'loading…' : 'login with chatgpt'}
		</button>
		{#if st === 'error'}
			<p class="err">{err}</p>
		{/if}
	{/if}
</div>

<style>
	.cg {
		display: grid;
		gap: 0.8rem;
		justify-items: start;
	}
	.ok {
		color: #059669;
		font-weight: 600;
		margin: 0;
	}
	.wait {
		margin: 0;
		font-size: 0.95rem;
	}
	.code {
		font-family: monospace;
		letter-spacing: 0.06em;
		background: #eef2f9;
		padding: 0.15rem 0.5rem;
		border-radius: 6px;
	}
	.hint {
		font-size: 0.88rem;
		color: #64748b;
		margin: 0;
	}
	.err {
		font-size: 0.82rem;
		color: #dc2626;
		margin: 0;
	}
</style>