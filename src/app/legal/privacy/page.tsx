export const metadata = { title: 'Privacy policy' };

export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Privacy policy</h1>
      <p className="mt-2 rounded-lg bg-accent/15 p-3 text-sm">
        PLACEHOLDER. Replace with a policy reviewed by a lawyer before launch (see COMPLIANCE.md).
      </p>
      <div className="mt-6 space-y-4">
        <h2 className="text-xl font-semibold">Tourists</h2>
        <p>
          We do not ask tourists for an account, name or email. Card details are handled by our payment partner and never reach our
          servers. If you leave a rating, we store the rating and optional text without any identity. We store the tip amount and the
          country the payment came from (derived from your IP address by our host, the IP itself is not stored).
        </p>
        <h2 className="text-xl font-semibold">Guides</h2>
        <p>
          We store your email, display name, optional photo URL, your tours, tips received and payouts. Identity and bank details are
          collected and held by our payment partner. You can download or delete your data from your dashboard. Financial records are kept
          as long as accounting law requires.
        </p>
        <h2 className="text-xl font-semibold">Retention</h2>
        <p>Free-text feedback is deleted after 24 months. Sign-in tokens expire after 15 minutes.</p>
        <h2 className="text-xl font-semibold">Contact</h2>
        <p>[controller name, address, email, DPO if applicable]</p>
      </div>
    </main>
  );
}
