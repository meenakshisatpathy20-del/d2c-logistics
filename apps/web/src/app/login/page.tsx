"use client";

import { ArrowRight, Bell, Eye, EyeOff, Loader2, ShieldCheck, Truck } from "lucide-react";
import { motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { login, type LoginStep, verifyCode } from "@/lib/api";
import { BrandLogo, Logo, OUR_BRANDS } from "@/components/ui/logo";
import { Button, Field, inputClass } from "@/components/ui/primitives";

const POINTS = [
  { icon: Truck, title: "Every courier, one login", body: "Book, schedule pickups and track across all couriers." },
  { icon: Bell, title: "Red flags before they hurt", body: "Missed pickups and stuck parcels are raised and escalated automatically." },
  { icon: ShieldCheck, title: "Every step has an owner", body: "No more chasing on WhatsApp. Everyone sees who owns what." },
];

export default function LoginPage() {
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
        <Suspense>
          <SignIn />
        </Suspense>
      </section>
    </div>
  );
}

/** Step 1: work email + password. Step 2: the 6-digit code. */
function SignIn() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [step, setStep] = useState<LoginStep | null>(null);
  const [code, setCode] = useState<string[]>(Array(6).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const full = code.join("");

  async function submitPassword() {
    setBusy(true);
    setError(null);
    try {
      setStep(await login(email.trim(), password));
      setCode(Array(6).fill(""));
      setTimeout(() => boxes.current[0]?.focus(), 50);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(value = full) {
    if (!step || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await verifyCode(step.challengeId, value);
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (e) {
      setError((e as Error).message);
      setCode(Array(6).fill(""));
      boxes.current[0]?.focus();
      setBusy(false);
    }
  }

  function typeDigit(i: number, raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return setCode((c) => c.map((d, j) => (j === i ? "" : d)));
    // Pasting the whole code fills every box.
    const nextCode = [...code];
    for (let k = 0; k < digits.length && i + k < 6; k++) nextCode[i + k] = digits[k];
    setCode(nextCode);
    const filled = nextCode.join("");
    if (filled.length === 6) void submitCode(filled);
    else boxes.current[Math.min(5, i + digits.length)]?.focus();
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="w-full max-w-sm">
      <div className="mb-10 lg:hidden">
        <Logo />
      </div>
      <h2 className="font-display text-2xl font-bold text-navy">{step ? "Enter the code" : "Sign in"}</h2>
      <p className="mt-1.5 text-sm text-muted">
        {step ? `We sent a 6-digit code to ${step.sentTo}. It works for ${step.expiresInMinutes} minutes.` : "Use your work email and password."}
      </p>

      {step?.demoCode ? (
        <div className="mt-5 rounded-xl border border-dashed border-brand-amber bg-brand-amber-soft px-4 py-3 text-[13px] text-[#b54708]">
          <span className="font-semibold">Demo mode:</span> email delivery is not connected yet, so your code is{" "}
          <span className="font-mono text-[15px] font-bold tracking-widest">{step.demoCode}</span>
        </div>
      ) : null}

      <form
        className="mt-7 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (step) void submitCode();
          else if (validEmail && password) void submitPassword();
        }}
      >
        {!step ? (
          <>
            <Field label="Work email">
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className={inputClass}
                autoFocus
              />
            </Field>
            <Field label="Password" hint="Forgot it? Ask your admin to reset it.">
              <div className="relative">
                <input
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputClass} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted hover:text-ink"
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
          </>
        ) : (
          <Field label="6-digit code">
            <div className="flex gap-2">
              {code.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    boxes.current[i] = el;
                  }}
                  value={d}
                  inputMode="numeric"
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  aria-label={`Digit ${i + 1}`}
                  onChange={(e) => typeDigit(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !d && i > 0) boxes.current[i - 1]?.focus();
                  }}
                  className={`${inputClass} h-12 w-12 px-0 text-center text-lg font-semibold`}
                />
              ))}
            </div>
          </Field>
        )}

        {error ? <p className="rounded-lg bg-flag-red-soft px-3 py-2 text-[13px] font-medium text-flag-red">{error}</p> : null}

        <Button type="submit" size="lg" className="w-full" disabled={busy || (step ? full.length !== 6 : !validEmail || !password)}>
          {busy ? <Loader2 size={17} className="animate-spin" /> : null}
          {step ? "Verify and sign in" : "Continue"}
          {!busy ? <ArrowRight size={17} /> : null}
        </Button>
        {step ? (
          <div className="flex justify-between text-[13px] font-medium">
            <button type="button" onClick={() => setStep(null)} className="text-brand-blue hover:underline">
              Use another account
            </button>
            <button type="button" onClick={() => void submitPassword()} className="text-brand-blue hover:underline" disabled={busy}>
              Send a new code
            </button>
          </div>
        ) : null}
      </form>

      <p className="mt-10 text-center text-xs text-faint">Vendor and courier partners sign in here too, with their own access.</p>
      <p className="mt-2 text-center text-xs text-faint">A D2C Ecommerce India platform</p>
    </motion.div>
  );
}
