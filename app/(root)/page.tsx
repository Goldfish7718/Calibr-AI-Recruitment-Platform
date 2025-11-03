"use client";

import { Hero } from "./_components/Hero";
import dynamic from "next/dynamic";
import { Suspense } from "react";
import { ToastHandler } from "./_components/ToastHandler";

const HowItWorks = dynamic(() => import("./_components/HowItWorks"), {
  loading: () => <div className="h-screen flex items-center justify-center">Loading...</div>,
});
const Features = dynamic(() => import("./_components/Features"), {
  loading: () => <div className="h-screen flex items-center justify-center">Loading...</div>,
});
const Benefits = dynamic(() => import("./_components/Benifits"), {
  loading: () => <div className="h-screen flex items-center justify-center">Loading...</div>,
});
const Testimonials = dynamic(() => import("./_components/Testimonials"), {
  loading: () => <div className="h-screen flex items-center justify-center">Loading...</div>,
});
const CallToAction = dynamic(() => import("./_components/CallToAction"), {
  loading: () => <div className="h-screen flex items-center justify-center">Loading...</div>,
});

export default function Home() {
  return (
    <div>
      <Suspense fallback={null}>
        <ToastHandler />
      </Suspense>
      <Hero />
      <HowItWorks />
      <Features />
      <Benefits />
      <Testimonials />
      <CallToAction />
    </div>
  );
}
