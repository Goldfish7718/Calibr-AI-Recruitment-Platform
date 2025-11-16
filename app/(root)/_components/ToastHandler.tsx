"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

const toastMessages: Record<string, string> = {
  login_required: "You must log in to continue.",
  access_only_for_candidate: "Access denied for Employer.",
  access_only_for_employer: "Access denied for Candidate.",
  // add more mappings as needed
};

export function ToastHandler() {
  const searchParams = useSearchParams();
  
  useEffect(() => {
    const toastKey = searchParams.get("toast");
    if (toastKey) {
      const message = toastMessages[toastKey] || toastKey.replaceAll("_", " ");
      toast.error(message);
    }
  }, [searchParams]);

  return null;
}
