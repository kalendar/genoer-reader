/**
 * The openstax-convert pipeline emits block html with figure `img[src]`
 * already rewritten to a path relative to the book's own media folder, e.g.
 * `src="media/OSX_Eship_05_01_Schumpeter.jpg"`. Resolve that against the
 * book's actual media base path (`/books/<slug>/media/`) before rendering.
 */
export function rewriteMediaSrc(html: string, mediaBase: string): string {
	const base = mediaBase.endsWith('/') ? mediaBase : `${mediaBase}/`;
	return html.replace(/(\ssrc=")media\//g, `$1${base}`);
}
