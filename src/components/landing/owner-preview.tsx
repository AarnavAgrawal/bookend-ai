/**
 * What the owner sees at the moment a card declines, drawn with the app's own
 * ticket, rail and button styles. It is a picture of the product, so nothing in
 * it is interactive.
 */

const QUOTE_LINES = [
  {
    item: "50-gallon gas water heater",
    evidence: "You paid $640.00 at Harbor Plumbing Supply on Oct 2",
    amount: "$640.00",
  },
  {
    item: "Valves, fittings, gas flex line",
    evidence: "Your average on the last 4 water heater jobs",
    amount: "$128.00",
  },
  {
    item: "Venting, solder, pipe straps",
    evidence: "You paid $82.00 at Eastside Hardware on Sept 18",
    amount: "$82.00",
  },
  { item: "Sales tax on materials", evidence: "Your local rate", amount: "$50.00" },
  { item: "Install and haul-away", evidence: "6 hours at your $150 rate", amount: "$900.00" },
];

function DeclinedRail() {
  // $850 of $900 spent; red because the card just refused a purchase.
  return (
    <div className="flex h-5 items-stretch">
      <div className="w-2 bg-ink" />
      <div className="flex-1 bg-line">
        <div className="h-full bg-red" style={{ width: `${(850 / 900) * 100}%` }} />
      </div>
      <div className="w-2 bg-red" />
    </div>
  );
}

function FluePhoto() {
  return (
    <svg viewBox="0 0 96 96" className="h-20 w-20 shrink-0 bg-[#cfccc3] sm:h-24 sm:w-24" role="img" aria-label="Crew photo of the corroded flue">
      <rect x="0" y="62" width="96" height="34" fill="#b9b5aa" />
      <rect x="38" y="0" width="22" height="70" fill="#8d8a82" />
      <rect x="34" y="34" width="30" height="8" fill="#76736c" />
      <path d="M38 42 h22 v10 l-6 -3 -5 4 -6 -3 -5 3 z" fill="#9c5a2c" />
      <circle cx="44" cy="50" r="3" fill="#7a3f1c" />
      <circle cx="55" cy="47" r="2" fill="#7a3f1c" />
      <rect x="26" y="70" width="46" height="26" fill="#6f6d67" />
    </svg>
  );
}

export function OwnerPreview() {
  return (
    <figure className="ticket px-4 py-5 sm:px-6" aria-label="Example of a job in Bookend at the moment its card declines a purchase">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div>
          <p className="font-display text-2xl font-semibold leading-tight">Water heater replacement</p>
          <p className="text-sm text-muted">Whitfield residence, 418 Alder St.</p>
        </div>
        <p className="text-sm font-semibold text-redtext">Card declined: decide</p>
      </div>

      <div className="mt-5">
        <p className="text-sm font-semibold text-muted">Quote, accepted Nov 3</p>
        <table className="mt-1 w-full text-left">
          <tbody className="divide-y divide-line border-y border-line">
            {QUOTE_LINES.map((line) => (
              <tr key={line.item} className="align-baseline">
                <td className="py-2 pr-4">
                  <span className="block">{line.item}</span>
                  <span className="block text-sm text-muted">{line.evidence}</span>
                </td>
                <td className="money py-2 text-right text-lg">{line.amount}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-2 font-display text-xl font-semibold">Total</td>
              <td className="money pt-2 text-right text-xl">$1,800.00</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-6">
        <div className="mb-1.5 flex items-baseline justify-between gap-4 text-sm">
          <span className="text-muted">Card ending 4417</span>
          <span>
            <span className="money text-base">$850.00</span> <span className="text-muted">of</span>{" "}
            <span className="money text-base">$900.00</span>
          </span>
        </div>
        <DeclinedRail />
      </div>

      <div className="mt-6 border-l-4 border-red bg-paper p-4">
        <p className="font-semibold">
          Declined: <span className="money text-lg">$250.00</span> at Harbor Plumbing Supply
        </p>
        <div className="mt-3 flex gap-4">
          <FluePhoto />
          <blockquote className="text-ink">
            <p>&ldquo;The old flue is rotted through at the collar. It has to be replaced before the new heater can vent.&rdquo;</p>
            <footer className="mt-1 text-sm text-muted">Marco, on site, 2:12 pm</footer>
          </blockquote>
        </div>
        <p className="mt-4 text-sm text-muted">
          Raising the limit to $1,100.00 lets the purchase through and sends the customer a $250.00 change order to
          agree to.
        </p>
        <div className="mt-3 flex flex-wrap gap-3" aria-hidden="true">
          <span className="btn btn-amber">Raise limit to $1,100</span>
          <span className="btn btn-quiet">Not now</span>
        </div>
      </div>
    </figure>
  );
}
