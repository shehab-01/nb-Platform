"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import "./landing.css";
import { OrderSuccess } from "@/components/storefront/order-success";
import { ApiError } from "@/lib/http";
import {
  onLastOrderChange,
  readLastOrder,
  rememberOrder,
  type LastOrder,
} from "@/lib/last-order";
import { cleanPhoneInput, toBdMobile } from "@/lib/phone";
import {
  productImage,
  trackedItem,
  type StorefrontListing,
  type StorefrontVariant,
} from "@/lib/products";
import { createOrder } from "@/lib/storefront-api";
import {
  normalisePhone,
  trackAddToCart,
  trackBeginCheckout,
  trackPurchase,
  trackViewItem,
} from "@/lib/tracking";
import { useOrderDraft } from "@/lib/use-order-draft";

/** "1,650" — Latin digits with a thousands comma, as the design prices things. */
function taka(amount: number): string {
  return amount.toLocaleString("en-US");
}

/**
 * The landing page. Mobile first, and deliberately one straight column of
 * cards: the product, the sizes to pick from, the order
 * form, then the description — nothing to navigate and nowhere to get lost.
 *
 * The offer is the live product and its sizes, passed in from the server
 * component so the prices are in the HTML from the first byte. Picking a size
 * swaps the picture, the title and every figure on the page, and its id goes
 * with the order so the API prices that row — the browser never says what
 * anything costs.
 */
