export function Logo() {
  return (
    <a className="logo" href="#top" aria-label="MarkDesk home">
      <svg className="logoGlyph" viewBox="0 0 24 16" aria-hidden="true">
        {/* The owner's reference M (docs/assets/logo-reference.png): a slab M
            whose center V reaches almost to the baseline, split in two colors
            with the left half drawn over the right at the crossing. Adapted to
            the MarkDesk palette: text + one amber accent. */}
        <path
          className="logoGlyphRight"
          d="M21 3 H19 L8.5 10.9 L12 13.8 L16.8 10.3 V15.35 H18.6 L21 13.7 Z"
        />
        <path
          className="logoGlyphLeft"
          d="M3 3 H5 L15.5 10.9 L12 13.8 L7.2 10.3 V15.35 H5.4 L3 13.7 Z"
        />
      </svg>
      <span>MARKDESK</span>
    </a>
  );
}
