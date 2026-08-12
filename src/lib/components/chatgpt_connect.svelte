<script lang="ts">
	let { label = 'continue with chatgpt' }: { label?: string } = $props();

	type St = 'load' | 'idle' | 'starting' | 'waiting' | 'connected' | 'error';
	let st = $state<St>('load');
	let code = $state('');
	let url = $state('');
	let email = $state('');
	let name = $state('');
	let err = $state('');
	let copied = $state(false);
	let timer: ReturnType<typeof setInterval> | null = null;

	$effect(() => {
		refresh();
		return stop;
	});

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
		if (timer) clearInterval(timer);
		timer = null;
	}

	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			copied = false;
		}
	}

	async function connect() {
		if (st === 'starting' || st === 'waiting') return;
		err = '';
		const popup = window.open('', 'ver-chatgpt-login', 'popup,width=520,height=760');
		st = 'starting';
		try {
			const r = await fetch('/api/chatgpt/login', { method: 'POST' });
			const j = (await r.json()) as {
				user_code?: string;
				verification_url?: string;
				interval?: number;
				message?: string;
			};
			if (!r.ok || !j.user_code || !j.verification_url)
				throw new Error(j.message ?? `login ${r.status}`);
			code = j.user_code;
			url = j.verification_url;
			st = 'waiting';
			copy();
			if (popup) popup.location.href = url;
			else window.open(url, '_blank', 'noopener');
			stop();
			timer = setInterval(poll, Math.max(j.interval ?? 5, 3) * 1000);
		} catch (e) {
			st = 'error';
			err = (e as Error).message;
			if (popup) popup.close();
		}
	}

	async function poll() {
		try {
			const r = await fetch('/api/chatgpt/poll', { method: 'POST' });
			const j = (await r.json()) as { status?: string; n?: string; m?: string; r?: string | null };
			if (!r.ok) return;
			if (j.status === 'authenticated') {
				stop();
				if (j.r) {
					location.href = j.r;
					return;
				}
				st = 'connected';
				email = j.m ?? '';
				name = j.n ?? '';
			} else if (j.status === 'expired') {
				stop();
				st = 'error';
				err = 'that code expired, try again';
			}
		} catch {
			/* best-effort, next tick retries */
		}
	}

	function cancel() {
		stop();
		st = 'idle';
		code = '';
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
		<button type="button" class="link" onclick={disconnect}>disconnect</button>
	{:else if st === 'waiting'}
		<p class="wait">enter this code in the chatgpt window</p>
		<button type="button" class="code" onclick={copy}>{code}</button>
		<p class="hint">
			{copied ? 'copied to clipboard' : 'click the code to copy'} —
			<button type="button" class="link" onclick={() => window.open(url, '_blank', 'noopener')}>
				open chatgpt
			</button>
		</p>
		<button type="button" class="link" onclick={cancel}>cancel</button>
	{:else}
		<button
			type="button"
			class="go"
			disabled={st === 'starting' || st === 'load'}
			onclick={connect}
		>
			{st === 'starting' ? 'starting…' : label}
		</button>
		{#if st === 'error'}<p class="err">{err}</p>{/if}
	{/if}
</div>

<style>
	.cg {
		display: grid;
		gap: 0.6rem;
		justify-items: center;
		text-align: center;
	}
	.go {
		width: 100%;
		padding: 0.8rem;
		border: 1px solid #dbe3f0;
		border-radius: 9px;
		background: #fff;
		color: #16233f;
		font-weight: 600;
		font-size: 1rem;
		cursor: pointer;
	}
	.go:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.ok {
		color: #059669;
		font-weight: 600;
		margin: 0;
	}
	.wait {
		margin: 0;
		font-size: 0.95rem;
		color: #16233f;
	}
	.code {
		font-family: monospace;
		font-size: 1.35rem;
		letter-spacing: 0.14em;
		background: #eef2f9;
		border: 1px solid #dbe3f0;
		border-radius: 8px;
		padding: 0.45rem 0.9rem;
		color: #16233f;
		cursor: pointer;
	}
	.hint {
		font-size: 0.85rem;
		color: #64748b;
		margin: 0;
	}
	.link {
		background: none;
		border: none;
		color: #1d4ed8;
		font-size: 0.85rem;
		cursor: pointer;
		padding: 0;
	}
	.err {
		font-size: 0.82rem;
		color: #dc2626;
		margin: 0;
	}
</style>
