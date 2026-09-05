import { Fragment } from 'react';
import katex from 'katex';
import 'katex/contrib/mhchem';
import 'katex/dist/katex.min.css';

// Matches $$...$$ and \[...\] blocks, inline $...$ and \(...\). Split keeps the
// delimiters so each part can be classified below.
const MATH_SPLIT = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]+?\$|\\\([\s\S]*?\\\))/g;

/** Renders plain text plus inline $...$, \(...\) and block $$...$$, \[...\] LaTeX safely. Chemistry uses \ce{...} via mhchem. */
export function MathText({ text, className = '' }: { text?: string; className?: string }) {
  const value = text ?? '';
  const parts = value.split(MATH_SPLIT);
  return <span className={`math-text whitespace-pre-wrap ${className}`}>{parts.map((part, index) => {
    if (part.startsWith('$$') && part.endsWith('$$')) return <span key={index} className="block overflow-x-auto py-2" dangerouslySetInnerHTML={{ __html: render(part.slice(2, -2), true) }} />;
    if (part.startsWith('\\[') && part.endsWith('\\]')) return <span key={index} className="block overflow-x-auto py-2" dangerouslySetInnerHTML={{ __html: render(part.slice(2, -2), true) }} />;
    if (part.startsWith('\\(') && part.endsWith('\\)')) return <span key={index} dangerouslySetInnerHTML={{ __html: render(part.slice(2, -2), false) }} />;
    // Inline $...$: reject pairs whose inner text starts/ends with a space —
    // that's prose like "Giá 5$ và 10$", not a formula (pandoc rule).
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      const inner = part.slice(1, -1);
      if (/^\s|\s$/.test(inner)) return <Fragment key={index}>{part}</Fragment>;
      return <span key={index} dangerouslySetInnerHTML={{ __html: render(inner, false) }} />;
    }
    return <Fragment key={index}>{part}</Fragment>;
  })}</span>;
}

function render(input: string, displayMode: boolean) {
  try { return katex.renderToString(input, { displayMode, throwOnError: false, strict: 'ignore', trust: false }); }
  catch { return escapeHtml(input); }
}
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!)); }
