import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/types';
import { guides } from '@/db/schema';

const MAP: Record<string, string> = { þ: 'th', ð: 'd', æ: 'ae', ø: 'o', ß: 'ss', ł: 'l' };

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[þðæøßł]/g, (c) => MAP[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'guide';
}

/** Unique slug; appends a short random suffix on collision. Slugs never change (printed QR codes). */
export async function uniqueSlug(db: Db, name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  for (let i = 0; i < 8; i++) {
    const hit = await db.select({ id: guides.id }).from(guides).where(eq(guides.slug, candidate)).limit(1);
    if (!hit[0]) return candidate;
    candidate = `${base}-${randomBytes(2).toString('hex')}`;
  }
  return `${base}-${randomBytes(4).toString('hex')}`;
}
