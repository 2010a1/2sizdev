/** Neutral loading placeholder block. Compose with Tailwind h-/w- utilities
 * inside a 'card' if the real content sits in one. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden='true' className={'skeleton ' + className} />;
}