export function Landing({ listing }: { listing: StorefrontListing }) {
  const { variants } = listing;
  // The selected size, as a position in the list. Ids are null on the
  // fallback and skus are not unique, so the index is the one key that is.
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      variants.findIndex((v) => v.isDefault),
    ),
  );
  const variant = variants[index] ?? variants[0];
  // How many one order places; the catalogue row decides. Free delivery, so
  // the total is simply the line total.
  const quantity = Math.max(1, variant.defaultQuantity);
  const total = variant.unitPrice * quantity;

  // The confirmed order, if any: set on submit, or restored from this device
  // on a return visit. `fresh` is only true right after submitting.
  const [lastOrder, setLastOrder] = useState<LastOrder | null>(null);
  const [fresh, setFresh] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<
    "cooldown" | "throttled" | "failed" | "phone" | null
  >(null);
  const [phoneValue, setPhoneValue] = useState("");
  const orderSectionRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const checkoutStarted = useRef(false);
  // Keeps a half-filled form as a lead even if this visitor never orders.
  const draft = useOrderDraft(formRef);

  // Everything the analytics events describe comes from the size actually
  // selected: its own catalogue id, its own price, and the quantity this
  // order will carry, so GA4 and Meta report the sale that was really made.
  const items = useMemo(
    () => [{ ...trackedItem(variant), quantity }],
    [variant, quantity],
  );

  // view_item / ViewContent: once per page load per product — on load for
  // the default size, and once more when a size with a different catalogue id
  // is picked (to Meta each id is its own content). Picking the same size
  // again, or a quantity change, fires nothing.
  const viewedSku = useRef<string | null>(null);
  useEffect(() => {
    if (viewedSku.current === variant.sku) return;
    viewedSku.current = variant.sku;
    trackViewItem(items);
  }, [variant.sku, items]);

  // Back within 24h of ordering: show the confirmation, not a form that would
  // only refuse the same number. Also follow another tab that just ordered.
  useEffect(() => {
    setLastOrder(readLastOrder());
    return onLastOrderChange((order) => {
      setLastOrder(order);
      setFresh(false);
    });
  }, []);

  function scrollToOrder() {
    orderSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

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
    setSubmitting(true);
    setSubmitError(null);
    try {
      const order = await createOrder({
        customerName,
        phone,
        address,
        quantity,
        variantId: variant.id,
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
      scrollToOrder();
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
              ? "phone"
              : "failed",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="nb-landing">
      {/* Kept from the old page: the logo bar, pinned to the top. */}
      <header className="nb-header">
        <Image
          src="/logo.png"
          alt="Nature Bazar"
          width={150}
          height={48}
          priority
        />
      </header>

      <div className="nb-stack">
      {/* One card from the title to the description. The title, the picture
          and the button follow whichever size is selected in the picker. */}
      <section className="nb-card nb-product">
        <h1>{variant.title}</h1>
        <div
          className="nb-product-image"
          // No picture yet: the logo stands in, on the dark ground it was
          // drawn for and with room around it, rather than a stretched crop.
          data-placeholder={variant.imageUrl === null || undefined}
        >
          <Image
            // Keyed on the selection so switching size fades in the new
            // picture instead of leaving the old one up while it loads.
            key={index}
            src={productImage(variant)}
            alt={variant.title}
            width={1120}
            height={1120}
            sizes="(max-width: 560px) 100vw, 560px"
            priority
          />
        </div>
        <button
          type="button"
          className="nb-cta-top"
          onClick={() => {
            trackAddToCart(items);
            scrollToOrder();
          }}
        >
          অর্ডার করতে চাই
        </button>

        <div className="nb-block" aria-labelledby="nb-pick">
        <h2 id="nb-pick">কত প্যাকেট নিতে চান সিলেক্ট করুন</h2>
        {variants.map((v, i) => (
          <SizeOption
            key={i}
            variant={v}
            selected={i === index}
            onSelect={() => setIndex(i)}
          />
        ))}
        </div>

        {/* What the form below will order, so the figure on the confirm
            button never comes as a surprise. */}
        <div className="nb-block nb-summary" aria-label="অর্ডার সারাংশ">
          <div>
            <span>
              {variant.title}
              {quantity > 1 ? ` × ${quantity}` : ""}
            </span>
            <span>৳{taka(total)}</span>
          </div>
          <div>
            <span>মোট</span>
            <span>৳{taka(total)}</span>
          </div>
          <div className="nb-summary-total">
            <span>Total</span>
            <span>৳{taka(total)}</span>
          </div>
        </div>

        <section
        className="nb-block"
        id="order"
        ref={orderSectionRef}
        aria-labelledby="nb-form"
      >
        {lastOrder ? (
          <OrderSuccess
            order={lastOrder}
            product={variant}
            fresh={fresh}
          />
        ) : (
          <>
            <h2 id="nb-form">অর্ডার করতে নিচের তথ্যগুলি দিন</h2>
            <form
              ref={formRef}
              onSubmit={handleSubmit}
              onFocusCapture={handleFormFocus}
              onInput={draft.onFormInput}
              onBlurCapture={draft.onFieldBlur}
            >
              <label className="nb-field">
                <span>নাম</span>
                <input
                  required
                  name="name"
                  maxLength={120}
                  autoComplete="name"
                  placeholder="আপনার নাম"
                />
              </label>
              <label className="nb-field">
                <span>মোবাইল নাম্বার</span>
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
                  placeholder="11 ডিজিট মোবাইল নাম্বার"
                />
              </label>
              <label className="nb-field">
                <span>ঠিকানা</span>
                <textarea
                  required
                  name="address"
                  rows={3}
                  minLength={4}
                  maxLength={1000}
                  placeholder="বাসা নম্বর, গ্রাম/মহল্লা, উপজেলা, জেলা"
                />
              </label>
              {submitError === "phone" && (
                <p className="nb-form-error">
                  সঠিক মোবাইল নাম্বার দিন — ১১ ডিজিট, 01 দিয়ে শুরু (যেমন
                  01712345678)।
                </p>
              )}
              {submitError === "cooldown" && (
                <p className="nb-form-error">
                  এই নাম্বার থেকে ইতিমধ্যে একটি অর্ডার করা হয়েছে। আমাদের
                  প্রতিনিধি শিগগিরই আপনার সাথে যোগাযোগ করবেন। নতুন অর্ডারের জন্য
                  ২৪ ঘণ্টা পর আবার চেষ্টা করুন।
                </p>
              )}
              {submitError === "throttled" && (
                <p className="nb-form-error">
                  একসাথে অনেকবার চেষ্টা করা হয়েছে। অনুগ্রহ করে কয়েক মিনিট পর
                  আবার চেষ্টা করুন।
                </p>
              )}
              {submitError === "failed" && (
                <p className="nb-form-error">
                  দুঃখিত, অর্ডারটি জমা দেওয়া যায়নি। একটু পরে আবার চেষ্টা করুন।
                </p>
              )}

              <button type="submit" className="nb-confirm" disabled={submitting}>
                {submitting
                  ? "অর্ডার পাঠানো হচ্ছে…"
                  : `অর্ডার কনফার্ম করুন ${taka(total)} TK`}
              </button>
              <p className="nb-confirm-note">
                আমাদের একজন কাস্টমার প্রতিনিধি আপনাকে কল করে আবার কনফার্ম হবে
                <br />
                ক্যাশ অন ডেলিভারি · সারা বাংলাদেশে ফ্রি ডেলিভারি
              </p>
            </form>
          </>
        )}
        </section>

        <ProductDescription text={listing.description} />
      </section>

      <button
        type="button"
        className="nb-cta-top nb-cta-bottom"
        onClick={() => {
          trackAddToCart(items);
          scrollToOrder();
        }}
      >
        অর্ডার করতে চাই
      </button>
      </div>

      <footer className="nb-footer">
        <Image src="/logo.png" alt="Nature Bazar" width={120} height={40} />
        <p>© 2026 naturebazar. All rights reserved.</p>
        <p>
          <a href="/privacy-policy">Privacy policy</a>
        </p>
      </footer>
    </main>
  );
}

/** One size: radio, thumbnail, title, price. Selecting it drives the page. */
function SizeOption({
  variant,
  selected,
  onSelect,
}: {
  variant: StorefrontVariant;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label className="nb-variant" data-selected={selected}>
      <input
        type="radio"
        name="size"
        checked={selected}
        onChange={onSelect}
      />
      <Image
        className="nb-variant-thumb"
        data-placeholder={variant.imageUrl === null || undefined}
        src={productImage(variant)}
        alt=""
        width={64}
        height={64}
      />
      <div className="nb-variant-text">
        <p className="nb-variant-title">{variant.title}</p>
        <span className="nb-price">৳{taka(variant.unitPrice)}</span>
      </div>
    </label>
  );
}

/**
 * The description below the fold, written on the product in the admin. Plain
 * text with blank lines between paragraphs until the rich text editor lands,
 * at which point this renders stored HTML instead. Nothing to say, nothing
 * shown: an empty section would only make the page look unfinished.
 */
function ProductDescription({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return null;
  return (
    <div className="nb-desc" aria-labelledby="nb-desc">
      <h2 id="nb-desc">পণ্যের বিবরণ</h2>
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}
