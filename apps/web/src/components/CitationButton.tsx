'use client';

import { useEffect, useRef, useState } from 'react';
import type { ResearchCitation } from '@/types/advisor';

/** A small "sources" info button placed next to an AI-generated claim
 * (fit reason, rationale, earnings outlook, earnings likelihood reason).
 * Clicking it opens a floating panel listing the specific research
 * blurb(s) behind that claim, each with its source name and link. Renders
 * nothing when there are no citations for this claim, rather than a
 * button that opens to an empty/dead-end panel. */
export function CitationButton({ citations }: { citations: ResearchCitation[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  if (citations.length === 0) return null;

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', marginLeft: 6, verticalAlign: 'middle' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Hide sources' : 'Show sources'}
        aria-expanded={open}
        title="Show sources"
        className="info-icon"
        style={{
          cursor: 'pointer', background: 'transparent', padding: 0,
          fontFamily: 'var(--mono)', fontSize: 10, fontStyle: 'italic', lineHeight: 1,
        }}
      >
        i
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Sources"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 20,
            background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8,
            padding: '10px 12px', width: 300, maxWidth: '80vw', fontSize: 12, fontWeight: 400,
            fontFamily: 'var(--font-sans, inherit)', boxShadow: '0 8px 24px rgba(0,0,0,.28)',
          }}
        >
          {citations.map((c, i) => (
            <div key={i} style={{ marginBottom: i < citations.length - 1 ? 10 : 0 }}>
              <div style={{ color: 'var(--text)', fontStyle: 'italic' }}>&ldquo;{c.claim}&rdquo;</div>
              <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {c.sources.map((s, j) => (
                  <a key={j} href={s.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                    {s.title}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
