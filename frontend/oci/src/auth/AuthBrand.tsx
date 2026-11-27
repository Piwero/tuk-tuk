import { Logo } from "../components/Logo";

/** The mark and wordmark heading the sign-in and setup cards. The mark is
 * decorative (Logo.tsx); the wordmark beside it carries the name. */
export function AuthBrand(): React.JSX.Element {
  return (
    <div className="auth-gate-brand">
      <Logo size={32} />
      <span>Tuk Tuk</span>
    </div>
  );
}
