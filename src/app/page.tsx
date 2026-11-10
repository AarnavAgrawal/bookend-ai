import type { Metadata } from "next";
import Link from "next/link";
import { HeroStage } from "@/components/landing/hero-stage";
import { OwnerPreview } from "@/components/landing/owner-preview";
import { Wordmark } from "@/components/landing/wordmark";

export const metadata: Metadata = {
  title: "Bookend: know your margin before the job is done",
  description:
    "Quote from what you actually paid, give every job a card of its own, turn overruns into change orders and close with the true margin.",
};

const STEPS = [
  {
    title: "Quote from what you actually paid",
    body: "Claude drafts the quote from your own spend history and receipts, and every line shows the evidence it came from. The arithmetic is done in code, not by the AI.",
  },
  {
    title: "A card for every job",
    body: "When the customer accepts, you approve a Ramp virtual card limited to the quoted materials plus tax. Your crew buys on it, and a live meter shows what's left.",
  },
  {
    title: "Overruns become change orders",
    body: "A purchase that would go over the limit is declined. The crew explains with a note and a photo, you raise the limit with one tap, and the customer agrees to the extra cost.",
  },
  {
    title: "Close with the true margin",
    body: "The crew wraps up with a voice note, the card freezes, and the invoice is drafted with receipts attached. You see what you billed minus what you actually spent and paid.",
  },
];

const TRADES = [
  {
    trade: "Plumbers",
    body: "Water heaters, repipes and remodels, where the wall you open decides the parts list.",
  },
  {
    trade: "Electricians",
    body: "Panel swaps and rewires, where the code upgrade shows up once the cover comes off.",
  },
  {
    trade: "Caterers",
    body: "Events where the headcount climbs the week before, and the grocery order has to follow it.",
  },
];

const container = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";

