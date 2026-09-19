'use client';

import { useEffect, useRef, useState } from 'react';
import type { FieldClaim } from '@/types/advisor';

/** A small "sources" info button placed next to an AI-generated claim
 * (fit reason, rationale, earnings outlook, earnings likelihood reason).
 * Clicking it slides out a right-side drawer listing the specific
 * synthesized claim(s) behind that field, each with the quote(s) that
 * support it and their source name + specific link. Renders nothing when
 * there are no claims for this field, rather than a button that opens to
 * an empty/dead-end panel. Reuses AuthPanel.tsx's dual-listener
 * (outside-pointerdown + Escape) close pattern. */
export function CitationButton({ citations }: { citations: FieldClaim[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (citations.length === 0) return null;

  return (
    <span ref={rootRef} style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Hide sources' : 'Show sources'}
        aria-expanded={open}
        title="Show sources"
        className="info-icon"
        style={{
          cursor: 'pointer', background: 'transparent', padding: 0,
          fontFamily: 'var(--mono)', fontSize: 'calc(10px * var(--type-scale))', fontStyle: 'italic', lineHeight: 1,
        }}
      >
        i
      </button>
      {open && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200 }}
          />
          <div
            role="dialog"
            aria-label="Sources"
            style={{
              position: 'fixed', top: 0, right: 0, height: '100vh', width: 'min(420px, 92vw)',
              background: 'var(--surface-2)', borderLeft: '1px solid var(--border)',
              boxShadow: '-8px 0 24px rgba(0,0,0,.35)', zIndex: 201,
              overflowY: 'auto', padding: '20px 18px',
              fontFamily: 'var(--font-sans, inherit)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="section-label" style={{ margin: 0 }}>Sources</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="settings-toggle"
                style={{ padding: '2px 8px' }}
              >
                ✕
              </button>
            </div>
            {citations.map((fc, i) => (
              <div key={i} style={{ marginBottom: i < citations.length - 1 ? 18 : 0 }}>
                <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: 'calc(13.5px * var(--type-scale))' }}>{fc.claim}</div>
                {fc.quotes.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {fc.quotes.map((q, j) => (
                      <div
                        key={j}
                        style={{
                          borderLeft: '2px solid var(--border)', paddingLeft: 10,
                          fontSize: 'calc(12.5px * var(--type-scale))',
                        }}
                      >
                        <div style={{ color: 'var(--muted)', fontStyle: 'italic' }}>&ldquo;{q.quote}&rdquo;</div>
                        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                          {q.sources.map((s, k) => (
                            <a
                              key={k}
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              title={s.url}
                              style={{
                                color: 'var(--accent)', display: 'block', minWidth: 0, maxWidth: '100%',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              }}
                            >
                              {s.url}
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
