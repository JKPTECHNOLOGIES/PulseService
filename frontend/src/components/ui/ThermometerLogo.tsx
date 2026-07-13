interface ThermometerLogoProps {
  className?: string;
}

/**
 * Prime Comfort Solutions brand mark: a thermometer paired with a snowflake,
 * signaling both heating and cooling (HVAC). Colors are fixed (brand cyan) so
 * the mark renders consistently on any background. Size via `className`.
 */
export default function ThermometerLogo({ className }: ThermometerLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Prime Comfort Solutions"
    >
      {/* Snowflake (cooling) */}
      <g stroke="#45B4E6" strokeWidth="1.8" strokeLinecap="round">
        <line x1="6" y1="6.6" x2="6" y2="15.4" />
        <line x1="2.4" y1="8.8" x2="9.6" y2="13.2" />
        <line x1="2.4" y1="13.2" x2="9.6" y2="8.8" />
      </g>

      {/* Thermometer (heating) */}
      <g transform="translate(4 0)">
        {/* Outline + white interior */}
        <path
          d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"
          fill="#ffffff"
          stroke="#45B4E6"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        {/* Mercury (fill level) */}
        <rect x="10.4" y="10" width="2.2" height="7" rx="1.1" fill="#B4E2F5" />
        <circle cx="11.5" cy="18.9" r="3" fill="#B4E2F5" />
        {/* Scale ticks */}
        <g stroke="#45B4E6" strokeWidth="1.8" strokeLinecap="round">
          <line x1="14" y1="6.5" x2="16.4" y2="6.5" />
          <line x1="14" y1="9" x2="16.4" y2="9" />
          <line x1="14" y1="11.5" x2="16.4" y2="11.5" />
        </g>
      </g>
    </svg>
  );
}
