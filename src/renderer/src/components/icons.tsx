interface IconProps {
  size?: number
}

function base(size: number, children: React.ReactNode): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function IconSidebar({ size = 18 }: IconProps): React.JSX.Element {
  return base(
    size,
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </>
  )
}

export function IconFolder({ size = 16 }: IconProps): React.JSX.Element {
  return base(
    size,
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  )
}

export function IconProject({ size = 16 }: IconProps): React.JSX.Element {
  return base(
    size,
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  )
}

export function IconUsers({ size = 16 }: IconProps): React.JSX.Element {
  return base(
    size,
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
      <path d="M16 5.4a3 3 0 0 1 0 5.6" />
      <path d="M17.5 14.6c1.7.6 2.8 2.1 3.1 4.4" />
    </>
  )
}

export function IconGear({ size = 18 }: IconProps): React.JSX.Element {
  return base(
    size,
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
    </>
  )
}

export function IconPlus({ size = 16 }: IconProps): React.JSX.Element {
  return base(
    size,
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  )
}

export function IconTrash({ size = 15 }: IconProps): React.JSX.Element {
  return base(
    size,
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </>
  )
}

export function IconPencil({ size = 15 }: IconProps): React.JSX.Element {
  return base(
    size,
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  )
}

export function IconChevron({ size = 14 }: IconProps): React.JSX.Element {
  return base(size, <path d="m6 9 6 6 6-6" />)
}

export function IconClose({ size = 16 }: IconProps): React.JSX.Element {
  return base(
    size,
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>
  )
}

export function IconMinimize({ size = 12 }: IconProps): React.JSX.Element {
  return <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" stroke="currentColor" strokeWidth="1.2" /></svg>
}

export function IconMaximize({ size = 12 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="2.4" y="2.4" width="7.2" height="7.2" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

export function IconRestore({ size = 12 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="2.2" y="3.8" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4.2 3.6V2.6a1 1 0 0 1 1-1h4.2a1 1 0 0 1 1 1v4.2a1 1 0 0 1-1 1h-1" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

export function IconSend({ size = 17 }: IconProps): React.JSX.Element {
  return base(
    size,
    <>
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </>
  )
}

export function IconStop({ size = 15 }: IconProps): React.JSX.Element {
  return <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" /></svg>
}

export function IconRelay({ size = 16 }: IconProps): React.JSX.Element {
  return base(
    size,
    <>
      <path d="M4 7h12a3 3 0 0 1 3 3v4" />
      <path d="m15 4 4 3-4 3" />
      <path d="M20 17H8a3 3 0 0 1-3-3v-4" />
      <path d="m9 20-4-3 4-3" />
    </>
  )
}

export function IconSpark({ size = 16 }: IconProps): React.JSX.Element {
  return base(
    size,
    <>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="m6.3 6.3 2.4 2.4M15.3 15.3l-2.4-2.4M17.7 6.3l-2.4 2.4M8.7 15.3l-2.4 2.4" />
    </>
  )
}
