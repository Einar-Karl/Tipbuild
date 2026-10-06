'use client';

import { useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

interface Props {
  publishableKey: string;
  clientSecret: string;
  returnUrl: string;
  label: string;
  processingLabel: string;
  errorLabel: string;
}

const cache = new Map<string, Promise<Stripe | null>>();
function stripeFor(key: string): Promise<Stripe | null> {
  let p = cache.get(key);
  if (!p) {
    p = loadStripe(key);
    cache.set(key, p);
  }
  return p;
}

function Inner({ clientSecret, returnUrl, label, processingLabel, errorLabel }: Omit<Props, 'publishableKey'>) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? errorLabel);
      setBusy(false);
      return;
    }
    // On success Stripe redirects to returnUrl; the webhook confirms the payment server-side.
    const { error: payError } = await stripe.confirmPayment({ elements, clientSecret, confirmParams: { return_url: returnUrl } });
    if (payError) {
      setError(payError.message ?? errorLabel);
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void confirm();
      }}
    >
      {/* Apple Pay / Google Pay / Link, shown only when the device supports them */}
      <ExpressCheckoutElement onConfirm={() => void confirm()} />
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <button className="btn w-full text-lg" disabled={!stripe || busy}>
        {busy ? processingLabel : label}
      </button>
    </form>
  );
}

export default function StripePayment({ publishableKey, ...rest }: Props) {
  return (
    <Elements
      stripe={stripeFor(publishableKey)}
      options={{ clientSecret: rest.clientSecret, appearance: { theme: 'stripe', variables: { borderRadius: '12px' } } }}
    >
      <Inner {...rest} />
    </Elements>
  );
}
