// R67 E-27, under programme decision D-09: a FORK of the kit's LinkListCard
// into projexa, not an edit of node_modules and not a kit release.
//
// WHY IT HAD TO BE FORKED. The kit's LinkListItem is `{ label, onClick }` --
// every entry is a <button>. That is fine for the Quick actions card it was
// written for, where the actions are verbs. A page whose whole purpose is
// navigation cannot be built of buttons: a button cannot be middle-clicked
// into a new tab, cannot be copied as a link, has no destination in the status
// bar, and gives a screen reader no href to announce. This fork takes an
// `href` and renders a real <Link>, and keeps the kit's markup, spacing and
// trailing arrow exactly so the two do not look like different components.
//
// Everything else on the /analysis page is still the kit's.
import Link from "next/link";

export type ProjexaLinkListItem = {
  label: string;
  href: string;
  /** One line under the label saying what the destination answers. */
  description?: string;
  /** Set when the link works but will land on an unscoped screen -- shown, never hidden. */
  note?: string;
};

export function ProjexaLinkListCard({ title, items }: { title: string; items: ProjexaLinkListItem[] }) {
  return (
    <div className="rounded-md border border-ct-border p-3">
      <h3 className="mb-2 text-[13px] font-medium text-ct-navy">{title}</h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="text-[12.5px] text-ct-teal hover:underline">
              {item.label} →
            </Link>
            {item.description && <p className="text-[11.5px] text-ct-muted">{item.description}</p>}
            {item.note && <p className="text-[11.5px] text-px-muted">{item.note}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
