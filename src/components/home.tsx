// Presentational landing content, kept free of server-only APIs so the same
// component can be rendered by React Testing Library under jsdom.
export function Home() {
  return (
    <main>
      <h1>pinata</h1>
      <p>
        <strong>pin</strong> + <strong>anno</strong>tation + at <strong>ya</strong>
      </p>
      <p>
        A lightweight workspace for giving directional feedback on public
        websites: pin a note to the exact spot on a static page capture, share a
        link, get the founder&apos;s reply. No source edits, no crawling, no
        runtime AI.
      </p>
    </main>
  );
}
