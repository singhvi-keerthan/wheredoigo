"use client";

// A database or Swiggy hiccup shouldn't show a raw 500: say what happened and
// offer the one useful action.
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="wrap">
      <header className="masthead">
        <p className="wordmark">Coffee run</p>
      </header>
      <section className="ticket">
        <h1 className="ask">The order board didn&apos;t load</h1>
        <p className="ask-sub">Usually a brief connection blip. Your usual and today&apos;s choice are saved.</p>
        <div className="perf" aria-hidden />
        <button className="btn go" onClick={() => reset()}>
          Try again
        </button>
      </section>
    </main>
  );
}
