import type React from 'react';

/**
 * Stripe's hosted pricing table is a custom element, not a React component
 * (PLT-02). TypeScript needs telling it exists, and this has to be an ambient
 * declaration rather than a `declare global` inside the component — a module
 * augmentation does not apply to JSX in the file that declares it.
 */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'stripe-pricing-table': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          'pricing-table-id': string;
          'publishable-key': string;
          /** The co-op's id, handed back on the completed checkout. */
          'client-reference-id'?: string;
          'customer-email'?: string;
        },
        HTMLElement
      >;
    }
  }
}
