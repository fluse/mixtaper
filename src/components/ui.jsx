import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export function IconButton({ icon: Icon, label, onClick, active, disabled, danger, className = '', size = 18, children, ...rest }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg h-9 min-w-9 px-2 text-sm whitespace-nowrap transition-colors',
        'disabled:opacity-35 disabled:pointer-events-none',
        active
          ? 'bg-tape-500/20 text-tape-400 ring-1 ring-tape-500/40'
          : danger
            ? 'text-ink-300 hover:bg-red-500/15 hover:text-red-400'
            : 'text-ink-300 hover:bg-ink-700 hover:text-white',
        className,
      ].join(' ')}
      {...rest}
    >
      {Icon && <Icon size={size} strokeWidth={2} />}
      {children}
    </button>
  );
}

export function Button({ children, onClick, variant = 'default', disabled, className = '', icon: Icon, type = 'button' }) {
  const styles = {
    default: 'bg-ink-700 hover:bg-ink-600 text-ink-200',
    primary: 'bg-tape-500 hover:bg-tape-400 text-white shadow-lg shadow-tape-500/20',
    danger: 'bg-red-500/15 hover:bg-red-500/25 text-red-300',
    ghost: 'hover:bg-ink-700 text-ink-300',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 h-9 text-sm font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none ${styles[variant]} ${className}`}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

/**
 * Ziehbarer Griff zum Ändern einer Größe.
 * direction "y": nach oben ziehen = größer; "x-left": nach links ziehen = größer.
 */
export function ResizeHandle({ direction, value, onChange, className, title }) {
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = direction === 'y' ? e.clientY : e.clientX;
    const startValue = value;
    const cursor = direction === 'y' ? 'ns-resize' : 'ew-resize';
    document.body.style.cursor = cursor;
    const move = (ev) => {
      const pos = direction === 'y' ? ev.clientY : ev.clientX;
      onChange(startValue + (start - pos));
    };
    const up = () => {
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className={`group ${className}`} onPointerDown={onPointerDown} title={title}>
      <div
        className={`absolute bg-tape-400 opacity-0 group-hover:opacity-70 transition-opacity ${
          direction === 'y' ? 'left-0 right-0 top-1/2 h-0.5 -translate-y-1/2' : 'top-0 bottom-0 left-1/2 w-0.5 -translate-x-1/2'
        }`}
      />
    </div>
  );
}

export function Divider() {
  return <div className="w-px h-6 shrink-0 bg-ink-700 mx-1.5" />;
}

export function Field({ label, children, hint, className = '' }) {
  return (
    <label className={`flex flex-col gap-1.5 text-xs text-ink-400 ${className}`}>
      <span className="font-medium uppercase tracking-wider">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-ink-500 normal-case tracking-normal">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'h-9 rounded-lg bg-ink-900 border border-ink-700 px-3 text-sm text-ink-200 placeholder:text-ink-500 focus:outline-none focus:border-tape-500/60 focus:ring-2 focus:ring-tape-500/15';

export function Slider({ value, min, max, step = 0.01, onChange, onCommit, format, className = '' }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={onCommit}
        className="flex-1 min-w-0"
      />
      {format && <span className="w-14 text-right text-xs tabular-nums text-ink-300">{format(value)}</span>}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer text-sm text-ink-200">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-[#ff5d8f]"
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-ink-500">{hint}</span>}
      </span>
    </label>
  );
}

export function Modal({ title, icon: Icon, onClose, children, width = 'max-w-lg', closable = true }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && closable && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closable, onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
      onPointerDown={(e) => closable && e.target === e.currentTarget && onClose()}
    >
      <div className={`w-full ${width} max-h-full overflow-auto rounded-2xl bg-ink-850 border border-ink-700 shadow-2xl`}>
        <div className="flex items-center gap-3 px-5 h-14 border-b border-ink-700">
          {Icon && <Icon size={20} className="text-tape-400" />}
          <h2 className="font-semibold text-white flex-1">{title}</h2>
          {closable && <IconButton icon={X} label="Schließen" onClick={onClose} />}
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function ProgressBar({ value }) {
  return (
    <div className="h-2 rounded-full bg-ink-700 overflow-hidden">
      <div
        className={`h-full bg-linear-to-r from-tape-500 to-sun-400 transition-[width] duration-200 ${value == null ? 'w-1/3 animate-pulse' : ''}`}
        style={value != null ? { width: `${Math.round(value * 100)}%` } : undefined}
      />
    </div>
  );
}
