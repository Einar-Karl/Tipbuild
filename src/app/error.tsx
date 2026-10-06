'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-3xl font-bold">Something went wrong</h1>
      <p className="text-muted">Please try again. If it keeps happening, contact support.</p>
      <button className="btn" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
