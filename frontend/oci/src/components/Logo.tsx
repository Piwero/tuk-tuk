interface LogoProps {
  /** 21px sidebar brand (beside the 17px wordmark), 32px auth screen. */
  size?: number;
}

/** The Tuk Tuk mark: two `t` stems sharing one crossbar, each turning into a
 * foot at the bottom — the doubled name drawn as a single ligature. The feet
 * are load-bearing, not decoration: without them the three strokes read as a
 * hash rather than as letters.
 *
 * Authored on a 48-unit grid, which is also the grid the icon PNGs in
 * `public/icons/` are cut from — the geometry is recorded in
 * docs/design-system.md so the raster set can be regenerated from it. Scale
 * the mark with `size`; never edit the viewBox.
 *
 * Decorative by design. Everywhere it appears the "Tuk Tuk" wordmark is
 * already beside it, so giving the mark an accessible name would announce
 * the app twice. Paints with `currentColor`, exactly like the Lucide subset
 * in Icon.tsx, so the light and dark themes re-point it from CSS and this
 * component never learns which theme is on. */
export function Logo({ size = 21 }: LogoProps): JSX.Element {
  return (
    <svg
      className="logo"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M11.5 7.75h6v22.5q0 4 4 4h3.5v6h-3.5q-10 0-10-10z" />
      <path d="M27.5 7.75h6v22.5q0 4 4 4h3.5v6h-3.5q-10 0-10-10z" />
      <rect x="6.5" y="15.25" width="32" height="6" rx="3" />
    </svg>
  );
}
