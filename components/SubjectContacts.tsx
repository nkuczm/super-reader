"use client";

import { useState } from "react";
import { authorsOf, cleanLinkedIn, contactId, safeImage, type Card, type ContactItem } from "@/lib/subjects";

const HIDE_SUGGESTED_KEY = "super-reader:hide-suggested-contacts";

/**
 * The subject's contacts: people to interview, from the stories and
 * suggested beside them. Details come from the stories or from the reader —
 * the AI is never asked to guess an address.
 */
export default function SubjectContacts({
  contacts,
  cards,
  running,
  canRun,
  onRun,
  onSave,
  onRemove,
  onAdd,
  onOpenCard,
  dismissedIds,
}: {
  contacts: ContactItem[];
  cards: Card[];
  running: boolean;
  canRun: boolean;
  onRun: () => void;
  onSave: (contact: ContactItem) => void;
  onRemove: (contact: ContactItem) => void;
  onAdd: (name: string, role: string) => void;
  onOpenCard: (card: Card) => void;
  /** People removed from the list, so an author removed is not brought back. */
  dismissedIds: string[];
}) {
  const [adding, setAdding] = useState<{ name: string; role: string } | null>(null);
  // The stories' own authors are contacts without asking: a byline is the
  // surest lead there is. One removed stays removed (a dismissed item).
  const held = new Map(contacts.map((c) => [c.id, c]));
  const dismissed = new Set(dismissedIds);
  const authors: ContactItem[] = authorsOf(cards).flatMap(({ name, refs }) => {
    const id = contactId(name);
    if (dismissed.has(id)) return [];
    const mine = held.get(id);
    return [
      mine
        ? { ...mine, refs: [...new Set([...refs, ...mine.refs])] }
        : { id, kind: "contact" as const, name, role: "Author", why: "", refs, origin: "story" as const, state: "kept" as const, at: 0 },
    ];
  });
  // People you mean to reach, or have, come first of all — in whichever
  // list they started — the ones still to reach at the very top.
  const outreach = [...authors, ...contacts.filter((c) => !authors.some((a) => a.id === c.id))]
    .filter((c) => c.outreach)
    .sort((a, b) => (a.outreach === b.outreach ? 0 : a.outreach === "want" ? -1 : 1));
  const reaching = new Set(outreach.map((c) => c.id));
  const authorIds = new Set(authors.map((a) => a.id));
  const fromStories = contacts.filter((c) => c.origin === "story" && !authorIds.has(c.id) && !reaching.has(c.id));
  // Then yours: people you added, and suggestions you picked as worth contacting.
  const yours = contacts.filter((c) => !reaching.has(c.id) && (c.origin === "you" || (c.origin === "suggested" && c.state === "kept")));
  const suggested = contacts.filter((c) => c.origin === "suggested" && c.state !== "kept" && !reaching.has(c.id));
  const [hideSuggested, setHideSuggested] = useState(() => {
    try {
      return localStorage.getItem(HIDE_SUGGESTED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleSuggested = () =>
    setHideSuggested((v) => {
      try {
        localStorage.setItem(HIDE_SUGGESTED_KEY, v ? "0" : "1");
      } catch {
        /* not remembered */
      }
      return !v;
    });
  const byId = new Map(cards.map((card) => [card.id, card]));

  const section = (title: string, list: ContactItem[], note?: string, refsLabel?: (n: number) => string) =>
    list.length > 0 && (
      <section className="contacts-section">
        {title && <h2>{title}</h2>}
        {note && <p className="sub">{note}</p>}
        <ul className="contacts-list">
          {list.map((contact) => (
            <ContactRow
              key={contact.id}
              contact={contact}
              // Only someone actually in the stories has stories to list.
              stories={contact.origin === "suggested" ? [] : contact.refs.map((ref) => byId.get(ref)).filter((c): c is Card => !!c)}
              refsLabel={refsLabel ?? ((n) => `Mentioned in ${n} ${n === 1 ? "story" : "stories"}`)}
              onSave={onSave}
              onRemove={onRemove}
              onOpenCard={onOpenCard}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <div className="contacts-page">
      <div className="contacts-bar">
        <button className="btn ghost small" disabled={!canRun || running} onClick={onRun}
          title="Look through the stories for people to interview">
          {running ? "Finding people…" : "✦ Find people"}
        </button>
        <button className="btn ghost small" onClick={() => setAdding({ name: "", role: "" })}>+ Add contact</button>
      </div>
      {adding && (
        <form
          className="contact-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (adding.name.trim()) onAdd(adding.name.trim(), adding.role.trim());
            setAdding(null);
          }}
        >
          <input className="input" autoFocus placeholder="Name" value={adding.name}
            onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
          <input className="input" placeholder="Role or organisation" value={adding.role}
            onChange={(e) => setAdding({ ...adding, role: e.target.value })} />
          <button className="btn small" disabled={!adding.name.trim()}>Add</button>
          <button type="button" className="link-btn" onClick={() => setAdding(null)}>Cancel</button>
        </form>
      )}
      {contacts.length === 0 && !adding && (
        <p className="contacts-empty">
          No contacts yet. <b>Find people</b> reads this subject&apos;s stories for the people in them and those connected
          to them — or add someone yourself.
        </p>
      )}
      {section("Reaching out", outreach)}
      {section("Your contacts", yours)}
      {section("Authors", authors.filter((a) => !reaching.has(a.id)), undefined, (n) => `Wrote ${n} ${n === 1 ? "story" : "stories"} here`)}
      {section("In the stories", fromStories)}
      {suggested.length > 0 && (
        <div className="contacts-suggested-head">
          <h2>Suggested</h2>
          <button className="link-btn" onClick={toggleSuggested}>{hideSuggested ? `Show (${suggested.length})` : "Hide"}</button>
        </div>
      )}
      {!hideSuggested && section("", suggested)}
    </div>
  );
}

function ContactRow({
  contact,
  stories,
  onSave,
  onRemove,
  onOpenCard,
  refsLabel,
}: {
  refsLabel: (n: number) => string;
  contact: ContactItem;
  stories: Card[];
  onSave: (contact: ContactItem) => void;
  onRemove: (contact: ContactItem) => void;
  onOpenCard: (card: Card) => void;
}) {
  /** All three details at once — any, all or none of them filled in. */
  const [editing, setEditing] = useState<{ email: string; phone: string; linkedin: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [showRefs, setShowRefs] = useState(false);

  const save = () => {
    if (!editing) return;
    const email = editing.email.trim();
    const phone = editing.phone.trim();
    const linkedinRaw = editing.linkedin.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return setProblem("That email doesn't look right.");
    if (phone && phone.replace(/\D/g, "").length < 6) return setProblem("That phone number doesn't look right.");
    const linkedin = linkedinRaw ? cleanLinkedIn(linkedinRaw) : null;
    if (linkedinRaw && !linkedin) return setProblem("That doesn't look like a LinkedIn profile link.");
    onSave({
      ...contact,
      email: email || undefined,
      // Still "from the story" if it is the address the story gave.
      emailFrom: email ? (email === contact.email ? contact.emailFrom : "you") : undefined,
      phone: phone || undefined,
      linkedin: linkedin ?? undefined,
      state: "kept",
    });
    setEditing(null);
    setProblem(null);
  };

  return (
    <li className={`contact${contact.state === "pending" && contact.origin === "suggested" ? " pending" : ""}${contact.outreach ? ` outreach-${contact.outreach}` : ""}${contact.origin === "suggested" && contact.state === "kept" ? " picked" : ""}`}>
      <div className="contact-main">
        <div className="contact-name">
          <span className="contact-avatar" aria-hidden="true">
            {safeImage(contact.photo) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={safeImage(contact.photo)} alt="" />
            ) : (
              contact.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
            )}
          </span>
          {contact.name}
          {contact.role && <span className="contact-role">{contact.role}</span>}
          {contact.origin === "suggested" && contact.state === "kept" && <span className="contact-badge picked">Picked</span>}
        </div>
        <div className="contact-outreach" role="group" aria-label="Outreach">
          <button
            className={`outreach-btn${contact.outreach === "want" ? " on" : ""}`}
            aria-pressed={contact.outreach === "want"}
            title="Mark as someone to interview or contact"
            onClick={() => onSave({ ...contact, outreach: contact.outreach === "want" ? undefined : "want", state: "kept" })}
          >
            ☆ Want to contact
          </button>
          <button
            className={`outreach-btn reached${contact.outreach === "reached" ? " on" : ""}`}
            aria-pressed={contact.outreach === "reached"}
            title="Mark that you got in touch"
            onClick={() => onSave({ ...contact, outreach: contact.outreach === "reached" ? "want" : "reached", state: "kept" })}
          >
            ✓ In touch
          </button>
        </div>
        {contact.why && <p className="contact-why">{contact.why}</p>}
        {stories.length > 0 && (
          <div className="contact-refs">
            <button className="link-btn contact-refs-toggle" aria-expanded={showRefs} onClick={() => setShowRefs((v) => !v)}>
              {refsLabel(stories.length)} {showRefs ? "▾" : "▸"}
            </button>
            {showRefs && (
              <ul>
                {stories.map((card) => (
                  <li key={card.id}>
                    <button className="link-btn" onClick={() => onOpenCard(card)}>{card.title}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="contact-details">
          {contact.email && (
            <a href={`mailto:${contact.email}`}>
              {contact.email}
              {contact.emailFrom === "story" && <span className="contact-from"> · from the story</span>}
            </a>
          )}
          {contact.phone && <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>{contact.phone}</a>}
          {contact.linkedin && cleanLinkedIn(contact.linkedin) && (
            <a href={cleanLinkedIn(contact.linkedin)!} target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>
          )}
          {!contact.email && !contact.phone && !contact.linkedin && !editing && <span className="contact-none">No email found in the stories</span>}
        </div>
        <textarea
          className="contact-notes"
          placeholder="Notes…"
          defaultValue={contact.notes ?? ""}
          rows={1}
          ref={(el) => {
            // Tall enough for notes already written.
            if (el && el.value) {
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
          onBlur={(e) => {
            const value = e.currentTarget.value.slice(0, 4000);
            if (value !== (contact.notes ?? "")) onSave({ ...contact, notes: value || undefined, state: "kept" });
          }}
        />
        {editing ? (
          <form
            noValidate
            className="contact-edit"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
            onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
          >
            {(
              [
                ["email", "Email", "email", "name@example.com"],
                ["phone", "Phone", "tel", "+1 555 010 0000"],
                // Plain text, checked by cleanLinkedIn: a "url" field would
                // silently refuse "linkedin.com/in/…" for lacking https://.
                ["linkedin", "LinkedIn", "text", "linkedin.com/in/name"],
              ] as const
            ).map(([key, label, type, placeholder], i) => (
              <label key={key} className="contact-field">
                <span>{label}</span>
                <input
                  className="input"
                  autoFocus={i === 0}
                  type={type}
                  placeholder={placeholder}
                  value={editing[key]}
                  onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                />
              </label>
            ))}
            {problem && <span className="signin-error">{problem}</span>}
            <div className="contact-edit-actions">
              <button className="btn small">Save</button>
              <button type="button" className="link-btn" onClick={() => { setEditing(null); setProblem(null); }}>Cancel</button>
            </div>
          </form>
        ) : (
          <button
            className="link-btn contact-add-detail"
            onClick={() => setEditing({ email: contact.email ?? "", phone: contact.phone ?? "", linkedin: contact.linkedin ?? "" })}
          >
            {contact.email || contact.phone || contact.linkedin ? "Edit email, phone, LinkedIn" : "Add email, phone, LinkedIn"}
          </button>
        )}
      </div>
      <div className="contact-actions">
        {contact.state === "pending" && contact.origin === "suggested" && (
          <button className="decide accept" aria-label={`Keep ${contact.name}`} title="Keep"
            onClick={() => onSave({ ...contact, state: "kept" })}>✓</button>
        )}
        <button className="decide dismiss" aria-label={`Remove ${contact.name}`} title="Remove"
          onClick={() => onRemove(contact)}>✕</button>
      </div>
    </li>
  );
}
