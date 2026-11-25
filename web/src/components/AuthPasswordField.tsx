import type { ChangeEvent, ReactNode } from 'react';

function VisibilityIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2.1 12s3.2-5.2 9.9-5.2S21.9 12 21.9 12s-3.2 5.2-9.9 5.2S2.1 12 2.1 12Z" />
      <circle cx="12" cy="12" r="2.7" />
      <path d="m4 4 16 16" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2.1 12s3.2-5.2 9.9-5.2S21.9 12 21.9 12s-3.2 5.2-9.9 5.2S2.1 12 2.1 12Z" />
      <circle cx="12" cy="12" r="2.7" />
    </svg>
  );
}

export function AuthPasswordField({
  label,
  name,
  value,
  placeholder,
  autoComplete,
  visible,
  required = true,
  onChange,
  onFocus,
  onBlur,
  onToggle,
}: {
  label: ReactNode;
  name?: string;
  value: string;
  placeholder: string;
  autoComplete: string;
  visible: boolean;
  required?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  onToggle: () => void;
}) {
  return (
    <label className="sx-labeled-field">
      <span>{label}</span>
      <span
        className="sx-password-control"
        onFocus={onFocus}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onBlur();
        }}
      >
        <input
          className="form-field"
          type={visible ? 'text' : 'password'}
          name={name}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          value={value}
          onChange={onChange}
        />
        <button
          type="button"
          className="sx-password-toggle"
          aria-label={visible ? '隐藏密码' : '显示密码'}
          aria-pressed={visible}
          title={visible ? '隐藏密码' : '显示密码'}
          onPointerDown={(event) => event.preventDefault()}
          onClick={onToggle}
        >
          <VisibilityIcon visible={visible} />
        </button>
      </span>
    </label>
  );
}
