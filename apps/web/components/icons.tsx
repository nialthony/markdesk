interface IconProps {
  size?: number;
}

export function ArrowUpRight({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 17 17 7M8 7h9v9" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function Shield({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3 19 6v5c0 4.6-2.8 8.3-7 10-4.2-1.7-7-5.4-7-10V6l7-3Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="m9 12 2 2 4-5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function Clock({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function Layers({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m12 3 9 5-9 5-9-5 9-5Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
