export function Logo() {
  return (
    <a className="logo" href="#top" aria-label="MarkDesk home">
      <svg className="logoGlyph" viewBox="0 0 24 24" aria-hidden="true">
        {/* The mark: a reference line with offers quoted above and below it. */}
        <line x1="2.5" y1="12" x2="21.5" y2="12" stroke="currentColor" strokeWidth="2.4" />
        <circle cx="8" cy="5.8" r="2.7" fill="currentColor" />
        <circle cx="16" cy="18.2" r="2.7" fill="currentColor" />
      </svg>
      <span>MARKDESK</span>
    </a>
  );
}