export default function LandingPage() {
  return (
    <div className="overflow-x-clip">
      <header className={`${container} flex items-center justify-between gap-4 py-5`}>
        <Link href="/" aria-label="Bookend home" className="-m-1 p-1">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-5 text-sm font-medium sm:gap-7">
          <a href="#how" className="hidden hover:underline sm:inline">
            How it works
          </a>
          <a href="#who" className="hidden hover:underline md:inline">
            Who it&apos;s for
          </a>
          <Link href="/sign-in" className="hover:underline">
            Sign in
          </Link>
          <Link href="/dashboard" className="btn hidden min-h-10 py-1.5 text-sm sm:inline-flex">
            Get started
          </Link>
        </nav>
      </header>

      <main>
        <section aria-labelledby="hero-title" className={`${container} pb-20 pt-10 sm:pt-16 lg:pb-28`}>
          <div className="grid gap-8 lg:grid-cols-12 lg:items-end lg:gap-10">
            <h1
              id="hero-title"
              className="text-[3.4rem] font-bold leading-[0.92] tracking-[-0.01em] sm:text-7xl lg:col-span-7 lg:text-[6.5rem]"
            >
              Know your margin before the job is done.
            </h1>
            <div className="lg:col-span-5 lg:pb-3">
              <p className="max-w-[46ch] text-lg leading-relaxed">
                Bookend quotes each job from what you&apos;ve actually paid, gives it a Ramp card capped at the
                quoted materials, and turns any overrun into a change order your customer agrees to.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link href="/dashboard" className="btn btn-amber px-6 text-lg focus-visible:outline-ink">
                  Get started
                </Link>
                <a href="#how" className="btn btn-quiet px-6 text-lg">
                  See how it works
                </a>
              </div>
            </div>
          </div>

          <div className="mt-12 sm:mt-16">
            <HeroStage />
          </div>
        </section>

        <section id="how" aria-labelledby="how-title" className="scroll-mt-6 border-t border-line">
          <div className={`${container} py-20 lg:py-28`}>
            <h2 id="how-title" className="max-w-[18ch] text-5xl font-bold sm:text-6xl">
              How a job runs on Bookend
            </h2>
            <p className="mt-4 max-w-[60ch] text-lg text-muted">
              Four steps, from the first quote to the last receipt. Each one hands the next a number you can check.
            </p>

            <div className="relative mt-14">
              {/* The steps sit on a rail: the quote at the ink end, the outcome at the amber end. */}
              <div
                aria-hidden="true"
                className="absolute inset-y-0 left-0 flex w-4 flex-col items-center md:static md:mb-8 md:h-8 md:w-full md:flex-row"
              >
                <span className="h-2 w-4 bg-ink md:h-8 md:w-2.5" />
                <span className="w-1.5 flex-1 bg-line md:h-2 md:w-auto" />
                <span className="h-2 w-4 bg-amber md:h-8 md:w-2.5" />
              </div>
              <ol className="grid gap-12 pl-10 md:grid-cols-4 md:gap-8 md:pl-0">
                {STEPS.map((step, i) => (
                  <li key={step.title}>
                    <span aria-hidden="true" className="money block text-6xl leading-none">
                      {i + 1}
                    </span>
                    <h3 className="mt-3 text-[1.75rem] font-semibold">
                      <span className="sr-only">Step {i + 1}: </span>
                      {step.title}
                    </h3>
                    <p className="mt-3 max-w-[42ch] leading-relaxed">{step.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section aria-labelledby="preview-title" className="border-t border-line bg-[#EFEDE6]">
          <div className={`${container} grid gap-12 py-20 lg:grid-cols-12 lg:gap-10 lg:py-28`}>
            <div className="lg:col-span-5">
              <h2 id="preview-title" className="max-w-[16ch] text-5xl font-bold sm:text-6xl">
                What you see when a card says no
              </h2>
              <p className="mt-5 max-w-[46ch] text-lg leading-relaxed">
                A decline doesn&apos;t strand the crew at the counter. It lands on the job as a decision, with
                everything you need to make it from the truck.
              </p>
              <ul className="mt-8 max-w-[46ch] space-y-5">
                <li className="border-l-4 border-ink pl-4">
                  <p className="font-semibold">The quote, with its evidence</p>
                  <p className="text-muted">Each line points to the receipt or past job its price came from.</p>
                </li>
                <li className="border-l-4 border-red pl-4">
                  <p className="font-semibold">The crew&apos;s reason</p>
                  <p className="text-muted">A note and a photo from the site, sent with the declined purchase.</p>
                </li>
                <li className="border-l-4 border-amber pl-4">
                  <p className="font-semibold">The new limit, already worked out</p>
                  <p className="text-muted">
                    One tap raises the card and sends the customer the change order to agree to.
                  </p>
                </li>
              </ul>
            </div>
            <div className="lg:col-span-7">
              <OwnerPreview />
            </div>
          </div>
        </section>

        <section id="who" aria-labelledby="who-title" className="scroll-mt-6 border-t border-line">
          <div className={`${container} py-20 lg:py-28`}>
            <h2 id="who-title" className="max-w-[20ch] text-5xl font-bold sm:text-6xl">
              For businesses that buy the materials for every job
            </h2>
            <dl className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
              {TRADES.map((t) => (
                <div key={t.trade} className="border-t-2 border-ink pt-4">
                  <dt className="font-display text-3xl font-semibold">{t.trade}</dt>
                  <dd className="mt-2 max-w-[38ch] text-lg leading-relaxed">{t.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="cta-title" className="bg-ink text-paper">
          <div className={`${container} flex flex-col gap-8 py-16 md:flex-row md:items-end md:justify-between lg:py-20`}>
            <div>
              <h2 id="cta-title" className="max-w-[18ch] text-5xl font-bold sm:text-6xl">
                Put your next job on a card of its own.
              </h2>
              <p className="mt-4 max-w-[52ch] text-lg text-paper/80">
                Connect Ramp, set your rates, and quote your first job from what you&apos;ve already paid.
              </p>
            </div>
            <Link href="/dashboard" className="btn btn-amber shrink-0 self-start px-7 text-lg md:self-auto">
              Get started
            </Link>
          </div>
        </section>
      </main>

      <footer className={`${container} flex flex-col gap-4 py-10 sm:flex-row sm:items-center sm:justify-between`}>
        <Wordmark size="text-xl" />
        <p className="text-sm text-muted">Built on the Ramp API. Sandbox demo: no real money moves.</p>
      </footer>
    </div>
  );
}
