import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import "@/templates/classic/landing.css";

export const metadata: Metadata = {
  title: "Privacy Policy — Nature Bazar",
  description:
    "How Nature Bazar collects, uses and protects the personal data you share when you order.",
};

/**
 * The privacy policy the order form links to. Static: it describes what the
 * shop actually does with a customer's data — takes the order, calls to
 * confirm, hands the parcel to a courier, measures its advertising — and
 * nothing it does not. Wears the landing page's chrome so it reads as part of
 * the same site.
 */
export default function PrivacyPolicy() {
  return (
    <main className="nb-landing">
      <header className="nb-header">
        <Link href="/">
          <Image src="/logo.png" alt="Nature Bazar" width={150} height={48} />
        </Link>
      </header>

      <div className="nb-stack">
        <article className="nb-card nb-legal">
          <h1>Privacy Policy</h1>
          <p className="nb-legal-date">Effective 8 September 2026</p>

          <p>
            Nature Bazar (&ldquo;we&rdquo;, &ldquo;us&rdquo;) sells food
            products online for cash-on-delivery across Bangladesh. This policy
            explains what personal data we collect when you use this website,
            why we collect it, who we share it with and the choices you have.
            By placing an order you agree to the practices described here.
          </p>

          <h2>1. What we collect</h2>
          <p>When you place an order, or start filling in the order form:</p>
          <ul>
            <li>Your name, mobile number and delivery address.</li>
            <li>Which product and size you ordered, and any note you added.</li>
            <li>
              The details you type into the order form, even if you do not
              finish it, so that we can follow up on an incomplete order.
            </li>
          </ul>
          <p>Automatically, when you visit:</p>
          <ul>
            <li>
              Your IP address, device and browser type, the pages you view and
              the time of your visit.
            </li>
            <li>
              Cookies and similar identifiers set by us and by the advertising
              and analytics services described below.
            </li>
          </ul>
          <p>
            We do not collect payment card details: every order is paid in cash
            on delivery.
          </p>

          <h2>2. How we use it</h2>
          <ul>
            <li>To process, confirm and deliver your order.</li>
            <li>
              To call you to confirm the order before it is dispatched, and to
              contact you about it if something goes wrong.
            </li>
            <li>
              To prevent duplicate or fraudulent orders — for example, one
              order per mobile number within a short period.
            </li>
            <li>
              To measure how our advertising performs and to show you relevant
              offers, as described under Advertising and analytics.
            </li>
            <li>To improve this website and our products.</li>
            <li>To comply with the law and to enforce our terms.</li>
          </ul>

          <h2>3. Who we share it with</h2>
          <p>We share personal data only as needed to run the shop:</p>
          <ul>
            <li>
              <strong>Delivery partners.</strong> Your name, mobile number,
              address and the cash amount due are passed to the courier that
              delivers your parcel (for example Pathao Courier).
            </li>
            <li>
              <strong>Advertising and analytics services.</strong> Meta
              (Facebook) and Google, as described in the next section.
            </li>
            <li>
              <strong>Service providers</strong> that host this website and our
              systems, who act on our instructions.
            </li>
            <li>
              <strong>Authorities</strong>, where the law requires it.
            </li>
          </ul>
          <p>We do not sell your personal data.</p>

          <h2>4. Advertising and analytics</h2>
          <p>
            We use the Meta Pixel and Meta&rsquo;s Conversions API, and may use
            Google Tag Manager and Google Analytics, to understand how visitors
            reach and use this site and to measure our advertising. These tools
            record events such as viewing a product, starting the order form
            and placing an order. When you place an order we may also send
            Meta a hashed (scrambled) version of your name and mobile number so
            that the purchase can be matched to the advertisement that brought
            you here. Meta and Google process this data under their own privacy
            policies. You can limit ad tracking in your browser settings, in
            your Facebook ad preferences, and with tools such as the Google
            Analytics opt-out.
          </p>

          <h2>5. Cookies</h2>
          <p>
            Cookies are small files stored by your browser. We use them to
            remember an order you have just placed on this device, to keep an
            unfinished order form from being lost, and — through the services
            above — for advertising measurement. You can delete or block
            cookies in your browser; the order form still works without them.
          </p>

          <h2>6. How long we keep it</h2>
          <p>
            Order records, including your name, mobile number and address, are
            kept for as long as we need them to fulfil the order, handle
            returns and complaints, keep our accounts and meet legal
            obligations. Details from an order form that was never submitted
            are kept only long enough to follow up, and then deleted.
          </p>

          <h2>7. Security</h2>
          <p>
            Your data is stored on secured servers and transmitted over
            encrypted connections. Access is limited to staff who need it to
            process orders. No method of storage or transmission is completely
            secure, so we cannot guarantee absolute security, but we take
            reasonable steps to protect your data.
          </p>

          <h2>8. Your choices and rights</h2>
          <ul>
            <li>
              You may ask us what personal data we hold about you, ask us to
              correct it, or ask us to delete it where we no longer need it.
            </li>
            <li>
              You may ask us not to contact you for marketing at any time.
            </li>
            <li>
              You may block cookies and opt out of ad tracking as described
              above.
            </li>
          </ul>
          <p>To make a request, contact us using the details below.</p>

          <h2>9. Children</h2>
          <p>
            This website is intended for adults. We do not knowingly collect
            personal data from anyone under 18. If you believe a child has
            given us personal data, contact us and we will delete it.
          </p>

          <h2>10. Changes to this policy</h2>
          <p>
            We may update this policy from time to time. The date at the top
            shows when it was last changed. Continued use of the site after a
            change means you accept the updated policy.
          </p>

          <h2>11. Contact</h2>
          <p>
            Questions about this policy or about your data can be sent to
            Nature Bazar through our Facebook page, or raised with our
            representative when we call to confirm your order.
          </p>

          <Link href="/" className="nb-back">
            ← Back to the shop
          </Link>
        </article>
      </div>

      <footer className="nb-footer">
        <Image src="/logo.png" alt="Nature Bazar" width={120} height={40} />
        <p>© 2026 naturebazar. All rights reserved.</p>
      </footer>
    </main>
  );
}
