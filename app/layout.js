import "./globals.css";

export const metadata = {
  title: "Walk the World",
  description: "Spin a 3D globe, pick a place, and walk around in real street-level imagery.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
