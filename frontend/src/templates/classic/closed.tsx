import Image from "next/image";

import "./landing.css";
import { rawImage } from "@/templates/raw-image";
import type { ClosedProps } from "@/templates/types";

/** The shop with nothing to sell: the logo and a line, nothing to tap. */
export function Closed({ store }: ClosedProps) {
  return (
    <main className="nb-landing" style={store.themeVars}>
      <header className="nb-header">
        <Image
          src={store.content.logo}
          alt={store.name}
          width={150}
          height={48}
          priority
          unoptimized={rawImage(store.content.logo)}
        />
      </header>
      <div className="nb-stack">
        <section className="nb-card nb-closed">
          <h1>এই মুহূর্তে কোনো পণ্য বিক্রির জন্য নেই</h1>
          <p>আমরা শিগগিরই ফিরছি। একটু পরে আবার দেখুন।</p>
        </section>
      </div>
    </main>
  );
}
