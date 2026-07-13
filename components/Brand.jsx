'use client';

export function BrandMark({ className = 'h-12 w-12', title = 'Walk the World' }) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      className={className}
      fill="none"
    >
      <defs>
        <linearGradient id="wtw-orbit" x1="7" y1="8" x2="57" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#76F7D2" />
          <stop offset="1" stopColor="#F6B85A" />
        </linearGradient>
        <radialGradient id="wtw-core" cx="0" cy="0" r="1" gradientTransform="translate(25 19) rotate(52) scale(37)">
          <stop stopColor="#163C55" />
          <stop offset="1" stopColor="#07111D" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="23" fill="url(#wtw-core)" stroke="url(#wtw-orbit)" strokeWidth="2" />
      <path d="M10 37.5C19 31 24 44 32 35.5C39 28 44 34 54 24" stroke="url(#wtw-orbit)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="10" cy="37.5" r="3" fill="#76F7D2" />
      <path d="M48 20l7 3.5-6.5 4.4" fill="#F6B85A" />
      <path d="M20 17.5c3.5-3 8.5-4.5 13-4.2M18 49c4.2 2.2 9.3 3.1 14.2 2.3" stroke="#B8CEE0" strokeOpacity=".55" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function BrandLockup({ compact = false, className = '' }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <BrandMark className={compact ? 'h-8 w-8 shrink-0' : 'h-11 w-11 shrink-0'} />
      <div className="min-w-0">
        <div className={`${compact ? 'text-[10px]' : 'text-sm'} font-display font-extrabold tracking-[0.19em] text-white`}>
          WALK THE WORLD
        </div>
        {!compact && (
          <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">
            Open data · living planet
          </div>
        )}
      </div>
    </div>
  );
}

