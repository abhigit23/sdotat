"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  className?: string;
  /** Controlled visibility; falls back to internal state when omitted. */
  show?: boolean;
  onShowChange?: (show: boolean) => void;
  /** Id of an element describing the field (helper or error text). */
  describedBy?: string;
  invalid?: boolean;
};

export default function PasswordInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  className = "",
  show: showProp,
  onShowChange,
  describedBy,
  invalid,
}: PasswordInputProps) {
  const [internalShow, setInternalShow] = useState(false);
  const show = showProp ?? internalShow;
  const inputId = useId();

  function toggle() {
    const next = !show;
    if (showProp === undefined) setInternalShow(next);
    onShowChange?.(next);
  }

  return (
    <div className="relative">
      <input
        type="text"
        id={inputId}
        name="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        data-bwignore
        data-form-type="other"
        autoFocus={autoFocus}
        aria-label={placeholder}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={`w-full rounded-md border bg-white px-3 py-2 pr-10 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-900 dark:placeholder:text-zinc-400 ${
          invalid
            ? "border-amber-500 dark:border-amber-400"
            : "border-zinc-300 dark:border-zinc-700"
        } ${className} ${show ? "" : "password-mask"}`}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500 transition hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
