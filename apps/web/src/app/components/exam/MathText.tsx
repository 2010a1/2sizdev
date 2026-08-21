import { Fragment } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/** Renders plain text plus inline $...$ and block $$...$$ LaTeX safely. */
export function MathText({ text, className = '' }: { text?: string; className?: string }) {
  const value = text ?? '';
  const parts = value.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g);
  return <span className={`math-text whitespace-pre-wrap ${className}`}>{parts.map((part, index) => {
    if (part.startsWith('$$') && part.endsWith('$$')) return <span key={index} className="block overflow-x-auto py-2" dangerouslySetInnerHTML={{ __html: render(part.slice(2, -2), true) }} />;
    if (part.startsWith('$') && part.endsWith('$')) return <span key={index} dangerouslySetInnerHTML={{ __html: render(part.slice(1, -1), false) }} />;
    return <Fragment key={index}>{part}</Fragment>;
  })}</span>;
}

function render(input: string, displayMode: boolean) {
  try { return katex.renderToString(input, { displayMode, throwOnError: false, strict: 'ignore', trust: false }); }
  catch { return escapeHtml(input); }
}
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!)); }
