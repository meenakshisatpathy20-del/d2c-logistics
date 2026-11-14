import Image from "next/image";

/** Official D2C Ecommerce logo (from d2cecommerce.in), with the Logistics product name. */
export function Logo({ onDark = false, compact = false }: { onDark?: boolean; compact?: boolean }) {
  if (compact) {
    return (
      <span className="flex items-center gap-2.5">
        <Image src="/brand/d2c-ecommerce.webp" alt="D2C Ecommerce" width={900} height={284} priority className="h-7 w-auto" />
        <span className="hidden h-6 w-px bg-line sm:block" aria-hidden />
        <span className="hidden text-[11px] font-semibold uppercase tracking-[0.24em] text-brand-blue-deep sm:block">
          Logistics
        </span>
      </span>
    );
  }
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <span className={onDark ? "rounded-xl bg-white px-3 py-2" : undefined}>
        <Image
          src="/brand/d2c-ecommerce.webp"
          alt="D2C Ecommerce"
          width={900}
          height={284}
          priority
          className="h-8 w-auto"
        />
      </span>
      <span
        className={`text-[10.5px] font-semibold uppercase tracking-[0.28em] ${onDark ? "text-white/70" : "text-brand-blue-deep"}`}
      >
        Logistics
      </span>
    </div>
  );
}

/** Our brands, shown where the platform says who it ships for. */
export const OUR_BRANDS = [
  { slug: "accessher", name: "AccessHer" },
  { slug: "accesshim", name: "AccessHim" },
  { slug: "hilife", name: "Hungama HiLife" },
  { slug: "kasrat", name: "Kasrat" },
  { slug: "luxura", name: "Luxura Sciences" },
  { slug: "bagssy", name: "Bagssy" },
  { slug: "drape-n-don", name: "Drape N Don" },
  { slug: "swarg-homes", name: "Swarg Homes" },
  { slug: "swarg-kitchen", name: "Swarg Kitchen" },
  { slug: "endless-trendz", name: "Endless Trendz" },
  { slug: "baby-babu", name: "Baby Babu" },
  { slug: "d2c-travel", name: "D2C Travel" },
] as const;

export function BrandLogo({ slug, name, className = "h-9" }: { slug: string; name: string; className?: string }) {
  return (
    <Image src={`/brands/${slug}.webp`} alt={name} width={240} height={120} className={`w-auto object-contain ${className}`} />
  );
}
