export default function manifest() {
  return {
    name: 'Walk the World',
    short_name: 'Walk World',
    description: 'Explore a living 3D interpretation of real streets built from open data.',
    start_url: '/',
    display: 'standalone',
    background_color: '#050b12',
    theme_color: '#07111d',
    orientation: 'any',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
    ],
  };
}

