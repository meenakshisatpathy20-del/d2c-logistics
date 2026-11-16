"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Logo } from "@/components/ui/logo";
import { Button, Field, inputClass } from "@/components/ui/primitives";
import { type LoginStep, vendorLogin, verifyCode } from "@/lib/api";

/** Vendor sign-in: mobile number, then the 6-digit code. No password, no app. */
export default function VendorLoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState<LoginStep | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeBox = useRef<HTMLInputElement>(null);
  const validPhone = /^[6-9]\d{9}$/.test(phone);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      setStep(await vendorLogin(phone));
      setCode("");
      setTimeout(() => codeBox.current?.focus(), 50);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(value = code) {
    if (!step || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await verifyCode(step.challengeId, value);
      router.replace("/v");
    } catch (e) {
      setError((e as Error).message);
      setCode("");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col px-6 py-10">
      <Logo />
      <div className="mt-14">
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand-orange">Vendor partner</p>
        <h1 className="mt-2 font-display text-[28px] font-bold leading-tight text-navy">{step ? "Enter the code" : "Your pickups, on your phone"}</h1>
        <p className="mt-2 text-[15px] text-muted">
          {step ? `We sent a 6-digit code to ${step.sentTo}.` : "Sign in with the mobile number registered with D2C Ecommerce."}
        </p>
      </div>

      {step?.demoCode ? (
        <div className="mt-6 rounded-xl border border-dashed border-brand-amber bg-brand-amber-soft px-4 py-3 text-[14px] text-[#b54708]">
          <span className="font-semibold">Demo mode:</span> SMS is not connected yet, so your code is{" "}
          <span className="font-mono text-[16px] font-bold tracking-widest">{step.demoCode}</span>
        </div>
      ) : null}

      <form
        className="mt-8 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (step) void verify();
          else if (validPhone) void send();
        }}
      >
        {!step ? (
          <Field label="Mobile number">
            <div className="flex">
              <span className="inline-flex h-12 items-center rounded-l-lg border border-r-0 border-line bg-white px-3 text-[15px] text-muted">+91</span>
              <input
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={10}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                placeholder="98765 43210"
                className={`${inputClass} h-12 rounded-l-none text-[16px]`}
                autoFocus
              />
            </div>
          </Field>
        ) : (
          <Field label="6-digit code">
            <input
              ref={codeBox}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(v);
                if (v.length === 6) void verify(v);
              }}
              aria-label="6-digit code"
              className={`${inputClass} h-14 text-center font-mono text-[24px] tracking-[0.5em]`}
            />
          </Field>
        )}
        {error ? <p className="rounded-lg bg-flag-red-soft px-3 py-2 text-[14px] font-medium text-flag-red">{error}</p> : null}
        <Button type="submit" size="lg" className="h-12 w-full text-[16px]" disabled={busy || (step ? code.length !== 6 : !validPhone)}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : null}
          {step ? "Verify" : "Send code"} {!busy ? <ArrowRight size={18} /> : null}
        </Button>
        {step ? (
          <button type="button" onClick={() => setStep(null)} className="w-full text-center text-[14px] font-medium text-brand-blue">
            Change number
          </button>
        ) : null}
      </form>
      <p className="mt-auto pt-10 text-center text-xs text-faint">D2C Ecommerce India · Logistics</p>
    </div>
  );
}
