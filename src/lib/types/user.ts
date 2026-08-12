export interface User {
	s: 'u';
	n: string;
	p?: string;
	m?: string;
	d: number;
	o?: 'google' | 'local' | 'chatgpt';
	h?: string;
	cg?: string;
	cgn?: string;
	cgm?: string;
	cgl?: string[];
}
