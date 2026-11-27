const icons = {
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
  moon: <path d="M20.9 13.1A9 9 0 0 1 10.9 3.1a9 9 0 1 0 10 10Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  shield: <path d="M12 22s7-3.5 7-9V5l-7-3-7 3v8c0 5.5 7 9 7 9Z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M10 2h4l.7 2.3 1.7 1 2.4-.6 2 3.5-1.7 1.7v2l1.7 1.7-2 3.5-2.4-.6-1.7 1L14 20h-4l-.7-2.5-1.7-1-2.4.6-2-3.5 1.7-1.7v-2L3.2 8.2l2-3.5 2.4.6 1.7-1L10 2Z" transform="translate(0 1)" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  back: <path d="M19 12H5m7-7-7 7 7 7" />,
  search: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4 4" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  upload: <><path d="M12 16V4m-4 4 4-4 4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
  external: <path d="M13 5h6v6m0-6-8 8m6 0v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5" />,
  edit: <path d="m14 5 5 5M5 19l4.5-1 10-10a2 2 0 0 0-4-4l-10 10L5 19Z" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M15.5 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13m-8 4v5m4-5v5" />,
}

export function Icon({ name }: { name: keyof typeof icons }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    {icons[name]}
  </svg>
}
