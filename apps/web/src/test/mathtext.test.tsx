import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MathText } from '../app/components/exam/MathText';

// KaTeX renders server-side fine, so react-dom/server gives us the HTML string.
const html = (text: string) => renderToString(<MathText text={text} />);

describe('MathText formula rendering', () => {
  it('renders inline $...$ and block $$...$$ as KaTeX', () => {
    const inline = html('Giải $x^2 - 4 = 0$ nhé');
    expect(inline).toContain('katex');
    expect(inline).not.toContain('$x^2');
    const block = html('$$\\frac{a}{b}$$');
    expect(block).toContain('katex-display');
  });

  it('accepts \\(...\\) and \\[...\\] delimiters from other AI sources', () => {
    expect(html('y = \\(x_1 + x_2\\) ok')).toContain('katex');
    expect(html('\\[\\sqrt{2}\\]')).toContain('katex-display');
  });

  it('renders chemistry via mhchem \\ce{} with subscripts', () => {
    const out = html('$\\ce{H2SO4}$');
    expect(out).toContain('katex-html');
    // MathML mirror carries H + msub 2 / msub 4 - the visual HTML uses CSS vlist
    expect(out).toContain('msub');
    expect(out).toContain('<mn>2</mn>');
    expect(out).toContain('<mn>4</mn>');
  });

  it('keeps plain Unicode math from Word untouched', () => {
    const out = html('Biết x² + H₂SO₄ ⇌ 2H⁺');
    expect(out).toContain('x²');
    expect(out).toContain('H₂SO₄');
    expect(out).toContain('⇌');
  });

  it('does not crash on broken LaTeX and escapes raw text', () => {
    expect(() => html('$\\frac{$')).not.toThrow();
    const out = html('a < b & "c"');
    // React escapes the raw text nodes
    expect(out).not.toContain('<b>');
  });

  it('leaves lone $ (prices, currency) as text', () => {
    const out = html('Giá 5$ và 10$');
    expect(out).not.toContain('katex');
  });
});
