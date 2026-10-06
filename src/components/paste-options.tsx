"use client";

import { Dices } from "lucide-react";
import PasswordInput from "./password-input";
import { EXPIRY_OPTIONS } from "@/lib/expiry";
import { generatePassphrase } from "@/lib/passphrase";

type Props = {
  expiresIn: string;
  onExpiresInChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  showPassword: boolean;
  onShowPasswordChange: (show: boolean) => void;
  passwordTooShort: boolean;
  passwordWeak: boolean;
  minPasswordLength: number;
  burnAfterRead: boolean;
  onBurnAfterReadChange: (burn: boolean) => void;
  hasFiles: boolean;
};

/** The editor's options row: expiration, password and burn after reading. */
export default function PasteOptions({
  expiresIn,
  onExpiresInChange,
  password,
  onPasswordChange,
  showPassword,
  onShowPasswordChange,
  passwordTooShort,
  passwordWeak,
  minPasswordLength,
  burnAfterRead,
  onBurnAfterReadChange,
  hasFiles,
}: Props) {
  function generatePassword() {
    onPasswordChange(generatePassphrase());
    // Show it so the user can copy it before it is masked.
    onShowPasswordChange(true);
  }

  return (
    <div className="grid shrink-0 grid-cols-1 gap-2 short:max-sm:grid-cols-[0.7fr_1.3fr] sm:grid-cols-2 md:grid-cols-3 tiny:grid-cols-3">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium tiny:sr-only">Expiration</span>
        <select
          id="paste-expiration"
          name="expiresIn"
          value={expiresIn}
          onChange={(e) => onExpiresInChange(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {EXPIRY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-zinc-500 short:hidden dark:text-zinc-400">
          The paste is deleted automatically after this.
        </span>
      </label>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2 tiny:justify-end">
          <span className="text-sm font-medium tiny:sr-only">Password</span>
          <button
            type="button"
            onClick={generatePassword}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            <Dices size={12} aria-hidden />
            Generate
          </button>
        </div>
        <PasswordInput
          value={password}
          onChange={onPasswordChange}
          placeholder="Protect with a password"
          show={showPassword}
          onShowChange={onShowPasswordChange}
          describedBy="password-hint"
          invalid={passwordTooShort}
        />
        <span
          id="password-hint"
          className={`text-xs ${
            passwordTooShort || passwordWeak
              ? "text-amber-700 dark:text-amber-400"
              : "text-zinc-500 short:hidden dark:text-zinc-400"
          }`}
        >
          {passwordTooShort
            ? `Use at least ${minPasswordLength} characters.`
            : passwordWeak
              ? "Weak password. Try Generate."
              : "Optional. You share it separately from the link."}
        </span>
      </div>

      <label className="flex items-start gap-2 short:max-sm:col-span-2 sm:col-span-2 md:col-span-1 md:pt-6 tiny:col-span-1 tiny:pt-6">
        <input
          type="checkbox"
          id="burn-after-read"
          name="burnAfterRead"
          checked={burnAfterRead}
          disabled={hasFiles}
          onChange={(e) => onBurnAfterReadChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
        />
        <span className="flex flex-col">
          <span className="text-sm font-medium">Burn after reading</span>
          <span className="text-xs text-zinc-500 short:hidden dark:text-zinc-400">
            Deleted after first opening. Can&apos;t be used with attachments.
          </span>
          {hasFiles && (
            <span className="text-xs text-amber-700 short:hidden dark:text-amber-400">
              Remove attachments to use this.
            </span>
          )}
        </span>
      </label>
    </div>
  );
}
