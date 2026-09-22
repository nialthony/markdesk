export function Logo() {
  return (
    <a className="logo" href="#top" aria-label="MarkDesk home">
      <svg className="logoGlyph" viewBox="0 0 24 24" aria-hidden="true">
        {/* Double chevron M: the bid above and the ask below the mark. */}
        <path d="M5 5.5 L12 11.5 L19 5.5" fill="none" stroke="currentColor" strokeWidth="2.7" />
        <path d="M5 12.5 L12 18.5 L19 12.5" fill="none" stroke="currentColor" strokeWidth="2.7" />
      </svg>
      <span>MARKDESK</span>
    </a>
  );
}
