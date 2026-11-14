"use client";

import { ArrowRight, Bell, ShieldCheck, Truck } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandLogo, Logo, OUR_BRANDS } from "@/components/ui/logo";
import { Button, Field, inputClass } from "@/components/ui/primitives";

const POINTS = [
  { icon: Truck, title: "Every courier, one login", body: "Book, schedule pickups and track across all couriers." },
  { icon: Bell, title: "Red flags before they hurt", body: "Missed pickups and stuck parcels are raised and escalated automatically." },
  { icon: ShieldCheck, title: "Every step has an owner", body: "No more chasing on WhatsApp. Everyone sees who owns what." },
];

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const validPhone = /^[6-9]\d{9}$/.test(phone);

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-navy px-12 py-10 text-white lg:flex lg:flex-col">
        <div aria-hidden className="absolute -right-32 -top-32 size-96 rounded-full bg-brand-orange/15 blur-3xl" />
        <div aria-hidden className="absolute -bottom-40 -left-24 size-[28rem] rounded-full bg-brand-blue/35 blur-3xl" />
        <Logo onDark />
        <div className="relative mt-auto max-w-lg">
          <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-brand-yellow">
            India&apos;s 1st Multi D2C Brand Retail Platform
          </p>
          <h1 className="mt-3 font-display text-[38px] font-bold leading-[1.12]">
            Shipping you can <span className="text-brand-orange">see</span>, from booking to doorstep.
          </h1>
          <ul className="mt-8 space-y-4">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10">
                  <Icon size={17} className="text-brand-orange" />
                </span>
                <span>
                  <span className="block text-[15px] font-semibold">{title}</span>
                  <span className="mt-0.5 block text-[13.5px] text-white/65">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative mt-10">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-white/55">Shipping for our brands</p>
          <div className="grid grid-cols-4 gap-2.5">
            {OUR_BRANDS.slice(0, 8).map((b) => (
              <div key={b.slug} className="grid h-14 place-items-center rounded-xl bg-white px-3">
                <BrandLogo slug={b.slug} name={b.name} className="max-h-10" />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-white/50">and every D2C brand on D2C Mall, 15+ lifestyle brands in all.</p>
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-sm"
        >
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          <h2 className="font-display text-2xl font-bold text-navy">
            {step === "phone" ? "Sign in" : "Enter the OTP"}
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            {step === "phone"
              ? "Use the mobile number registered with your team."
              : `We sent a 6-digit code to +91 ${phone}.`}
          </p>

          <form
            className="mt-8 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (step === "phone" && validPhone) setStep("otp");
              else if (step === "otp") router.push("/");
            }}
          >
            {step === "phone" ? (
              <Field label="Mobile number">
                <div className="flex">
                  <span className="inline-flex h-10 items-center rounded-l-lg border border-r-0 border-line bg-page px-3 text-sm text-muted">
                    +91
                  </span>
                  <input
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={10}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                    placeholder="98765 43210"
                    className={`${inputClass} rounded-l-none`}
                  />
                </div>
              </Field>
            ) : (
              <Field label="One-time password" hint="Code expires in 5 minutes.">
                <div className="flex gap-2">
                  {Array.from({ length: 6 }, (_, i) => (
                    <input
                      key={i}
                      inputMode="numeric"
                      maxLength={1}
                      aria-label={`Digit ${i + 1}`}
                      className={`${inputClass} w-11 px-0 text-center text-lg font-semibold`}
                    />
                  ))}
                </div>
              </Field>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={step === "phone" && !validPhone}>
              {step === "phone" ? "Send OTP" : "Verify and sign in"}
              <ArrowRight size={17} />
            </Button>
            {step === "otp" ? (
              <button
                type="button"
                onClick={() => setStep("phone")}
                className="w-full text-center text-[13px] font-medium text-brand-blue hover:underline"
              >
                Change number
              </button>
            ) : null}
          </form>

          <p className="mt-10 text-center text-xs text-faint">
            Vendor and courier partners sign in here too, with their own access.
          </p>
          <p className="mt-2 text-center text-xs text-faint">A D2C Ecommerce India platform</p>
        </motion.div>
      </section>
    </div>
  );
}
