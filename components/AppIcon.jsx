const paths = {
  menu: <path d="M4 7h16M4 12h16M4 17h10" />,
  map: <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15" />,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2.1-.7-.7-1.7 1-2-2.1-2.1-2 1-1.7-.7L10.5 2h-3l-.7 2.1-1.7.7-2-1L1 5.9l1 2-.7 1.7L0 10.5v3l2.1.7.7 1.7-1 2L3.9 20l2-1 1.7.7.9 2.3h3l.7-2.1 1.7-.7 2 1 2.1-2.1-1-2 .7-1.7 2.3-.9Z" transform="translate(2 0) scale(.83)" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z" /></>,
  camera: <><path d="M4 7h3l1.5-2h7L17 7h3v12H4V7Z" /><circle cx="12" cy="13" r="3.5" /></>,
  share: <><path d="M14 5h5v5M19 5l-8 8" /><path d="M17 13v6H5V7h6" /></>,
  passport: <><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="11" r="3" /><path d="M9 11h6M12 8v6M8 17h8" /></>,
  spark: <path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Zm7 13 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" />,
  sound: <><path d="M5 10v4h3l4 4V6L8 10H5Z" /><path d="M15 9c1.5 1.7 1.5 4.3 0 6M18 6c3.2 3.3 3.2 8.7 0 12" /></>,
};

export function AppIcon({ name, className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[name] || paths.compass}
    </svg>
  );
}

