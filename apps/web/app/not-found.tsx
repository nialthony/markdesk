import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <main className="emptyPage">
      <Logo />
      <p className="eyebrow">404 / NOT FOUND</p>
      <h1>This order does not exist.</h1>
      <a className="primaryButton" href="/">
        Return to market board
      </a>
    </main>
  );
}
