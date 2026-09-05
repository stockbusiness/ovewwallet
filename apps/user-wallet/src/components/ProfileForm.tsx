"use client";

import { useState } from "react";
import type { AccountProfileResponse, ProfileFieldKey, ProfileFieldRequirement } from "@/lib/api";
import { PREFECTURES, PROFILE_FIELD_LABELS } from "@/lib/profile-labels";

type ProfileValues = AccountProfileResponse["profile"];

export interface ProfileFormProps {
  data: AccountProfileResponse;
  saving: boolean;
  onSave: (values: Record<string, string>) => void;
}

const INPUT_CLASS =
  "w-full rounded-lg border border-sengoku-border bg-sengoku-navy px-3 py-2 text-sm text-sengoku-text placeholder:text-sengoku-faint";

function Label({ text, requirement }: { text: string; requirement: ProfileFieldRequirement }) {
  return (
    <span className="flex items-center gap-2 text-xs font-bold text-sengoku-muted">
      {text}
      {requirement === "REQUIRED" && (
        <span className="rounded-full bg-sengoku-gold/15 px-2 py-0.5 text-[10px] font-bold text-sengoku-gold">
          ご記入のお願い
        </span>
      )}
    </span>
  );
}

/**
 * プロフィール入力欄。**どの欄を出すかはAPIが返す`config`に従う**ので、管理画面で
 * 項目を閉じれば再ビルド無しにここから消える (docs/account-profile.md)。
 *
 * 必須 (REQUIRED) でも送信は止めない。未入力のまま送れることが仕様で、
 * 入力しないこと自体をセグメントに使うため。
 */
export function ProfileForm({ data, saving, onSave }: ProfileFormProps) {
  const [values, setValues] = useState<ProfileValues>(data.profile);
  const fields = data.config.fields;

  const visible = (key: ProfileFieldKey) => fields[key] !== "HIDDEN";
  const set = (key: keyof ProfileValues, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    // HIDDENの項目はサーバーが拒否するので、そもそも送らない。
    const payload: Record<string, string> = {};
    if (visible("fullName")) payload.fullName = values.fullName ?? "";
    if (visible("fullNameKana")) payload.fullNameKana = values.fullNameKana ?? "";
    if (visible("phone")) payload.phone = values.phone ?? "";
    if (visible("postalCode")) payload.postalCode = values.postalCode ?? "";
    if (visible("address")) {
      payload.prefecture = values.prefecture ?? "";
      payload.city = values.city ?? "";
      payload.addressLine = values.addressLine ?? "";
      payload.building = values.building ?? "";
    }
    onSave(payload);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {visible("fullName") && (
        <label className="flex flex-col gap-1">
          <Label text={PROFILE_FIELD_LABELS.fullName} requirement={fields.fullName} />
          <input
            className={INPUT_CLASS}
            value={values.fullName ?? ""}
            onChange={(e) => set("fullName", e.target.value)}
            placeholder="山田 太郎"
            autoComplete="name"
          />
        </label>
      )}

      {visible("fullNameKana") && (
        <label className="flex flex-col gap-1">
          <Label text={PROFILE_FIELD_LABELS.fullNameKana} requirement={fields.fullNameKana} />
          <input
            className={INPUT_CLASS}
            value={values.fullNameKana ?? ""}
            onChange={(e) => set("fullNameKana", e.target.value)}
            placeholder="ヤマダ タロウ"
          />
          <span className="text-[11px] text-sengoku-faint">全角カタカナでご記入ください</span>
        </label>
      )}

      {visible("phone") && (
        <label className="flex flex-col gap-1">
          <Label text={PROFILE_FIELD_LABELS.phone} requirement={fields.phone} />
          <input
            className={INPUT_CLASS}
            value={values.phone ?? ""}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="09012345678"
            inputMode="tel"
            autoComplete="tel"
          />
        </label>
      )}

      {visible("postalCode") && (
        <label className="flex flex-col gap-1">
          <Label text={PROFILE_FIELD_LABELS.postalCode} requirement={fields.postalCode} />
          <input
            className={INPUT_CLASS}
            value={values.postalCode ?? ""}
            onChange={(e) => set("postalCode", e.target.value)}
            placeholder="1000001"
            inputMode="numeric"
            autoComplete="postal-code"
          />
        </label>
      )}

      {visible("address") && (
        <fieldset className="flex flex-col gap-3 border-0 p-0">
          <legend className="p-0">
            <Label text={PROFILE_FIELD_LABELS.address} requirement={fields.address} />
          </legend>
          <select
            className={INPUT_CLASS}
            value={values.prefecture ?? ""}
            onChange={(e) => set("prefecture", e.target.value)}
            aria-label="都道府県"
          >
            <option value="">都道府県を選択</option>
            {PREFECTURES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <input
            className={INPUT_CLASS}
            value={values.city ?? ""}
            onChange={(e) => set("city", e.target.value)}
            placeholder="市区町村"
            aria-label="市区町村"
          />
          <input
            className={INPUT_CLASS}
            value={values.addressLine ?? ""}
            onChange={(e) => set("addressLine", e.target.value)}
            placeholder="町名・番地"
            aria-label="町名・番地"
          />
          <input
            className={INPUT_CLASS}
            value={values.building ?? ""}
            onChange={(e) => set("building", e.target.value)}
            placeholder="建物名・部屋番号 (任意)"
            aria-label="建物名・部屋番号"
          />
        </fieldset>
      )}

      <button
        type="submit"
        disabled={saving}
        className="rounded-full bg-sengoku-gold px-6 py-3 text-sm font-bold text-sengoku-ink disabled:opacity-50"
      >
        {saving ? "保存中..." : "保存する"}
      </button>
    </form>
  );
}
