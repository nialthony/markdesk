export function Logo() {
  return (
    <a className="logo" href="#top" aria-label="MarkDesk home">
      <svg className="logoGlyph" viewBox="0 0 24 24" aria-hidden="true">
        {/* Geometric M monogram: one squared-off stroke, terminal precise. */}
        <path d="M4 19 V5 L12 12.5 L20 5 V19" fill="none" stroke="currentColor" strokeWidth="2.7" />
      </svg>
      <span>MARKDESK</span>
    </a>
  );
}
