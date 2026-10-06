/* eslint-disable @next/next/no-img-element */
export function Avatar({ name, url, size = 72 }: { name: string; url?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  if (url)
    return <img src={url} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <div
      aria-hidden
      className="flex items-center justify-center rounded-full bg-basalt font-display text-xl font-bold text-page"
      style={{ width: size, height: size }}
    >
      {initials}
    </div>
  );
}
