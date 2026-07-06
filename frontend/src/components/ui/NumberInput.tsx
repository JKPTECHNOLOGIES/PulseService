import { forwardRef, useEffect, useState } from "react";
import type { InputHTMLAttributes } from "react";

interface NumberInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "type"
  > {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
}

/**
 * A `type="number"` input that can actually be cleared.
 *
 * The common bug: a controlled `value={0}` with `onChange={Number(...)}` means
 * deleting the digit yields `""` -> `Number("") === 0`, so the field snaps back
 * to `0` and you can only change it with the arrows. This component keeps the
 * raw text internally so the field can be empty (emitting `null`), while still
 * reporting a `number` as you type. It won't clobber in-progress input like
 * "5." or an intentionally empty field.
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput({ value, onChange, ...rest }, ref) {
    const v = value ?? null;
    const [text, setText] = useState(v === null ? "" : String(v));

    useEffect(() => {
      setText((prev) => {
        const prevNum = prev === "" ? null : Number(prev);
        // Keep what's typed if it already represents the incoming value...
        if (prevNum === v) return prev;
        // ...and don't force-fill a deliberately empty field that maps to 0/null.
        if (prev === "" && (v === null || v === 0)) return prev;
        return v === null ? "" : String(v);
      });
    }, [v]);

    return (
      <input
        ref={ref}
        type="number"
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          onChange(raw === "" ? null : Number(raw));
        }}
        {...rest}
      />
    );
  },
);
