"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  bengaliNumber,
  OrderSuccess,
} from "@/components/storefront/order-success";
import { isValidAddress } from "@/lib/address";
import { ApiError } from "@/lib/http";
import { cleanPhoneInput, toBdMobile } from "@/lib/phone";
import {
  onLastOrderChange,
  readLastOrder,
  rememberOrder,
  type LastOrder,
} from "@/lib/last-order";
import {
  productImage,
  trackedItem,
  type StorefrontProduct,
} from "@/lib/products";
import { createOrder } from "@/lib/storefront-api";
import { useOrderDraft } from "@/lib/use-order-draft";
import {
  normalisePhone,
  trackAddToCart,
  trackBeginCheckout,
  trackPurchase,
  trackViewCart,
  trackViewItem,
} from "@/lib/tracking";

/**
 * The storefront. The product it sells is passed in from the server component
 * that wraps it, so the price is in the HTML from the first byte rather than
 * arriving after a client fetch.
 */
export function Storefront({ product }: { product: StorefrontProduct }) {
  // The confirmed order, if any: set on submit, or restored from this device
  // on a return visit. `fresh` is only true right after submitting.
  const [lastOrder, setLastOrder] = useState<LastOrder | null>(null);
  const [fresh, setFresh] = useState(false);
  const orderSectionRef = useRef<HTMLElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<
    "cooldown" | "throttled" | "failed" | "phone" | "address" | null
  >(null);
  const [phoneValue, setPhoneValue] = useState("");
  const orderTableRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const checkoutStarted = useRef(false);
  // Keeps a half-filled form as a lead even if this visitor never orders.
  const draft = useOrderDraft(formRef);

  // Everything the analytics events describe comes from the product actually
  // on sale, so editing it in the admin can never leave GA4 or Meta reporting
  // the old name or price.
  const items = useMemo(() => [trackedItem(product)], [product]);
  // How many the order form places. The product decides the default; free
  // delivery means the total is simply the line total.
  const quantity = Math.max(1, product.defaultQuantity);
  const money = `${bengaliNumber(product.unitPrice * quantity)}.০০৳`;

  // view_item: the storefront (single product page) was shown.
  useEffect(() => {
    trackViewItem(items);
  }, [items]);

  // Back within 24h of ordering: show the confirmation, not a form that would
  // only refuse the same number. Also follow another tab that just ordered.
  useEffect(() => {
    setLastOrder(readLastOrder());
    return onLastOrderChange((order) => {
      setLastOrder(order);
      setFresh(false);
    });
  }, []);

  // view_cart: the "Your order" table scrolled into view, once per load.
  useEffect(() => {
    const el = orderTableRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          trackViewCart(items);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [items]);

  // begin_checkout: the user started filling the order form, once per load.
  function handleFormFocus() {
    if (checkoutStarted.current) return;
    checkoutStarted.current = true;
    trackBeginCheckout(items);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const form = new FormData(event.currentTarget);
    const customerName = String(form.get("name") ?? "").trim();
    const address = String(form.get("address") ?? "").trim();
    // The courier only accepts 01XXXXXXXXX, so the number is checked here
    // and sent in that exact form.
    const phone = toBdMobile(String(form.get("phone") ?? ""));
    if (!phone) {
      setSubmitError("phone");
      event.currentTarget.phone?.focus?.();
      return;
    }
    // Drafts autosave whatever was typed; only a real submit needs an
    // address a courier can use.
    if (!isValidAddress(address)) {
      setSubmitError("address");
      event.currentTarget.address?.focus?.();
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const order = await createOrder({
        customerName,
        phone,
        address,
        quantity,
        // Promotes this visit's autosaved row instead of creating a second one.
        draftKey: draft.getDraftKey(),
      });
      draft.stop();
      const placed: LastOrder = {
        orderNo: order.orderNo,
        name: customerName,
        phone,
        address,
        at: Date.now(),
      };
      rememberOrder(placed);
      setLastOrder(placed);
      setFresh(true);
      orderSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      trackPurchase({
        items,
        transactionId: order.orderNo,
        user: {
          first_name: customerName.split(/\s+/)[0] ?? "",
          phone: normalisePhone(phone),
          street: address,
          country: "BD",
        },
      });
    } catch (err) {
      // 409: this number already ordered within the cooldown window.
      // 429: too many attempts from this connection right now.
      const status = err instanceof ApiError ? err.status : 0;
      setSubmitError(
        status === 409
          ? "cooldown"
          : status === 429
            ? "throttled"
            : status === 422
              ? err instanceof ApiError && /address/i.test(err.message)
                ? "address"
                : "phone"
              : "failed",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="storefront">
      <header className="store-header">
        <Image
          src="/logo.png"
          alt="Nature Bazar"
          width={155}
          height={51}
          priority
        />
      </header>

      <div className="dark-zone">
        <section className="hero-image">
          <Image
            src="/campaign.jpg"
            alt="Nature Bazar Millionaire Campaign"
            width={1146}
            height={672}
            sizes="(max-width: 680px) 100vw, 680px"
            priority
          />
        </section>

        <section className="how-section">
          <Image
            src="/how-it-works.jpeg"
            alt="কীভাবে অংশগ্রহণ করবেন"
            width={812}
            height={232}
            sizes="(max-width: 680px) 100vw, 680px"
          />
        </section>

        <section className="order-btn-section">
          <a
            className="order-now"
            href="#order"
            onClick={() => trackAddToCart(items)}
          >
            অর্ডার করুন
          </a>
        </section>

        <section className="wide-image prizes-image">
          <Image
            src="/prizes.jpg"
            alt="Nature Bazar ক্যাম্পেইনের আকর্ষণীয় পুরস্কার"
            width={877}
            height={877}
            sizes="(max-width: 680px) 100vw, 680px"
          />
        </section>

        <section className="product-showcase">
          <Image
            src="/products.jpg"
            alt="ইলিশ, গরুর মাংস ও চেপা শুটকির আচার"
            width={1120}
            height={450}
            sizes="(max-width: 680px) 100vw, 680px"
          />
          <div className="offer-price-row">
            <Image
              src="/offer-price.png"
              alt="১৪৯০ টাকা অফার"
              width={180}
              height={120}
            />
          </div>
        </section>
      </div>

      <section className="order-section" id="order" ref={orderSectionRef}>
        {lastOrder ? (
          <OrderSuccess
            order={lastOrder}
            product={product}
            fresh={fresh}
          />
        ) : (
          <>
            <h2 className="eyebrow">অর্ডার করতে নিচের ফর্মটি ফিলআপ করুন</h2>

            <form
              ref={formRef}
              onSubmit={handleSubmit}
              onFocusCapture={handleFormFocus}
              onInput={draft.onFormInput}
              onBlurCapture={draft.onFieldBlur}
            >
              <label>
                নাম
                <input
                  required
                  name="name"
                  maxLength={120}
                  placeholder="আপনার নাম লিখুন"
                />
              </label>
              <label>
                ফোন নাম্বার
                <input
                  required
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={14}
                  value={phoneValue}
                  onChange={(e) => {
                    setPhoneValue(cleanPhoneInput(e.target.value));
                    if (submitError === "phone") setSubmitError(null);
                  }}
                  aria-invalid={submitError === "phone" || undefined}
                  placeholder="01XXXXXXXXX"
                />
              </label>
              <label>
                ঠিকানা
                <textarea
                  required
                  name="address"
                  rows={3}
                  minLength={4}
                  maxLength={1000}
                  onChange={() => {
                    if (submitError === "address") setSubmitError(null);
                  }}
                  aria-invalid={submitError === "address" || undefined}
                  placeholder="বাসা/রোড নম্বর, গ্রাম/মহল্লা, উপজেলা, জেলা"
                />
              </label>
              {submitError === "address" && (
                <p className="form-error">
                  সম্পূর্ণ ঠিকানা লিখুন — বাসা/রোড, এলাকা, জেলা (কমপক্ষে ৩ শব্দ, শুধু সংখ্যা নয়)।
                </p>
              )}
              {submitError === "phone" && (
                <p className="form-error">
                  সঠিক মোবাইল নাম্বার দিন — ১১ ডিজিট, 01 দিয়ে শুরু (যেমন
                  01712345678)।
                </p>
              )}
              {submitError === "cooldown" && (
                <p className="form-error">
                  এই নাম্বার থেকে ইতিমধ্যে একটি অর্ডার করা হয়েছে। আমাদের
                  প্রতিনিধি শিগগিরই আপনার সাথে যোগাযোগ করবেন। নতুন অর্ডারের জন্য
                  ২৪ ঘণ্টা পর আবার চেষ্টা করুন।
                </p>
              )}
              {submitError === "throttled" && (
                <p className="form-error">
                  একসাথে অনেকবার চেষ্টা করা হয়েছে। অনুগ্রহ করে কয়েক মিনিট পর
                  আবার চেষ্টা করুন।
                </p>
              )}
              {submitError === "failed" && (
                <p className="form-error">
                  দুঃখিত, অর্ডারটি জমা দেওয়া যায়নি। একটু পরে আবার চেষ্টা করুন।
                </p>
              )}
              <button type="submit" disabled={submitting}>
                {submitting ? "অর্ডার পাঠানো হচ্ছে…" : "অর্ডার কনফার্ম করুন"}{" "}
                <span>→</span>
              </button>
              <small className="form-note">
                ক্যাশ অন ডেলিভারি · সারা বাংলাদেশে ফ্রি ডেলিভারি
              </small>
            </form>
          </>
        )}
      </section>

      <section className="order-details" ref={orderTableRef}>
        <h4>Shipping</h4>
        <div className="shipping-box">সারা বাংলাদেশ ফ্রী হোম ডেলিভারি।</div>
        <h4 className="order-summary-heading">Your order</h4>
        <div className="order-table">
          <div>
            <b>Product</b>
            <b>Subtotal</b>
          </div>
          <div>
            <div className="order-product">
              <Image
                src={productImage(product)}
                alt={product.title}
                width={60}
                height={60}
              />
              <span>
                {product.title} × {bengaliNumber(quantity)}
              </span>
            </div>
            <span>{money}</span>
          </div>
          <div>
            <span>Subtotal</span>
            <span>{money}</span>
          </div>
          <div>
            <span>Shipping</span>
            <span>সারা বাংলাদেশ ফ্রী হোম ডেলিভারি।</span>
          </div>
          <div>
            <b>Total</b>
            <b>{money}</b>
          </div>
        </div>
        <div className="cash-box">
          <h3>Cash on delivery</h3>
          <p>Pay with cash upon delivery.</p>
        </div>
        <p className="privacy-note">
          Your personal data will be used to process your order, support your
          experience throughout this website, and for other purposes described
          in our privacy policy.
        </p>
        <a
          className="checkout-button"
          href="#order"
          onClick={() => trackAddToCart(items)}
        >
          <span className="checkout-lock">🔒</span> অর্ডার করুন{" "}
          <span>১,৪৯০.০০৳</span>
        </a>
      </section>
      <footer className="store-footer">
        <Image src="/logo.png" alt="Nature Bazar" width={130} height={43} />
        <p>© 2026 naturebazar. All rights reserved.</p>
        <div>
          <a href="#">Privacy policy</a>
          <a href="#">Terms of service</a>
        </div>
      </footer>
    </main>
  );
}
