export const metadata = { title: 'Terms' };

export default function Terms() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Terms of use</h1>
      <p className="mt-2 rounded-lg bg-accent/15 p-3 text-sm">
        PLACEHOLDER. Replace with terms reviewed by a lawyer before launch (see COMPLIANCE.md).
      </p>
      <div className="mt-6 space-y-4">
        <h2 className="text-xl font-semibold">Tipping</h2>
        <p>
          A tip is a voluntary gift to the guide. A service fee is deducted and shown before you pay. Tips are paid out to guides once a
          month. Tips are generally non-refundable; contact us if you were charged by mistake.
        </p>
        <h2 className="text-xl font-semibold">Guides</h2>
        <p>
          Guides must complete identity verification with our payment partner before receiving tips. Guides are responsible for reporting
          tip income to the tax authorities.
        </p>
        <p>[operator company name, registration number, address, VAT number]</p>
      </div>
    </main>
  );
}
